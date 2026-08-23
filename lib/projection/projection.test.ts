/**
 * Projection invariants.
 *
 * One rule matters more than everything else here, and it gets a property test
 * rather than an example: an estimate may only ever move in the dangerous
 * direction. If that ever breaks, a dead sensor starts making firefighters look
 * better than they are, which is the precise failure this whole project is
 * built to avoid.
 */

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import {
  projectChannel,
  PROJECTABLE_CHANNELS,
  type ChannelSample,
  type DangerDirection,
} from "./engine";

const CONFIG = DEFAULT_RISK_CONFIG;
const NOW = 1_700_000_000_000;

/** Evenly spaced measured readings ending `endsAgoSec` before now. */
function series(values: number[], stepSec = 30, endsAgoSec = 10): ChannelSample[] {
  const end = NOW - endsAgoSec * 1000;
  return values.map((value, i) => ({
    atMs: end - (values.length - 1 - i) * stepSec * 1000,
    value,
  }));
}

describe("projection — the governing rule", () => {
  it("never returns a value better than the last measured reading", () => {
    const channels = Object.keys(PROJECTABLE_CHANNELS);

    fc.assert(
      fc.property(
        fc.constantFrom(...channels),
        fc.array(fc.double({ min: 1, max: 200, noNaN: true }), {
          minLength: 3,
          maxLength: 12,
        }),
        fc.integer({ min: 1, max: 110 }),
        (channel, values, darkSec) => {
          const history = series(values, 20, darkSec);
          const outcome = projectChannel(channel, history, NOW, CONFIG);
          if (!outcome.projected) return;

          const direction = PROJECTABLE_CHANNELS[channel] as DangerDirection;
          const { value, lastMeasured } = outcome.projection;

          if (direction === "higher_is_worse") {
            expect(value).toBeGreaterThanOrEqual(lastMeasured - 1e-9);
          } else {
            expect(value).toBeLessThanOrEqual(lastMeasured + 1e-9);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it("continues a rising heart rate", () => {
    const outcome = projectChannel("hrBpm", series([120, 130, 140, 150]), NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.value).toBeGreaterThan(150);
    expect(outcome.projection.slopePerMin).toBeGreaterThan(0);
  });

  it("holds a FALLING heart rate at its last measured value, never lower", () => {
    // The asymmetry is the whole point: recovery is not assumed to continue.
    const outcome = projectChannel("hrBpm", series([180, 170, 160, 150]), NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.value).toBe(150);
    expect(outcome.projection.note).toMatch(/may not improve the picture/i);
  });

  it("continues a FALLING SpO2, because down is the dangerous way", () => {
    const outcome = projectChannel("spo2Pct", series([97, 95, 93, 91]), NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.value).toBeLessThan(91);
  });

  it("holds a RISING SpO2 at its last measured value", () => {
    const outcome = projectChannel("spo2Pct", series([88, 91, 94, 97]), NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.value).toBe(97);
  });
});

describe("projection — it refuses more often than it guesses", () => {
  it("refuses a channel with no agreed dangerous direction", () => {
    // Glucose is dangerous in BOTH directions, so "the worse of two values" has
    // no meaning without a clinical judgement nobody has made.
    const outcome = projectChannel("glucoseMmolL", series([6, 5.5, 5, 4.5]), NOW, CONFIG);
    expect(outcome.projected).toBe(false);
    if (outcome.projected) return;
    expect(outcome.refusal).toBe("channel_not_projectable");
  });

  it("refuses without enough measured history", () => {
    const outcome = projectChannel("hrBpm", series([120, 140]), NOW, CONFIG);
    expect(outcome.projected).toBe(false);
    if (outcome.projected) return;
    expect(outcome.refusal).toBe("insufficient_history");
  });

  it("expires back to worst case once the horizon passes", () => {
    // Dark for longer than projection_max_horizon_sec.
    const outcome = projectChannel(
      "hrBpm",
      series([120, 130, 140, 150], 30, 400),
      NOW,
      CONFIG,
    );
    expect(outcome.projected).toBe(false);
    if (outcome.projected) return;
    expect(outcome.refusal).toBe("horizon_exceeded");
    expect(outcome.note).toMatch(/worst case/i);
  });

  it("refuses to turn disagreeing readings into a trend", () => {
    const outcome = projectChannel(
      "hrBpm",
      series([120, 165, 122, 168, 124, 170]),
      NOW,
      CONFIG,
    );
    if (outcome.projected) {
      // If it did project, it must at least not have invented a move.
      expect(outcome.projection.value).toBe(outcome.projection.lastMeasured);
    } else {
      expect(outcome.refusal).toBe("slope_inconsistent");
    }
  });

  it("ignores readings older than the history window", () => {
    const stale = [{ atMs: NOW - 3_600_000, value: 200 }];
    const recent = series([120, 121, 122]);
    const outcome = projectChannel("hrBpm", [...stale, ...recent], NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.samples).toBe(3);
  });
});

describe("projection — it never claims to be a measurement", () => {
  it("says so, in words a commander would read", () => {
    const outcome = projectChannel("hrBpm", series([120, 130, 140, 150]), NOW, CONFIG);
    expect(outcome.projected).toBe(true);
    if (!outcome.projected) return;
    expect(outcome.projection.note).toMatch(/an estimate, not a measurement/i);
    // and it shows its working rather than asserting a number
    expect(outcome.projection.note).toMatch(/last measured/i);
    expect(outcome.projection.samples).toBeGreaterThanOrEqual(3);
  });

  it("is deterministic", () => {
    const h = series([120, 130, 140, 150]);
    expect(projectChannel("hrBpm", h, NOW, CONFIG)).toEqual(
      projectChannel("hrBpm", h, NOW, CONFIG),
    );
  });

  it("uses only that firefighter's own readings — the signature admits nothing else", () => {
    // Enforced by the type, not by discipline: there is no environment,
    // position or crew parameter to pass, so an ambient-derived estimate is
    // not expressible. This test exists so that removing that property breaks
    // a named test rather than passing silently.
    expect(projectChannel.length).toBe(4); // channel, history, nowMs, config
  });
});
