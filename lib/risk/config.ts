/**
 * Valoris risk engine — configuration.
 *
 * Every number the engine uses lives here by name. There are no magic numbers
 * in the engine itself. Each parameter carries provenance (`sourceStatus`) and
 * governance state (`clinicalReviewStatus`).
 *
 * No imports other than types. See lib/risk/types.ts for why.
 */

import {
  canonicalJson as canonicalJsonShared,
  computeParametersHash,
  loadNamedParameters,
} from "../params/parameters";
import type { RiskParameter } from "./types";

/** Re-exported so existing callers and the model assumptions panel keep working. */
export const canonicalJson = canonicalJsonShared;
export const computeConfigHash = computeParametersHash;

/**
 * The complete set of named parameters. The engine may only read names from
 * this list, and a config is rejected unless it defines every one of them.
 */
export const PARAM_NAMES = [
  // --- Data freshness -----------------------------------------------------
  "stale_after_sec",
  "missing_after_sec",
  "estimated_core_temp_sd_confidence_drop_c",

  // --- Band cut-offs ------------------------------------------------------
  "band_safe_max_score",
  "band_caution_max_score",
  "band_high_max_score",

  // --- Composite weights --------------------------------------------------
  "weight_physiological",
  "weight_environmental",
  "weight_proximity",
  "weight_profile",

  // --- Hard overrides -----------------------------------------------------
  "override_spo2_critical_pct",
  "override_spo2_confirm_readings",
  "override_core_temp_critical_c",
  "override_hr_fraction_of_max",
  "override_scba_pressure_pct",
  "override_escape_blocked_fire_distance_m",

  // --- Physiological ------------------------------------------------------
  "phys_weight_hr",
  "phys_weight_spo2",
  "phys_weight_core_temp",
  "phys_weight_fatigue",
  "phys_weight_time_on_task",
  "hr_max_age_constant_bpm",
  "hr_fraction_low",
  "hr_fraction_high",
  "spo2_deviation_low_pct",
  "spo2_deviation_high_pct",
  "spo2_deviation_min_span_pct",
  "core_temp_low_c",
  "core_temp_high_c",
  "fatigue_low_pct",
  "fatigue_high_pct",
  "time_on_task_low_min",
  "time_on_task_high_min",

  // --- Environmental ------------------------------------------------------
  "env_weight_co",
  "env_weight_pm25",
  "env_weight_heat",
  "co_low_ppm",
  "co_high_ppm",
  "pm25_low_ugm3",
  "pm25_high_ugm3",
  "ambient_temp_low_c",
  "ambient_temp_high_c",
  "humidity_reference_pct",
  "humidity_heat_penalty_c_per_10pct",
  // Owned by config/shared-default.json — the same physical quantity the
  // physiology toxic model uses. Must not be redefined in risk-default.json.
  "scba_inhaled_fraction_on_air",

  // --- Proximity ----------------------------------------------------------
  "prox_weight_fire_distance",
  "prox_weight_escape_route",
  "prox_weight_scba",
  "fire_front_high_distance_m",
  "fire_front_low_distance_m",
  "escape_route_degraded_score",
  "escape_route_blocked_score",
  "scba_pressure_low_score_pct",
  "scba_pressure_high_score_pct",

  // --- Profile vulnerability ---------------------------------------------
  "prof_weight_respiratory",
  "prof_weight_heat_tolerance",
  "prof_weight_fitness",
  "prof_weight_prev_shift",
  "prof_weight_conditions",
  "prof_weight_cumulative_exposure",
  "resp_risk_score_none",
  "resp_risk_score_mild",
  "resp_risk_score_moderate",
  "resp_risk_score_high",
  "heat_tolerance_score_low",
  "heat_tolerance_score_avg",
  "heat_tolerance_score_high",
  "fitness_score_low",
  "fitness_score_moderate",
  "fitness_score_high",
  "prev_shift_low_h",
  "prev_shift_high_h",
  "condition_score_per_condition",

  // --- Personalisation ----------------------------------------------------
  "resp_risk_spo2_alert_shift_pct_per_level",
  "heat_tolerance_core_temp_shift_c",
  "heat_tolerance_ambient_shift_c",
  "prev_shift_fatigue_pct_per_hour",
  "cumulative_co_tightening_frac",
  "cumulative_heat_tightening_max_c",
] as const;

export type ParamName = (typeof PARAM_NAMES)[number];

export type RiskConfig = {
  modelVersion: string;
  configHash: string;
  parameters: Record<ParamName, RiskParameter>;
};

/** Read a named parameter value. Throws if the name is not configured. */
export function param(config: RiskConfig, name: ParamName): number {
  const p = config.parameters[name];
  if (p === undefined) {
    throw new Error(`Risk config is missing required parameter "${name}"`);
  }
  return p.value;
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

/**
 * Parse and validate a raw config object (e.g. `config/risk-default.json`).
 *
 * Delegates to the shared parameter loader in `lib/params/`, so the citation
 * rule, the bounds check and the no-shadowing rule are defined once for every
 * model config rather than restated per module.
 *
 * `shared` supplies parameters owned by `config/shared-default.json` — physical
 * quantities used by more than one model. A name present in both the shared and
 * the local config is rejected.
 */
export function loadRiskConfig(
  raw: unknown,
  shared?: Record<string, RiskParameter>,
): RiskConfig {
  return loadNamedParameters("risk config", raw, PARAM_NAMES, shared);
}

/** Every parameter, in declaration order — for the model assumptions panel. */
export function listParameters(config: RiskConfig): RiskParameter[] {
  return PARAM_NAMES.map((n) => config.parameters[n]);
}
