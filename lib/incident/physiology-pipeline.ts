/**
 * The composition layer. This is the only place the physiology models and the
 * risk engine meet.
 *
 * ARCHITECTURAL BOUNDARY, enforced by tests:
 *   lib/risk/       imports nothing from lib/physiology/
 *   lib/physiology/ imports nothing from lib/risk/
 *   this module     imports both, and nothing imports this module from inside
 *                   either of them
 *
 * Both remain liftable into separate services. The risk engine still receives
 * plain numbers and has no idea they were modelled rather than measured.
 *
 * WHAT CHANGES HERE. Before this module, `coreTempC` and `fatiguePct` arrived as
 * given inputs — effectively pretend sensors. Now they are *produced*:
 *
 *   heart rate ─► Karvonen reserve ─► inferred metabolic rate
 *                        │                      │
 *                        │                      ▼
 *                        │            reduced ISO 7933 heat balance
 *                        │                      │
 *                        │                      ▼  heat storage
 *                        └──────────────► core temperature estimate
 *                        │                      │
 *                        └──────────────► fatigue accumulation
 *                        └──────────────► toxic exposure accumulation
 *
 * The values a sensor reported are still stored, so the record shows what the
 * sensor said *and* what the model said. The engine consumes the model's.
 *
 * Pure. Takes plain data and returns plain data — no Prisma, no HTTP.
 */

import {
  accumulateFatigue,
  accumulateToxicExposure,
  assessCardiacStrain,
  assessHeatStrain,
  estimateCoreTempKalman,
  inferMetabolicRateWm2,
  personalCoreTempLimitC,
  physParam,
  type CoreTempFilterState,
  type PhysiologyConfig,
  type Subject,
  type WorkContext,
} from "@/lib/physiology";
import type { HealthProfile } from "@/lib/risk/types";

/** Readings as they arrived, before any modelling. */
export type RawReadings = {
  hrBpm: number | null;
  spo2Pct: number | null;
  /** What a wearable reported, if anything. Recorded but not consumed. */
  reportedCoreTempC: number | null;
  /** What a wearable reported, if anything. Recorded but not consumed. */
  reportedFatiguePct: number | null;
  ambientTempC: number | null;
  humidityPct: number | null;
  meanRadiantTempC: number | null;
  airVelocityMs: number | null;
  coPpm: number | null;
  pm25UgM3: number | null;
  wearingPpe: boolean;
  scbaOnAir: boolean;
};

/** Freshness of the inputs, epoch ms. Absent means the channel is not aged. */
export type ReadingTimestamps = {
  hrBpm?: number | undefined;
  ambientTempC?: number | undefined;
  humidityPct?: number | undefined;
  coPpm?: number | undefined;
  pm25UgM3?: number | undefined;
};

/** Carried forward from the previous tick for this firefighter. */
export type PhysiologyCarryOver = {
  coreTempC: number | null;
  /**
   * Variance of the core temperature estimate carried from the previous tick.
   * The Kalman filter needs both the estimate and its variance; carrying only
   * the estimate would silently reset the filter's uncertainty every tick.
   */
  coreTempVarianceC2: number | null;
  fatiguePct: number | null;
  cohbPct: number | null;
  pm25DoseUgMinM3: number | null;
  /** Worst CO seen so far this incident, so a dropout is not read as clean air. */
  worstCoPpm: number | null;
  worstPm25UgM3: number | null;
  /** Epoch ms of the previous observation, for the step length. */
  previousObservedAtMs: number | null;
};

export const EMPTY_CARRY_OVER: PhysiologyCarryOver = {
  coreTempC: null,
  coreTempVarianceC2: null,
  fatiguePct: null,
  cohbPct: null,
  pm25DoseUgMinM3: null,
  worstCoPpm: null,
  worstPm25UgM3: null,
  previousObservedAtMs: null,
};

export type DerivePhysiologyInput = {
  profile: HealthProfile;
  readings: RawReadings;
  timestamps: ReadingTimestamps;
  carryOver: PhysiologyCarryOver;
  observedAtMs: number;
  config: PhysiologyConfig;
};

