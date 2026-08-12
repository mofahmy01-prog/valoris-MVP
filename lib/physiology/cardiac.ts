/**
 * Karvonen heart rate reserve, with a PPE and heat penalty.
 *
 * Plain %HRmax ignores that a 50-year-old with a resting rate of 70 has far
 * less usable range than a 28-year-old with a resting rate of 50. Karvonen uses
 * the reserve between rest and maximum, which is the personalising step.
 *
 * The PPE penalty models the cardiovascular cost of working in encapsulating
 * turnout gear: some of the reserve is spent on thermoregulation before any
 * work is done. Its magnitude is invented and flagged for review.
 *
 * Pure. No imports beyond config and types.
 */

import { physParam, type PhysiologyConfig } from "./config";
import type { CardiacStrain, ModelProvenance, Subject, WorkContext } from "./types";

const MODEL_KEY = "karvonen_hrr_ppe_v1";
const MODEL_LABEL = "Karvonen heart rate reserve with PPE penalty (illustrative)";

/** Numerical guards, not clinical thresholds. */
const MIN_AGE_YEARS = 16;
const MAX_AGE_YEARS = 80;

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

export function ageAdjustedHrMaxBpm(
  ageYears: number,
  config: PhysiologyConfig,
): number {
  const age = clamp(ageYears, MIN_AGE_YEARS, MAX_AGE_YEARS);
  return physParam(config, "hr_max_age_constant_bpm") - age;
}

export function assessCardiacStrain(
  subject: Subject,
  hrBpm: number | null,
  context: WorkContext,
  config: PhysiologyConfig,
): CardiacStrain {
  const caveats: string[] = [
    "Maximum heart rate is estimated from age, not measured; individual spread is roughly plus or minus 10 to 12 bpm.",
  ];

  const hrMaxBpm = ageAdjustedHrMaxBpm(subject.ageYears, config);
  const restingHrBpm = clamp(subject.restingHrBpm, 30, hrMaxBpm - 1);
  const nominalReserveBpm = Math.max(
    physParam(config, "min_hr_reserve_bpm"),
    hrMaxBpm - restingHrBpm,
  );

  const ppePenaltyFraction = context.wearingPpe
    ? physParam(config, "ppe_clo") *
      physParam(config, "ppe_reserve_penalty_frac_per_clo")
    : 0;
  if (context.wearingPpe) {
    caveats.push(
      "A PPE reserve penalty is applied; its magnitude is invented and unreviewed.",
    );
  }

  const ambientTempC = context.ambientTempC;
  const heatPenaltyFraction =
    ambientTempC === null
      ? 0
      : Math.max(
          0,
          (ambientTempC - physParam(config, "heat_reserve_penalty_reference_c")) *
            physParam(config, "heat_reserve_penalty_frac_per_c"),
        );
  if (ambientTempC === null) {
    caveats.push(
      "Ambient temperature unavailable, so no heat penalty is applied — the reserve estimate is optimistic.",
    );
  }

  const reservePenaltyFraction = clamp(
    ppePenaltyFraction + heatPenaltyFraction,
    0,
    physParam(config, "max_reserve_penalty_frac"),
  );

  const effectiveHrReserveBpm = Math.max(
    physParam(config, "min_hr_reserve_bpm"),
    nominalReserveBpm * (1 - reservePenaltyFraction),
  );

  let hrrFraction: number | null = null;
  let nominalHrrFraction: number | null = null;
  if (hrBpm === null || !Number.isFinite(hrBpm)) {
    caveats.push("Heart rate unavailable — no reserve fraction can be reported.");
  } else {
    const workingBpm = Math.max(0, hrBpm - restingHrBpm);
    hrrFraction = workingBpm / effectiveHrReserveBpm;
    nominalHrrFraction = workingBpm / nominalReserveBpm;
  }

  const provenance: ModelProvenance = {
    modelKey: MODEL_KEY,
    modelLabel: MODEL_LABEL,
    estimated: true,
    caveats,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };

  return {
    hrMaxBpm,
    restingHrBpm,
    hrReserveBpm: nominalReserveBpm,
    effectiveHrReserveBpm,
    hrrFraction,
    nominalHrrFraction,
    reservePenaltyFraction,
    ppePenaltyFraction,
    heatPenaltyFraction,
    provenance,
  };
}

/**
 * Metabolic rate inferred from cardiac strain. Valoris has no work-rate sensor,
 * so this is the substitute — and it is the weakest link in the heat strain
 * chain, because anything that raises heart rate without raising work rate
 * (dehydration, stress, medication) inflates the inferred metabolic rate.
 */
export function inferMetabolicRateWm2(
  hrrFraction: number | null,
  config: PhysiologyConfig,
): { metabolicRateWm2: number; inferred: boolean; caveat: string } {
  const rest = physParam(config, "metabolic_rate_rest_w_m2");
  const max = physParam(config, "metabolic_rate_max_w_m2");

  if (hrrFraction === null) {
    // No heart rate. Assume the worst credible work rate rather than resting:
    // absence of data must not read as "this person is sitting down".
    return {
      metabolicRateWm2: max,
      inferred: false,
      caveat:
        "Heart rate unavailable, so metabolic rate is assumed at the configured maximum. Missing data is not treated as rest.",
    };
  }

  return {
    metabolicRateWm2: rest + clamp(hrrFraction, 0, 1) * (max - rest),
    inferred: true,
    caveat:
      "Metabolic rate is inferred from heart rate reserve, not measured. Anything that raises heart rate without raising workload inflates it.",
  };
}
