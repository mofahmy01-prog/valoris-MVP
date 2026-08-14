/**
 * Demo simulator — drives the existing engine. PRESENTATION ONLY.
 *
 * Generates vitals, environment and position for six firefighters and posts
 * them through the real `POST /observations` route. No shortcut around the
 * ingestion path: the simulator is just another sensor feed.
 *
 * Sensor failure works by NOT refreshing a channel's timestamp. The staleness
 * rules in lib/risk/ then do the rest on their own — confidence falls, the band
 * moves to UNKNOWN. Nothing here special-cases it.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export type Callsign =
  | "ALPHA-1"
  | "ALPHA-2"
  | "BRAVO-1"
  | "BRAVO-2"
  | "CHARLIE-1"
  | "CHARLIE-2";

export const CALLSIGNS: Callsign[] = [
  "ALPHA-1",
  "ALPHA-2",
  "BRAVO-1",
  "BRAVO-2",
  "CHARLIE-1",
  "CHARLIE-2",
];

/** Channels a demo operator can kill. */
export const KILLABLE_CHANNELS = [
  "hrBpm",
  "spo2Pct",
  "coPpm",
  "pm25UgM3",
  "scbaPressurePct",
] as const;
export type KillableChannel = (typeof KILLABLE_CHANNELS)[number];

export const INCIDENT_CENTRE = { lat: 34.0459, lng: -118.5426 };

export type FirefighterSimState = {
  callsign: Callsign;
  /** Metres east and north of the incident centre. */
  eastM: number;
  northM: number;
  hrBpm: number;
  spo2Pct: number;
  respRatePerMin: number;
  hydrationPct: number;
  scbaPressurePct: number;
  timeOnTaskMin: number;
  glucoseMmolL: number;
  /** Channels whose timestamps have stopped advancing. */
  killedChannels: KillableChannel[];
};

export type SimState = {
  incidentId: string | null;
  running: boolean;
  speed: number;
  tick: number;
  /** Incident minutes elapsed. One tick = one incident minute at 1x. */
  incidentMinutes: number;
  windDirDeg: number;
  windSpeedMs: number;
  windShiftActive: boolean;
  ambientTempC: number;
  humidityPct: number;
  firefighters: Record<Callsign, FirefighterSimState>;
  lastError: string | null;
  lastTickAtMs: number | null;
};

/**
 * Starting layout. Crews stand off from the ignition point so there is an arc
 * to watch: everyone starts clear, ALPHA is closest and is overtaken first,
 * CHARLIE holds the furthest sector and stays viable longest.
 */
const START_POSITIONS: Record<Callsign, { eastM: number; northM: number }> = {
  "ALPHA-1": { eastM: -620, northM: 430 },
  "ALPHA-2": { eastM: -540, northM: 560 },
  "BRAVO-1": { eastM: 780, northM: 300 },
  "BRAVO-2": { eastM: 860, northM: 470 },
  "CHARLIE-1": { eastM: -220, northM: -980 },
  "CHARLIE-2": { eastM: 140, northM: -1080 },
};

const RESTING_HR: Record<Callsign, number> = {
  "ALPHA-1": 50,
  "ALPHA-2": 62,
  "BRAVO-1": 55,
  "BRAVO-2": 70,
  "CHARLIE-1": 78,
  "CHARLIE-2": 64,
};

const SPO2_BASELINE: Record<Callsign, number> = {
  "ALPHA-1": 98,
  "ALPHA-2": 97,
  "BRAVO-1": 98,
  "BRAVO-2": 95,
  "CHARLIE-1": 96,
  "CHARLIE-2": 96,
};

