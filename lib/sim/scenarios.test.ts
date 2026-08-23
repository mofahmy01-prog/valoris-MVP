/**
 * Scenario invariants.
 *
 * A scenario library fails in two ways that matter: a step that silently never
 * fires, and a "baseline" that is not actually a baseline. Both make the
 * scenarios worse than useless, because they look like evidence.
 */

import { describe, expect, it } from "vitest";

import { SCENARIOS, scenarioByKey, stepsDueBetween } from "./scenarios";

describe("scenarios — the five the roadmap asked for", () => {
  it("covers baseline, wind shift, glucose fall, asthmatic in plume and sensor dropout", () => {
    expect(SCENARIOS.map((s) => s.key).sort()).toEqual([
      "asthmatic_in_plume",
      "baseline",
      "glucose_fall",
      "sensor_dropout",
      "wind_shift",
    ]);
  });

  it("says what each one exercises and what to watch for", () => {
    // A scenario whose purpose must be explained verbally is not reproducible
    // in any useful sense.
    for (const s of SCENARIOS) {
      expect(s.synopsis.length, `${s.key} synopsis`).toBeGreaterThan(20);
      expect(s.exercises.length, `${s.key} exercises`).toBeGreaterThan(20);
      expect(s.expect.length, `${s.key} expectations`).toBeGreaterThan(0);
    }
  });

  it("keeps the baseline genuinely uneventful", () => {
    const baseline = scenarioByKey("baseline")!;
    // The control. If it injects anything it is not a control, and the
    // false-alarm reading it produces is meaningless.
    expect(baseline.steps).toEqual([]);
    expect(baseline.noiseProfile).toBe("clean");
    expect(baseline.expect.join(" ")).toMatch(/defect, not a demonstration/i);
  });

  it("runs the dropout scenario on degraded hardware", () => {
    expect(scenarioByKey("sensor_dropout")!.noiseProfile).toBe("degraded");
  });

  it("returns undefined for an unknown key rather than a default", () => {
    expect(scenarioByKey("nope")).toBeUndefined();
  });
});

describe("scenarios — steps fire exactly once, even at high speed", () => {
  it("fires a step when the clock jumps over its minute", () => {
    const windShift = scenarioByKey("wind_shift")!;
    // At 20x the clock moves twenty minutes per tick, so a step at minute 12 is
    // never EQUAL to the clock. Checking a range is what stops it being skipped.
    const due = stepsDueBetween(windShift, 0, 20);
    expect(due).toHaveLength(1);
    expect(due[0]!.action).toBe("wind_shift");
  });

  it("does not fire a step before its time", () => {
    expect(stepsDueBetween(scenarioByKey("wind_shift")!, 0, 5)).toHaveLength(0);
  });

  it("does not fire the same step twice across consecutive windows", () => {
    const s = scenarioByKey("wind_shift")!;
    const first = stepsDueBetween(s, 0, 12);
    const second = stepsDueBetween(s, 12, 30);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);
  });

  it("every step lands inside a plausible incident window", () => {
    for (const s of SCENARIOS) {
      for (const step of s.steps) {
        expect(step.atMinute, `${s.key} step`).toBeGreaterThan(0);
        expect(step.atMinute, `${s.key} step`).toBeLessThan(240);
      }
    }
  });
});
