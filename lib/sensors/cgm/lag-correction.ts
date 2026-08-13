/**
 * Interstitial lag correction and latency accounting.
 *
 * CGM measures interstitial fluid, not blood. The physiological lag is roughly
 * 5–15 minutes and exists no matter how fast the API is. During rapid glucose
 * FALL — which is the wildfire deployment scenario — the displayed value
 * OVERSTATES actual blood glucose, so the correction is downward.
 *
 * The correction magnitudes are ILLUSTRATIVE and invented. They are a plausible
 * direction of adjustment, not a validated correction, and they require clinical
 * review before any pilot. See docs/CLINICAL_ASSUMPTIONS.md item 29.
 *
 * Correction is applied ONLY when glucose is falling. A stable or rising reading
 * does not overstate blood glucose, and adjusting it downward anyway would
 * manufacture hypoglycaemia that is not happening.
 *
 * Pure. No imports beyond config and types.
 */

import { dbParam, type DiabetesConfig } from "./config";
import {
  FALLING_TRENDS,
  type GlucoseAssessment,
  type GlucoseReading,
  type LatencyBreakdown,
} from "./types";

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function describeMinutes(seconds: number): string {
  const minutes = seconds / 60;
  if (minutes < 1) return "under a minute";
  if (minutes < 90) return `about ${Math.round(minutes)} minutes`;
  return `about ${(minutes / 60).toFixed(1)} hours`;
}

export function latencyBreakdown(
  reading: GlucoseReading,
  nowMs: number,
  config: DiabetesConfig,
): LatencyBreakdown {
  // The upper bound of the physiological lag is assumed, not the lower: assuming
  // the shorter lag would understate how far behind blood glucose the reading is.
  const physiologicalLagSec = dbParam(config, "interstitial_lag_max_sec");
  const apiLatencySec = Math.max(0, reading.latencySec);
  const readingAgeSec = Math.max(0, (nowMs - reading.recordedAtMs) / 1000);

  // Reading age already contains the API delay for a reading that has arrived,
  // so the total is the physiological lag plus however old the sample now is.
  const totalLatencySec = physiologicalLagSec + readingAgeSec;
  const limit = dbParam(config, "max_usable_total_latency_sec");

  return {
    physiologicalLagSec: Math.round(physiologicalLagSec),
    apiLatencySec: Math.round(apiLatencySec),
    readingAgeSec: Math.round(readingAgeSec),
    totalLatencySec: Math.round(totalLatencySec),
    summary: `${describeMinutes(totalLatencySec)} behind blood glucose (${describeMinutes(physiologicalLagSec)} physiological lag + ${describeMinutes(readingAgeSec)} reading age)`,
    exceedsUsableLimit: totalLatencySec > limit,
  };
}

export function assessGlucose(
  reading: GlucoseReading,
  nowMs: number,
  config: DiabetesConfig,
): GlucoseAssessment {
  const caveats: string[] = [
    "CGM measures interstitial fluid, not blood. A physiological lag of roughly 5-15 minutes exists regardless of API speed.",
    "Interstitial lag correction values are ILLUSTRATIVE and invented. See docs/CLINICAL_ASSUMPTIONS.md item 29.",
  ];

  const latency = latencyBreakdown(reading, nowMs, config);
  const isFalling = FALLING_TRENDS.includes(reading.trend);

  // Band from the REPORTED value, then correct. Using the corrected value to
  // choose the correction would be circular.
  const dangerAt = dbParam(config, "glucose_danger_mmol_l");
  const cautionAt = dbParam(config, "glucose_caution_mmol_l");

  let correctionBand: GlucoseAssessment["correctionBand"] = "none";
  let correctionAppliedMmolL = 0;

  if (isFalling) {
    if (reading.valueMmolL <= dangerAt) {
      correctionBand = "danger";
      correctionAppliedMmolL = dbParam(config, "lag_correction_danger_mmol_l");
    } else if (reading.valueMmolL <= cautionAt) {
      correctionBand = "caution";
      correctionAppliedMmolL = dbParam(config, "lag_correction_caution_mmol_l");
    }
    caveats.push(
      "Glucose is falling, so the displayed interstitial value overstates blood glucose; the correction is downward.",
    );
  } else {
    caveats.push(
      "Glucose is not falling, so no lag correction is applied — correcting a stable reading downward would manufacture hypoglycaemia that is not happening.",
    );
  }

  const correctedMmolL = Math.max(0, reading.valueMmolL - correctionAppliedMmolL);

  let usableMmolL: number | null = correctedMmolL;
  let unusableReason = "";
  if (latency.exceedsUsableLimit) {
    usableMmolL = null;
    unusableReason = `Total latency ${describeMinutes(latency.totalLatencySec)} exceeds the usable limit of ${describeMinutes(dbParam(config, "max_usable_total_latency_sec"))}. Glucose does not contribute to the live risk score; the diabetes module reports UNKNOWN rather than presenting a stale number as current.`;
    caveats.push(unusableReason);
  }

  if (reading.isSandbox) {
    caveats.push(
      "Sandbox data. Not real patient data, and not evidence of production access.",
    );
  }

  return {
    reportedMmolL: round2(reading.valueMmolL),
    correctedMmolL: round2(correctedMmolL),
    correctionAppliedMmolL: round2(correctionAppliedMmolL),
    correctionBand,
    trend: reading.trend,
    isFalling,
    latency,
    usableMmolL: usableMmolL === null ? null : round2(usableMmolL),
    unusableReason,
    dataTier: reading.dataTier,
    vendor: reading.vendor,
    isSandbox: reading.isSandbox,
    caveats,
  };
}
