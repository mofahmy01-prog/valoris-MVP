/**
 * Valoris risk engine — deterministic, rule-based, explainable.
 *
 * No machine learning. No randomness. No clock reads. Same inputs plus the
 * same config produce byte-identical output, always.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { degradeConfidence, maxBand } from "./bands";
import { param, type ParamName, type RiskConfig } from "./config";
import type {
  Confidence,
  DataQuality,
  Environment,
  HealthProfile,
  Position,
  RiskAssessment,
  RiskBand,
  Vitals,
} from "./types";

/* -------------------------------------------------------------------------- */
/* Numerical guards. These are not clinical thresholds — they exist only to    */
/* keep arithmetic well defined on out-of-domain inputs.                       */
/* -------------------------------------------------------------------------- */

const MIN_AGE_YEARS = 16;
const MAX_AGE_YEARS = 80;
const MIN_HUMIDITY_PCT = 0;
const MAX_HUMIDITY_PCT = 100;
const MAX_SUBSCORE = 100;
/** Smallest span a threshold range may collapse to, to avoid divide-by-zero. */
const MIN_RANGE_SPAN = 0.001;

/* -------------------------------------------------------------------------- */
/* Small pure helpers                                                          */
/* -------------------------------------------------------------------------- */

function clamp(value: number, lo: number, hi: number): number {
  if (!Number.isFinite(value)) return lo;
  return value < lo ? lo : value > hi ? hi : value;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** 0 at or below `low`, 100 at or above `high`, linear between. */
function ramp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return MAX_SUBSCORE;
  if (high <= low) return value >= high ? MAX_SUBSCORE : 0;
  return clamp(((value - low) / (high - low)) * MAX_SUBSCORE, 0, MAX_SUBSCORE);
}

/** 100 at or below `high`, 0 at or above `low` — for "closer is worse". */
function descendingRamp(value: number, high: number, low: number): number {
  if (!Number.isFinite(value)) return MAX_SUBSCORE;
  if (low <= high) return value <= high ? MAX_SUBSCORE : 0;
  return clamp(((low - value) / (low - high)) * MAX_SUBSCORE, 0, MAX_SUBSCORE);
}

type WeightedTerm = { weight: number; value: number };

/** Weight-normalised mean, so a subscore is always within 0..100. */
function weightedMean(terms: WeightedTerm[]): number {
  let weightSum = 0;
  let acc = 0;
  for (const t of terms) {
    const w = Math.max(0, t.weight);
    weightSum += w;
    acc += w * clamp(t.value, 0, MAX_SUBSCORE);
  }
  return weightSum === 0 ? 0 : acc / weightSum;
}

function fmt(value: number, dp: number): string {
  return value.toFixed(dp);
}

/** Keep an adjusted [low, high] pair ordered with a minimum span. */
function orderedRange(low: number, high: number, minSpan: number): [number, number] {
  const span = Math.max(minSpan, 0);
  return high >= low + span ? [low, high] : [low, low + span];
}

/* -------------------------------------------------------------------------- */
/* Data freshness                                                              */
/* -------------------------------------------------------------------------- */

const VITAL_CHANNELS = [
  "hrBpm",
  "spo2Pct",
  "coreTempC",
  "respRatePerMin",
  "fatiguePct",
  "hydrationPct",
] as const;

const ENV_CHANNELS = [
  "ambientTempC",
  "humidityPct",
  "coPpm",
  "pm25UgM3",
  "windSpeedMs",
  "windDirDeg",
] as const;

/**
 * Position and equipment channels. `positionFix` covers lat/lng, and
 * `escapeRouteStatus` is an assessment rather than a reading, but both go stale
 * exactly like a sensor value and both must be aged.
 */
const POSITION_CHANNELS = [
  "positionFix",
  "distanceToFireFrontM",
  "distanceToSafeZoneM",
  "escapeRouteStatus",
  "scbaPressurePct",
] as const;

/**
 * Channels derived from the position fix. If the fix itself can no longer be
 * trusted, neither can a distance measured from it, however recently that
 * distance was computed.
 */
const FIX_DERIVED_CHANNELS: readonly string[] = [
  "distanceToFireFrontM",
  "distanceToSafeZoneM",
];

/** Absence of any of these forces the band to UNKNOWN and confidence to low. */
const CRITICAL_CHANNELS: readonly string[] = ["hrBpm", "spo2Pct", "coreTempC"];

type ChannelState = "ok" | "stale" | "missing";

type Freshness = {
  state: Record<string, ChannelState>;
  stale: string[];
  missing: string[];
  oldestAgeSec: number;
};

