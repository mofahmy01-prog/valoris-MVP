import {
  loadNamedParameters,
  type ConfigParameter,
  type LoadedParameters,
} from "../../params/parameters";

export const DIABETES_PARAM_NAMES = [
  "interstitial_lag_min_sec",
  "interstitial_lag_max_sec",
  "lag_correction_caution_mmol_l",
  "lag_correction_danger_mmol_l",
  "glucose_caution_mmol_l",
  "glucose_danger_mmol_l",
  "glucose_hypo_override_mmol_l",
  "glucose_hyper_high_mmol_l",
  "glucose_hyper_low_mmol_l",
  "glucose_ideal_low_mmol_l",
  "max_usable_total_latency_sec",
  "glucose_stale_after_sec",
  "glucose_missing_after_sec",
  "exercise_consumption_multiplier_min",
  "exercise_consumption_multiplier_max",
  "resting_consumption_mmol_l_per_hour",
  "ppe_thermal_consumption_multiplier",
  "heat_consumption_multiplier_per_c_above_30",
] as const;

export type DiabetesParamName = (typeof DIABETES_PARAM_NAMES)[number];
export type DiabetesConfig = LoadedParameters<DiabetesParamName>;

export function dbParam(config: DiabetesConfig, name: DiabetesParamName): number {
  const p = config.parameters[name];
  if (p === undefined) {
    throw new Error(`Diabetes config is missing required parameter "${name}"`);
  }
  return p.value;
}

export function loadDiabetesConfig(raw: unknown): DiabetesConfig {
  return loadNamedParameters("diabetes config", raw, DIABETES_PARAM_NAMES);
}

export function listDiabetesParameters(config: DiabetesConfig): ConfigParameter[] {
  return DIABETES_PARAM_NAMES.map((n) => config.parameters[n]);
}
