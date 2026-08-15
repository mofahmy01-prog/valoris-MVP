/**
 * Palisades fire geometry — a scrubbable perimeter over the real incident.
 *
 * WHAT IS REAL AND WHAT IS NOT. This matters more than anything else in this
 * file, so it is stated first:
 *
 *   - The SHAPE is real. `data/historical/palisades-2025/perimeters.geojson` is
 *     the NIFC WFIGS observed final perimeter (Tier A, public domain). At the
 *     end of the timeline the drawn perimeter IS that polygon.
 *   - The TIMING is driven by published acreage milestones (see
 *     `ACREAGE_TIMELINE`), which are approximate and UNVERIFIED.
 *   - Every INTERMEDIATE shape is interpolated and therefore SYNTHETIC
 *     (Tier C). The real fire did not grow self-similarly outward from the
 *     ignition point; it ran hard downslope and downwind first. A perimeter
 *     shown for, say, 03:00 on 8 January is NOT what the fire looked like at
 *     03:00 on 8 January.
 *
 * This is emphatically NOT a fire behaviour model and must never be presented
 * as one. Valoris does not model fire spread — it consumes a perimeter and
 * works out what that perimeter means for each individual firefighter. The
 * interpolation exists only so there is something to scrub.
 *
 * Method: the observed perimeter is reduced to a radial profile R(θ) about the
 * ignition point. Area scales as r², so a fire at area fraction `a` of its
 * final size is drawn at radius R(θ)·√a. That keeps the real outline's
 * character at every point on the timeline — an irregular fire stays
 * irregular — and lands exactly on the observed polygon at t = 1.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { readFileSync } from "node:fs";
import path from "node:path";

import { INCIDENT_CENTRE } from "./simulator";

/**
 * Metres per degree, local equirectangular approximation. Good over ~20 km.
 * Exported so the client can rebuild contour rings from a radius array without
 * the server shipping thousands of coordinates on every scrub.
 */
export const M_PER_DEG_LAT = 110_540;
export const M_PER_DEG_LNG =
  111_320 * Math.cos((INCIDENT_CENTRE.lat * Math.PI) / 180);

/** Bearings used for the radial profile. 2° resolution. */
export const PROFILE_BEARINGS = 180;

/**
 * The agency incident record, stored alongside the perimeter it describes.
 *
 * `data/historical/palisades-2025/incident-metadata.json` is the unmodified
 * response from the same WFIGS FeatureServer the perimeter came from. The
 * timeline's endpoints are read out of it rather than typed in here, so they
 * cannot drift away from the source.
 */
type IncidentAttributes = Record<string, string | number | null>;

let cachedAttributes: IncidentAttributes | null = null;

function incidentAttributes(): IncidentAttributes {
  if (cachedAttributes !== null) return cachedAttributes;
  const file = path.join(
    process.cwd(),
    "data",
    "historical",
    "palisades-2025",
    "incident-metadata.json",
  );
  const parsed = JSON.parse(readFileSync(file, "utf8")) as {
    features: { attributes: IncidentAttributes }[];
  };
  cachedAttributes = parsed.features[0]?.attributes ?? {};
  return cachedAttributes;
}

const attributes = incidentAttributes();
const num = (key: string, fallback: number): number =>
  typeof attributes[key] === "number" ? (attributes[key] as number) : fallback;
const str = (key: string): string | null =>
  typeof attributes[key] === "string" ? (attributes[key] as string) : null;

/**
 * Facts taken directly from the interagency record. These are REAL and citable.
 *
 * One caveat, found by reading the record rather than assuming it: the polygon
 * carries `poly_PolygonDateTime` of 2025-01-08T14:31Z while `poly_DateCurrent`
 * is 2025-01-21T23:43Z, and its geometry measures the FINAL 23,448 acres. The
 * capture stamp therefore cannot be read as "the fire was this size at that
 * moment" — the record was revised long after that first infrared pass. This is
 * why the perimeter is treated as a final footprint and not as a dated snapshot.
 */
export const INCIDENT = {
  name: str("attr_IncidentName") ?? "Palisades",
  /** Fire discovery, from the incident record. */
  discoveryMs: num("attr_FireDiscoveryDateTime", Date.parse("2025-01-07T18:30:00Z")),
  /** End of the final ICS-209 reporting period — the incident's close. */
  containmentMs: num(
    "attr_ICS209RptForTimePeriodTo",
    Date.parse("2025-02-01T01:30:00Z"),
  ),
  /** Observed final size, from the polygon itself. */
  finalAcres: num("poly_GISAcres", 23_448),
  polygonStampMs: num("poly_PolygonDateTime", 0),
  recordUpdatedMs: num("poly_DateCurrent", 0),
  mapMethod: str("poly_MapMethod"),
  polygonSource: str("poly_Source"),
  irwinId: str("attr_IrwinID"),
  uniqueFireId: str("attr_UniqueFireIdentifier"),
  primaryFuel: str("attr_PrimaryFuelModel"),
  percentContained: num("attr_PercentContained", 100),
  protectingUnit: str("attr_POOProtectingUnit"),
} as const;