function assessFreshness(
  vitals: Vitals,
  env: Environment,
  pos: Position,
  config: RiskConfig,
  nowMs: number,
): Freshness {
  const staleAfterSec = param(config, "stale_after_sec");
  const missingAfterSec = param(config, "missing_after_sec");

  const state: Record<string, ChannelState> = {};
  let oldestAgeSec = 0;

  const inspect = (
    key: string,
    hasValue: boolean,
    lastUpdatedMs: Record<string, number> | undefined,
  ): void => {
    const ts = lastUpdatedMs?.[key];
    if (typeof ts === "number" && Number.isFinite(ts)) {
      const ageSec = Math.max(0, (nowMs - ts) / 1000);
      if (ageSec > oldestAgeSec) oldestAgeSec = ageSec;
    }

    if (!hasValue) {
      state[key] = "missing";
      return;
    }
    if (typeof ts !== "number" || !Number.isFinite(ts)) {
      // A value with no reported age cannot be aged, so it cannot be trusted.
      state[key] = "missing";
      return;
    }
    const ageSec = Math.max(0, (nowMs - ts) / 1000);
    state[key] =
      ageSec > missingAfterSec ? "missing" : ageSec > staleAfterSec ? "stale" : "ok";
  };

  const present = (value: number | null): boolean =>
    value !== null && Number.isFinite(value);

  for (const key of VITAL_CHANNELS) {
    inspect(key, present(vitals[key]), vitals.lastUpdatedMs);
  }
  for (const key of ENV_CHANNELS) {
    inspect(key, present(env[key]), env.lastUpdatedMs);
  }

  // lat/lng and escapeRouteStatus are never null in the type, so their presence
  // is given; only their age decides the state.
  inspect("positionFix", Number.isFinite(pos.lat) && Number.isFinite(pos.lng), pos.lastUpdatedMs);
  inspect("distanceToFireFrontM", present(pos.distanceToFireFrontM), pos.lastUpdatedMs);
  inspect("distanceToSafeZoneM", present(pos.distanceToSafeZoneM), pos.lastUpdatedMs);
  inspect("escapeRouteStatus", true, pos.lastUpdatedMs);
  inspect("scbaPressurePct", present(pos.scbaPressurePct), pos.lastUpdatedMs);

  // A distance is only as trustworthy as the fix it was measured from.
  if (state["positionFix"] === "missing") {
    for (const key of FIX_DERIVED_CHANNELS) state[key] = "missing";
  } else if (state["positionFix"] === "stale") {
    for (const key of FIX_DERIVED_CHANNELS) {
      if (state[key] === "ok") state[key] = "stale";
    }
  }

  // Build the reported lists in declaration order so output is deterministic.
  const stale: string[] = [];
  const missing: string[] = [];
  for (const key of [...VITAL_CHANNELS, ...ENV_CHANNELS, ...POSITION_CHANNELS]) {
    if (state[key] === "stale") stale.push(key);
    else if (state[key] === "missing") missing.push(key);
  }

  return { state, stale, missing, oldestAgeSec };
}

/**
 * A channel's usable value: `null` whenever the reading is absent OR too old to
 * trust. Stale-but-present readings are still used; the confidence drop is how
 * staleness is communicated.
 */
function usable(
  key: string,
  value: number | null,
  freshness: Freshness,
): number | null {
  return freshness.state[key] === "missing" ? null : value;
}

/* -------------------------------------------------------------------------- */
/* Personalisation                                                             */
/* -------------------------------------------------------------------------- */

const RESP_RISK_LEVEL: Record<HealthProfile["respiratoryRisk"], number> = {
  none: 0,
  mild: 1,
  moderate: 2,
  high: 3,
};

/** low = -1 (limits tighten), avg = 0, high = +1 (limits relax). */
const HEAT_TOLERANCE_STEP: Record<HealthProfile["heatTolerance"], number> = {
  low: -1,
  avg: 0,
  high: 1,
};

const RESP_RISK_PARAM: Record<HealthProfile["respiratoryRisk"], ParamName> = {
  none: "resp_risk_score_none",
  mild: "resp_risk_score_mild",
  moderate: "resp_risk_score_moderate",
  high: "resp_risk_score_high",
};

const HEAT_TOLERANCE_PARAM: Record<HealthProfile["heatTolerance"], ParamName> = {
  low: "heat_tolerance_score_low",
  avg: "heat_tolerance_score_avg",
  high: "heat_tolerance_score_high",
};

const FITNESS_PARAM: Record<HealthProfile["fitness"], ParamName> = {
  low: "fitness_score_low",
  moderate: "fitness_score_moderate",
  high: "fitness_score_high",
};

/**
 * Thresholds after they have been calibrated to this individual. This is the
 * differentiator: two firefighters with identical readings are measured against
 * different numbers.
 */
type PersonalThresholds = {
  ageYears: number;
  hrMaxBpm: number;
  hrLowBpm: number;
  hrHighBpm: number;
  hrOverrideBpm: number;
  spo2DeviationLowPct: number;
  spo2DeviationHighPct: number;
  spo2OverridePct: number;
  coreTempLowC: number;
  coreTempHighC: number;
  coreTempOverrideC: number;
  fatigueCarryOverPct: number;
  coLowPpm: number;
  coHighPpm: number;
  pm25LowUgM3: number;
  pm25HighUgM3: number;
  ambientLowC: number;
  ambientHighC: number;
};

