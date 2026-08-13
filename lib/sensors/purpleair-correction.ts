/**
 * EPA US-wide correction for PurpleAir PM2.5, extended for wildfire smoke.
 *
 * WHY THIS EXISTS. Raw PurpleAir readings overestimate PM2.5 by roughly 60%
 * (EPA collocated study), and the error is non-linear above 300 µg/m³ — exactly
 * the range wildfire smoke produces. Feeding raw values into an asthma exposure
 * index makes every threshold fire early, which looks like a broken model to
 * anyone who knows air quality.
 *
 * THREE REGIMES:
 *   ≤ 300 µg/m³   EPA US-wide multi-linear correction using relative humidity
 *   300–400       blended transition between the two fits
 *   ≥ 400         quadratic fit for extreme smoke
 *
 * ============================ READ THIS ==================================
 * The correction STRUCTURE is published. The COEFFICIENT VALUES in
 * `config/purpleair-default.json` are an UNVERIFIED transcription — nobody here
 * has read the paper. They are marked `literature_derived` with a citation
 * because the method is published, and every rationale says UNVERIFIED.
 *
 * Source to verify: Barkjohn KK, Holder AL, Frederick SG, Clements AL,
 * "Correction and Accuracy of PurpleAir PM2.5 Measurements for Extreme Wildfire
 * Smoke", Sensors 2022, 22, 9669 (see corrigendum Sensors 2024, 24, 7871).
 * Tracked as blocking item 2 in docs/DATA_PROVENANCE.md.
 *
 * PM2.5 feeds the environmental subscore, and for a firefighter with declared
 * respiratory risk it feeds the thresholds that fire earliest. A wrong
 * correction moves every asthma-related alert in the system.
 * =========================================================================
 *
 * KNOWN LIMITATION, DOCUMENTED NOT HIDDEN: even corrected, the regression slope
 * is approximately 0.88 during smoke events — a residual underestimate of about
 * 12%. This is stated in the model assumptions panel and travels with every
 * corrected reading as `knownBiasNote`.
 *
 * CHANNEL SELECTION: the correction is fitted against `pm2.5_cf_1`, the higher-
 * density correction factor. The `pm2.5_atm` channel diverges above 30 µg/m³,
 * reaching a ratio of about 0.66 against cf_1 at 80 µg/m³. Applying a cf_1
 * correction to `atm` data compounds the error, so this module accepts cf_1 only.
 *
 * Pure. No imports beyond config and types.
 */

import { paParam, type PurpleAirConfig } from "./purpleair-config";

/** Raw two-channel reading, cf_1 channel only. */
export type PurpleAirRaw = {
  /** Channel A, pm2.5_cf_1. */
  pm25_cf_1_a: number;
  /** Channel B, pm2.5_cf_1. */
  pm25_cf_1_b: number;
  humidityPct: number;
  temperatureC: number;
  timestampMs: number;
};

export type CorrectionRegime = "us_wide" | "transition" | "extreme_smoke";
export type QualityFlag = "good" | "degraded" | "rejected";

export type CorrectedPm25 = {
  /** Corrected value, µg/m³. Null when the reading was rejected. */
  valueUgM3: number | null;
  /** Raw channel mean before correction, µg/m³. Retained always. */
  rawUgM3: number;
  regime: CorrectionRegime;
  /** |A − B| / mean. Zero when both channels agree exactly. */
  channelAgreement: number;
  qualityFlag: QualityFlag;
  correctionApplied: string;
  knownBiasNote: string;
  /** Why the reading was degraded or rejected. Empty when good. */
  rejectionReasons: string[];
  /**
   * A rejected reading is MISSING, not zero and not the raw value. The caller
   * must pass null to the risk engine, which then scores it at worst case and
   * moves the band to UNKNOWN. Never substitute the raw reading.
   */
  treatAsMissing: boolean;
  channel: "pm2.5_cf_1";
  correctionMethod: "epa_us_wide_extended_v1";
  coefficientsVerified: false;
  citation: string;
};

const CITATION =
  "Barkjohn KK, Holder AL, Frederick SG, Clements AL. Correction and Accuracy of PurpleAir PM2.5 Measurements for Extreme Wildfire Smoke. Sensors 2022;22:9669 (corrigendum Sensors 2024;24:7871). COEFFICIENTS UNVERIFIED — see docs/DATA_PROVENANCE.md blocking item 2.";

const KNOWN_BIAS_NOTE =
  "Even corrected, the regression slope is approximately 0.88 for smoke events — roughly a 12% underestimate. Raw sensor values are retained.";

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** EPA US-wide multi-linear form: a·raw + b·RH + c. */
export function usWideCorrection(
  rawUgM3: number,
  humidityPct: number,
  config: PurpleAirConfig,
): number {
  return (
    paParam(config, "us_wide_slope") * rawUgM3 +
    paParam(config, "us_wide_humidity_coeff") * humidityPct +
    paParam(config, "us_wide_intercept")
  );
}

/** Quadratic form for extreme smoke: a·raw² + b·raw + c·RH + d. */
export function extremeSmokeCorrection(
  rawUgM3: number,
  humidityPct: number,
  config: PurpleAirConfig,
): number {
  return (
    paParam(config, "extreme_quadratic_coeff") * rawUgM3 * rawUgM3 +
    paParam(config, "extreme_linear_coeff") * rawUgM3 +
    paParam(config, "extreme_humidity_coeff") * humidityPct +
    paParam(config, "extreme_intercept")
  );
}

/**
 * Two-channel agreement. PurpleAir carries two laser counters; disagreement
 * between them is the primary indicator of a fouled or failing sensor.
 */
