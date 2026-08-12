/**
 * Core temperature estimation — sequential Kalman filter from heart rate.
 *
 * WHY A KALMAN FILTER IS NOT MACHINE LEARNING. Every coefficient below is a
 * fixed, named, versioned constant read from config. Nothing is fitted at
 * runtime, nothing is learned from the data flowing through, and the same inputs
 * plus the same config always produce byte-identical output. A Kalman filter
 * whose parameters were fitted to data *would* be a learned model; this one's
 * were published, and they sit in `config/physiology-default.json` where a
 * physician can see and change them.
 *
 * STRUCTURE (the published sequential-estimation approach, see ref [2]):
 *
 *   time update        CT⁻(t) = CT(t−1)                       state persists
 *                      v⁻(t)  = v(t−1) + γ                    variance grows
 *
 *   observation model  HR(CT) = b0 + b1·CT + b2·CT²
 *                      dHR/dCT = b1 + 2·b2·CT
 *
 *   measurement update K     = v⁻·(dHR/dCT) / ((dHR/dCT)²·v⁻ + σ²)
 *                      CT(t) = CT⁻(t) + K·(HRobserved − HR(CT⁻))
 *                      v(t)  = (1 − K·(dHR/dCT))·v⁻(t)
 *
 * The variance is the point. When heart rate is unavailable the time update
 * still runs — the estimate persists but its variance grows, so the estimate
 * degrades on its own without anyone special-casing a dropout. That variance
 * becomes a standard deviation, and the standard deviation reduces the
 * confidence of any risk assessment built on it.
 *
 * ============================ READ THIS ==================================
 * The coefficient VALUES in the shipped config are a transcription and have NOT
 * been checked against the primary source by anyone. They are marked
 * `literature_derived` because the method is published, and the citation is
 * recorded — but the reference list flags them as REQUIRING VERIFICATION. Do not
 * treat the specific numbers as authoritative until someone has opened the paper.
 *
 * The published validation is against rectal thermometry in controlled
 * laboratory conditions with real individual variability. NONE of it is
 * firefighter-in-PPE validated. This model may NEVER be marked `validated`.
 * =========================================================================
 *
 * KNOWN STRUCTURAL LIMITATION: this estimator is heart-rate-only. Ambient
 * temperature, humidity, radiant load and PPE do not enter it at all. Two
 * firefighters with the same heart rate get the same core temperature estimate
 * whether they are in 20 °C or 60 °C. That is a property of the published model,
 * not a bug in this implementation — but it is a real weakness, and the heat
 * balance from the reduced PHS model is reported alongside rather than folded in.
 * See docs/KNOWN_LIMITATIONS.md item 25.
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import type { CoreTempEstimate, ModelProvenance, Subject } from "./types";

const MODEL_KEY = "core_temp_kalman_hr_v1";
const MODEL_LABEL =
  "Core temperature — sequential Kalman filter from heart rate (literature-derived structure, coefficients UNVERIFIED, ESTIMATED not measured)";

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Filter state carried between ticks. Plain data — the caller persists it. */
export type CoreTempFilterState = {
  /** Current estimate, °C. */
  coreTempC: number;
  /** Estimate variance, °C². Grows without an observation, shrinks with one. */
  varianceC2: number;
};

export function initialCoreTempFilterState(
  config: PhysiologyConfig,
): CoreTempFilterState {
  return {
    coreTempC: physParam(config, "kalman_initial_core_temp_c"),
    varianceC2: physParam(config, "kalman_initial_variance_c2"),
  };
}

/** Observation model: expected heart rate at a given core temperature. */
export function expectedHeartRateBpm(
  coreTempC: number,
  config: PhysiologyConfig,
): number {
  return (
    physParam(config, "kalman_hr_intercept_b0") +
    physParam(config, "kalman_hr_linear_b1") * coreTempC +
    physParam(config, "kalman_hr_quadratic_b2") * coreTempC * coreTempC
  );
}

/** Derivative of the observation model — the filter's linearisation. */
export function heartRateSensitivityBpmPerC(
  coreTempC: number,
  config: PhysiologyConfig,
): number {
  return (
    physParam(config, "kalman_hr_linear_b1") +
    2 * physParam(config, "kalman_hr_quadratic_b2") * coreTempC
  );
}