function personalise(
  profile: HealthProfile,
  config: RiskConfig,
): PersonalThresholds {
  const ageYears = clamp(profile.age, MIN_AGE_YEARS, MAX_AGE_YEARS);
  const hrMaxBpm = param(config, "hr_max_age_constant_bpm") - ageYears;

  const respLevel = RESP_RISK_LEVEL[profile.respiratoryRisk];
  const spo2Shift =
    respLevel * param(config, "resp_risk_spo2_alert_shift_pct_per_level");
  const minSpan = param(config, "spo2_deviation_min_span_pct");
  const devLow = Math.max(
    minSpan,
    param(config, "spo2_deviation_low_pct") - spo2Shift,
  );
  const [spo2DeviationLowPct, spo2DeviationHighPct] = orderedRange(
    devLow,
    param(config, "spo2_deviation_high_pct") - spo2Shift,
    minSpan,
  );

  const heatStep = HEAT_TOLERANCE_STEP[profile.heatTolerance];
  const coreShift = heatStep * param(config, "heat_tolerance_core_temp_shift_c");
  const [coreTempLowC, coreTempHighC] = orderedRange(
    param(config, "core_temp_low_c") + coreShift,
    param(config, "core_temp_high_c") + coreShift,
    MIN_RANGE_SPAN,
  );

  const coIndex = clamp(profile.cumulativeCoExposureIndex, 0, 1);
  const heatIndex = clamp(profile.cumulativeHeatExposureIndex, 0, 1);
  const coFactor = 1 - coIndex * param(config, "cumulative_co_tightening_frac");
  const heatTightenC = heatIndex * param(config, "cumulative_heat_tightening_max_c");
  const ambientShiftC =
    heatStep * param(config, "heat_tolerance_ambient_shift_c") - heatTightenC;

  const [coLowPpm, coHighPpm] = orderedRange(
    param(config, "co_low_ppm") * coFactor,
    param(config, "co_high_ppm") * coFactor,
    MIN_RANGE_SPAN,
  );
  const [pm25LowUgM3, pm25HighUgM3] = orderedRange(
    param(config, "pm25_low_ugm3") * coFactor,
    param(config, "pm25_high_ugm3") * coFactor,
    MIN_RANGE_SPAN,
  );
  const [ambientLowC, ambientHighC] = orderedRange(
    param(config, "ambient_temp_low_c") + ambientShiftC,
    param(config, "ambient_temp_high_c") + ambientShiftC,
    MIN_RANGE_SPAN,
  );

  return {
    ageYears,
    hrMaxBpm,
    hrLowBpm: hrMaxBpm * param(config, "hr_fraction_low"),
    hrHighBpm: hrMaxBpm * param(config, "hr_fraction_high"),
    hrOverrideBpm: hrMaxBpm * param(config, "override_hr_fraction_of_max"),
    spo2DeviationLowPct,
    spo2DeviationHighPct,
    spo2OverridePct: param(config, "override_spo2_critical_pct") + spo2Shift,
    coreTempLowC,
    coreTempHighC,
    coreTempOverrideC: param(config, "override_core_temp_critical_c") + coreShift,
    fatigueCarryOverPct:
      Math.max(0, profile.prevShiftHours) *
      param(config, "prev_shift_fatigue_pct_per_hour"),
    coLowPpm,
    coHighPpm,
    pm25LowUgM3,
    pm25HighUgM3,
    ambientLowC,
    ambientHighC,
  };
}

/* -------------------------------------------------------------------------- */
/* Subscores                                                                   */
/* -------------------------------------------------------------------------- */

type Driver = { key: string; label: string; weighted: number };

type SubscoreResult = { value: number; drivers: Driver[] };

