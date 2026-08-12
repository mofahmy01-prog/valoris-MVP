/**
 * Physiology model configuration. Every number the Tier C models use lives here
 * by name, bounded and provenance-tagged, exactly like the risk config.
 */

import {
  loadNamedParameters,
  type ConfigParameter,
  type LoadedParameters,
} from "../params/parameters";

export const PHYSIOLOGY_PARAM_NAMES = [
  // --- Integration stepping ------------------------------------------------
  "max_step_minutes",

  // --- Population defaults (used when a subject value is absent) ----------
  "body_mass_kg_default",
  "body_surface_area_m2_default",
  "specific_heat_body_wh_per_kg_c",

  // --- Karvonen with PPE penalty ------------------------------------------
  "hr_max_age_constant_bpm",
  "ppe_clo",
  "ppe_reserve_penalty_frac_per_clo",
  "heat_reserve_penalty_frac_per_c",
  "heat_reserve_penalty_reference_c",
  "max_reserve_penalty_frac",
  "min_hr_reserve_bpm",

  // --- Metabolic rate inference -------------------------------------------
  "metabolic_rate_rest_w_m2",
  "metabolic_rate_max_w_m2",
  "work_efficiency_fraction",

  // --- Reduced ISO 7933 PHS heat balance ----------------------------------
  "skin_temp_c",
  "skin_vapour_pressure_kpa",
  "convective_coeff_w_m2k",
  "radiative_coeff_w_m2k",
  "air_velocity_ms_default",
  "air_velocity_exponent",
  "clothing_insulation_clo_ppe",
  "clothing_insulation_clo_no_ppe",
  "evaporative_resistance_m2kpa_w_ppe",
  "evaporative_resistance_m2kpa_w_no_ppe",
  "respiratory_evaporative_coeff",
  "respiratory_convective_coeff",
  "max_sweat_rate_g_per_hour_unacclimatised",
  "max_sweat_rate_g_per_hour_acclimatised",
  "max_water_loss_g_unacclimatised",
  "max_water_loss_g_acclimatised",
  "evaporative_efficiency_at_full_wettedness",
  "phs_core_temp_limit_c",
  "heat_tolerance_core_limit_shift_c",
  "dlim_horizon_min",

  // --- Core temperature bounds --------------------------------------------
  "core_temp_baseline_c",
  "core_temp_min_c",
  "core_temp_max_c",

  // --- Core temperature: sequential Kalman filter from heart rate ---------
  "kalman_initial_core_temp_c",
  "kalman_initial_variance_c2",
  "kalman_variance_growth_c2_per_min",
  "kalman_observation_variance_bpm2",
  "kalman_hr_intercept_b0",
  "kalman_hr_linear_b1",
  "kalman_hr_quadratic_b2",
  "core_temp_estimate_sd_confidence_drop_c",
  "core_temp_upper_bound_sd_multiple",

  // --- Fatigue accumulation -----------------------------------------------
  "fatigue_accum_pct_per_hour_at_max_hrr",
  "fatigue_hrr_threshold_frac",
  "fatigue_heat_multiplier_at_core_limit",
  "fatigue_recovery_pct_per_hour",
  "fatigue_prev_shift_pct_per_hour",
  "fatigue_fitness_multiplier_low",
  "fatigue_fitness_multiplier_moderate",
  "fatigue_fitness_multiplier_high",
  "fatigue_min_pct",
  "fatigue_max_pct",

  // --- Toxic exposure accumulation ----------------------------------------
  "cohb_baseline_pct",
  "cohb_pct_per_ppm_hour_at_rest",
  "cohb_ventilation_multiplier_max",
  "cohb_elimination_half_life_min",
  "cohb_index_limit_pct",
  "cohb_max_pct",
  "pm25_dose_index_limit_ug_min_m3",
  "scba_inhaled_fraction_on_air",
  "scba_inhaled_fraction_off_air",
] as const;

export type PhysiologyParamName = (typeof PHYSIOLOGY_PARAM_NAMES)[number];

export type PhysiologyConfig = LoadedParameters<PhysiologyParamName>;

export function physParam(
  config: PhysiologyConfig,
  name: PhysiologyParamName,
): number {
  const p = config.parameters[name];
  if (p === undefined) {
    throw new Error(`Physiology config is missing required parameter "${name}"`);
  }
  return p.value;
}

export function loadPhysiologyConfig(
  raw: unknown,
  shared?: Record<string, ConfigParameter>,
): PhysiologyConfig {
  return loadNamedParameters(
    "physiology config",
    raw,
    PHYSIOLOGY_PARAM_NAMES,
    shared,
  );
}

/** Every parameter, in declaration order — for the model assumptions panel. */
export function listPhysiologyParameters(
  config: PhysiologyConfig,
): ConfigParameter[] {
  return PHYSIOLOGY_PARAM_NAMES.map((n) => config.parameters[n]);
}
