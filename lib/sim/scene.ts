/**
 * Scene evaluation — the whole picture as a pure function of (time, positions).
 *
 * The commander scrubs a timeline and drags crew around the map, so nothing here
 * may depend on accumulated tick state: the same time and the same positions
 * must always produce the same answer. That is what makes scrubbing backwards
 * work, and it is why this is a separate module from the tick-based simulator.
 *
 * What is real:
 *   - The risk assessment. `assessRisk` is the production engine, unmodified.
 *   - The physiology. `derivePhysiology` is the production pipeline, including
 *     the Kalman core-temperature filter, COHb accumulation and PM2.5 dose.
 *   - The fire outline. See `palisades.ts` — observed NIFC perimeter, Tier A.
 *
 * What is synthetic (Tier C, illustrative only):
 *   - The atmosphere model below. CO, PM2.5 and heat as a function of distance
 *     from the fire edge. Exponential falloff with invented scale lengths. It is
 *     not a dispersion model, ignores wind, terrain and plume rise entirely, and
 *     no coefficient here has any empirical basis.
 *   - The exertion model below. Heart rate and SpO2 as a function of time on
 *     task and proximity.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import {
  derivePhysiology,
  EMPTY_CARRY_OVER,
  type PhysiologyCarryOver,
} from "@/lib/incident/physiology-pipeline";
import { DEFAULT_PHYSIOLOGY_CONFIG } from "@/lib/physiology/default-config";
import { BAND_SEVERITY } from "@/lib/risk/bands";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import type {
  Environment,
  HealthProfile,
  Position,
  RiskBand,
  Vitals,
} from "@/lib/risk/types";

import {
  hasReconCoverage,
  reconDronesAt,
  type DroneState,
} from "./drones";
import {
  perimeterRadiiAt,
  separationFromFire,
  TIMELINE_START_MS,
  toEastNorth,
} from "./palisades";

/**
 * One SCBA bottle cycle. Physiology is integrated over the CURRENT work cycle,
 * not the whole shift.
 *
 * Integrating a twelve-hour shift put every crew member at an estimated core
 * temperature of 40–42 °C by the second day of the timeline, which is not a
 * risk assessment, it is a fatality. The cause is documented limitation 25: the
 * core temperature filter is heart-rate-only, so a sustained working heart rate
 * drives the estimate upward indefinitely with no rest term to pull it back.
 *
 * Firefighters do not work continuously. They work a bottle, then rehab. Each
 * cycle is treated as starting from rested, which is optimistic — real
 * accumulated strain across a shift is NOT modelled — but it keeps the estimate
 * inside a physiologically meaningful range instead of saturating everyone.
 */
const WORK_CYCLE_MINUTES = 45;
/** Physiology is walked forward in steps of this length to reach the present. */
const STEP_MINUTES = 5;

/** How far beyond the fire edge contours are searched for, and at what step. */
export const MAX_OFFSET_M = 4000;
const OFFSET_STEPS = 80;

export type CrewPlacement = { callsign: string; lat: number; lng: number };

export type Atmosphere = {
  coPpm: number;
  pm25UgM3: number;
  ambientTempC: number;
  humidityPct: number;
};

/**
 * Air quality and heat at a given separation from the fire edge.
 *
 * SYNTHETIC. Exponential falloff with hand-chosen scale lengths, scaled mildly
 * by fire size so a 13 km fire smokes harder than a 300 m one. No wind, no
 * terrain, no plume chemistry. Illustrative only.
 */
export function atmosphereAt(separationM: number, fireRadiusM: number): Atmosphere {
  // Inside the perimeter is simply "at the edge, worst case".
  const d = Math.max(0, separationM);
  const size = Math.min(1.4, 0.5 + fireRadiusM / 9_000);

  const co = 90 * size * Math.exp(-d / 250);
  const pm = 700 * size * Math.exp(-d / 900);
  const heat = 55 * Math.exp(-d / 180);

  return {
    coPpm: Math.round(co * 10) / 10,
    pm25UgM3: Math.round(pm * 10) / 10,
    ambientTempC: Math.round((18 + heat) * 10) / 10,
    // Smoke and heat dry the air out close in.
    humidityPct: Math.round(Math.min(48, 14 + d / 90)),
  };
}

/**
 * Raw wearable readings for a firefighter working at this separation.
 *
 * SYNTHETIC. Heart rate rises with time on task and, more strongly, with
 * proximity — so moving a crew member on the map changes their physiology,
 * which is the point of a draggable picture.
 */
