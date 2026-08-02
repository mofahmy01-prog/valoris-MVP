import type { Confidence, RiskBand } from "./types";

/**
 * Severity ordering used for comparisons and for the "removing an input never
 * lowers the band" property.
 *
 * UNKNOWN sits above SAFE and below CAUTION. It means "we do not know", which
 * is never safe, but it is also not an assertion that the firefighter is in
 * danger. Where a missing input destroys the evidence for a higher band, the
 * band collapses to UNKNOWN rather than silently reading SAFE — see
 * docs/KNOWN_LIMITATIONS.md.
 */
export const BAND_SEVERITY: Record<RiskBand, number> = {
  SAFE: 0,
  UNKNOWN: 1,
  CAUTION: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const CONFIDENCE_BY_RANK: readonly Confidence[] = ["low", "medium", "high"];

/** Drop confidence by `steps`, never below `low`. */
export function degradeConfidence(c: Confidence, steps: number): Confidence {
  const next = CONFIDENCE_RANK[c] - Math.max(0, Math.trunc(steps));
  const clamped = Math.max(0, Math.min(CONFIDENCE_BY_RANK.length - 1, next));
  return CONFIDENCE_BY_RANK[clamped] as Confidence;
}

/** The more severe of two bands. */
export function maxBand(a: RiskBand, b: RiskBand): RiskBand {
  return BAND_SEVERITY[a] >= BAND_SEVERITY[b] ? a : b;
}