function physiological(
  profile: HealthProfile,
  vitals: Vitals,
  pos: Position,
  freshness: Freshness,
  th: PersonalThresholds,
  config: RiskConfig,
): SubscoreResult {
  const hr = usable("hrBpm", vitals.hrBpm, freshness);
  const spo2 = usable("spo2Pct", vitals.spo2Pct, freshness);
  const coreTemp = usable("coreTempC", vitals.coreTempC, freshness);
  const fatigue = usable("fatiguePct", vitals.fatiguePct, freshness);

  const hrScore = hr === null ? MAX_SUBSCORE : ramp(hr, th.hrLowBpm, th.hrHighBpm);
  const hrLabel =
    hr === null
      ? "Heart rate unavailable — scored as worst case"
      : `Heart rate ${fmt(hr, 0)} bpm — ${fmt((hr / th.hrMaxBpm) * 100, 0)}% of age-adjusted max ${fmt(th.hrMaxBpm, 0)} bpm (age ${fmt(th.ageYears, 0)})`;

  const spo2Deviation = spo2 === null ? null : profile.spo2BaselinePct - spo2;
  const spo2Score =
    spo2Deviation === null
      ? MAX_SUBSCORE
      : ramp(spo2Deviation, th.spo2DeviationLowPct, th.spo2DeviationHighPct);
  const spo2Label =
    spo2 === null || spo2Deviation === null
      ? "SpO2 unavailable — scored as worst case"
      : `SpO2 ${fmt(spo2, 0)}% — ${fmt(Math.max(0, spo2Deviation), 1)} points below personal baseline ${fmt(profile.spo2BaselinePct, 0)}%`;

  const coreScore =
    coreTemp === null
      ? MAX_SUBSCORE
      : ramp(coreTemp, th.coreTempLowC, th.coreTempHighC);
  const coreLabel =
    coreTemp === null
      ? "Estimated core temperature unavailable — scored as worst case"
      : `Estimated core temperature ${fmt(coreTemp, 1)} C (estimated, not measured; personal limit ${fmt(th.coreTempHighC, 1)} C)`;

  const effectiveFatigue =
    fatigue === null ? null : clamp(fatigue + th.fatigueCarryOverPct, 0, 100);
  const fatigueScore =
    effectiveFatigue === null
      ? MAX_SUBSCORE
      : ramp(
          effectiveFatigue,
          param(config, "fatigue_low_pct"),
          param(config, "fatigue_high_pct"),
        );
  const fatigueLabel =
    effectiveFatigue === null
      ? "Fatigue index unavailable — scored as worst case"
      : `Fatigue index ${fmt(effectiveFatigue, 0)}% (includes ${fmt(th.fatigueCarryOverPct, 0)} points carried from a ${fmt(profile.prevShiftHours, 0)} h previous shift)`;

  const totScore = ramp(
    Math.max(0, pos.timeOnTaskMin),
    param(config, "time_on_task_low_min"),
    param(config, "time_on_task_high_min"),
  );
  const totLabel = `${fmt(Math.max(0, pos.timeOnTaskMin), 0)} min continuously on task`;

  const terms: Array<{ key: string; label: string; p: ParamName; value: number }> = [
    { key: "hr", label: hrLabel, p: "phys_weight_hr", value: hrScore },
    { key: "spo2", label: spo2Label, p: "phys_weight_spo2", value: spo2Score },
    { key: "core_temp", label: coreLabel, p: "phys_weight_core_temp", value: coreScore },
    { key: "fatigue", label: fatigueLabel, p: "phys_weight_fatigue", value: fatigueScore },
    {
      key: "time_on_task",
      label: totLabel,
      p: "phys_weight_time_on_task",
      value: totScore,
    },
  ];

  const value = weightedMean(
    terms.map((t) => ({ weight: param(config, t.p), value: t.value })),
  );
  const composite = param(config, "weight_physiological");
  const weightSum = terms.reduce((s, t) => s + Math.max(0, param(config, t.p)), 0);
  const drivers = terms.map((t) => ({
    key: t.key,
    label: t.label,
    weighted:
      weightSum === 0
        ? 0
        : (composite * Math.max(0, param(config, t.p)) * t.value) / weightSum,
  }));

  return { value, drivers };
}

function environmental(
  env: Environment,
  pos: Position,
  freshness: Freshness,
  th: PersonalThresholds,
  config: RiskConfig,
): SubscoreResult {
  const co = usable("coPpm", env.coPpm, freshness);
  const pm25 = usable("pm25UgM3", env.pm25UgM3, freshness);
  const ambient = usable("ambientTempC", env.ambientTempC, freshness);
  const humidity = usable("humidityPct", env.humidityPct, freshness);

  // On air, inhalation hazards are attenuated but never eliminated — this
  // system cannot verify mask seal or filter state.
  // Shared with the physiology toxic model — one value for one physical
  // quantity, owned by config/shared-default.json.
  const protection = pos.scbaOnAir
    ? clamp(param(config, "scba_inhaled_fraction_on_air"), 0, 1)
    : 1;

  const coRaw = co === null ? MAX_SUBSCORE : ramp(co, th.coLowPpm, th.coHighPpm);
  const coScore = coRaw * protection;
  const coLabel =
    co === null
      ? "CO reading unavailable — scored as worst case"
      : `CO ${fmt(co, 0)} ppm (personal alert from ${fmt(th.coLowPpm, 0)} ppm)${pos.scbaOnAir ? ", attenuated by SCBA on air" : ", no SCBA protection applied"}`;

  const pmRaw =
    pm25 === null ? MAX_SUBSCORE : ramp(pm25, th.pm25LowUgM3, th.pm25HighUgM3);
  const pmScore = pmRaw * protection;
  const pmLabel =
    pm25 === null
      ? "PM2.5 reading unavailable — scored as worst case"
      : `PM2.5 ${fmt(pm25, 0)} ug/m3${pos.scbaOnAir ? ", attenuated by SCBA on air" : ", no SCBA protection applied"}`;

  const humidityPenaltyC = (() => {
    const reference = param(config, "humidity_reference_pct");
    const perTenPct = param(config, "humidity_heat_penalty_c_per_10pct");
    const worst =
      (Math.max(0, MAX_HUMIDITY_PCT - reference) / 10) * Math.max(0, perTenPct);
    if (humidity === null) return worst;
    const h = clamp(humidity, MIN_HUMIDITY_PCT, MAX_HUMIDITY_PCT);
    return (Math.max(0, h - reference) / 10) * Math.max(0, perTenPct);
  })();

  const effectiveTempC = ambient === null ? null : ambient + humidityPenaltyC;
  const heatScore =
    effectiveTempC === null
      ? MAX_SUBSCORE
      : ramp(effectiveTempC, th.ambientLowC, th.ambientHighC);
  const heatLabel =
    effectiveTempC === null
      ? "Ambient temperature unavailable — scored as worst case"
      : `Ambient ${fmt(ambient as number, 0)} C, humidity-adjusted to ${fmt(effectiveTempC, 0)} C (personal alert from ${fmt(th.ambientLowC, 0)} C)`;

  const terms: Array<{ key: string; label: string; p: ParamName; value: number }> = [
    { key: "co", label: coLabel, p: "env_weight_co", value: coScore },
    { key: "pm25", label: pmLabel, p: "env_weight_pm25", value: pmScore },
    { key: "heat", label: heatLabel, p: "env_weight_heat", value: heatScore },
  ];

  const value = weightedMean(
    terms.map((t) => ({ weight: param(config, t.p), value: t.value })),
  );
  const composite = param(config, "weight_environmental");
  const weightSum = terms.reduce((s, t) => s + Math.max(0, param(config, t.p)), 0);
  const drivers = terms.map((t) => ({
    key: t.key,
    label: t.label,
    weighted:
      weightSum === 0
        ? 0
        : (composite * Math.max(0, param(config, t.p)) * t.value) / weightSum,
  }));

  return { value, drivers };
}