export type KalmanCoreTempInput = {
  subject: Subject;
  /** Previous filter state, or null to start from the configured initial state. */
  previousState: CoreTempFilterState | null;
  /** Observed heart rate, bpm. Null runs the time update only. */
  hrBpm: number | null;
  /** Step length in minutes. */
  elapsedMin: number;
};

export type KalmanCoreTempResult = CoreTempEstimate & {
  state: CoreTempFilterState;
  /** Standard deviation of the estimate, °C. This is what drives confidence. */
  standardDeviationC: number;
  /** Kalman gain applied this step. Zero when no observation was available. */
  gain: number;
  /** False when heart rate was unavailable and only the time update ran. */
  observationApplied: boolean;
};

export function estimateCoreTempKalman(
  input: KalmanCoreTempInput,
  config: PhysiologyConfig,
): KalmanCoreTempResult {
  const caveats: string[] = [
    "ESTIMATED, not measured. No core temperature sensor exists in this system.",
    "Sequential Kalman estimation from heart rate. The method is published; the coefficient values in this config are an UNVERIFIED transcription — see docs/CLINICAL_ASSUMPTIONS.md reference [2].",
    "Published validation is against rectal thermometry in laboratory conditions. None of it is firefighter-in-PPE validated, and individual variability is real.",
    "Heart-rate-only: ambient temperature, humidity, radiant load and PPE do not enter this estimate. The heat balance is reported separately.",
  ];

  const elapsedMin = Math.max(0, input.elapsedMin);
  const start = input.previousState ?? initialCoreTempFilterState(config);
  if (input.previousState === null) {
    caveats.push(
      "No previous filter state; started from the configured initial estimate and variance rather than a measurement.",
    );
  }

  /* --- Time update ------------------------------------------------------- */
  const gammaPerMin = physParam(config, "kalman_variance_growth_c2_per_min");
  const predictedCoreTempC = start.coreTempC;
  const predictedVariance = start.varianceC2 + gammaPerMin * elapsedMin;

  /* --- Measurement update ------------------------------------------------ */
  let coreTempC = predictedCoreTempC;
  let varianceC2 = predictedVariance;
  let gain = 0;
  let observationApplied = false;

  if (input.hrBpm !== null && Number.isFinite(input.hrBpm)) {
    const sensitivity = heartRateSensitivityBpmPerC(predictedCoreTempC, config);
    const observationVariance = physParam(
      config,
      "kalman_observation_variance_bpm2",
    );
    const denominator =
      sensitivity * sensitivity * predictedVariance + observationVariance;
    if (denominator > 0) {
      gain = (predictedVariance * sensitivity) / denominator;
      const residual =
        input.hrBpm - expectedHeartRateBpm(predictedCoreTempC, config);
      coreTempC = predictedCoreTempC + gain * residual;
      varianceC2 = (1 - gain * sensitivity) * predictedVariance;
      observationApplied = true;
    }
  } else {
    caveats.push(
      "Heart rate unavailable: the time update ran but no measurement update. The estimate persists and its variance grows, so confidence degrades on its own.",
    );
  }

  /* --- Bounds ------------------------------------------------------------ */
  const minC = physParam(config, "core_temp_min_c");
  const maxC = physParam(config, "core_temp_max_c");
  const boundedCoreTempC = clamp(coreTempC, minC, maxC);
  const clamped = boundedCoreTempC !== coreTempC;
  if (clamped) {
    caveats.push(
      "The estimate reached a configured physiological bound and was clamped.",
    );
  }

  varianceC2 = Math.max(0, varianceC2);
  const standardDeviationC = Math.sqrt(varianceC2);

  const provenance: ModelProvenance = {
    modelKey: MODEL_KEY,
    modelLabel: MODEL_LABEL,
    estimated: true,
    caveats,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };

  const round2 = (v: number): number => Math.round(v * 100) / 100;
  const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;

  return {
    coreTempC: round2(boundedCoreTempC),
    deltaC: round2(boundedCoreTempC - start.coreTempC),
    // The filter has no separate storage/cardiac decomposition. Reporting the
    // whole change as cardiac is honest: heart rate is the only observation.
    contributions: {
      heatStorageC: 0,
      cardiacC: round2(boundedCoreTempC - start.coreTempC),
      recoveryC: 0,
    },
    clamped,
    provenance,
    state: { coreTempC: round2(boundedCoreTempC), varianceC2: round4(varianceC2) },
    standardDeviationC: round4(standardDeviationC),
    gain: round4(gain),
    observationApplied,
  };
}
