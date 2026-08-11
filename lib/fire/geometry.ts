/**
 * Geodesic helpers. Pure functions, no imports beyond types.
 *
 * This is the only place distance to a fire front is computed. The result is
 * handed to the risk engine as a plain number in metres — the engine never
 * sees a polygon, a provider, or a coordinate system.
 */

import type { LatLng } from "./types";

const EARTH_RADIUS_M = 6_371_008.8;
const DEG_TO_RAD = Math.PI / 180;

export function toRadians(deg: number): number {
  return deg * DEG_TO_RAD;
}

/** Great-circle distance in metres. */
export function haversineMetres(a: LatLng, b: LatLng): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Local equirectangular projection to metres about `origin`. Accurate enough
 * over the few kilometres an incident spans, and it keeps the segment maths
 * simple and deterministic.
 */
function toLocalMetres(point: LatLng, origin: LatLng): { x: number; y: number } {
  const latRad = toRadians(origin.lat);
  return {
    x: toRadians(point.lng - origin.lng) * Math.cos(latRad) * EARTH_RADIUS_M,
    y: toRadians(point.lat - origin.lat) * EARTH_RADIUS_M,
  };
}

/** Offset a point by metres east and north. */
export function offsetMetres(
  origin: LatLng,
  eastM: number,
  northM: number,
): LatLng {
  const latRad = toRadians(origin.lat);
  return {
    lat: origin.lat + (northM / EARTH_RADIUS_M) / DEG_TO_RAD,
    lng:
      origin.lng +
      (eastM / (EARTH_RADIUS_M * Math.cos(latRad))) / DEG_TO_RAD,
  };
}

function distancePointToSegmentM(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number },
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** True when `point` lies inside the ring, by ray casting in local metres. */
export function isInsidePerimeter(point: LatLng, perimeter: LatLng[]): boolean {
  if (perimeter.length < 3) return false;
  const origin = perimeter[0] as LatLng;
  const p = toLocalMetres(point, origin);
  const ring = perimeter.map((v) => toLocalMetres(v, origin));

  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const vi = ring[i] as { x: number; y: number };
    const vj = ring[j] as { x: number; y: number };
    const straddles = vi.y > p.y !== vj.y > p.y;
    if (!straddles) continue;
    const xAtP = ((vj.x - vi.x) * (p.y - vi.y)) / (vj.y - vi.y) + vi.x;
    if (p.x < xAtP) inside = !inside;
  }
  return inside;
}

/**
 * Distance in metres from a point to the nearest edge of the perimeter.
 *
 * Returns 0 when the point is inside the perimeter — a firefighter within the
 * fire area has no separation from the front, and reporting a positive
 * "distance to front" there would read as safer than reality.
 */
export function distanceToPerimeterM(
  point: LatLng,
  perimeter: LatLng[],
): number {
  if (perimeter.length === 0) return Number.POSITIVE_INFINITY;
  if (perimeter.length === 1) return haversineMetres(point, perimeter[0] as LatLng);
  if (isInsidePerimeter(point, perimeter)) return 0;

  const origin = perimeter[0] as LatLng;
  const p = toLocalMetres(point, origin);
  const ring = perimeter.map((v) => toLocalMetres(v, origin));

  let best = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ring.length; i += 1) {
    const a = ring[i] as { x: number; y: number };
    const b = ring[(i + 1) % ring.length] as { x: number; y: number };
    const d = distancePointToSegmentM(p, a, b);
    if (d < best) best = d;
  }
  return best;
}
