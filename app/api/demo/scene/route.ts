/**
 * The whole operational picture at one moment, for one set of crew positions.
 *
 * Stateless by design. The commander scrubs a timeline and drags crew markers
 * around; every request carries the time and the positions, and the same
 * request always returns the same answer. Nothing accumulates server-side, so
 * scrubbing backwards works and the picture cannot drift out of step with the
 * timeline.
 *
 * Geometry is returned as a radius-per-bearing array plus the projection
 * constants, not as finished polygons. The client rebuilds the fire outline and
 * each firefighter's two contours from that, which keeps a scrub response
 * around 2 KB instead of shipping a dozen 180-point rings.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { z } from "zod";

import { badRequest, ok } from "@/lib/api/respond";
import { prisma } from "@/lib/db/client";
import { toHealthProfile } from "@/lib/incident/mapping";
import { INCIDENT_CENTRE } from "@/lib/sim/simulator";
import {
  areaFractionAt,
  INCIDENT,
  M_PER_DEG_LAT,
  M_PER_DEG_LNG,
  PEAK_ACRES,
  perimeterRadiiAt,
  PROFILE_BEARINGS,
  radialProfile,
  TIMELINE_END_MS,
  TIMELINE_START_MS,
  toLngLat,
} from "@/lib/sim/palisades";
import {
  baseAt,
  reconDronesAt,
  responseDronesAt,
  type DroneDispatch,
} from "@/lib/sim/drones";
import { assessCrewMember, MAX_OFFSET_M, type CrewPlacement } from "@/lib/sim/scene";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  atMs: z.number().int().finite(),
  crew: z
    .array(
      z.object({
        callsign: z.string().min(1),
        lat: z.number().gte(-90).lte(90),
        lng: z.number().gte(-180).lte(180),
      }),
    )
    .max(50)
    .optional(),
  /**
   * Response drones the commander has launched. Carried in the request like
   * everything else, so the scene stays a pure function of its inputs and
   * scrubbing back before a dispatch correctly shows the drone still at base.
   */
  dispatches: z
    .array(
      z.object({
        id: z.string().min(1),
        targetCallsign: z.string().min(1),
        targetLat: z.number().gte(-90).lte(90),
        targetLng: z.number().gte(-180).lte(180),
        dispatchedAtMs: z.number().int().finite(),
      }),
    )
    .max(20)
    .optional(),
});

/**
 * Where the crew stand before anyone drags them.
 *
 * Placed as a FRACTION of the final perimeter radius on their own bearing,
 * rather than at an absolute distance. The perimeter is very lopsided — a few
 * hundred metres on some bearings, 13 km on others — so fixed distances would
 * put every crew either inside the fire from the first day or permanently clear
 * of it. Expressed as fractions, a crew at 0.55 is overrun once the fire
 * reaches 30% of its final area, one at 0.75 at 56%, and anything above 1.0 is
 * never overrun. That staggers the timeline so there is always a crew about to
 * be in trouble and a crew still safe to compare them against.
 *
 * Positions are INVENTED for the demonstration. The real deployment is not
 * public and is never guessed at.
 */
const DEFAULT_PLACEMENTS: {
  callsign: string;
  bearingDeg: number;
  fractionOfFinalRadius: number;
}[] = [
  { callsign: "ALPHA-1", bearingDeg: 30, fractionOfFinalRadius: 0.55 },
  { callsign: "ALPHA-2", bearingDeg: 48, fractionOfFinalRadius: 0.75 },
  { callsign: "BRAVO-1", bearingDeg: 80, fractionOfFinalRadius: 0.95 },
  { callsign: "BRAVO-2", bearingDeg: 104, fractionOfFinalRadius: 1.15 },
  { callsign: "CHARLIE-1", bearingDeg: 340, fractionOfFinalRadius: 1.35 },
  { callsign: "CHARLIE-2", bearingDeg: 310, fractionOfFinalRadius: 1.8 },
];

/** Resolve the fraction-of-radius placements against the observed perimeter. */
function defaultPlacements(): CrewPlacement[] {
  const profile = radialProfile();
  return DEFAULT_PLACEMENTS.map((p) => {
    const index = Math.round((p.bearingDeg / 360) * PROFILE_BEARINGS) % PROFILE_BEARINGS;
    const angle = (p.bearingDeg * Math.PI) / 180;
    // Some bearings point out to sea and never burn, so the profile is zero
    // there; fall back to a sensible standoff rather than stacking on the origin.
    const finalRadius = profile[index] === undefined || profile[index] === 0
      ? 4_000
      : (profile[index] as number);
    const r = finalRadius * p.fractionOfFinalRadius;
    const [lng, lat] = toLngLat(Math.sin(angle) * r, Math.cos(angle) * r);
    return { callsign: p.callsign, lat, lng };
  });
}

