/**
 * Valoris risk engine — domain types.
 *
 * This module has NO imports. Everything under `lib/risk/` is deliberately
 * framework-free so the engine can be lifted into a separate service later
 * without a rewrite.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 * Not a medical device. Not clinically validated.
 */

export type RiskBand = "UNKNOWN" | "SAFE" | "CAUTION" | "HIGH" | "CRITICAL";
export type Confidence = "high" | "medium" | "low";

export type HealthProfile = {
  id: string;
  callsign: string;
  age: number;
  fitness: "low" | "moderate" | "high";
  restingHrBpm: number;
  spo2BaselinePct: number;
  conditions: string[];
  respiratoryRisk: "none" | "mild" | "moderate" | "high";
  heatTolerance: "low" | "avg" | "high";
  prevShiftHours: number;
  cumulativeCoExposureIndex: number;
  cumulativeHeatExposureIndex: number;
};

export type Vitals = {
  hrBpm: number | null;
  spo2Pct: number | null;
  coreTempC: number | null; // ESTIMATED, never presented as measured
  respRatePerMin: number | null;
  fatiguePct: number | null;
  hydrationPct: number | null;
  fallDetected: boolean;
  lastUpdatedMs: Record<string, number>;

  /**
   * Optional recent SpO2 readings, oldest first, most recent last, including
   * the current reading. Supplied by the caller because `assessRisk` is a pure
   * stateless function and the SpO2 hard override is defined as "confirmed
   * across N consecutive readings".
   *
   * If absent or shorter than the configured confirmation count, the engine
   * cannot confirm and fails safe: a single breaching reading fires the
   * override. See docs/CLINICAL_ASSUMPTIONS.md.
   */
  recentSpo2Pct?: number[];

  /**
   * True when `coreTempC` came from a model rather than a sensor.
   *
   * An estimate that can be wrong for a given individual is weaker evidence than
   * a measurement, so declaring it caps data-quality confidence below `high`.
   * Optional and defaulting to false so a caller supplying a genuinely measured
   * core temperature is not penalised — but note that nothing in Valoris measures
   * core temperature, so the composition layer always sets this true.
   */
  coreTempIsEstimated?: boolean;

  /**
   * Standard deviation of the core temperature estimate, °C, where the estimator
   * reports one. Above a configured threshold, confidence drops a further step.
   * This is how a heart-rate dropout degrades confidence through the estimator's
   * own growing variance rather than through a special case.
   */
  coreTempEstimateSdC?: number | null;
};

export type Environment = {
  ambientTempC: number | null;
  humidityPct: number | null;
  coPpm: number | null;
  pm25UgM3: number | null;
  windSpeedMs: number | null;
  windDirDeg: number | null;
  lastUpdatedMs: Record<string, number>;
};

export type Position = {
  lat: number;
  lng: number;
  distanceToFireFrontM: number | null;
  distanceToSafeZoneM: number | null;
  escapeRouteStatus: "clear" | "degraded" | "blocked";
  scbaPressurePct: number | null;
  scbaOnAir: boolean;
  timeOnTaskMin: number;

  /**
   * Optional commander- or firefighter-declared mayday. Modelled here rather
   * than in Vitals because it is an operational state, not a sensor reading.
   */
  manualMaydayActive?: boolean;

  /**
   * Freshness of each position/equipment channel, keyed by channel name:
   * `positionFix`, `distanceToFireFrontM`, `distanceToSafeZoneM`,
   * `escapeRouteStatus`, `scbaPressurePct`.
   *
   * Optional only so the originally specified `Position` shape still
   * type-checks. **Omitting it is not a safe default.** An absent map means no
   * channel's age can be established, so every position channel is treated as
   * missing — which scores each at worst case and fires the SCBA override. That
   * is deliberate: forgetting to report freshness must be loud, not silent.
   *
   * A frozen GPS or SCBA feed keeps reporting the same plausible number for as
   * long as nobody checks its age. Tracking that age here is what stops a stale
   * reading from contributing to a confident score.
   */
  lastUpdatedMs?: Record<string, number>;
};

export type DataQuality = {
  confidence: Confidence;
  staleInputs: string[];
  missingInputs: string[];
  oldestReadingAgeSec: number;
  note: string;
};

export type RiskSubscores = {
  physiological: number;
  environmental: number;
  proximity: number;
  profile: number;
};

export type RiskAssessment = {
  firefighterId: string;
  calculatedAtMs: number;
  score: number; // 0-100
  band: RiskBand;
  subscores: RiskSubscores;
  hardOverride: boolean;
  hardOverrideReasons: string[];
  topDrivers: string[]; // ranked, max 3
  explanation: string; // plain English
  dataQuality: DataQuality;
  modelVersion: string;
  configHash: string;
};

/** Provenance of a threshold value. Everything ships as `illustrative`. */
export type SourceStatus =
  | "illustrative"
  | "literature_derived"
  | "expert_proposed"
  | "validated";

/** Where a threshold sits in clinical governance. Everything ships `unreviewed`. */
export type ClinicalReviewStatus =
  | "unreviewed"
  | "under_review"
  | "approved_for_simulation"
  | "approved_for_pilot"
  | "rejected";

export type RiskParameter = {
  name: string;
  value: number;
  unit: string;
  sourceStatus: SourceStatus;
  clinicalReviewStatus: ClinicalReviewStatus;
  rationale: string;
  min: number;
  max: number;
  editable: boolean;
  /**
   * Reference into the numbered list in docs/CLINICAL_ASSUMPTIONS.md, e.g.
   * "ref [2]". Mandatory when `sourceStatus` is `literature_derived` or
   * `validated` — enforced by the shared loader in lib/params.
   */
  citation?: string;
};
