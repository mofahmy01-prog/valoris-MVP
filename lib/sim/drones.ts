/**
 * Drones — reconnaissance and response.
 *
 * Two kinds, doing two different jobs, and only one of them touches the risk
 * score:
 *
 *   RECON drones are a sensor platform. They orbit a standoff outside the fire
 *   edge and refresh the environmental picture beneath them. A firefighter
 *   inside a recon footprint has CURRENT air data; one outside does not, and
 *   their environmental channels age until the existing staleness rules drop
 *   their confidence. That is the whole mechanic — no new scoring path, no
 *   special case in the engine. It also answers a question the demo previously
 *   dodged: where was fresh CO and PM2.5 at a firefighter's exact position
 *   supposed to be coming from?
 *
 *   RESPONSE drones carry equipment to a named firefighter. They are dispatched
 *   BY THE COMMANDER and never automatically. Valoris does not withdraw anyone
 *   and does not launch anything on its own; it can show that a crew member is
 *   falling back and make dispatch one click away, and that is the limit.
 *
 * Everything here is a pure function of (time, dispatch list), like the rest of
 * the scene, so scrubbing backwards shows a drone back at base.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE. No drone integration exists; no
 * airframe, autopilot or vendor is modelled.
 */

import { INCIDENT_CENTRE } from "./simulator";
import { perimeterRadiiAt, PROFILE_BEARINGS, toLngLat, type LngLat } from "./palisades";

export type DroneKind = "recon" | "response";

/**
 * How long a response drone takes to reach its target, wall-clock milliseconds.
 *
 * A fixed duration rather than a ground speed. The honest version — distance
 * divided by 20 m/s — put arrival several minutes out, and worse, it was
 * measured against the TIMELINE clock, which only advances when the commander
 * scrubs. A drone dispatched on a paused timeline never arrived at all. Flight
 * is a wall-clock animation now, and this is the demo's tempo, not an
 * aerodynamic claim.
 */
export const RESPONSE_FLIGHT_MS = 10_000;

/**
 * Recon orbits, defined relative to the fire rather than as fixed coordinates.
 *
 * Each sits a standoff BEYOND the fire edge on its bearing, so the pattern
 * expands with the fire and the drones stay useful across the whole timeline
 * instead of being swallowed on day two.
 */
const RECON_ORBITS: {
  id: string;
  bearingDeg: number;
  standoffM: number;
  coverageRadiusM: number;
}[] = [
  { id: "RECON-1", bearingDeg: 35, standoffM: 700, coverageRadiusM: 2_200 },
  { id: "RECON-2", bearingDeg: 95, standoffM: 700, coverageRadiusM: 2_200 },
  { id: "RECON-3", bearingDeg: 335, standoffM: 900, coverageRadiusM: 2_200 },
];

/** Staging area the response drones launch from. South-west, well clear. */
const BASE_BEARING_DEG = 205;
const BASE_STANDOFF_M = 2_500;

export type DroneDispatch = {
  id: string;
  targetCallsign: string;
  targetLat: number;
  targetLng: number;
  dispatchedAtMs: number;
};

export type DroneState = {
  id: string;
  kind: DroneKind;
  lat: number;
  lng: number;
  status: "on_station" | "en_route" | "arrived";
  /** Recon only — radius of the refreshed sensor footprint, metres. */
  coverageRadiusM: number | null;
  /** Response only. */
  assignedTo: string | null;
  etaSec: number | null;
};

/** Fire edge distance on a bearing, from the radial profile. */
function edgeOnBearing(atMs: number, bearingDeg: number): number {
  const radii = perimeterRadiiAt(atMs);
  const index = Math.round((bearingDeg / 360) * PROFILE_BEARINGS) % PROFILE_BEARINGS;
  return radii[index] ?? 0;
}

function pointOnBearing(atMs: number, bearingDeg: number, extraM: number): LngLat {
  const r = edgeOnBearing(atMs, bearingDeg) + extraM;
  const angle = (bearingDeg * Math.PI) / 180;
  return toLngLat(Math.sin(angle) * r, Math.cos(angle) * r);
}

