/**
 * Tier C physiology models — domain types.
 *
 * No imports. `lib/physiology/` is pure, deterministic and framework-free for
 * the same reason `lib/risk/` is.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 *
 * IMPORTANT SCOPE NOTE. These are *reduced, illustrative* implementations of
 * published model families, not certified implementations of the standards they
 * are named after:
 *
 *  - `heat-strain.ts` implements the heat-balance core of ISO 7933 (Predicted
 *    Heat Strain). It is NOT a conformant ISO 7933 implementation: it omits the
 *    standard's iterative minute-by-minute integration, its clothing
 *    adjustment sub-models, acclimatisation branches and several correction
 *    terms. Do not present its output as an ISO 7933 result.
 *  - `cardiac.ts` implements Karvonen heart-rate reserve with a PPE penalty.
 *    The penalty magnitude is invented.
 *  - `core-temp.ts` produces an ESTIMATE. No core temperature is measured
 *    anywhere in Valoris.
 *  - `fatigue.ts` and `toxic-exposure.ts` are accumulator models with named
 *    rates. The rates are illustrative.
 *
 * Every threshold is `illustrative` / `unreviewed`. See
 * docs/CLINICAL_ASSUMPTIONS.md.
 */

export type Fitness = "low" | "moderate" | "high";
export type HeatTolerance = "low" | "avg" | "high";

/** The individual. Physiology needs body mass, which HealthProfile lacks. */
export type Subject = {
  id: string;
  callsign: string;
  ageYears: number;
  restingHrBpm: number;
  fitness: Fitness;
  heatTolerance: HeatTolerance;
  prevShiftHours: number;
  /** Falls back to the configured population default when absent. */
  bodyMassKg?: number | null;
  /** Falls back to the configured population default when absent. */
  bodySurfaceAreaM2?: number | null;
  /** Acclimatised to heat. Changes the sweat-rate and water-loss limits. */
  heatAcclimatised?: boolean;
};

/** Conditions the subject is working in. Nulls are handled per model. */
export type WorkContext = {
  ambientTempC: number | null;
  humidityPct: number | null;
  /** Defaults to ambient when absent — a conservative simplification. */
  meanRadiantTempC?: number | null;
  airVelocityMs?: number | null;
  coPpm: number | null;
  pm25UgM3: number | null;
  wearingPpe: boolean;
  scbaOnAir: boolean;
};

/** Provenance carried by every model output. */
export type ModelProvenance = {
  modelKey: string;
  modelLabel: string;
  /** True when the value is inferred rather than measured. Always true here. */
  estimated: boolean;
  /** Named limitations that apply to this specific result. */
  caveats: string[];
  modelVersion: string;
  configHash: string;
};

/* -------------------------------------------------------------------------- */
/* Cardiac — Karvonen with PPE penalty                                        */
/* -------------------------------------------------------------------------- */

export type CardiacStrain = {
  hrMaxBpm: number;
  restingHrBpm: number;
  /** Nominal reserve, HRmax − HRrest. */
  hrReserveBpm: number;
  /** Reserve after PPE and heat penalties are subtracted. */
  effectiveHrReserveBpm: number;
  /** Fraction of the *effective* reserve in use, 0..1+. */
  hrrFraction: number | null;
  /** Fraction of the nominal reserve in use, for comparison. */
  nominalHrrFraction: number | null;
  /** Total reserve lost to PPE and heat, as a fraction of nominal. */
  reservePenaltyFraction: number;
  ppePenaltyFraction: number;
  heatPenaltyFraction: number;
  provenance: ModelProvenance;
};

/* -------------------------------------------------------------------------- */
/* Heat strain — reduced ISO 7933 PHS                                          */
/* -------------------------------------------------------------------------- */

export type HeatStrainLimiter =
  | "water_loss"
  | "core_temperature"
  | "none_within_horizon"
  | "insufficient_data";

export type HeatStrain = {
  /** Metabolic rate used, W/m². Derived from cardiac strain, not measured. */
  metabolicRateWm2: number;
  /** Convective heat exchange, W/m². Negative means losing heat. */
  convectiveWm2: number;
  /** Radiative heat exchange, W/m². */
  radiativeWm2: number;
  /** Respiratory convective + evaporative loss, W/m². */
  respiratoryWm2: number;
  /** Evaporation required to hold heat balance, W/m². */
  requiredEvaporationWm2: number;
  /** Maximum evaporation the environment and clothing permit, W/m². */
  maxEvaporationWm2: number;
  /** Required skin wettedness, 0..1+ (above 1 means balance is impossible). */
  requiredWettedness: number;
  /** Sweat rate needed, g/h. */
  requiredSweatRateGPerHour: number;
  /** Sweat rate actually achievable, g/h, capped by physiology. */
  predictedSweatRateGPerHour: number;
  /** Net heat storage, W/m². Positive means core temperature will rise. */
  heatStorageWm2: number;
  /** Minutes until the water-loss limit, null when never reached. */
  dlimWaterLossMin: number | null;
  /** Minutes until the core temperature limit, null when never reached. */
  dlimCoreTempMin: number | null;
  /** The binding limit, in minutes. Null when neither binds. */
  dlimMin: number | null;
  limiter: HeatStrainLimiter;
  /** Personalised core temperature limit used, °C. */
  coreTempLimitC: number;
  provenance: ModelProvenance;
};

/* -------------------------------------------------------------------------- */
/* Core temperature estimation                                                 */
/* -------------------------------------------------------------------------- */

export type CoreTempEstimate = {
  coreTempC: number;
  deltaC: number;
  /** What drove the change, °C, for explainability. */
  contributions: {
    heatStorageC: number;
    cardiacC: number;
    recoveryC: number;
  };
  /** True when the estimate hit a configured physiological bound. */
  clamped: boolean;
  provenance: ModelProvenance;
};

/* -------------------------------------------------------------------------- */
/* Fatigue accumulation                                                        */
/* -------------------------------------------------------------------------- */

export type FatigueState = {
  fatiguePct: number;
  /** Points added this step by exertion. */
  accumulatedPct: number;
  /** Points removed this step by recovery. */
  recoveredPct: number;
  /** Points carried in from the previous shift, included in fatiguePct. */
  carryOverPct: number;
  provenance: ModelProvenance;
};

/* -------------------------------------------------------------------------- */
/* Toxic exposure accumulation                                                 */
/* -------------------------------------------------------------------------- */

export type ToxicExposureState = {
  /** Estimated carboxyhaemoglobin saturation, %. */
  cohbPct: number;
  /** COHb as a fraction of the configured limit, 0..1+. */
  coIndex: number;
  /** Cumulative inhaled PM2.5 dose, µg·min/m³. */
  pm25DoseUgMinM3: number;
  /** PM2.5 dose as a fraction of the configured limit, 0..1+. */
  pm25Index: number;
  /** Worst of the two indices — what the risk engine consumes. */
  combinedIndex: number;
  /** Effective inhaled fraction after SCBA gating, 0..1. */
  inhaledFraction: number;
  /** True when the subject was on air for this step. */
  scbaOnAir: boolean;
  provenance: ModelProvenance;
};