export async function POST(request: Request) {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Body must be JSON");
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) return badRequest(parsed.error.issues[0]?.message ?? "Invalid body");

  const atMs = Math.max(TIMELINE_START_MS, Math.min(TIMELINE_END_MS, parsed.data.atMs));

  const firefighters = await prisma.firefighterProfile.findMany({
    orderBy: { callsign: "asc" },
  });

  const placements: CrewPlacement[] =
    parsed.data.crew !== undefined && parsed.data.crew.length > 0
      ? parsed.data.crew
      : defaultPlacements();

  const recon = reconDronesAt(atMs);
  const dispatches: DroneDispatch[] = parsed.data.dispatches ?? [];
  const response = responseDronesAt(atMs, dispatches);
  const [baseLng, baseLat] = baseAt(atMs);

  const crew = [];
  for (const placement of placements) {
    const row = firefighters.find((f) => f.callsign === placement.callsign);
    if (row === undefined) continue;

    const profile = toHealthProfile(row);
    const assessment = assessCrewMember(profile, placement, atMs, recon);

    crew.push({
      ...assessment,
      ageYears: row.ageYears,
      fitness: row.fitness,
      conditions: JSON.parse(row.conditionsJson) as string[],
    });
  }

  const radii = perimeterRadiiAt(atMs);

  return ok({
    atMs,
    atUtc: new Date(atMs).toISOString(),
    timelineStartMs: TIMELINE_START_MS,
    timelineEndMs: TIMELINE_END_MS,
    areaFraction: Math.round(areaFractionAt(atMs) * 1000) / 1000,
    /** Interpolated from the published acreage record. Approximate. */
    acres: Math.round(areaFractionAt(atMs) * PEAK_ACRES),
    fireMaxRadiusM: Math.round(Math.max(...radii)),
    maxOffsetM: MAX_OFFSET_M,

    /** Radius of the fire outline on each bearing, metres from the origin. */
    perimeterRadii: radii.map((r) => Math.round(r)),

    /**
     * Everything needed to turn a radius array into lng/lat. Bearing b of N is
     * measured clockwise from north: east = sin(θ)·r, north = cos(θ)·r.
     */
    geo: {
      originLat: INCIDENT_CENTRE.lat,
      originLng: INCIDENT_CENTRE.lng,
      mPerDegLat: M_PER_DEG_LAT,
      mPerDegLng: M_PER_DEG_LNG,
      bearings: PROFILE_BEARINGS,
    },

    crew,

    /**
     * Recon drones on station, plus any response drones the commander has
     * launched. Recon footprints are what decide whether a firefighter's air
     * data is current; see the provenance note below.
     */
    drones: [...recon, ...response],
    droneBase: { lat: baseLat, lng: baseLng },

    /**
     * Facts lifted verbatim from the interagency incident record, stored in
     * the repository next to the perimeter they describe.
     */
    incidentRecord: {
      name: INCIDENT.name,
      uniqueFireId: INCIDENT.uniqueFireId,
      irwinId: INCIDENT.irwinId,
      discoveryUtc: new Date(INCIDENT.discoveryMs).toISOString(),
      closedUtc: new Date(INCIDENT.containmentMs).toISOString(),
      finalAcres: INCIDENT.finalAcres,
      mapMethod: INCIDENT.mapMethod,
      polygonSource: INCIDENT.polygonSource,
      polygonStampUtc:
        INCIDENT.polygonStampMs === 0
          ? null
          : new Date(INCIDENT.polygonStampMs).toISOString(),
      recordUpdatedUtc:
        INCIDENT.recordUpdatedMs === 0
          ? null
          : new Date(INCIDENT.recordUpdatedMs).toISOString(),
      primaryFuel: INCIDENT.primaryFuel,
      protectingUnit: INCIDENT.protectingUnit,
      percentContained: INCIDENT.percentContained,
    },

    provenance: {
      perimeterShape:
        "REAL (Tier A) — NIFC WFIGS observed perimeter, mapped by IR image interpretation, 23,448 acres. Public domain.",
      timelineEndpoints:
        "REAL — discovery and incident-close times are read from the interagency record, not typed in.",
      growthTiming:
        "UNVERIFIED — intermediate acreages are transcribed from contemporaneous public reporting, not the CAL FIRE archive. They shape the curve only; no risk output depends on them.",
      intermediateShape:
        "SYNTHETIC (Tier C) — every perimeter before the fire reaches full size is interpolated by area-scaling the observed outline. The real fire did not grow self-similarly; it ran downslope and downwind first. NOT a fire behaviour prediction.",
      polygonDateCaveat:
        "The polygon is stamped 2025-01-08T14:31Z but was last revised 2025-01-21T23:43Z and measures the final 23,448 acres. The capture stamp cannot be read as the fire's size at that moment, so it is treated as a final footprint rather than a dated snapshot.",
      atmosphere:
        "SYNTHETIC (Tier C) — exponential falloff of CO, PM2.5 and heat with hand-chosen scale lengths. No wind, terrain or plume model. This drives the ABSOLUTE contour distances, so treat the ordering between firefighters as meaningful and the metres as illustrative.",
      crewPositions: "INVENTED for the demonstration. Real deployment positions are not public.",
      riskEngine: "REAL — production assessRisk and derivePhysiology, unmodified.",
      drones:
        "SYNTHETIC (Tier C) — no drone integration exists. No airframe, autopilot, vendor or datalink is modelled. Recon footprints decide only whether a firefighter's air data is treated as current; response drones are dispatched by the commander and never automatically.",
    },
  });
}