/** Where response drones launch from. */
export function baseAt(atMs: number): LngLat {
  return pointOnBearing(atMs, BASE_BEARING_DEG, BASE_STANDOFF_M);
}

/**
 * Recon drones on station.
 *
 * Tasked over the CREW, not at a fixed standoff from the flame front. The
 * fire-relative pattern looked reasonable but broke early in the timeline: with
 * the fire only 4 km across, drones parked at edge-plus-700 m sat well inside
 * where the crews were standing, so three firefighters 3–4.5 km clear of a small
 * fire had no coverage, went stale, and dropped to UNKNOWN — which then
 * collapsed their contours, because a sweep that never finds SAFE returns no
 * safe boundary at all.
 *
 * Tasking recon over the deployment is also what a commander would actually do.
 * Crews are grouped by bearing into as many sectors as there are airframes, and
 * one drone covers each sector's centroid. Coverage is still finite: drag a
 * firefighter far enough out of their sector and they lose it, which is the
 * interesting case rather than the default one.
 */
export function reconDronesAt(
  atMs: number,
  crew: { lat: number; lng: number }[] = [],
): DroneState[] {
  if (crew.length === 0) {
    // No deployment to cover — fall back to the fire-relative pattern.
    return RECON_ORBITS.map((orbit) => {
      const [lng, lat] = pointOnBearing(atMs, orbit.bearingDeg, orbit.standoffM);
      return {
        id: orbit.id,
        kind: "recon" as const,
        lat,
        lng,
        status: "on_station" as const,
        coverageRadiusM: orbit.coverageRadiusM,
        assignedTo: null,
        etaSec: null,
      };
    });
  }

  const byBearing = [...crew].sort((a, b) => {
    const bearing = (p: { lat: number; lng: number }) =>
      Math.atan2(p.lng - INCIDENT_CENTRE.lng, p.lat - INCIDENT_CENTRE.lat);
    return bearing(a) - bearing(b);
  });

  const sectors = Math.min(RECON_ORBITS.length, byBearing.length);
  const perSector = Math.ceil(byBearing.length / sectors);
  const drones: DroneState[] = [];

  for (let i = 0; i < sectors; i += 1) {
    const group = byBearing.slice(i * perSector, (i + 1) * perSector);
    if (group.length === 0) continue;
    const lat = group.reduce((sum, c) => sum + c.lat, 0) / group.length;
    const lng = group.reduce((sum, c) => sum + c.lng, 0) / group.length;
    drones.push({
      id: RECON_ORBITS[i]!.id,
      kind: "recon",
      lat,
      lng,
      status: "on_station",
      coverageRadiusM: RECON_ORBITS[i]!.coverageRadiusM,
      assignedTo: null,
      etaSec: null,
    });
  }

  return drones;
}

/** Metres between two lng/lat pairs, locally flat. */
function metresBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const dLat = (bLat - aLat) * 110_540;
  const dLng = (bLng - aLng) * 111_320 * Math.cos((aLat * Math.PI) / 180);
  return Math.hypot(dLat, dLng);
}

/**
 * True when a point has live recon coverage.
 *
 * This is what decides whether a firefighter's environmental readings are
 * treated as current or left to go stale.
 */
export function hasReconCoverage(
  atMs: number,
  lat: number,
  lng: number,
  recon: DroneState[] = reconDronesAt(atMs),
): boolean {
  return recon.some(
    (drone) =>
      drone.coverageRadiusM !== null &&
      metresBetween(drone.lat, drone.lng, lat, lng) <= drone.coverageRadiusM,
  );
}

/**
 * Response drones are deliberately NOT computed here.
 *
 * They carry equipment; they do not change anyone's risk score, so they have no
 * business inside the scene evaluation, which costs hundreds of engine
 * evaluations per request and cannot be polled at animation rate. Their flight
 * is a ten-second wall-clock animation owned by the client, interpolating
 * between `baseAt()` and the target using `RESPONSE_FLIGHT_MS`.
 *
 * Recon stays server-side because it genuinely does change the score.
 */
