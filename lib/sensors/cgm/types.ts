/**
 * Vendor-agnostic continuous glucose monitoring.
 *
 * Abbott Libre will matter as much as Dexcom for UK fire services, so nothing
 * here couples to a vendor. Re-architecting later is expensive; the abstraction
 * costs nothing now.
 *
 * ============================ ACCESS REALITY =============================
 * Valoris is developed against the **Dexcom sandbox**. It has no partner status
 * and no real-time access. The standard partner API delivers data with a
 * ONE-HOUR delay in the US and THREE HOURS outside it, including the UK — which
 * for an active fireground is useless.
 *
 * The only accurate public statement is:
 *
 *   "Glucose monitoring is developed against the Dexcom sandbox API. Real-time
 *    CGM access requires Dexcom Partner status, which we have not yet obtained."
 *
 * NEVER say "integrated with Dexcom" (it is their sandbox) and NEVER say
 * "real-time glucose monitoring". A test asserts no such claim appears in this
 * module.
 * =========================================================================
 *
 * TWO LATENCIES, BOTH REAL, BOTH SURFACED:
 *
 *   1. Physiological — CGM measures interstitial fluid, not blood. The lag is
 *      roughly 5–15 minutes and exists no matter how fast the API is. During
 *      rapid glucose FALL — exactly the wildfire deployment scenario — the
 *      displayed value OVERSTATES actual blood glucose.
 *   2. API — 0 for sandbox and simulated, ~60 min for Dexcom standard in the US,
 *      ~180 min outside it, ~5 min for real-time partner access.
 *
 * A commander must be able to see whether a reading is 5 minutes old or 185.
 *
 * No imports. Pure types.
 */

/** Data tier for a glucose reading. Corrected from the sensor spec. */
export type GlucoseDataTier =
  /**
   * Real CGM data recorded from a real person who is not a firefighter. Tier A
   * is environmental measurement ONLY — glucose is not environmental, and the
   * sensor spec's original mapping to Tier A was wrong.
   */
  | "B_REAL_WEARABLE_NON_FIREFIGHTER"
  /** Dexcom sandbox (simulated by the vendor) and Valoris-modelled glucose. */
  | "C_SYNTHETIC_MODEL_DRIVEN";

export type GlucoseTrend =
  | "doubleUp"
  | "singleUp"
  | "fortyFiveUp"
  | "flat"
  | "fortyFiveDown"
  | "singleDown"
  | "doubleDown"
  | "notComputable";

/** Trends that indicate glucose is falling. Lag correction matters most here. */
export const FALLING_TRENDS: readonly GlucoseTrend[] = [
  "fortyFiveDown",
  "singleDown",
  "doubleDown",
];

export type GlucoseReading = {
  /** As reported by the device, mmol/L. Never mg/dL — unit confusion kills. */
  valueMmolL: number;
  trend: GlucoseTrend;
  trendRateMmolLPerMin: number | null;
  /** When the device measured it. */
  recordedAtMs: number;
  /** When Valoris received it. */
  receivedAtMs: number;
  /** receivedAt − recordedAt. The API delay alone. */
  latencySec: number;
  vendor: string;
  dataTier: GlucoseDataTier;
  /** True only for a vendor sandbox. Sandbox data is not real patient data. */
  isSandbox: boolean;
};

export type AdapterHealth = {
  available: boolean;
  /** Why it is unavailable. Empty when available. */
  unavailableReason: string;
  lastSuccessfulPollMs: number | null;
  consecutiveFailures: number;
};

export type OAuthToken = {
  accessToken: string;
  refreshToken?: string;
  expiresAtMs: number;
  scope?: string;
};

export interface CgmAdapter {
  readonly vendor: "dexcom" | "abbott" | "simulated";
  /** False for every adapter in this build. There is no real-time access. */
  readonly isRealTime: boolean;
  /** API latency in seconds. Does NOT include the physiological lag. */
  readonly latencySec: number;
  /** Base URL. Sandbox only for Dexcom — the production host is never used. */
  readonly baseUrl: string;
  connect(auth: OAuthToken): Promise<void>;
  getReadings(from: Date, to: Date): Promise<GlucoseReading[]>;
  health(): AdapterHealth;
}

/**
 * The full latency picture for one reading, for display. A commander seeing
 * "6.1 mmol/L" needs to know whether that was true five minutes ago or three
 * hours ago.
 */
export type LatencyBreakdown = {
  /** Interstitial-to-blood lag, seconds. Independent of any API. */
  physiologicalLagSec: number;
  /** Transport delay, seconds. */
  apiLatencySec: number;
  /** Age of the reading itself at the moment of assessment, seconds. */
  readingAgeSec: number;
  /** Everything combined — what the commander must see. */
  totalLatencySec: number;
  /** Plain-English summary, e.g. "about 8 minutes behind blood glucose". */
  summary: string;
  /** True when total latency exceeds the configured usable limit. */
  exceedsUsableLimit: boolean;
};

/** Result of interpreting a reading for the risk pipeline. */
export type GlucoseAssessment = {
  /** As reported by the device. */
  reportedMmolL: number;
  /**
   * After interstitial lag correction. During a rapid fall the reported value
   * overstates blood glucose, so the corrected value is LOWER.
   */
  correctedMmolL: number;
  correctionAppliedMmolL: number;
  correctionBand: "none" | "caution" | "danger";
  trend: GlucoseTrend;
  isFalling: boolean;
  latency: LatencyBreakdown;
  /**
   * The value the risk engine should consume, or null when latency makes it
   * unusable. Null becomes UNKNOWN rather than a stale number shown as current.
   */
  usableMmolL: number | null;
  /** Why it is unusable. Empty when usable. */
  unusableReason: string;
  dataTier: GlucoseDataTier;
  vendor: string;
  isSandbox: boolean;
  caveats: string[];
};