function proximity(
  pos: Position,
  freshness: Freshness,
  config: RiskConfig,
): SubscoreResult {
  const fireDistanceM = usable(
    "distanceToFireFrontM",
    pos.distanceToFireFrontM,
    freshness,
  );
  const scbaPct = usable("scbaPressurePct", pos.scbaPressurePct, freshness);
  const routeKnown = freshness.state["escapeRouteStatus"] !== "missing";
  const fixState = freshness.state["positionFix"];

  const fireScore =
    fireDistanceM === null
      ? MAX_SUBSCORE
      : descendingRamp(
          fireDistanceM,
          param(config, "fire_front_high_distance_m"),
          param(config, "fire_front_low_distance_m"),
        );
  const fireLabel =
    fireDistanceM === null
      ? fixState === "missing"
        ? "Position fix too old to trust — distance to fire front discarded, scored as worst case"
        : "Distance to fire front unavailable — scored as worst case"
      : `Fire front ${fmt(fireDistanceM, 0)} m away${fixState === "stale" ? " (from an ageing position fix)" : ""}`;

  // A route does not clear itself, so a stale determination is still used; an
  // absent one is scored at worst case rather than assumed clear.
  const routeScore = !routeKnown
    ? param(config, "escape_route_blocked_score")
    : pos.escapeRouteStatus === "blocked"
      ? param(config, "escape_route_blocked_score")
      : pos.escapeRouteStatus === "degraded"
        ? param(config, "escape_route_degraded_score")
        : 0;
  const routeLabel = routeKnown
    ? `Escape route ${pos.escapeRouteStatus}${freshness.state["escapeRouteStatus"] === "stale" ? " (assessment ageing)" : ""}`
    : "Escape route status unavailable — scored as worst case";

  const scbaScore =
    scbaPct === null
      ? MAX_SUBSCORE
      : descendingRamp(
          scbaPct,
          param(config, "scba_pressure_high_score_pct"),
          param(config, "scba_pressure_low_score_pct"),
        );
  const scbaLabel =
    scbaPct === null
      ? "SCBA pressure unavailable or too old to trust — scored as worst case"
      : `SCBA ${fmt(scbaPct, 0)}% remaining${freshness.state["scbaPressurePct"] === "stale" ? " (reading ageing)" : ""}`;

  const terms: Array<{ key: string; label: string; p: ParamName; value: number }> = [
    {
      key: "fire_distance",
      label: fireLabel,
      p: "prox_weight_fire_distance",
      value: fireScore,
    },
    {
      key: "escape_route",
      label: routeLabel,
      p: "prox_weight_escape_route",
      value: routeScore,
    },
    { key: "scba", label: scbaLabel, p: "prox_weight_scba", value: scbaScore },
  ];

  const value = weightedMean(
    terms.map((t) => ({ weight: param(config, t.p), value: t.value })),
  );
  const composite = param(config, "weight_proximity");
  const weightSum = terms.reduce((s, t) => s + Math.max(0, param(config, t.p)), 0);
  const drivers = terms.map((t) => ({
    key: t.key,
    label: t.label,
    weighted:
      weightSum === 0
        ? 0
        : (composite * Math.max(0, param(config, t.p)) * t.value) / weightSum,
  }));

  return { value, drivers };
}

