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

import { perimeterRadiiAt, PROFILE_BEARINGS, toLngLat, type LngLat } from "./palisades";

export type DroneKind = "recon" | "response";

/** Ground speed of a response drone, metres per second (~72 km/h). */
const RESPONSE_SPEED_MS = 20;

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

/** Recon drones on station for this moment in the timeline. */
export function reconDronesAt(atMs: number): DroneState[] {
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
 * Response drones in flight, positioned by how long they have been airborne.
 *
 * Scrubbing back before a dispatch returns nothing for it, so the timeline stays
 * honest: a drone cannot be en route before it was sent.
 */
export function responseDronesAt(atMs: number, dispatches: DroneDispatch[]): DroneState[] {
  const [baseLng, baseLat] = baseAt(atMs);
  const out: DroneState[] = [];

  for (const dispatch of dispatches) {
    const elapsedSec = (atMs - dispatch.dispatchedAtMs) / 1_000;
    if (elapsedSec < 0) continue;

    const distanceM = metresBetween(
      baseLat,
      baseLng,
      dispatch.targetLat,
      dispatch.targetLng,
    );
    const flightSec = distanceM / RESPONSE_SPEED_MS;
    const progress = flightSec === 0 ? 1 : Math.min(1, elapsedSec / flightSec);

    out.push({
      id: dispatch.id,
      kind: "response",
      lat: baseLat + (dispatch.targetLat - baseLat) * progress,
      lng: baseLng + (dispatch.targetLng - baseLng) * progress,
      status: progress >= 1 ? "arrived" : "en_route",
      coverageRadiusM: null,
      assignedTo: dispatch.targetCallsign,
      etaSec: progress >= 1 ? 0 : Math.round(flightSec - elapsedSec),
    });
  }

  return out;
}
