/**
 * Valoris risk engine — configuration.
 *
 * Every number the engine uses lives here by name. There are no magic numbers
 * in the engine itself. Each parameter carries provenance (`sourceStatus`) and
 * governance state (`clinicalReviewStatus`).
 *
 * No imports other than types. See lib/risk/types.ts for why.
 */

import type {
  ClinicalReviewStatus,
  RiskParameter,
  SourceStatus,
} from "./types";

/**
 * The complete set of named parameters. The engine may only read names from
 * this list, and a config is rejected unless it defines every one of them.
 */
export const PARAM_NAMES = [
  // --- Data freshness -----------------------------------------------------
  "stale_after_sec",
  "missing_after_sec",

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
  "scba_inhalation_protection_factor",

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

const SOURCE_STATUSES: readonly SourceStatus[] = [
  "illustrative",
  "literature_derived",
  "expert_proposed",
  "validated",
];

const REVIEW_STATUSES: readonly ClinicalReviewStatus[] = [
  "unreviewed",
  "under_review",
  "approved_for_simulation",
  "approved_for_pilot",
  "rejected",
];

/** Read a named parameter value. Throws if the name is not configured. */
export function param(config: RiskConfig, name: ParamName): number {
  const p = config.parameters[name];
  if (p === undefined) {
    throw new Error(`Risk config is missing required parameter "${name}"`);
  }
  return p.value;
}

/* ------------------------------------------------------------------------ */
/* Canonical serialisation + hash                                            */
/* ------------------------------------------------------------------------ */

/** Deterministic JSON with object keys sorted, so the hash is stable. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const body = keys
    .map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`)
    .join(",");
  return `{${body}}`;
}

/** FNV-1a, 32-bit, expressed with explicit 32-bit arithmetic. */
function fnv1a32(input: string, offsetBasis: number): number {
  let hash = offsetBasis >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash ^ input.charCodeAt(i)) >>> 0;
    // hash * 16777619 without overflowing the float mantissa
    hash =
      (((hash << 24) >>> 0) +
        ((hash << 8) >>> 0) +
        ((hash << 7) >>> 0) +
        ((hash << 4) >>> 0) +
        ((hash << 1) >>> 0) +
        hash) >>>
      0;
  }
  return hash >>> 0;
}

function hex8(n: number): string {
  return (n >>> 0).toString(16).padStart(8, "0");
}

/**
 * Hash of the values that actually change engine behaviour: the model version
 * and every parameter's numeric value. Two configs with the same hash produce
 * the same outputs.
 */
export function computeConfigHash(
  modelVersion: string,
  parameters: Record<string, RiskParameter>,
): string {
  const values: Record<string, number> = {};
  for (const key of Object.keys(parameters)) {
    const p = parameters[key];
    if (p !== undefined) values[key] = p.value;
  }
  const payload = canonicalJson({ modelVersion, values });
  return `${hex8(fnv1a32(payload, 0x811c9dc5))}${hex8(fnv1a32(payload, 0x01000193))}`;
}

/* ------------------------------------------------------------------------ */
/* Validation                                                                */
/* ------------------------------------------------------------------------ */

function fail(message: string): never {
  throw new Error(`Invalid risk config: ${message}`);
}

function readParameter(name: string, raw: unknown): RiskParameter {
  if (raw === null || typeof raw !== "object") {
    fail(`parameter "${name}" must be an object`);
  }
  const r = raw as Record<string, unknown>;

  if (typeof r["value"] !== "number" || !Number.isFinite(r["value"])) {
    fail(`parameter "${name}" needs a finite numeric "value"`);
  }
  if (typeof r["unit"] !== "string") fail(`parameter "${name}" needs a "unit"`);
  if (typeof r["rationale"] !== "string") {
    fail(`parameter "${name}" needs a "rationale"`);
  }
  if (typeof r["min"] !== "number" || typeof r["max"] !== "number") {
    fail(`parameter "${name}" needs numeric "min" and "max"`);
  }
  if (typeof r["editable"] !== "boolean") {
    fail(`parameter "${name}" needs a boolean "editable"`);
  }
  const source = r["sourceStatus"];
  if (!SOURCE_STATUSES.includes(source as SourceStatus)) {
    fail(`parameter "${name}" has an unknown sourceStatus "${String(source)}"`);
  }
  const review = r["clinicalReviewStatus"];
  if (!REVIEW_STATUSES.includes(review as ClinicalReviewStatus)) {
    fail(
      `parameter "${name}" has an unknown clinicalReviewStatus "${String(review)}"`,
    );
  }
  const value = r["value"] as number;
  const min = r["min"] as number;
  const max = r["max"] as number;
  if (value < min || value > max) {
    fail(`parameter "${name}" value ${value} is outside [${min}, ${max}]`);
  }

  return {
    name,
    value,
    unit: r["unit"] as string,
    sourceStatus: source as SourceStatus,
    clinicalReviewStatus: review as ClinicalReviewStatus,
    rationale: r["rationale"] as string,
    min,
    max,
    editable: r["editable"] as boolean,
  };
}

/**
 * Parse and validate a raw config object (e.g. `config/risk-default.json`).
 * Rejects unknown or missing parameter names so a typo can never silently fall
 * back to a hidden default.
 */
export function loadRiskConfig(raw: unknown): RiskConfig {
  if (raw === null || typeof raw !== "object") fail("root must be an object");
  const r = raw as Record<string, unknown>;

  const modelVersion = r["modelVersion"];
  if (typeof modelVersion !== "string" || modelVersion.trim() === "") {
    fail(`"modelVersion" must be a non-empty string`);
  }

  const rawParams = r["parameters"];
  if (rawParams === null || typeof rawParams !== "object") {
    fail(`"parameters" must be an object`);
  }
  const paramsRecord = rawParams as Record<string, unknown>;

  const known = new Set<string>(PARAM_NAMES);
  for (const key of Object.keys(paramsRecord)) {
    if (!known.has(key)) fail(`unknown parameter "${key}"`);
  }

  const parameters = {} as Record<ParamName, RiskParameter>;
  for (const name of PARAM_NAMES) {
    const entry = paramsRecord[name];
    if (entry === undefined) fail(`missing parameter "${name}"`);
    parameters[name] = readParameter(name, entry);
  }

  return {
    modelVersion,
    configHash: computeConfigHash(modelVersion, parameters),
    parameters,
  };
}

/** Every parameter, in declaration order — for the model assumptions panel. */
export function listParameters(config: RiskConfig): RiskParameter[] {
  return PARAM_NAMES.map((n) => config.parameters[n]);
}