function profileVulnerability(
  profile: HealthProfile,
  config: RiskConfig,
): SubscoreResult {
  const respScore = param(config, RESP_RISK_PARAM[profile.respiratoryRisk]);
  const respLabel = `${profile.respiratoryRisk} respiratory risk`;

  const heatScore = param(config, HEAT_TOLERANCE_PARAM[profile.heatTolerance]);
  const heatLabel = `${profile.heatTolerance} heat tolerance`;

  const fitnessScore = param(config, FITNESS_PARAM[profile.fitness]);
  const fitnessLabel = `${profile.fitness} fitness`;

  const prevShiftScore = ramp(
    Math.max(0, profile.prevShiftHours),
    param(config, "prev_shift_low_h"),
    param(config, "prev_shift_high_h"),
  );
  const prevShiftLabel = `${fmt(Math.max(0, profile.prevShiftHours), 0)} h previous shift`;

  const conditionCount = profile.conditions.length;
  const conditionScore = clamp(
    conditionCount * param(config, "condition_score_per_condition"),
    0,
    MAX_SUBSCORE,
  );
  const conditionLabel =
    conditionCount === 0
      ? "No declared conditions"
      : `Declared conditions: ${[...profile.conditions].sort().join(", ")}`;

  const coIndex = clamp(profile.cumulativeCoExposureIndex, 0, 1);
  const heatIndex = clamp(profile.cumulativeHeatExposureIndex, 0, 1);
  const cumulativeScore = Math.max(coIndex, heatIndex) * MAX_SUBSCORE;
  const cumulativeLabel = `Cumulative exposure index — CO ${fmt(coIndex, 2)}, heat ${fmt(heatIndex, 2)}`;

  const terms: Array<{ key: string; label: string; p: ParamName; value: number }> = [
    {
      key: "respiratory",
      label: respLabel,
      p: "prof_weight_respiratory",
      value: respScore,
    },
    {
      key: "heat_tolerance",
      label: heatLabel,
      p: "prof_weight_heat_tolerance",
      value: heatScore,
    },
    { key: "fitness", label: fitnessLabel, p: "prof_weight_fitness", value: fitnessScore },
    {
      key: "prev_shift",
      label: prevShiftLabel,
      p: "prof_weight_prev_shift",
      value: prevShiftScore,
    },
    {
      key: "conditions",
      label: conditionLabel,
      p: "prof_weight_conditions",
      value: conditionScore,
    },
    {
      key: "cumulative_exposure",
      label: cumulativeLabel,
      p: "prof_weight_cumulative_exposure",
      value: cumulativeScore,
    },
  ];

  const value = weightedMean(
    terms.map((t) => ({ weight: param(config, t.p), value: t.value })),
  );
  const composite = param(config, "weight_profile");
  const weightSum = terms.reduce((s, t) => s + Math.max(0, param(config, t.p)), 0);
  const drivers = terms.map((t) => ({
    key: t.key,
    label: t.label,
    weighted:
      weightSum === 0
        ? 0
        : (composite * Math.max(0, param(config, t.p)) * t.value) / weightSum,
  }));

  return { value, drivers };
}

/* -------------------------------------------------------------------------- */
/* Hard overrides                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Overrides are unconditional: they bypass the composite score, the band
 * thresholds and confidence entirely. Each fires on its own input; a missing
 * sibling input never suppresses one.
 *
 * Where an input is itself absent, the two operational channels (SCBA pressure,
 * distance to fire front) are evaluated at worst case, because there is no
 * UNKNOWN pathway defined for them. The three vital-sign channels are not: an
 * absent vital produces UNKNOWN, not CRITICAL, so that a dropped sensor reads
 * as "we cannot see this person" rather than "this person is dying".
 */
