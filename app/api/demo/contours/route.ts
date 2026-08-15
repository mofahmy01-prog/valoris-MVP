/**
 * Personalised risk contours.
 *
 * The question this answers is not "how far away is the fire" but "if THIS
 * firefighter stood at that point, what would the engine say about them". Two
 * people standing side by side get different contours, because the engine
 * scores them against thresholds calibrated to their age, fitness and
 * conditions. That difference is the whole point of Valoris, and here it is a
 * shape on a map rather than a number in a table.
 *
 * Honest method: no geometry is invented and no buffer constant is applied. For
 * each candidate point it reconstructs what the atmosphere would be there —
 * using the same model the simulator uses to report CO, PM2.5 and heat — and
 * runs the REAL `assessRisk` against that firefighter's current vitals. A
 * contour is drawn wherever the engine's own answer changes. No second scoring
 * path.
 *
 * The sweep runs on every bearing, not one. The front is a wind-driven ellipse,
 * so air on the downwind flank is far worse than air abeam at the same range;
 * a single-bearing sweep produced circular rings that disagreed with the band
 * firefighters were actually reporting. Per-bearing, the contour bulges downwind
 * exactly as the smoke does.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { prisma } from "@/lib/db/client";
import { notFound, ok } from "@/lib/api/respond";
import {
  toEnvironment,
  toHealthProfile,
  toPosition,
  toVitals,
} from "@/lib/incident/mapping";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import { BAND_SEVERITY } from "@/lib/risk/bands";
import type { Environment, Position, RiskBand } from "@/lib/risk/types";
import { simState } from "@/lib/sim/runtime";
import {
  atmosphereFor,
  frontRadiusToward,
  toLatLng,
  type Callsign,
  type FirefighterSimState,
  type SimState,
} from "@/lib/sim/simulator";

export const dynamic = "force-dynamic";

/** How far beyond the front to search, and at what resolution. */
const MAX_DISTANCE_M = 3000;
const STEPS = 60;
/** Bearings sampled around the fire when building a contour polygon. */
const BEARINGS = 48;

type LngLat = [number, number];

