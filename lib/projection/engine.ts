/**
 * Projecting a channel that has gone dark.
 *
 * Today a channel that stops reporting is scored at worst case. That is safe but
 * uninformative: it makes a degraded sensor picture indistinguishable from a
 * deteriorating firefighter, and it is the cause of limitations 6 and 8.
 *
 * THE GOVERNING RULE, agreed before Milestone 2 and not negotiable here:
 *
 *     An estimate may only ever move in the dangerous direction.
 *
 * The imputed value is the WORSE of the last measured value and that value
 * extrapolated along its recent measured slope. A rising core temperature keeps
 * rising. A falling heart rate is held at its last measured value rather than
 * assumed to keep recovering. A projection can therefore never improve a
 * firefighter's picture — it can only continue a deterioration that was actually
 * being measured on that individual.
 *
 * This is a CLINICAL claim, not merely an engineering one. It asserts that a
 * deterioration observed over the preceding window is more likely to continue
 * than to reverse, over a short horizon, under continuing exertion. Nobody
 * qualified has reviewed that assertion. See docs/CLINICAL_ASSUMPTIONS.md
 * item 13, which flags the minimum history depth, the maximum horizon, and
 * whether a projected value may fire a hard override at all.
 *
 * EXPLICITLY OUT OF SCOPE, and not to be added without separate review:
 * estimating a missing physiological value from ambient conditions, workload,
 * proximity, or crewmates' readings. That would be inventing an unvalidated
 * physiological model. This module reads ONE firefighter's OWN history and
 * nothing else — it takes no environment, no position and no crew argument, so
 * the constraint is enforced by the signature rather than by discipline.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { param, type RiskConfig } from "@/lib/risk/config";

/** One measured reading of one channel. Never a projected one. */
export type ChannelSample = {
  atMs: number;
  value: number;
};

/**
 * Which way is worse for a given channel.
 *
 * Deliberately explicit per channel rather than inferred. A channel whose
 * dangerous direction is ambiguous does not appear here and is not projected.
 */
export type DangerDirection = "higher_is_worse" | "lower_is_worse";

/**
 * Channels that may be projected, and which way danger lies.
 *
 * `glucoseMmolL` is DELIBERATELY ABSENT. It is dangerous in both directions —
 * hypoglycaemia and hyperglycaemia — so "the worse of two values" has no single
 * meaning without deciding how to weigh a fall toward hypo against a rise toward
 * hyper. That is a clinical judgement, item 13 asks for per-channel review, and
 * inventing an answer here would be exactly the kind of unreviewed physiological
 * model this module refuses to build.
 *
 * `fatiguePct` and `coreTempC` as *reported* are absent for a different reason:
 * Valoris derives them rather than measuring them, so projecting them would be
 * projecting a model's output rather than a firefighter's readings.
 */
export const PROJECTABLE_CHANNELS: Record<string, DangerDirection> = {
  hrBpm: "higher_is_worse",
  spo2Pct: "lower_is_worse",
  respRatePerMin: "higher_is_worse",
  coPpm: "higher_is_worse",
  pm25UgM3: "higher_is_worse",
  ambientTempC: "higher_is_worse",
  scbaPressurePct: "lower_is_worse",
};

export type ProjectionRefusal =
  | "channel_not_projectable"
  | "insufficient_history"
  | "horizon_exceeded"
  | "slope_inconsistent";

export type Projection = {
  channel: string;
  /** The imputed value. Never better than the last measured reading. */
  value: number;
  /** The last actually-measured reading this was built from. */
  lastMeasured: number;
  lastMeasuredAtMs: number;
  /** Fitted slope, in channel units per minute. */
  slopePerMin: number;
  /** How long the channel has been dark, seconds. */
  darkForSec: number;
  samples: number;
  /** Plain English, for a commander rather than a log. */
  note: string;
};

export type ProjectionOutcome =
  | { projected: true; projection: Projection }
  | { projected: false; refusal: ProjectionRefusal; note: string };

/** Least-squares slope of value against time, in units per minute. */
function fitSlopePerMin(samples: ChannelSample[]): number {
  const n = samples.length;
  const meanT = samples.reduce((s, x) => s + x.atMs, 0) / n;
  const meanV = samples.reduce((s, x) => s + x.value, 0) / n;

  let num = 0;
  let den = 0;
  for (const s of samples) {
    const dt = s.atMs - meanT;
    num += dt * (s.value - meanV);
    den += dt * dt;
  }
  if (den === 0) return 0;
  // Slope is per millisecond; report per minute so the units read sensibly.
  return (num / den) * 60_000;
}