export type PhysiologyDerivation = {
  /** What the risk engine will consume as `coreTempC`. */
  coreTempC: number;
  /**
   * Freshness of the derived core temperature, epoch ms — or undefined when it
   * cannot be aged, in which case the engine treats it as missing.
   */
  coreTempUpdatedAtMs: number | undefined;
  /** Variance of the estimate, to carry into the next tick. */
  coreTempVarianceC2: number;
  /** Standard deviation of the estimate, °C. Drives the confidence reduction. */
  coreTempSdC: number;
  /** False when heart rate was absent and only the filter's time update ran. */
  coreTempObservationApplied: boolean;
  /** Upper confidence bound used by safety-relevant downstream models. */
  coreTempUpperBoundC: number;

  /** What the risk engine will consume as `fatiguePct`. */
  fatiguePct: number;
  fatigueUpdatedAtMs: number | undefined;

  hrrFraction: number | null;
  effectiveHrReserveBpm: number;
  metabolicRateWm2: number;
  heatStorageWm2: number;
  predictedSweatRateGPerHour: number;
  dlimMin: number | null;
  heatStrainLimiter: string;
  coreTempLimitC: number;

  cohbPct: number;
  coIndex: number;
  pm25DoseUgMinM3: number;
  pm25Index: number;
  toxicCombinedIndex: number;

  stepMinutes: number;
  stepCapped: boolean;
  /** Every caveat every model raised, de-duplicated, order preserved. */
  caveats: string[];
  modelVersion: string;
  configHash: string;
};

/** HealthProfile is the risk engine's shape; Subject is physiology's. */
export function toPhysiologySubject(profile: HealthProfile): Subject {
  return {
    id: profile.id,
    callsign: profile.callsign,
    ageYears: profile.age,
    restingHrBpm: profile.restingHrBpm,
    fitness: profile.fitness,
    heatTolerance: profile.heatTolerance,
    prevShiftHours: profile.prevShiftHours,
    // Body mass, surface area and heat acclimatisation are not captured on
    // FirefighterProfile. Population defaults are used and acclimatisation
    // defaults to false, which is the conservative direction.
    bodyMassKg: null,
    bodySurfaceAreaM2: null,
    heatAcclimatised: false,
  };
}

function toWorkContext(readings: RawReadings): WorkContext {
  return {
    ambientTempC: readings.ambientTempC,
    humidityPct: readings.humidityPct,
    meanRadiantTempC: readings.meanRadiantTempC,
    airVelocityMs: readings.airVelocityMs,
    coPpm: readings.coPpm,
    pm25UgM3: readings.pm25UgM3,
    wearingPpe: readings.wearingPpe,
    scbaOnAir: readings.scbaOnAir,
  };
}

/**
 * Freshness of a derived value: no fresher than the oldest input it used.
 *
 * Returns undefined when a *required* input cannot be aged at all. Heart rate is
 * required for both derived channels, because it drives the inferred metabolic
 * rate and the cardiac term. Without it the models still produce a deliberately
 * pessimistic number, but that number must not be presented as a current
 * reading — so it is handed over unaged and the risk engine treats it as
 * missing, which scores it at worst case.
 */