/** Bands whose regions get their own contour, worst first. */
const CONTOUR_BANDS = ["HIGH", "CAUTION", "SAFE"] as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const incidentId = url.searchParams.get("incidentId");
  if (incidentId === null) return notFound("incidentId is required");
  const wantPolygonsFor = url.searchParams.get("callsign");

  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: { deployments: { include: { firefighter: true } } },
  });
  if (incident === null) return notFound(`No incident with id ${incidentId}`);

  const sim = simState();

  /** Unit vector for a compass bearing, in metres east/north. */
  const unitFor = (bearingDeg: number): { e: number; n: number } => {
    const rad = (bearingDeg * Math.PI) / 180;
    return { e: Math.sin(rad), n: Math.cos(rad) };
  };

  /** Where the front sits on a bearing, metres from the ignition point. */
  const frontOn = (u: { e: number; n: number }): number =>
    frontRadiusToward(u.e, u.n, sim.incidentMinutes, sim.windShiftActive, sim.windDirDeg);

  const contours = [];
  let polygons: Record<string, LngLat[]> | null = null;
  let firePerimeter: LngLat[] | null = null;

  for (const deployment of incident.deployments) {
    const callsign = deployment.firefighter.callsign as Callsign;
    const simFf: FirefighterSimState | undefined = sim.firefighters[callsign];
    if (simFf === undefined) continue;

    const latest = await prisma.observation.findFirst({
      where: { deploymentId: deployment.id },
      orderBy: { recordedAtUtc: "desc" },
    });
    if (latest === null) continue;

    const profile = toHealthProfile(deployment.firefighter);
    const baseVitals = toVitals(latest);
    const baseEnv = toEnvironment(latest);
    const basePos = toPosition(latest);
    const nowMs = latest.recordedAtUtc.getTime();

    /**
     * Band this firefighter would be in, standing `distanceM` beyond the front
     * on the given bearing. Their vitals and profile travel with them; only the
     * air and the proximity change.
     */
    const bandAt = (u: { e: number; n: number }, distanceM: number): RiskBand => {
      const r = frontOn(u) + distanceM;
      const air = atmosphereFor(sim as SimState, {
        ...simFf,
        eastM: u.e * r,
        northM: u.n * r,
      });

      const env: Environment = {
        ...baseEnv,
        ambientTempC: air.ambientTempC,
        humidityPct: air.humidityPct,
        coPpm: air.coPpm,
        pm25UgM3: air.pm25UgM3,
      };
      const pos: Position = { ...basePos, distanceToFireFrontM: distanceM };

      return assessRisk(profile, baseVitals, env, pos, DEFAULT_RISK_CONFIG, nowMs).band;
    };

    /**
     * First distance beyond the front, on this bearing, at which the band is no
     * worse than `target`. A linear sweep rather than a binary search, because
     * the band is not guaranteed monotonic in distance and a search could land
     * in a local pocket. Returns null if it never gets there inside the window.
     */
    const boundaryOn = (u: { e: number; n: number }, target: RiskBand): number | null => {
      for (let i = 0; i <= STEPS; i += 1) {
        const d = (i / STEPS) * MAX_DISTANCE_M;
        if (BAND_SEVERITY[bandAt(u, d)] <= BAND_SEVERITY[target]) return d;
      }
      return null;
    };

    // Scalar summary along their own bearing — what the comparison table shows.
    const range = Math.hypot(simFf.eastM, simFf.northM);
    const own =
      range === 0
        ? { e: 0, n: 1 }
        : { e: simFf.eastM / range, n: simFf.northM / range };

    const safeBoundaryM = boundaryOn(own, "SAFE");
    const cautionBoundaryM = boundaryOn(own, "CAUTION");

    contours.push({
      callsign: deployment.firefighter.callsign,
      ageYears: deployment.firefighter.ageYears,
      fitness: deployment.firefighter.fitness,
      conditions: JSON.parse(deployment.firefighter.conditionsJson) as string[],
      frontOnBearingM: Math.round(frontOn(own)),
      currentDistanceM: Math.round(basePos.distanceToFireFrontM ?? 0),
      currentBand: assessRisk(
        profile,
        baseVitals,
        baseEnv,
        basePos,
        DEFAULT_RISK_CONFIG,
        nowMs,
      ).band,
      /** Inside this offset from the front, they are HIGH or worse. */
      cautionBoundaryM: cautionBoundaryM === null ? null : Math.round(cautionBoundaryM),
      /** Beyond this offset from the front, they are SAFE. */
      safeBoundaryM: safeBoundaryM === null ? null : Math.round(safeBoundaryM),
    });

    // Full contour polygons, for the one firefighter the map is showing.
    if (wantPolygonsFor === deployment.firefighter.callsign) {
      polygons = {};
      firePerimeter = [];

      for (const band of CONTOUR_BANDS) {
        polygons[band] = [];
      }

      for (let b = 0; b < BEARINGS; b += 1) {
        const u = unitFor((b / BEARINGS) * 360);
        const front = frontOn(u);
        const fireAt = toLatLng(u.e * front, u.n * front);
        firePerimeter.push([fireAt.lng, fireAt.lat]);

        // One sweep per bearing, not one per band. Every band's boundary is
        // read off the same walk outward — three separate sweeps meant ~8,800
        // engine evaluations per refresh, and the map redraws every tick.
        const found = new Map<string, number>();
        for (let i = 0; i <= STEPS && found.size < CONTOUR_BANDS.length; i += 1) {
          const d = (i / STEPS) * MAX_DISTANCE_M;
          const severity = BAND_SEVERITY[bandAt(u, d)];
          for (const band of CONTOUR_BANDS) {
            if (!found.has(band) && severity <= BAND_SEVERITY[band]) found.set(band, d);
          }
        }

        for (const band of CONTOUR_BANDS) {
          // Unreachable inside the window: pin to the search limit, so the
          // contour is drawn at the edge of what was actually evaluated rather
          // than silently omitted.
          const d = found.get(band) ?? MAX_DISTANCE_M;
          const r = front + d;
          const p = toLatLng(u.e * r, u.n * r);
          polygons[band]?.push([p.lng, p.lat]);
        }
      }

      // Close each ring.
      firePerimeter.push(firePerimeter[0] as LngLat);
      for (const band of CONTOUR_BANDS) {
        const ring = polygons[band];
        if (ring !== undefined && ring.length > 0) ring.push(ring[0] as LngLat);
      }
    }
  }

  contours.sort((a, b) => (b.safeBoundaryM ?? 0) - (a.safeBoundaryM ?? 0));

  return ok({
    incidentId,
    incidentMinutes: sim.incidentMinutes,
    windDirDeg: sim.windDirDeg,
    windShiftActive: sim.windShiftActive,
    searchLimitM: MAX_DISTANCE_M,
    method:
      "Each contour is the locus where the real risk engine changes this individual's band, swept on 48 bearings with the atmosphere reconstructed at every point. Not a geometric buffer.",
    contours,
    /** Present only when ?callsign= was supplied. */
    polygonsFor: wantPolygonsFor,
    firePerimeter,
    /**
     * Outer edge of the region that is WORSE than the named band. Nested, so a
     * client can paint them outermost-first to get filled zones.
     */
    polygons,
  });
}