/** Fraction of consecutive deltas whose sign agrees with the fitted slope. */
function slopeAgreement(samples: ChannelSample[], slopePerMin: number): number {
  if (samples.length < 2) return 0;
  const want = Math.sign(slopePerMin);
  if (want === 0) return 1;

  let agreeing = 0;
  let total = 0;
  for (let i = 1; i < samples.length; i += 1) {
    const delta = (samples[i] as ChannelSample).value - (samples[i - 1] as ChannelSample).value;
    total += 1;
    // A flat step contradicts nothing.
    if (delta === 0 || Math.sign(delta) === want) agreeing += 1;
  }
  return total === 0 ? 0 : agreeing / total;
}

/** The worse of two values for this channel. */
function worse(a: number, b: number, direction: DangerDirection): number {
  return direction === "higher_is_worse" ? Math.max(a, b) : Math.min(a, b);
}

/**
 * Project one dark channel from this firefighter's own measured history.
 *
 * `history` must contain MEASURED readings only. Feeding projections back in
 * would compound an estimate on an estimate, and the slope would drift away from
 * anything that was ever observed.
 */
export function projectChannel(
  channel: string,
  history: ChannelSample[],
  nowMs: number,
  config: RiskConfig,
): ProjectionOutcome {
  const direction = PROJECTABLE_CHANNELS[channel];
  if (direction === undefined) {
    return {
      projected: false,
      refusal: "channel_not_projectable",
      note: `${channel} has no agreed dangerous direction, so it is scored at worst case rather than estimated.`,
    };
  }

  const usable = history
    .filter((s) => Number.isFinite(s.value) && s.atMs <= nowMs)
    .sort((a, b) => a.atMs - b.atMs);

  /*
    Horizon is checked FIRST, against the most recent reading of any age.

    Checking it after the window filter reported "insufficient history" for a
    channel that had simply been dark too long — true, but the wrong reason, and
    a commander reading "too few readings" would go looking for a sensor fault
    that was not there. Both answers refuse to project; only one of them is
    honest about why.
  */
  const latest = usable[usable.length - 1];
  if (latest === undefined) {
    return {
      projected: false,
      refusal: "insufficient_history",
      note: `No measured readings for ${channel} at all, so worst case stands.`,
    };
  }

  const darkForMs = nowMs - latest.atMs;
  const maxHorizonMs = param(config, "projection_max_horizon_sec") * 1000;

  if (darkForMs > maxHorizonMs) {
    // A projection must not run indefinitely on a slope nobody is measuring.
    return {
      projected: false,
      refusal: "horizon_exceeded",
      note: `${channel} has been dark for ${Math.round(darkForMs / 1000)}s, beyond the ${param(config, "projection_max_horizon_sec")}s projection horizon. Reverted to worst case.`,
    };
  }

  const windowMs = param(config, "projection_history_window_sec") * 1000;
  const inWindow = usable.filter((s) => nowMs - s.atMs <= windowMs);

  if (inWindow.length < param(config, "projection_min_samples")) {
    return {
      projected: false,
      refusal: "insufficient_history",
      note: `Only ${inWindow.length} measured readings for ${channel} in the window — too few to establish a trend, so worst case stands.`,
    };
  }

  const last = inWindow[inWindow.length - 1] as ChannelSample;

  const slopePerMin = fitSlopePerMin(inWindow);
  const minSlope = param(config, "projection_min_slope_per_min");
  const agreement = slopeAgreement(inWindow, slopePerMin);

  // A trend the readings do not agree on is noise, and amplifying noise into a
  // projection would be worse than admitting we do not know.
  if (
    Math.abs(slopePerMin) >= minSlope &&
    agreement < param(config, "projection_slope_agreement_frac")
  ) {
    return {
      projected: false,
      refusal: "slope_inconsistent",
      note: `${channel} readings disagree on direction (${Math.round(agreement * 100)}% agreement), so no trend is claimed and worst case stands.`,
    };
  }

  const darkMin = darkForMs / 60_000;
  const extrapolated =
    Math.abs(slopePerMin) < minSlope ? last.value : last.value + slopePerMin * darkMin;

  // THE RULE. Never better than what was last actually measured.
  const value = worse(last.value, extrapolated, direction);

  const moved = Math.abs(value - last.value) >= 0.05;
  const note = moved
    ? `${channel} projected from this firefighter's own readings: last measured ${round(last.value)} ${Math.round(darkForMs / 1000)}s ago, trending ${slopePerMin > 0 ? "up" : "down"} at ${round(Math.abs(slopePerMin))}/min, continued to ${round(value)}. An estimate, not a measurement.`
    : `${channel} held at its last measured ${round(last.value)} from ${Math.round(darkForMs / 1000)}s ago — the trend was flat or pointed the safe way, and an estimate may not improve the picture. An estimate, not a measurement.`;

  return {
    projected: true,
    projection: {
      channel,
      value,
      lastMeasured: last.value,
      lastMeasuredAtMs: last.atMs,
      slopePerMin,
      darkForSec: Math.round(darkForMs / 1000),
      samples: inWindow.length,
      note,
    },
  };
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