/**
 * Growth curve for the timeline.
 *
 * The FIRST and LAST entries are sourced from the incident record above. Every
 * entry between them is UNVERIFIED — transcribed from contemporaneous public
 * reporting, not from the CAL FIRE incident archive — and exists only to shape
 * the curve. No risk output depends on them.
 *
 * The intermediate figures are clamped to the observed final acreage so the
 * series is monotonic and terminates exactly at it. A previous version peaked
 * at an unverified 23,713 on 12 January, which normalised the end of the
 * timeline to 0.989 of full size: the final drawn perimeter came out about 1%
 * smaller than the real one, undermining the one thing that is meant to be
 * exactly right.
 */
const REPORTED_INTERMEDIATE: { atUtc: string; acres: number }[] = [
  { atUtc: "2025-01-08T02:00:00Z", acres: 1_262 },
  { atUtc: "2025-01-08T18:00:00Z", acres: 11_802 },
  { atUtc: "2025-01-09T18:00:00Z", acres: 17_234 },
  { atUtc: "2025-01-10T18:00:00Z", acres: 19_978 },
  { atUtc: "2025-01-11T18:00:00Z", acres: 21_596 },
  { atUtc: "2025-01-12T18:00:00Z", acres: 23_448 },
];

export const ACREAGE_TIMELINE: { atUtc: string; acres: number; sourced: boolean }[] = [
  { atUtc: new Date(INCIDENT.discoveryMs).toISOString(), acres: 10, sourced: false },
  ...REPORTED_INTERMEDIATE.map((p) => ({
    ...p,
    acres: Math.min(p.acres, INCIDENT.finalAcres),
    sourced: false,
  })),
  {
    atUtc: new Date(INCIDENT.containmentMs).toISOString(),
    acres: INCIDENT.finalAcres,
    sourced: true,
  },
];

export const TIMELINE_START_MS = INCIDENT.discoveryMs;
export const TIMELINE_END_MS = INCIDENT.containmentMs;
export const PEAK_ACRES = INCIDENT.finalAcres;

export type LngLat = [number, number];

/** Metres east/north of the ignition point, for a lng/lat pair. */
export function toEastNorth(lng: number, lat: number): { eastM: number; northM: number } {
  return {
    eastM: (lng - INCIDENT_CENTRE.lng) * M_PER_DEG_LNG,
    northM: (lat - INCIDENT_CENTRE.lat) * M_PER_DEG_LAT,
  };
}

/** Inverse of `toEastNorth`. */
export function toLngLat(eastM: number, northM: number): LngLat {
  return [
    INCIDENT_CENTRE.lng + eastM / M_PER_DEG_LNG,
    INCIDENT_CENTRE.lat + northM / M_PER_DEG_LAT,
  ];
}

type Ring = { eastM: number; northM: number }[];

let cachedProfile: number[] | null = null;

/** Shoelace area of a ring in square metres. */
function ringArea(ring: Ring): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.eastM * b.northM - b.eastM * a.northM;
  }
  return Math.abs(sum) / 2;
}

/**
 * The observed perimeter's outer ring, in local metres.
 *
 * The NIFC file is a MultiPolygon containing the main burn area plus a scatter
 * of small detached spot fires. The largest ring by area is the burn area; the
 * rest are dropped, because a radial profile cannot represent disjoint pieces
 * and silently folding them in would distort the outline.
 */
function observedRing(): Ring {
  const file = path.join(
    process.cwd(),
    "data",
    "historical",
    "palisades-2025",
    "perimeters.geojson",
  );
  const gj = JSON.parse(readFileSync(file, "utf8")) as {
    features: { geometry: { type: string; coordinates: number[][][][] | number[][][] } }[];
  };

  const rings: Ring[] = [];
  for (const feature of gj.features) {
    const { type, coordinates } = feature.geometry;
    const polygons =
      type === "MultiPolygon"
        ? (coordinates as number[][][][])
        : [coordinates as number[][][]];

    for (const polygon of polygons) {
      const outer = polygon[0];
      if (outer === undefined) continue;
      rings.push(
        outer.map((c) => toEastNorth(c[0] as number, c[1] as number)),
      );
    }
  }

  let best: Ring = [];
  let bestArea = -1;
  for (const ring of rings) {
    const area = ringArea(ring);
    if (area > bestArea) {
      bestArea = area;
      best = ring;
    }
  }
  return best;
}

/**
 * Distance from the ignition point to the observed perimeter, per bearing.
 *
 * Ray/segment intersection rather than nearest-vertex, so the profile is
 * accurate between vertices. Where a ray crosses the outline more than once —
 * the perimeter is not perfectly star-shaped about the ignition point — the
 * FURTHEST crossing wins, so no burnt ground is ever drawn as unburnt.
 */