export function exertionAt(
  restingHrBpm: number,
  spo2BaselinePct: number,
  timeOnTaskMin: number,
  separationM: number,
): { hrBpm: number; spo2Pct: number; respRatePerMin: number; hydrationPct: number; scbaPressurePct: number } {
  const proximity = Math.max(0, Math.min(1, 1 - Math.max(0, separationM) / 1_200));

  return {
    hrBpm: Math.round(
      Math.min(200, restingHrBpm + 42 + timeOnTaskMin * 0.06 + proximity * 58),
    ),
    spo2Pct: Math.round((spo2BaselinePct - proximity * 5.5) * 10) / 10,
    respRatePerMin: Math.round(14 + proximity * 15),
    hydrationPct: Math.round(Math.max(30, 100 - timeOnTaskMin * 0.055)),
    scbaPressurePct: Math.round(Math.max(0, 100 - (timeOnTaskMin % 45) * 1.9)),
  };
}

/** Minutes into the current bottle cycle at this point on the timeline. */
export function timeOnTaskAt(atMs: number): number {
  const elapsed = Math.max(0, (atMs - TIMELINE_START_MS) / 60_000);
  return Math.round(elapsed % WORK_CYCLE_MINUTES);
}

/** True when this firefighter wears a CGM, and glucose is a critical channel. */
export function isGlucoseMonitored(profile: HealthProfile): boolean {
  return (profile.conditions ?? []).some((c) => /diabet/i.test(c));
}

function vitalsFrom(
  profile: HealthProfile,
  exertion: ReturnType<typeof exertionAt>,
  coreTempC: number,
  coreTempUpdatedAtMs: number | undefined,
  fatiguePct: number,
  timeOnTaskMin: number,
  atMs: number,
): Vitals {
  // A monitored firefighter with no glucose reading is UNKNOWN, not SAFE — the
  // engine treats the channel as critical for them. Omitting it here made
  // BRAVO-1 read UNKNOWN at every point on the timeline, which is the engine
  // behaving correctly about a gap this module was creating.
  const monitored = isGlucoseMonitored(profile);
  const glucoseMmolL = 6.2 - timeOnTaskMin * 0.012;

  return {
    hrBpm: exertion.hrBpm,
    spo2Pct: exertion.spo2Pct,
    coreTempC,
    respRatePerMin: exertion.respRatePerMin,
    fatiguePct,
    hydrationPct: exertion.hydrationPct,
    fallDetected: false,
    ...(monitored ? { glucoseMmolL: Math.round(glucoseMmolL * 100) / 100 } : {}),
    lastUpdatedMs: {
      hrBpm: atMs,
      spo2Pct: atMs,
      respRatePerMin: atMs,
      hydrationPct: atMs,
      ...(coreTempUpdatedAtMs === undefined ? {} : { coreTempC: coreTempUpdatedAtMs }),
      fatiguePct: atMs,
      ...(monitored ? { glucoseMmolL: atMs } : {}),
    },
  } as unknown as Vitals;
}

/**
 * How far behind the environmental picture falls with no recon overhead.
 *
 * Past the 60-second stale threshold but inside the 120-second missing one, so
 * the readings stay usable and confidence drops a step rather than the channels
 * vanishing. Losing the drone should degrade the picture, not black it out.
 */
const NO_RECON_AGE_MS = 90_000;

function environmentFrom(
  air: Atmosphere,
  atMs: number,
  reconCoverage: boolean,
): Environment {
  /*
    Recon coverage is what makes the air data current.

    Without a drone overhead there is no plausible source for a live CO and
    PM2.5 reading at one firefighter's exact position, so those channels are
    aged and the existing staleness rules take it from there. No new scoring
    path — the drone earns its place through machinery the engine already has.
  */
  const observedAtMs = reconCoverage ? atMs : atMs - NO_RECON_AGE_MS;

  return {
    ambientTempC: air.ambientTempC,
    humidityPct: air.humidityPct,
    coPpm: air.coPpm,
    pm25UgM3: air.pm25UgM3,
    windSpeedMs: 12,
    windDirDeg: 45,
    lastUpdatedMs: {
      ambientTempC: observedAtMs,
      humidityPct: observedAtMs,
      coPpm: observedAtMs,
      pm25UgM3: observedAtMs,
      windSpeedMs: observedAtMs,
      windDirDeg: observedAtMs,
    },
  } as unknown as Environment;
}

