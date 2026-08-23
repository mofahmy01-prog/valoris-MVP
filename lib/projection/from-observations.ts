/**
 * Feeding the projection module from stored observations.
 *
 * The append-only `Observation` table is the rolling history the projection
 * reads. This module is the only bridge between the two, and it exists so the
 * projection engine itself stays pure and database-free.
 *
 * ONE RULE ABOUT WHAT GOES IN: measured readings only.
 *
 * A projected value must never be fed back in as history. Doing so would
 * compound an estimate on an estimate, and within a few ticks the slope would
 * describe nothing that was ever observed. Only columns written from a real
 * reported reading are read here, and the derived columns — core temperature,
 * fatigue — are deliberately excluded because they are model output rather than
 * measurement.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import type { Observation } from "@prisma/client";

import { param, type RiskConfig } from "@/lib/risk/config";
import type { Environment, Position, Vitals } from "@/lib/risk/types";

import {
  projectChannel,
  PROJECTABLE_CHANNELS,
  type ChannelSample,
  type Projection,
} from "./engine";

/**
 * Where each projectable channel's measured value and timestamp live on a row.
 *
 * Explicitly listed rather than derived, so adding a channel to
 * PROJECTABLE_CHANNELS without deciding where its MEASURED history comes from
 * is a compile error rather than a silent omission.
 */
const CHANNEL_COLUMNS: Record<
  string,
  { value: (row: Observation) => number | null; at: (row: Observation) => Date | null }
> = {
  hrBpm: { value: (r) => r.hrBpm, at: (r) => r.hrUpdatedAtUtc },
  spo2Pct: { value: (r) => r.spo2Pct, at: (r) => r.spo2UpdatedAtUtc },
  respRatePerMin: { value: (r) => r.respRatePerMin, at: (r) => r.respRateUpdatedAtUtc },
  coPpm: { value: (r) => r.coPpm, at: (r) => r.coUpdatedAtUtc },
  pm25UgM3: { value: (r) => r.pm25UgM3, at: (r) => r.pm25UpdatedAtUtc },
  ambientTempC: { value: (r) => r.ambientTempC, at: (r) => r.ambientTempUpdatedAtUtc },
  scbaPressurePct: {
    value: (r) => r.scbaPressurePct,
    at: (r) => r.scbaPressureUpdatedAtUtc,
  },
};

export type AppliedProjection = Projection & { channel: string };

export type ProjectionApplication = {
  vitals: Vitals;
  environment: Environment;
  position: Position;
  /** What was imputed, for the audit trail and for the operator to read. */
  applied: AppliedProjection[];
};

/** Build one channel's MEASURED history from stored observations. */
function historyFor(channel: string, rows: Observation[]): ChannelSample[] {
  const columns = CHANNEL_COLUMNS[channel];
  if (columns === undefined) return [];

  /*
    Deduplicated by measurement time, not by row.

    A frozen sensor keeps being written to the observation log every tick with
    the SAME reading and the SAME timestamp. Counted once per row, forty
    identical points would dominate the least-squares fit and flatten the slope
    onto the frozen value — the projection would then confidently continue a
    trend that had already stopped being measured. One measurement is one
    sample, however many times it was recorded.
  */
  const byTime = new Map<number, number>();
  for (const row of rows) {
    const value = columns.value(row);
    const at = columns.at(row);
    if (value === null || at === null) continue;
    byTime.set(at.getTime(), value);
  }

  return [...byTime.entries()]
    .map(([atMs, value]) => ({ atMs, value }))
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * Impute any dark channel that can be projected, and report what was imputed.
 *
 * A channel is a candidate when the current reading carries no value for it.
 * The projection engine then applies its own guards — history depth, horizon,
 * slope agreement — and refuses far more often than it accepts, which is the
 * intended behaviour rather than a limitation.
 */
export function applyProjections(
  vitals: Vitals,
  environment: Environment,
  position: Position,
  history: Observation[],
  nowMs: number,
  config: RiskConfig,
): ProjectionApplication {
  const applied: AppliedProjection[] = [];

  const vitalsOut: Vitals = { ...vitals };
  const environmentOut: Environment = { ...environment };
  const positionOut: Position = { ...position };

  const vitalsProjected: string[] = [];
  const environmentProjected: string[] = [];
  const positionProjected: string[] = [];

  const currentValue = (channel: string): number | null | undefined => {
    if (channel in vitalsOut) return (vitalsOut as Record<string, unknown>)[channel] as number | null;
    if (channel in environmentOut) {
      return (environmentOut as Record<string, unknown>)[channel] as number | null;
    }
    if (channel in positionOut) {
      return (positionOut as Record<string, unknown>)[channel] as number | null;
    }
    return undefined;
  };

  const missingAfterMs = param(config, "missing_after_sec") * 1000;

  const lastUpdatedFor = (channel: string): number | undefined => {
    if (channel in vitalsOut) return vitalsOut.lastUpdatedMs?.[channel];
    if (channel in environmentOut) return environmentOut.lastUpdatedMs?.[channel];
    if (channel in positionOut) return positionOut.lastUpdatedMs?.[channel];
    return undefined;
  };

  for (const channel of Object.keys(PROJECTABLE_CHANNELS)) {
    /*
      A channel is dark if it has no value OR if its reading is too old to
      trust.

      The second case is the common one in practice: a failed sensor usually
      keeps transmitting its last reading rather than reporting nothing, so the
      value is present and the TIMESTAMP is what has stopped moving. Treating
      only a null as dark would have missed exactly the failure this feature was
      built for — and did, on the first live test.
    */
    const present = currentValue(channel);
    const updatedAt = lastUpdatedFor(channel);
    const ageMs = typeof updatedAt === "number" ? nowMs - updatedAt : Infinity;
    const hasUsableReading =
      present !== null && present !== undefined && ageMs <= missingAfterMs;
    if (hasUsableReading) continue;

    const outcome = projectChannel(channel, historyFor(channel, history), nowMs, config);
    if (!outcome.projected) continue;

    const { projection } = outcome;
    applied.push(projection);

    if (channel in vitalsOut) {
      (vitalsOut as Record<string, unknown>)[channel] = projection.value;
      vitalsProjected.push(channel);
      // The age stays truthful: the ORIGINAL measurement time, not now.
      vitalsOut.lastUpdatedMs = {
        ...vitalsOut.lastUpdatedMs,
        [channel]: projection.lastMeasuredAtMs,
      };
    } else if (channel in environmentOut) {
      (environmentOut as Record<string, unknown>)[channel] = projection.value;
      environmentProjected.push(channel);
      environmentOut.lastUpdatedMs = {
        ...environmentOut.lastUpdatedMs,
        [channel]: projection.lastMeasuredAtMs,
      };
    } else if (channel in positionOut) {
      (positionOut as Record<string, unknown>)[channel] = projection.value;
      positionProjected.push(channel);
      positionOut.lastUpdatedMs = {
        ...(positionOut.lastUpdatedMs ?? {}),
        [channel]: projection.lastMeasuredAtMs,
      };
    }
  }

  if (vitalsProjected.length > 0) vitalsOut.projectedChannels = vitalsProjected;
  if (environmentProjected.length > 0) {
    environmentOut.projectedChannels = environmentProjected;
  }
  if (positionProjected.length > 0) positionOut.projectedChannels = positionProjected;

  return {
    vitals: vitalsOut,
    environment: environmentOut,
    position: positionOut,
    applied,
  };
}
