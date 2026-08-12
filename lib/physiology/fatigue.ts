/**
 * Fatigue accumulation.
 *
 * A deterministic accumulator: exertion above a named threshold adds points,
 * time below it removes them, heat strain multiplies accumulation, and fitness
 * scales the rate. Previous-shift hours are carried in as a starting offset.
 *
 * Recovery is deliberately much slower than accumulation. Twenty minutes in
 * rehab does not undo an hour on the nozzle.
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import type { FatigueState, Fitness, ModelProvenance, Subject } from "./types";

const MODEL_KEY = "fatigue_accumulator_v1";
const MODEL_LABEL = "Fatigue accumulation (illustrative)";

const FITNESS_MULTIPLIER_PARAM = {
  low: "fatigue_fitness_multiplier_low",
  moderate: "fatigue_fitness_multiplier_moderate",
  high: "fatigue_fitness_multiplier_high",
} as const satisfies Record<Fitness, string>;

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

/** Points carried into an incident from the previous shift. */
export function prevShiftCarryOverPct(
  subject: Subject,
  config: PhysiologyConfig,
): number {
  return (
    Math.max(0, subject.prevShiftHours) *
    physParam(config, "fatigue_prev_shift_pct_per_hour")
  );
}

export type FatigueInput = {
  subject: Subject;
  /** Previous fatigue index, %. Null starts from the prev-shift carry-over. */
  previousFatiguePct: number | null;
  /** Heart rate reserve fraction, or null when heart rate is unavailable. */
  hrrFraction: number | null;
  /** Current estimated core temperature, °C. */
  coreTempC: number;
  /** Personalised core temperature limit, °C, from the heat strain model. */
  coreTempLimitC: number;
  /** Step length in minutes. */
  elapsedMin: number;
};

export function accumulateFatigue(
  input: FatigueInput,
  config: PhysiologyConfig,
): FatigueState {
  const caveats: string[] = [
    "Accumulation and recovery rates are invented and unreviewed.",
    "Recovery time since the previous shift is not modelled, so carry-over never decays.",
  ];

  const { subject, hrrFraction } = input;
  const elapsedMin = Math.max(0, input.elapsedMin);
  const carryOverPct = prevShiftCarryOverPct(subject, config);
  const minPct = physParam(config, "fatigue_min_pct");
  const maxPct = physParam(config, "fatigue_max_pct");

  const start =
    input.previousFatiguePct === null
      ? clamp(carryOverPct, minPct, maxPct)
      : clamp(input.previousFatiguePct, minPct, maxPct);
  if (input.previousFatiguePct === null && carryOverPct > 0) {
    caveats.push(
      `Started at ${carryOverPct.toFixed(0)} points carried from a ${subject.prevShiftHours} h previous shift.`,
    );
  }

  const threshold = physParam(config, "fatigue_hrr_threshold_frac");
  const fitnessMultiplier = physParam(
    config,
    FITNESS_MULTIPLIER_PARAM[subject.fitness],
  );

  // Heat multiplies fatigue as the estimate approaches its personalised limit.
  const baselineC = physParam(config, "core_temp_baseline_c");
  const span = Math.max(1e-9, input.coreTempLimitC - baselineC);
  const heatProgress = clamp((input.coreTempC - baselineC) / span, 0, 1);
  const heatMultiplier =
    1 +
    (physParam(config, "fatigue_heat_multiplier_at_core_limit") - 1) * heatProgress;

  let accumulatedPct = 0;
  let recoveredPct = 0;

  if (hrrFraction === null) {
    // Absence of heart rate must not read as rest. Accumulate at the maximum.
    accumulatedPct =
      physParam(config, "fatigue_accum_pct_per_hour_at_max_hrr") *
      fitnessMultiplier *
      heatMultiplier *
      (elapsedMin / 60);
    caveats.push(
      "Heart rate unavailable — fatigue accumulated at the maximum rate rather than assuming rest.",
    );
  } else if (hrrFraction > threshold) {
    const excess = (hrrFraction - threshold) / Math.max(1e-9, 1 - threshold);
    accumulatedPct =
      physParam(config, "fatigue_accum_pct_per_hour_at_max_hrr") *
      clamp(excess, 0, 1) *
      fitnessMultiplier *
      heatMultiplier *
      (elapsedMin / 60);
  } else {
    recoveredPct =
      physParam(config, "fatigue_recovery_pct_per_hour") * (elapsedMin / 60);
  }

  const fatiguePct = clamp(start + accumulatedPct - recoveredPct, minPct, maxPct);

  const provenance: ModelProvenance = {
    modelKey: MODEL_KEY,
    modelLabel: MODEL_LABEL,
    estimated: true,
    caveats,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };

  const round1 = (v: number): number => Math.round(v * 10) / 10;

  return {
    fatiguePct: round1(fatiguePct),
    accumulatedPct: round1(accumulatedPct),
    recoveredPct: round1(Math.min(recoveredPct, Math.max(0, start - minPct))),
    carryOverPct: round1(carryOverPct),
    provenance,
  };
}