function positionFrom(
  lat: number,
  lng: number,
  separationM: number,
  scbaPressurePct: number,
  timeOnTaskMin: number,
  atMs: number,
): Position {
  /*
    Being INSIDE the perimeter is reported as a blocked escape route.

    Known limitation 21: the engine clamps separation at zero, so "at the fire
    edge" and "two kilometres inside the fire" arrive as the same number and
    scored the same — a crew deep inside the burn area read CAUTION. Rather than
    invent an override, this states the thing that is actually true of someone
    surrounded by fire: their route out is not clear. The engine already scores
    an unavailable route at worst case, so the severity comes from existing
    behaviour rather than a special case bolted on here.
  */
  const overrun = separationM < 0;

  return {
    lat,
    lng,
    // Inside the perimeter reports zero separation, never a negative distance.
    distanceToFireFrontM: Math.max(0, Math.round(separationM)),
    distanceToSafeZoneM: null,
    escapeRouteStatus: overrun ? "blocked" : "clear",
    scbaPressurePct,
    scbaOnAir: true,
    wearingPpe: true,
    timeOnTaskMin,
    manualMaydayActive: false,
    lastUpdatedMs: {
      fix: atMs,
      escapeRouteStatus: atMs,
      scbaPressurePct: atMs,
      distanceToFireFrontM: atMs,
    },
  } as unknown as Position;
}

/**
 * Walk the physiology pipeline forward from the start of the shift to `atMs`.
 *
 * The Kalman filter, COHb accumulation and PM2.5 dose are all stateful — they
 * need a history, not a single reading. Scrubbing has no history, so one is
 * reconstructed here by stepping the real pipeline from the start of the
 * current bottle cycle, holding the firefighter at their current position
 * throughout. That assumption (they have been where they are now for the whole
 * cycle) is the price of a scrubbable timeline, and it is why the exposure
 * figures are indicative rather than a record of what anyone actually breathed.
 */
function walkPhysiology(
  profile: HealthProfile,
  atMs: number,
  separationM: number,
  fireRadiusM: number,
) {
  const nowOnTask = timeOnTaskAt(atMs);
  const shiftStartMs = atMs - nowOnTask * 60_000;

  let carryOver: PhysiologyCarryOver = EMPTY_CARRY_OVER;
  let derivation = null as ReturnType<typeof derivePhysiology> | null;

  for (let minute = 0; minute <= nowOnTask; minute += STEP_MINUTES) {
    const stepMs = shiftStartMs + minute * 60_000;
    const air = atmosphereAt(separationM, fireRadiusM);
    const exertion = exertionAt(
      profile.restingHrBpm ?? 60,
      profile.spo2BaselinePct ?? 97,
      minute,
      separationM,
    );

    derivation = derivePhysiology({
      profile,
      readings: {
        hrBpm: exertion.hrBpm,
        spo2Pct: exertion.spo2Pct,
        reportedCoreTempC: null,
        reportedFatiguePct: null,
        ambientTempC: air.ambientTempC,
        humidityPct: air.humidityPct,
        meanRadiantTempC: null,
        airVelocityMs: 12,
        coPpm: air.coPpm,
        pm25UgM3: air.pm25UgM3,
        wearingPpe: true,
        scbaOnAir: true,
      },
      timestamps: {
        hrBpm: stepMs,
        ambientTempC: stepMs,
        humidityPct: stepMs,
        coPpm: stepMs,
        pm25UgM3: stepMs,
      },
      carryOver,
      observedAtMs: stepMs,
      config: DEFAULT_PHYSIOLOGY_CONFIG,
    });

    carryOver = {
      coreTempC: derivation.coreTempC,
      coreTempVarianceC2: derivation.coreTempVarianceC2,
      fatiguePct: derivation.fatiguePct,
      cohbPct: derivation.cohbPct,
      pm25DoseUgMinM3: derivation.pm25DoseUgMinM3,
      worstCoPpm: air.coPpm,
      worstPm25UgM3: air.pm25UgM3,
      previousObservedAtMs: stepMs,
    };
  }

  return derivation;
}

export type CrewAssessment = {
  callsign: string;
  lat: number;
  lng: number;
  separationM: number;
  band: RiskBand;
  score: number;
  confidence: string;
  /** Which of the three zones they are standing in. */
  zone: "DANGER" | "CAUTION" | "SAFE" | "UNKNOWN";
  /** Offsets from the fire edge, metres. Null when unreachable in the window. */
  dangerOffsetM: number | null;
  cautionOffsetM: number | null;
  hrBpm: number;
  spo2Pct: number;
  coreTempC: number;
  fatiguePct: number;
  cohbPct: number;
  timeOnTaskMin: number;
  /** True when a recon drone is refreshing the air picture over this position. */
  reconCoverage: boolean;
};

/**
 * Assess one firefighter, and find the two offsets that define their three
 * zones.
 *
 * The contour sweep holds their DERIVED physiology fixed — the core temperature
 * and CO burden they have actually accumulated travel with them — and varies
 * only the air and the proximity. The question the contour answers is "given
 * the state this person is already in, where would they be safe", which is the
 * question a commander repositioning a crew is asking.
 */
