/**
 * Core temperature ESTIMATION.
 *
 * Nothing in Valoris measures core temperature. This produces an estimate by
 * blending two deterministic terms:
 *
 *   1. the heat-balance storage term from the reduced PHS model, converted to a
 *      temperature rise via body mass and specific heat
 *   2. a cardiac term, driven by heart rate reserve fraction above a threshold
 *
 * Deliberately NOT a Kalman filter. Sequential estimators of the Buller type
 * are the published state of the art for HR-derived core temperature, but they
 * are statistical models with learned parameters, and Valoris is rule-based and
 * explainable by mandate.
 *
 * Every output is labelled estimated. Every surface that displays it must say
 * "estimated", never "measured".
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import { heatStorageToCoreTempRiseC } from "./heat-strain";
import type { CoreTempEstimate, ModelProvenance, Subject } from "./types";

const MODEL_KEY = "core_temp_blend_v1";
const MODEL_LABEL =
  "Core temperature estimate — heat balance blended with cardiac strain (illustrative, ESTIMATED not measured)";

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

export type CoreTempInput = {
  subject: Subject;
  /** Previous estimate, °C. Null starts from the configured baseline. */
  previousCoreTempC: number | null;
  /** Heat storage from the reduced PHS model, W/m². */
  heatStorageWm2: number;
  /** Heart rate reserve fraction, or null when heart rate is unavailable. */
  hrrFraction: number | null;
  /** Step length in minutes. */
  elapsedMin: number;
};

export function estimateCoreTemp(
  input: CoreTempInput,
  config: PhysiologyConfig,
): CoreTempEstimate {
  const caveats: string[] = [
    "ESTIMATED, not measured. No core temperature sensor exists in this system.",
    "Not a validated core temperature estimator; no sequential or statistical estimator is used.",
  ];

  const { subject, hrrFraction } = input;
  const elapsedMin = Math.max(0, input.elapsedMin);
  const startC =
    input.previousCoreTempC ?? physParam(config, "core_temp_baseline_c");
  if (input.previousCoreTempC === null) {
    caveats.push(
      "No previous estimate; started from the configured baseline rather than a measurement.",
    );
  }

  const bodyMassKg = subject.bodyMassKg ?? physParam(config, "body_mass_kg_default");
  const surfaceAreaM2 =
    subject.bodySurfaceAreaM2 ?? physParam(config, "body_surface_area_m2_default");

  /* --- Storage term ------------------------------------------------------ */
  const rawStorageRiseC = heatStorageToCoreTempRiseC(
    input.heatStorageWm2,
    surfaceAreaM2,
    bodyMassKg,
    elapsedMin,
    config,
  );
  const heatStorageC =
    physParam(config, "core_temp_weight_heat_storage") * rawStorageRiseC;

  /* --- Cardiac term ------------------------------------------------------ */
  const threshold = physParam(config, "core_temp_cardiac_hrr_threshold_frac");
  let cardiacC = 0;
  if (hrrFraction === null) {
    // No heart rate. Assume the cardiac term at its threshold-exceeded maximum
    // rather than zero — absence of data must not read as rest.
    cardiacC =
      physParam(config, "core_temp_weight_cardiac") *
      physParam(config, "core_temp_cardiac_rise_c_per_hour_at_max_hrr") *
      (elapsedMin / 60);
    caveats.push(
      "Heart rate unavailable — the cardiac term is taken at its maximum rather than zero, so the estimate is deliberately pessimistic.",
    );
  } else {
    const excess = Math.max(0, hrrFraction - threshold) / Math.max(1e-9, 1 - threshold);
    cardiacC =
      physParam(config, "core_temp_weight_cardiac") *
      physParam(config, "core_temp_cardiac_rise_c_per_hour_at_max_hrr") *
      clamp(excess, 0, 1) *
      (elapsedMin / 60);
  }

  /* --- Recovery ---------------------------------------------------------- */
  // Only when heat is actually being shed and exertion is below the threshold.
  const restingBelowThreshold =
    hrrFraction !== null && hrrFraction < threshold && input.heatStorageWm2 <= 0;
  let recoveryC = 0;
  if (restingBelowThreshold) {
    const baselineC = physParam(config, "core_temp_baseline_c");
    const towardBaseline = Math.max(0, startC - baselineC);
    recoveryC = -Math.min(
      towardBaseline,
      physParam(config, "core_temp_recovery_c_per_hour") * (elapsedMin / 60),
    );
  }

  let unclamped = startC + heatStorageC + cardiacC + recoveryC;

  // Cooling below the resting baseline is NOT modelled. This estimator has no
  // hypothermia pathway, and a large negative heat storage term must not invent
  // one — without this floor, a strongly negative storage value walks the
  // estimate down to the configured minimum, which would read as a cold
  // firefighter rather than a cooling one.
  const baselineFloorC = physParam(config, "core_temp_baseline_c");
  let flooredAtBaseline = false;
  if (unclamped < baselineFloorC && startC >= baselineFloorC) {
    unclamped = baselineFloorC;
    flooredAtBaseline = true;
  }
  if (flooredAtBaseline) {
    caveats.push(
      "Cooling was limited at the resting baseline; this model has no hypothermia pathway and will not estimate below it.",
    );
  }

  const coreTempC = clamp(
    unclamped,
    physParam(config, "core_temp_min_c"),
    physParam(config, "core_temp_max_c"),
  );
  const clamped = coreTempC !== unclamped;
  if (clamped) {
    caveats.push(
      "The estimate reached a configured physiological bound and was clamped.",
    );
  }

  const provenance: ModelProvenance = {
    modelKey: MODEL_KEY,
    modelLabel: MODEL_LABEL,
    estimated: true,
    caveats,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };

  const round2 = (v: number): number => Math.round(v * 100) / 100;

  return {
    coreTempC: round2(coreTempC),
    deltaC: round2(coreTempC - startC),
    contributions: {
      heatStorageC: round2(heatStorageC),
      cardiacC: round2(cardiacC),
      recoveryC: round2(recoveryC),
    },
    clamped,
    provenance,
  };
}