export function initialSimState(): SimState {
  const firefighters = {} as Record<Callsign, FirefighterSimState>;
  for (const callsign of CALLSIGNS) {
    const start = START_POSITIONS[callsign];
    firefighters[callsign] = {
      callsign,
      eastM: start.eastM,
      northM: start.northM,
      hrBpm: RESTING_HR[callsign] + 35,
      spo2Pct: SPO2_BASELINE[callsign],
      respRatePerMin: 16,
      hydrationPct: 92,
      scbaPressurePct: 95,
      timeOnTaskMin: 0,
      glucoseMmolL: 7.4,
      killedChannels: [],
    };
  }
  return {
    incidentId: null,
    running: false,
    speed: 1,
    tick: 0,
    incidentMinutes: 0,
    windDirDeg: 250,
    windSpeedMs: 5,
    windShiftActive: false,
    ambientTempC: 31,
    humidityPct: 34,
    firefighters,
    lastError: null,
    lastTickAtMs: null,
  };
}

/** Deterministic pseudo-noise. No Math.random — the demo replays identically. */
function wobble(seed: number, amplitude: number): number {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return (x - Math.floor(x) - 0.5) * 2 * amplitude;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Approximate fire front radius at a given incident minute.
 *
 * MUST track the shaping used to draw the perimeter in
 * lib/incident/snapshot.ts, or the atmosphere the crew reports would disagree
 * with the fire on the map — CO rising while the polygon is still far away.
 */
export function frontRadiusAt(incidentMinutes: number, windShiftActive: boolean): number {
  const shaped = Math.pow(Math.max(0, incidentMinutes), 1.35) / 6;
  return 120 + Math.min(shaped, 300) * (windShiftActive ? 14 : 10);
}

/**
 * Front radius in a firefighter's direction, allowing for wind.
 *
 * The drawn fire is a wind-driven ellipse: it reaches much further downwind
 * than upwind. A purely radial model would report a crew downwind of the fire
 * as breathing clean air while the polygon on the map was already on top of
 * them. The atmosphere has to agree with the picture.
 */
export function frontRadiusToward(
  eastM: number,
  northM: number,
  incidentMinutes: number,
  windShiftActive: boolean,
  windDirDeg: number,
): number {
  const base = frontRadiusAt(incidentMinutes, windShiftActive);
  // Wind direction is where it blows FROM, so the head runs 180° opposite.
  const headBearingRad = (((windDirDeg + 180) % 360) * Math.PI) / 180;
  // Bearing of the firefighter from the ignition point, clockwise from north.
  const bearingRad = Math.atan2(eastM, northM);
  const alignment = Math.cos(bearingRad - headBearingRad); // 1 downwind, −1 upwind
  // Head reaches ~2.2x the flank; the back barely moves.
  return base * (1 + 0.6 * alignment + 0.15 * alignment * alignment);
}

/** Metres from the incident centre, where the fire front is seeded. */
function distanceToCentreM(f: FirefighterSimState): number {
  return Math.hypot(f.eastM, f.northM);
}

/**
 * Advance one incident minute. Pure: takes state, returns new state.
 * The fire front itself is computed server-side by the existing provider — the
 * simulator only moves people and reports the atmosphere around them.
 */
export function advance(state: SimState): SimState {
  const tick = state.tick + 1;
  const incidentMinutes = state.incidentMinutes + 1;

  // The fire grows outward from the centre over time; wind shift accelerates it
  // and pushes it toward the ALPHA crew.
  const firefighters = {} as Record<Callsign, FirefighterSimState>;

  for (const callsign of CALLSIGNS) {
    const prev = state.firefighters[callsign];
    const seed = tick * 7 + callsign.length * 13 + callsign.charCodeAt(0);

    // Crews hold their assigned sectors and work the line. They do not walk
    // into the fire — the FIRE advances on THEM, which is the story the map has
    // to tell. Small drift only, so markers are alive rather than frozen.
    const drift = state.windShiftActive && callsign.startsWith("ALPHA") ? 1.5 : 0.6;
    const towardCentre = distanceToCentreM(prev) > 260 ? -drift : 0;
    const angle = Math.atan2(prev.northM, prev.eastM);
    const eastM = prev.eastM + Math.cos(angle) * towardCentre + wobble(seed, 5);
    const northM = prev.northM + Math.sin(angle) * towardCentre + wobble(seed + 1, 5);

    const distanceM = Math.hypot(eastM, northM);
    // Separation from the fire front in this firefighter's direction.
    const separationM = Math.max(
      0,
      distanceM -
        frontRadiusToward(
          eastM,
          northM,
          incidentMinutes,
          state.windShiftActive,
          state.windDirDeg,
        ),
    );
    const proximity = clamp(1 - separationM / 500, 0, 1);

    const timeOnTaskMin = prev.timeOnTaskMin + 1;

    // HR climbs with time on task and with proximity to the front.
    const hrTarget =
      RESTING_HR[callsign] + 45 + timeOnTaskMin * 1.15 + proximity * 38;
    const hrBpm = clamp(
      prev.hrBpm + (hrTarget - prev.hrBpm) * 0.25 + wobble(seed + 2, 1.5),
      RESTING_HR[callsign],
      205,
    );

    // SpO2 drifts down slightly in smoke.
    const spo2Pct = clamp(
      SPO2_BASELINE[callsign] - proximity * 4.5 + wobble(seed + 3, 0.4),
      80,
      100,
    );

    // Slow enough that a demo can run for several minutes at 1x before the SCBA
    // override starts firing for everyone, fast enough to be dramatic at 20x.
    const scbaPressurePct = clamp(
      prev.scbaPressurePct - (0.42 + proximity * 0.3),
      0,
      100,
    );

    firefighters[callsign] = {
      callsign,
      eastM,
      northM,
      hrBpm,
      spo2Pct,
      respRatePerMin: clamp(14 + proximity * 14 + wobble(seed + 4, 1), 8, 45),
      hydrationPct: clamp(prev.hydrationPct - 0.22, 20, 100),
      scbaPressurePct,
      timeOnTaskMin,
      // BRAVO-1 is the only one wearing a CGM; glucose falls under load.
      glucoseMmolL: clamp(
        prev.glucoseMmolL - 0.045 - proximity * 0.03,
        2.4,
        14,
      ),
      killedChannels: prev.killedChannels,
    };
  }

  return {
    ...state,
    tick,
    incidentMinutes,
    firefighters,
    ambientTempC: clamp(
      state.ambientTempC + (state.windShiftActive ? 0.28 : 0.06),
      15,
      70,
    ),
    humidityPct: clamp(state.humidityPct - 0.05, 5, 100),
    windSpeedMs: state.windShiftActive
      ? clamp(state.windSpeedMs + 0.25, 0, 22)
      : state.windSpeedMs,
    lastTickAtMs: Date.now(),
  };
}

/** Atmosphere at a firefighter's position, for the observation payload. */
export function atmosphereFor(
  state: SimState,
  f: FirefighterSimState,
): { coPpm: number; pm25UgM3: number; ambientTempC: number; humidityPct: number } {
  const frontRadiusM = frontRadiusToward(
    f.eastM,
    f.northM,
    state.incidentMinutes,
    state.windShiftActive,
    state.windDirDeg,
  );
  const separationM = Math.max(0, Math.hypot(f.eastM, f.northM) - frontRadiusM);
  const proximity = clamp(1 - separationM / 500, 0, 1);
  return {
    coPpm: Math.round(6 + proximity * 145),
    pm25UgM3: Math.round(18 + proximity * 320),
    ambientTempC: Math.round((state.ambientTempC + proximity * 16) * 10) / 10,
    humidityPct: Math.round(state.humidityPct),
  };
}

/** Metres offset converted to WGS84, for the observation payload and the map. */
export function toLatLng(eastM: number, northM: number): { lat: number; lng: number } {
  const EARTH_RADIUS_M = 6_371_008.8;
  const latRad = (INCIDENT_CENTRE.lat * Math.PI) / 180;
  return {
    lat: INCIDENT_CENTRE.lat + ((northM / EARTH_RADIUS_M) * 180) / Math.PI,
    lng:
      INCIDENT_CENTRE.lng +
      ((eastM / (EARTH_RADIUS_M * Math.cos(latRad))) * 180) / Math.PI,
  };
}