export function assessCrewMember(
  profile: HealthProfile,
  placement: CrewPlacement,
  atMs: number,
  recon: DroneState[] = reconDronesAt(atMs),
): CrewAssessment {
  const radii = perimeterRadiiAt(atMs);
  const fireRadiusM = Math.max(...radii);
  const { eastM, northM } = toEastNorth(placement.lng, placement.lat);
  const separationM = separationFromFire(atMs, eastM, northM);
  const timeOnTaskMin = timeOnTaskAt(atMs);
  const reconCoverage = hasReconCoverage(atMs, placement.lat, placement.lng, recon);

  const physiology = walkPhysiology(profile, atMs, separationM, fireRadiusM);
  const coreTempC = physiology?.coreTempC ?? 37;
  const coreTempUpdatedAtMs = physiology?.coreTempUpdatedAtMs;
  const fatiguePct = physiology?.fatiguePct ?? 0;

  /**
   * Band this person would be in, standing `offsetM` beyond the fire edge.
   *
   * `actualSeparationM` is passed separately for their real position, which may
   * be negative when the fire has overrun them. Every point on the contour
   * sweep is outside the perimeter by construction, so it uses the offset.
   */
  const bandAt = (
    offsetM: number,
    actualSeparationM = offsetM,
  ): { band: RiskBand; score: number; confidence: string } => {
    const air = atmosphereAt(offsetM, fireRadiusM);
    const exertion = exertionAt(
      profile.restingHrBpm ?? 60,
      profile.spo2BaselinePct ?? 97,
      timeOnTaskMin,
      offsetM,
    );
    const assessment = assessRisk(
      profile,
      vitalsFrom(
        profile,
        exertion,
        coreTempC,
        coreTempUpdatedAtMs,
        fatiguePct,
        timeOnTaskMin,
        atMs,
      ),
      environmentFrom(air, atMs, reconCoverage),
      positionFrom(
        placement.lat,
        placement.lng,
        actualSeparationM,
        exertion.scbaPressurePct,
        timeOnTaskMin,
        atMs,
      ),
      DEFAULT_RISK_CONFIG,
      atMs,
    );
    return {
      band: assessment.band,
      score: assessment.score,
      confidence: assessment.dataQuality.confidence,
    };
  };

  // Where they actually stand — including being inside the fire, if they are.
  const here = bandAt(Math.max(0, separationM), separationM);

  // One sweep outward, reading off both boundaries. Linear rather than a binary
  // search: the band is not guaranteed monotonic in distance, and a search
  // could settle in a local pocket.
  let dangerOffsetM: number | null = null;
  let cautionOffsetM: number | null = null;

  for (let i = 0; i <= OFFSET_STEPS; i += 1) {
    const offset = (i / OFFSET_STEPS) * MAX_OFFSET_M;
    const severity = BAND_SEVERITY[bandAt(offset).band];
    if (dangerOffsetM === null && severity <= BAND_SEVERITY.CAUTION) {
      dangerOffsetM = Math.round(offset);
    }
    if (severity <= BAND_SEVERITY.SAFE) {
      cautionOffsetM = Math.round(offset);
      break;
    }
  }

  const zone: CrewAssessment["zone"] =
    here.band === "UNKNOWN"
      ? "UNKNOWN"
      : BAND_SEVERITY[here.band] > BAND_SEVERITY.CAUTION
        ? "DANGER"
        : here.band === "SAFE"
          ? "SAFE"
          : "CAUTION";

  return {
    callsign: placement.callsign,
    lat: placement.lat,
    lng: placement.lng,
    separationM: Math.round(separationM),
    band: here.band,
    score: Math.round(here.score * 10) / 10,
    confidence: here.confidence,
    zone,
    dangerOffsetM,
    cautionOffsetM,
    hrBpm: exertionAt(
      profile.restingHrBpm ?? 60,
      profile.spo2BaselinePct ?? 97,
      timeOnTaskMin,
      Math.max(0, separationM),
    ).hrBpm,
    spo2Pct: exertionAt(
      profile.restingHrBpm ?? 60,
      profile.spo2BaselinePct ?? 97,
      timeOnTaskMin,
      Math.max(0, separationM),
    ).spo2Pct,
    coreTempC: Math.round(coreTempC * 100) / 100,
    fatiguePct: Math.round(fatiguePct),
    cohbPct: Math.round((physiology?.cohbPct ?? 0) * 100) / 100,
    timeOnTaskMin,
    reconCoverage,
  };
}
