/**
 * PurpleAir correction configuration.
 *
 * Every coefficient is named, bounded and provenance-tagged, exactly like the
 * risk and physiology configs. The `literature_derived` entries carry a citation
 * and their rationale says UNVERIFIED — see docs/DATA_PROVENANCE.md blocking
 * item 2.
 */

import {
  loadNamedParameters,
  type ConfigParameter,
  type LoadedParameters,
} from "../params/parameters";

export const PURPLEAIR_PARAM_NAMES = [
  // --- EPA US-wide multi-linear correction (<= 300 ug/m3) -----------------
  "us_wide_slope",
  "us_wide_humidity_coeff",
  "us_wide_intercept",

  // --- Extreme smoke quadratic (>= 400 ug/m3) -----------------------------
  "extreme_quadratic_coeff",
  "extreme_linear_coeff",
  "extreme_humidity_coeff",
  "extreme_intercept",

  // --- Regime boundaries ---------------------------------------------------
  "transition_low_ug_m3",
  "transition_high_ug_m3",

  // --- Quality checks ------------------------------------------------------
  "channel_disagreement_degraded_ug_m3",
  "channel_disagreement_degraded_frac",
  "channel_disagreement_rejected_frac",
  "max_plausible_ug_m3",

  // --- Documented residual bias -------------------------------------------
  "known_smoke_slope",
] as const;

export type PurpleAirParamName = (typeof PURPLEAIR_PARAM_NAMES)[number];

export type PurpleAirConfig = LoadedParameters<PurpleAirParamName>;

export function paParam(
  config: PurpleAirConfig,
  name: PurpleAirParamName,
): number {
  const p = config.parameters[name];
  if (p === undefined) {
    throw new Error(`PurpleAir config is missing required parameter "${name}"`);
  }
  return p.value;
}

export function loadPurpleAirConfig(raw: unknown): PurpleAirConfig {
  return loadNamedParameters("purpleair config", raw, PURPLEAIR_PARAM_NAMES);
}

export function listPurpleAirParameters(
  config: PurpleAirConfig,
): ConfigParameter[] {
  return PURPLEAIR_PARAM_NAMES.map((n) => config.parameters[n]);
}
