/**
 * Toxic exposure accumulation, with SCBA gating.
 *
 * Two accumulators:
 *
 *   CO   — a first-order carboxyhaemoglobin estimate. Uptake scales with
 *          inhaled concentration, elapsed time and minute ventilation (inferred
 *          from heart rate reserve), and decays with a configured elimination
 *          half-life while breathing clean air. This is NOT the
 *          Coburn-Forster-Kane equation; CFK is a differential model requiring
 *          haemoglobin, blood volume, endogenous CO production and alveolar
 *          ventilation, none of which Valoris has.
 *
 *   PM2.5 — a cumulative inhaled dose in µg·min/m³, with no elimination term.
 *          Particulate clearance is slow and is not modelled at all.
 *
 * SCBA gating is the whole point of "gating": while on air the inhaled fraction
 * drops to a configured value, and **that value is never zero**. Valoris cannot
 * verify mask seal, cylinder contents or compliance, so it never credits
 * perfect protection.
 *
 * Both accumulators keep rising while a sensor is missing — an absent CO reading
 * is treated as the worst credible concentration seen, not as clean air.
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import type {
  ModelProvenance,
  ToxicExposureState,
  WorkContext,
} from "./types";

const MODEL_KEY = "toxic_accumulator_v1";
const MODEL_LABEL =
  "Toxic exposure accumulation with SCBA gating (illustrative — not Coburn-Forster-Kane)";

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

export type ToxicExposureInput = {
  context: WorkContext;
  /** Previous COHb estimate, %. Null starts from the configured baseline. */
  previousCohbPct: number | null;
  /** Previous cumulative PM2.5 dose, µg·min/m³. Null starts at zero. */
  previousPm25DoseUgMinM3: number | null;
  /** Heart rate reserve fraction, drives the ventilation multiplier. */
  hrrFraction: number | null;
  /** Step length in minutes. */
  elapsedMin: number;
  /**
   * Worst CO concentration seen so far this incident, ppm. Used when the CO
   * sensor is unavailable, so a dropout cannot read as clean air. Null falls
   * back to the configured index limit expressed as a concentration.
   */
  worstKnownCoPpm?: number | null;
  /** Same idea for PM2.5. */
  worstKnownPm25UgM3?: number | null;
};

/** Inhaled fraction after SCBA gating. Never zero while on air. */
export function inhaledFraction(
  context: WorkContext,
  config: PhysiologyConfig,
): number {
  return context.scbaOnAir
    ? clamp(physParam(config, "scba_inhaled_fraction_on_air"), 0, 1)
    : clamp(physParam(config, "scba_inhaled_fraction_off_air"), 0, 1);
}

/** Ventilation multiplier on uptake, from cardiac strain. */
export function ventilationMultiplier(
  hrrFraction: number | null,
  config: PhysiologyConfig,
): number {
  const max = physParam(config, "cohb_ventilation_multiplier_max");
  // No heart rate: assume maximum ventilation. Absence is not rest.
  if (hrrFraction === null) return max;
  return 1 + clamp(hrrFraction, 0, 1) * (max - 1);
}

export function accumulateToxicExposure(
  input: ToxicExposureInput,
  config: PhysiologyConfig,
): ToxicExposureState {
  const caveats: string[] = [
    "Not the Coburn-Forster-Kane equation. A first-order approximation with invented coefficients.",
    "SCBA protection is never credited as complete: mask seal, cylinder contents and compliance cannot be verified by this system.",
  ];

  const elapsedMin = Math.max(0, input.elapsedMin);
  const fraction = inhaledFraction(input.context, config);
  const ventilation = ventilationMultiplier(input.hrrFraction, config);
  if (input.hrrFraction === null) {
    caveats.push(
      "Heart rate unavailable — minute ventilation assumed at maximum, so uptake is deliberately pessimistic.",
    );
  }

  /* --- CO / carboxyhaemoglobin ------------------------------------------- */
  const baselineCohb = physParam(config, "cohb_baseline_pct");
  const startCohb = clamp(
    input.previousCohbPct ?? baselineCohb,
    0,
    physParam(config, "cohb_max_pct"),
  );

  let coPpm = input.context.coPpm;
  if (coPpm === null) {
    // A dropped CO sensor does not mean clean air.
    coPpm =
      input.worstKnownCoPpm ??
      physParam(config, "cohb_index_limit_pct") /
        Math.max(1e-9, physParam(config, "cohb_pct_per_ppm_hour_at_rest"));
    caveats.push(
      "CO reading unavailable — the worst concentration seen so far is substituted. Absence is not treated as clean air.",
    );
  }

  const uptakePct =
    physParam(config, "cohb_pct_per_ppm_hour_at_rest") *
    Math.max(0, coPpm) *
    fraction *
    ventilation *
    (elapsedMin / 60);

  // Elimination applies to the amount above baseline, breathing clean air only.
  const halfLifeMin = Math.max(1, physParam(config, "cohb_elimination_half_life_min"));
  const decayFactor = Math.pow(0.5, elapsedMin / halfLifeMin);
  const aboveBaseline = Math.max(0, startCohb - baselineCohb);
  const afterDecay = baselineCohb + aboveBaseline * decayFactor;

  const cohbPct = clamp(
    afterDecay + uptakePct,
    0,
    physParam(config, "cohb_max_pct"),
  );
  const coIndex = cohbPct / Math.max(1e-9, physParam(config, "cohb_index_limit_pct"));

  /* --- PM2.5 dose -------------------------------------------------------- */
  let pm25 = input.context.pm25UgM3;
  if (pm25 === null) {
    pm25 =
      input.worstKnownPm25UgM3 ??
      physParam(config, "pm25_dose_index_limit_ug_min_m3") / 60;
    caveats.push(
      "PM2.5 reading unavailable — the worst concentration seen so far is substituted.",
    );
  }

  const pm25DoseUgMinM3 =
    Math.max(0, input.previousPm25DoseUgMinM3 ?? 0) +
    Math.max(0, pm25) * fraction * ventilation * elapsedMin;
  const pm25Index =
    pm25DoseUgMinM3 /
    Math.max(1e-9, physParam(config, "pm25_dose_index_limit_ug_min_m3"));

  if (input.previousPm25DoseUgMinM3 !== null) {
    caveats.push("PM2.5 dose has no elimination term; particulate clearance is not modelled.");
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
  const round3 = (v: number): number => Math.round(v * 1000) / 1000;

  return {
    cohbPct: round2(cohbPct),
    coIndex: round3(coIndex),
    pm25DoseUgMinM3: Math.round(pm25DoseUgMinM3),
    pm25Index: round3(pm25Index),
    combinedIndex: round3(Math.max(coIndex, pm25Index)),
    inhaledFraction: fraction,
    scbaOnAir: input.context.scbaOnAir,
    provenance,
  };
}