function derivedTimestamp(
  required: Array<number | undefined>,
  contributing: Array<number | undefined>,
): number | undefined {
  for (const ts of required) {
    if (ts === undefined || !Number.isFinite(ts)) return undefined;
  }
  const known = [...required, ...contributing].filter(
    (ts): ts is number => ts !== undefined && Number.isFinite(ts),
  );
  return known.length === 0 ? undefined : Math.min(...known);
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

export function derivePhysiology(
  input: DerivePhysiologyInput,
): PhysiologyDerivation {
  const { profile, readings, timestamps, carryOver, observedAtMs, config } = input;
  const subject = toPhysiologySubject(profile);
  const context = toWorkContext(readings);
  const caveats: string[] = [];

  /* --- Step length -------------------------------------------------------- */
  const maxStepMin = physParam(config, "max_step_minutes");
  const rawStepMin =
    carryOver.previousObservedAtMs === null
      ? 0
      : Math.max(0, (observedAtMs - carryOver.previousObservedAtMs) / 60_000);
  const stepMinutes = Math.min(rawStepMin, maxStepMin);
  const stepCapped = rawStepMin > maxStepMin;
  if (stepCapped) {
    caveats.push(
      `Gap since the previous observation was ${rawStepMin.toFixed(1)} min but the integration step is capped at ${maxStepMin} min, so accumulation across the gap is understated.`,
    );
  }

  /* --- 1. Cardiac strain -------------------------------------------------- */
  const cardiac = assessCardiacStrain(subject, readings.hrBpm, context, config);
  caveats.push(...cardiac.provenance.caveats);

  /* --- 2. Inferred metabolic rate ---------------------------------------- */
  const metabolic = inferMetabolicRateWm2(cardiac.hrrFraction, config);
  caveats.push(metabolic.caveat);

  /* --- 3. Heat strain ---------------------------------------------------- */
  const startCoreTempC =
    carryOver.coreTempC ?? physParam(config, "core_temp_baseline_c");
  const heat = assessHeatStrain(
    {
      subject,
      context,
      metabolicRateWm2: metabolic.metabolicRateWm2,
      currentCoreTempC: startCoreTempC,
    },
    config,
  );
  caveats.push(...heat.provenance.caveats);

  /* --- 4. Core temperature estimate — sequential Kalman filter ----------- */
  // Heart-rate-only by design. The heat balance above is reported alongside
  // rather than folded in, so the published model is not corrupted.
  const previousState: CoreTempFilterState | null =
    carryOver.coreTempC === null || carryOver.coreTempVarianceC2 === null
      ? null
      : {
          coreTempC: carryOver.coreTempC,
          varianceC2: carryOver.coreTempVarianceC2,
        };

  const coreTemp = estimateCoreTempKalman(
    {
      subject,
      previousState,
      hrBpm: readings.hrBpm,
      elapsedMin: stepMinutes,
    },
    config,
  );
  caveats.push(...coreTemp.provenance.caveats);

  /* --- 5. Fatigue -------------------------------------------------------- */
  // Fatigue's heat multiplier uses an UPPER CONFIDENCE BOUND on core
  // temperature, not the point estimate.
  //
  // The Kalman filter holds its estimate steady when heart rate drops out and
  // grows the variance instead. Feeding the point estimate downstream would mean
  // a dropout made fatigue accumulation *less* pessimistic just as the data got
  // worse — the same failure mode as a missing reading scoring as safe. Using
  // estimate + n·SD keeps "worse data is never rewarded" true through the whole
  // chain, and the multiple is a named, reviewable parameter.
  const coreTempUpperBoundC = Math.min(
    physParam(config, "core_temp_max_c"),
    coreTemp.coreTempC +
      physParam(config, "core_temp_upper_bound_sd_multiple") *
        coreTemp.standardDeviationC,
  );

  const fatigue = accumulateFatigue(
    {
      subject,
      previousFatiguePct: carryOver.fatiguePct,
      hrrFraction: cardiac.hrrFraction,
      coreTempC: coreTempUpperBoundC,
      coreTempLimitC: personalCoreTempLimitC(subject, config),
      elapsedMin: stepMinutes,
    },
    config,
  );
  caveats.push(...fatigue.provenance.caveats);
  if (coreTempUpperBoundC > coreTemp.coreTempC) {
    caveats.push(
      `Downstream models used an upper confidence bound of ${coreTempUpperBoundC.toFixed(2)} C rather than the ${coreTemp.coreTempC.toFixed(2)} C point estimate, because the estimate carries uncertainty.`,
    );
  }

  /* --- 6. Toxic exposure ------------------------------------------------- */
  const toxic = accumulateToxicExposure(
    {
      context,
      previousCohbPct: carryOver.cohbPct,
      previousPm25DoseUgMinM3: carryOver.pm25DoseUgMinM3,
      hrrFraction: cardiac.hrrFraction,
      elapsedMin: stepMinutes,
      worstKnownCoPpm: carryOver.worstCoPpm,
      worstKnownPm25UgM3: carryOver.worstPm25UgM3,
    },
    config,
  );
  caveats.push(...toxic.provenance.caveats);

  /* --- Freshness of the derived channels --------------------------------- */
  const coreTempUpdatedAtMs = derivedTimestamp(
    [timestamps.hrBpm],
    [timestamps.ambientTempC, timestamps.humidityPct],
  );
  const fatigueUpdatedAtMs = derivedTimestamp([timestamps.hrBpm], []);

  if (coreTempUpdatedAtMs === undefined) {
    caveats.push(
      "Core temperature is derived from heart rate, which cannot be aged, so the derived value is handed over unaged and will be treated as missing.",
    );
  }
  if (readings.reportedCoreTempC !== null) {
    caveats.push(
      "A wearable also reported a core temperature. It is recorded but not used: the model output is authoritative.",
    );
  }

  return {
    coreTempC: coreTemp.coreTempC,
    coreTempUpdatedAtMs,
    coreTempVarianceC2: coreTemp.state.varianceC2,
    coreTempSdC: coreTemp.standardDeviationC,
    coreTempObservationApplied: coreTemp.observationApplied,
    coreTempUpperBoundC: Math.round(coreTempUpperBoundC * 100) / 100,
    fatiguePct: fatigue.fatiguePct,
    fatigueUpdatedAtMs,

    hrrFraction: cardiac.hrrFraction,
    effectiveHrReserveBpm: cardiac.effectiveHrReserveBpm,
    metabolicRateWm2: metabolic.metabolicRateWm2,
    heatStorageWm2: heat.heatStorageWm2,
    predictedSweatRateGPerHour: heat.predictedSweatRateGPerHour,
    dlimMin: heat.dlimMin,
    heatStrainLimiter: heat.limiter,
    coreTempLimitC: heat.coreTempLimitC,

    cohbPct: toxic.cohbPct,
    coIndex: toxic.coIndex,
    pm25DoseUgMinM3: toxic.pm25DoseUgMinM3,
    pm25Index: toxic.pm25Index,
    toxicCombinedIndex: toxic.combinedIndex,

    stepMinutes: Math.round(stepMinutes * 100) / 100,
    stepCapped,
    caveats: dedupe(caveats),
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };
}