export function radialProfile(): number[] {
  if (cachedProfile !== null) return cachedProfile;

  const ring = observedRing();
  const profile: number[] = new Array<number>(PROFILE_BEARINGS).fill(0);

  for (let b = 0; b < PROFILE_BEARINGS; b += 1) {
    const angle = (b / PROFILE_BEARINGS) * Math.PI * 2;
    const dirE = Math.sin(angle);
    const dirN = Math.cos(angle);
    let furthest = 0;

    for (let i = 0; i < ring.length; i += 1) {
      const p = ring[i]!;
      const q = ring[(i + 1) % ring.length]!;

      // Solve p + s(q - p) = t(dir) for s in [0,1] and t >= 0.
      //
      // Eliminating t gives s = (dirE·p.n - dirN·p.e) / (segE·dirN - segN·dirE).
      // Note the denominator's operand order: writing it the other way round
      // negates s, which silently rejects every genuine crossing and admits
      // spurious ones. The symptom was a profile where bearings two degrees
      // apart read 0 m and 6 km.
      const segE = q.eastM - p.eastM;
      const segN = q.northM - p.northM;
      const denominator = segE * dirN - segN * dirE;
      if (Math.abs(denominator) < 1e-12) continue;

      const s = (dirE * p.northM - dirN * p.eastM) / denominator;
      if (s < 0 || s > 1) continue;

      const t =
        Math.abs(dirE) > Math.abs(dirN)
          ? (p.eastM + s * segE) / dirE
          : (p.northM + s * segN) / dirN;
      if (t > furthest) furthest = t;
    }

    profile[b] = furthest;
  }

  cachedProfile = profile;
  return profile;
}

/** Linear interpolation of the acreage record, then normalised to its peak. */
export function areaFractionAt(atMs: number): number {
  const clamped = Math.max(TIMELINE_START_MS, Math.min(TIMELINE_END_MS, atMs));

  for (let i = 0; i < ACREAGE_TIMELINE.length - 1; i += 1) {
    const a = ACREAGE_TIMELINE[i]!;
    const b = ACREAGE_TIMELINE[i + 1]!;
    const aMs = Date.parse(a.atUtc);
    const bMs = Date.parse(b.atUtc);
    if (clamped >= aMs && clamped <= bMs) {
      const span = bMs - aMs;
      const f = span === 0 ? 1 : (clamped - aMs) / span;
      return (a.acres + (b.acres - a.acres) * f) / PEAK_ACRES;
    }
  }
  return 1;
}

/**
 * Radius of the drawn perimeter on each bearing, at a moment in the timeline.
 * Area scales as r², hence the square root.
 */
export function perimeterRadiiAt(atMs: number): number[] {
  const scale = Math.sqrt(Math.max(0, areaFractionAt(atMs)));
  return radialProfile().map((r) => r * scale);
}

/** The drawn perimeter as a closed GeoJSON ring. */
export function perimeterRingAt(atMs: number): LngLat[] {
  const radii = perimeterRadiiAt(atMs);
  const ring: LngLat[] = [];
  for (let b = 0; b < PROFILE_BEARINGS; b += 1) {
    const angle = (b / PROFILE_BEARINGS) * Math.PI * 2;
    const r = radii[b] as number;
    ring.push(toLngLat(Math.sin(angle) * r, Math.cos(angle) * r));
  }
  ring.push(ring[0] as LngLat);
  return ring;
}

/**
 * A contour offset outward from the perimeter by a constant distance.
 *
 * The offset is applied along each bearing, so the contour inherits the fire's
 * outline: a round fire gets round contours, an irregular one gets contours
 * that follow its lobes.
 */
export function offsetRingAt(atMs: number, offsetM: number): LngLat[] {
  const radii = perimeterRadiiAt(atMs);
  const ring: LngLat[] = [];
  for (let b = 0; b < PROFILE_BEARINGS; b += 1) {
    const angle = (b / PROFILE_BEARINGS) * Math.PI * 2;
    const r = (radii[b] as number) + offsetM;
    ring.push(toLngLat(Math.sin(angle) * r, Math.cos(angle) * r));
  }
  ring.push(ring[0] as LngLat);
  return ring;
}

/**
 * Separation between a point and the drawn perimeter, in metres.
 * Negative inside the fire; the caller decides how to treat that.
 */
export function separationFromFire(
  atMs: number,
  eastM: number,
  northM: number,
): number {
  const radii = perimeterRadiiAt(atMs);
  const range = Math.hypot(eastM, northM);
  if (range === 0) return -(radii[0] as number);

  // Bearing measured the same way the profile is built: 0 = north, clockwise.
  let angle = Math.atan2(eastM, northM);
  if (angle < 0) angle += Math.PI * 2;

  const exact = (angle / (Math.PI * 2)) * PROFILE_BEARINGS;
  const i = Math.floor(exact) % PROFILE_BEARINGS;
  const j = (i + 1) % PROFILE_BEARINGS;
  const f = exact - Math.floor(exact);
  const edge = (radii[i] as number) * (1 - f) + (radii[j] as number) * f;

  return range - edge;
}