export function channelAgreement(a: number, b: number): number {
  const mean = (a + b) / 2;
  if (mean === 0) return a === b ? 0 : Number.POSITIVE_INFINITY;
  return Math.abs(a - b) / Math.abs(mean);
}

export function correctPurpleAir(
  raw: PurpleAirRaw,
  config: PurpleAirConfig,
): CorrectedPm25 {
  const rejectionReasons: string[] = [];
  const mean = (raw.pm25_cf_1_a + raw.pm25_cf_1_b) / 2;
  const agreement = channelAgreement(raw.pm25_cf_1_a, raw.pm25_cf_1_b);

  const base = {
    rawUgM3: Number.isFinite(mean) ? Math.round(mean * 100) / 100 : 0,
    channelAgreement: Number.isFinite(agreement)
      ? Math.round(agreement * 1000) / 1000
      : Number.POSITIVE_INFINITY,
    knownBiasNote: KNOWN_BIAS_NOTE,
    channel: "pm2.5_cf_1" as const,
    correctionMethod: "epa_us_wide_extended_v1" as const,
    coefficientsVerified: false as const,
    citation: CITATION,
  };

  const reject = (regime: CorrectionRegime): CorrectedPm25 => ({
    ...base,
    valueUgM3: null,
    regime,
    qualityFlag: "rejected",
    correctionApplied: "none — reading rejected",
    rejectionReasons,
    treatAsMissing: true,
  });

  /* --- Quality checks, before any correction ----------------------------- */

  // 1. Physical plausibility. Negative PM2.5 or absurd values are sensor faults,
  //    not smoke.
  const maxPlausible = paParam(config, "max_plausible_ug_m3");
  for (const [label, value] of [
    ["channel A", raw.pm25_cf_1_a],
    ["channel B", raw.pm25_cf_1_b],
  ] as const) {
    if (!Number.isFinite(value)) {
      rejectionReasons.push(`${label} is not a finite number`);
    } else if (value < 0) {
      rejectionReasons.push(`${label} is negative (${value}) — a sensor fault, not smoke`);
    } else if (value > maxPlausible) {
      rejectionReasons.push(
        `${label} is ${value} ug/m3, above the ${maxPlausible} ug/m3 plausibility ceiling — a sensor fault, not smoke`,
      );
    }
  }

  // 2. Humidity bounds. The correction uses relative humidity; outside 0-100 it
  //    is not a humidity reading.
  if (
    !Number.isFinite(raw.humidityPct) ||
    raw.humidityPct < 0 ||
    raw.humidityPct > 100
  ) {
    rejectionReasons.push(
      `relative humidity ${raw.humidityPct} is outside 0-100% — the correction cannot be applied`,
    );
  }

  if (rejectionReasons.length > 0) return reject("us_wide");

  // 3. Channel agreement.
  const degradedAbsolute = paParam(config, "channel_disagreement_degraded_ug_m3");
  const degradedFraction = paParam(config, "channel_disagreement_degraded_frac");
  const rejectFraction = paParam(config, "channel_disagreement_rejected_frac");
  const absoluteDiff = Math.abs(raw.pm25_cf_1_a - raw.pm25_cf_1_b);
  const degradedThreshold = Math.max(degradedAbsolute, degradedFraction * mean);

  let qualityFlag: QualityFlag = "good";
  if (agreement > rejectFraction) {
    rejectionReasons.push(
      `channels disagree by ${(agreement * 100).toFixed(0)}%, above the ${(rejectFraction * 100).toFixed(0)}% rejection threshold — the sensor cannot be trusted`,
    );
    return reject("us_wide");
  }
  if (absoluteDiff > degradedThreshold) {
    qualityFlag = "degraded";
    rejectionReasons.push(
      `channels disagree by ${absoluteDiff.toFixed(1)} ug/m3, above the ${degradedThreshold.toFixed(1)} ug/m3 degraded threshold`,
    );
  }

  /* --- Correction -------------------------------------------------------- */

  const transitionLow = paParam(config, "transition_low_ug_m3");
  const transitionHigh = paParam(config, "transition_high_ug_m3");
  const humidity = clamp(raw.humidityPct, 0, 100);

  let corrected: number;
  let regime: CorrectionRegime;
  let correctionApplied: string;

  if (mean <= transitionLow) {
    regime = "us_wide";
    corrected = usWideCorrection(mean, humidity, config);
    correctionApplied = `EPA US-wide multi-linear, raw ${mean.toFixed(1)} ug/m3 at ${humidity.toFixed(0)}% RH`;
  } else if (mean >= transitionHigh) {
    regime = "extreme_smoke";
    corrected = extremeSmokeCorrection(mean, humidity, config);
    correctionApplied = `extreme smoke quadratic, raw ${mean.toFixed(1)} ug/m3 at ${humidity.toFixed(0)}% RH`;
  } else {
    regime = "transition";
    const span = Math.max(1e-9, transitionHigh - transitionLow);
    const weight = (mean - transitionLow) / span;
    const low = usWideCorrection(mean, humidity, config);
    const high = extremeSmokeCorrection(mean, humidity, config);
    corrected = low * (1 - weight) + high * weight;
    correctionApplied = `blended transition, ${((1 - weight) * 100).toFixed(0)}% US-wide / ${(weight * 100).toFixed(0)}% extreme smoke`;
  }

  // A correction must never produce a negative concentration.
  const valueUgM3 = Math.max(0, Math.round(corrected * 100) / 100);

  return {
    ...base,
    valueUgM3,
    regime,
    qualityFlag,
    correctionApplied,
    rejectionReasons,
    treatAsMissing: false,
  };
}