function hardOverrides(
  vitals: Vitals,
  pos: Position,
  freshness: Freshness,
  th: PersonalThresholds,
  config: RiskConfig,
): string[] {
  const reasons: string[] = [];

  const spo2 = usable("spo2Pct", vitals.spo2Pct, freshness);
  if (spo2 !== null && spo2 <= th.spo2OverridePct) {
    const need = Math.max(1, Math.trunc(param(config, "override_spo2_confirm_readings")));
    const recent = vitals.recentSpo2Pct;
    const haveHistory = Array.isArray(recent) && recent.length >= need;
    const confirmed = haveHistory
      ? (recent as number[]).slice(-need).every((v) => v <= th.spo2OverridePct)
      : true; // cannot confirm — fail safe and treat the breach as actionable
    if (confirmed) {
      reasons.push(
        haveHistory
          ? `SpO2 ${fmt(spo2, 0)}% at or below the personalised critical threshold ${fmt(th.spo2OverridePct, 0)}%, confirmed across ${need} consecutive readings`
          : `SpO2 ${fmt(spo2, 0)}% at or below the personalised critical threshold ${fmt(th.spo2OverridePct, 0)}% (no reading history available to confirm — treated as actionable)`,
      );
    }
  }

  const coreTemp = usable("coreTempC", vitals.coreTempC, freshness);
  if (coreTemp !== null && coreTemp >= th.coreTempOverrideC) {
    reasons.push(
      `Estimated core temperature ${fmt(coreTemp, 1)} C at or above the personalised critical threshold ${fmt(th.coreTempOverrideC, 1)} C`,
    );
  }

  const hr = usable("hrBpm", vitals.hrBpm, freshness);
  if (hr !== null && hr >= th.hrOverrideBpm) {
    reasons.push(
      `Heart rate ${fmt(hr, 0)} bpm at or above ${fmt(param(config, "override_hr_fraction_of_max") * 100, 0)}% of age-adjusted max ${fmt(th.hrMaxBpm, 0)} bpm`,
    );
  }

  if (vitals.fallDetected) {
    reasons.push("Fall detected");
  }

  // Unknown or unagable SCBA pressure is itself the dangerous condition: nobody
  // knows how much air this person has left.
  const usableScba = usable("scbaPressurePct", pos.scbaPressurePct, freshness);
  const scbaPct = usableScba ?? 0;
  const scbaThreshold = param(config, "override_scba_pressure_pct");
  if (scbaPct <= scbaThreshold) {
    reasons.push(
      usableScba === null
        ? `SCBA pressure unavailable or too old to trust — treated as at or below the ${fmt(scbaThreshold, 0)}% override threshold`
        : `SCBA pressure ${fmt(scbaPct, 0)}% at or below the ${fmt(scbaThreshold, 0)}% override threshold`,
    );
  }

  // A blocked route is used even when the assessment is ageing — routes do not
  // clear themselves. Absence of any assessment does not manufacture one.
  if (pos.escapeRouteStatus === "blocked") {
    const usableDistance = usable(
      "distanceToFireFrontM",
      pos.distanceToFireFrontM,
      freshness,
    );
    const distanceM = usableDistance ?? 0;
    const limitM = param(config, "override_escape_blocked_fire_distance_m");
    if (distanceM <= limitM) {
      reasons.push(
        usableDistance === null
          ? `Escape route blocked and distance to fire front unavailable or too old to trust — treated as inside the ${fmt(limitM, 0)} m override distance`
          : `Escape route blocked with fire front ${fmt(distanceM, 0)} m away, inside the ${fmt(limitM, 0)} m override distance`,
      );
    }
  }

  if (pos.manualMaydayActive === true) {
    reasons.push("Manual mayday declared");
  }

  return reasons;
}

/* -------------------------------------------------------------------------- */
/* Confidence and banding                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Confidence reflects how much the inputs can be trusted, not how bad they are.
 *
 * Beyond staleness and absence, an ESTIMATED core temperature caps confidence
 * below `high`: a value modelled from heart rate can be wrong for a given
 * individual in a way a measurement cannot, and reporting `high` confidence on
 * top of it would overstate the evidence. If the estimator also reports a
 * standard deviation above the configured threshold, confidence drops again.
 */
function deriveConfidence(
  freshness: Freshness,
  vitals: Vitals,
  config: RiskConfig,
): Confidence {
  const criticalMissing = freshness.missing.some((k) =>
    CRITICAL_CHANNELS.includes(k),
  );
  if (criticalMissing) return "low";

  let confidence: Confidence = "high";
  if (freshness.missing.length > 0) confidence = degradeConfidence(confidence, 1);
  if (freshness.stale.length >= 2) confidence = degradeConfidence(confidence, 1);

  if (vitals.coreTempIsEstimated === true) {
    // An estimate is never grounds for full confidence.
    confidence = degradeConfidence(confidence, 1);

    const sd = vitals.coreTempEstimateSdC;
    if (
      typeof sd === "number" &&
      Number.isFinite(sd) &&
      sd > param(config, "estimated_core_temp_sd_confidence_drop_c")
    ) {
      confidence = degradeConfidence(confidence, 1);
    }
  }

  return confidence;
}

function bandFromScore(score: number, config: RiskConfig): RiskBand {
  if (score <= param(config, "band_safe_max_score")) return "SAFE";
  if (score <= param(config, "band_caution_max_score")) return "CAUTION";
  if (score <= param(config, "band_high_max_score")) return "HIGH";
  return "CRITICAL";
}

function dataQualityNote(freshness: Freshness, confidence: Confidence): string {
  const parts: string[] = [];
  if (freshness.missing.length > 0) {
    parts.push(
      `${freshness.missing.length} input${freshness.missing.length === 1 ? "" : "s"} missing (${freshness.missing.join(", ")}); scored as worst case`,
    );
  }
  if (freshness.stale.length > 0) {
    parts.push(
      `${freshness.stale.length} input${freshness.stale.length === 1 ? "" : "s"} stale (${freshness.stale.join(", ")})`,
    );
  }
  if (parts.length === 0) parts.push("All tracked inputs fresh");
  parts.push(`oldest reading ${Math.round(freshness.oldestAgeSec)} s old`);
  parts.push(`confidence ${confidence}`);
  return `${parts.join("; ")}.`;
}

/* -------------------------------------------------------------------------- */
/* Explanation                                                                 */
/* -------------------------------------------------------------------------- */

function buildExplanation(
  profile: HealthProfile,
  band: RiskBand,
  score: number,
  overrideReasons: string[],
  drivers: string[],
  freshness: Freshness,
  confidence: Confidence,
): string {
  const sentences: string[] = [];
  const criticalMissing = freshness.missing.filter((k) =>
    CRITICAL_CHANNELS.includes(k),
  );

  if (overrideReasons.length > 0) {
    sentences.push(
      `CRITICAL for ${profile.callsign} on a hard override, which bypasses the composite score.`,
    );
    sentences.push(`Trigger: ${overrideReasons.join("; ")}.`);
  } else if (band === "UNKNOWN") {
    if (criticalMissing.length > 0) {
      sentences.push(
        `UNKNOWN for ${profile.callsign}: ${criticalMissing.join(", ")} ${criticalMissing.length === 1 ? "is" : "are"} not available, so no safety level can be reported.`,
      );
    } else {
      sentences.push(
        `UNKNOWN for ${profile.callsign}: data confidence is low, and low confidence can never be reported as SAFE.`,
      );
    }
    sentences.push("Missing data is not treated as safe data.");
  } else {
    sentences.push(
      `${band} for ${profile.callsign}, composite score ${fmt(score, 0)} of 100.`,
    );
  }

  if (drivers.length > 0 && overrideReasons.length === 0) {
    sentences.push(`Leading factors: ${drivers.join("; ")}.`);
  }

  sentences.push(
    `Thresholds are calibrated to this individual (age ${profile.age}, ${profile.fitness} fitness, ${profile.respiratoryRisk} respiratory risk, ${profile.heatTolerance} heat tolerance).`,
  );
  sentences.push(dataQualityNote(freshness, confidence));
  sentences.push(
    "Simulation only. Not clinically validated. The commander decides; Valoris does not withdraw anyone.",
  );

  return sentences.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Entry point                                                                 */
/* -------------------------------------------------------------------------- */

export function assessRisk(
  profile: HealthProfile,
  vitals: Vitals,
  env: Environment,
  pos: Position,
  config: RiskConfig,
  nowMs: number,
): RiskAssessment {
  const freshness = assessFreshness(vitals, env, pos, config, nowMs);
  const th = personalise(profile, config);

  const phys = physiological(profile, vitals, pos, freshness, th, config);
  const environment = environmental(env, pos, freshness, th, config);
  const prox = proximity(pos, freshness, config);
  const prof = profileVulnerability(profile, config);

  const score = clamp(
    weightedMean([
      { weight: param(config, "weight_physiological"), value: phys.value },
      { weight: param(config, "weight_environmental"), value: environment.value },
      { weight: param(config, "weight_proximity"), value: prox.value },
      { weight: param(config, "weight_profile"), value: prof.value },
    ]),
    0,
    MAX_SUBSCORE,
  );
  const roundedScore = round1(score);

  const overrideReasons = hardOverrides(vitals, pos, freshness, th, config);
  const hardOverride = overrideReasons.length > 0;

  const confidence = deriveConfidence(freshness, vitals, config);
  const criticalMissing = freshness.missing.some((k) =>
    CRITICAL_CHANNELS.includes(k),
  );

  let band = bandFromScore(roundedScore, config);
  // Missing critical vitals, or low confidence, can never read as SAFE.
  if (criticalMissing || confidence === "low") {
    band = maxBand(band, "UNKNOWN");
  }
  if (hardOverride) band = "CRITICAL";

  const rankedDrivers = [...phys.drivers, ...environment.drivers, ...prox.drivers, ...prof.drivers]
    .filter((d) => d.weighted > 0)
    .sort((a, b) => (b.weighted - a.weighted) || a.key.localeCompare(b.key))
    .map((d) => d.label);

  const topDrivers = (hardOverride
    ? [...overrideReasons, ...rankedDrivers]
    : rankedDrivers
  ).slice(0, 3);

  const dataQuality: DataQuality = {
    confidence,
    staleInputs: [...freshness.stale],
    missingInputs: [...freshness.missing],
    oldestReadingAgeSec: Math.round(freshness.oldestAgeSec),
    note: dataQualityNote(freshness, confidence),
  };

  return {
    firefighterId: profile.id,
    calculatedAtMs: nowMs,
    score: roundedScore,
    band,
    subscores: {
      physiological: round1(phys.value),
      environmental: round1(environment.value),
      proximity: round1(prox.value),
      profile: round1(prof.value),
    },
    hardOverride,
    hardOverrideReasons: overrideReasons,
    topDrivers,
    explanation: buildExplanation(
      profile,
      band,
      roundedScore,
      overrideReasons,
      topDrivers,
      freshness,
      confidence,
    ),
    dataQuality,
    modelVersion: config.modelVersion,
    configHash: config.configHash,
  };
}
