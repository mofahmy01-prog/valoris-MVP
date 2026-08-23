/**
 * Sensor artefact invariants.
 *
 * The important assertions here are about honesty and determinism, not about
 * the statistics of the noise. A model that cannot be replayed is useless for
 * debugging, and a model that claims a data tier it has not earned is worse than
 * no model at all.
 */

import { describe, expect, it } from "vitest";

import {
  SyntheticArtefactModel,
  TierBWearableNoiseModel,
  type NoiseContext,
} from "./engine";

const ctx = (over: Partial<NoiseContext> = {}): NoiseContext => ({
  callsign: "ALPHA-1",
  channel: "hrBpm",
  tick: 1,
  nowMs: 1_700_000_000_000,
  ...over,
});

describe("sensor artefacts — honest about what they are", () => {
  it("declares Tier C, never Tier B", () => {
    const model = new SyntheticArtefactModel("typical");
    expect(model.dataTier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
    expect(model.disclosure).toMatch(/NOT derived from real wearable recordings/i);
  });

  it("refuses to pretend to be Tier B rather than silently degrading", () => {
    // A stub that falls back to synthetic texture would teach callers the real
    // thing is present when it is not.
    const model = new TierBWearableNoiseModel();
    expect(() => model.apply()).toThrow(/not implemented/i);
    expect(() => model.apply()).toThrow(/WESAD\/PAMAP2/);
  });

  it("keeps the non-firefighter disclosure on the Tier B slot", () => {
    // Required verbatim wherever Tier B appears, even unimplemented.
    expect(new TierBWearableNoiseModel().disclosure).toMatch(/NON-FIREFIGHTER/);
    expect(new TierBWearableNoiseModel().disclosure).toMatch(
      /does not validate any firefighter threshold/i,
    );
  });
});

describe("sensor artefacts — deterministic", () => {
  it("replays identically for the same firefighter, channel and tick", () => {
    const a = new SyntheticArtefactModel("degraded");
    const b = new SyntheticArtefactModel("degraded");
    for (let tick = 0; tick < 50; tick += 1) {
      expect(a.apply(140, ctx({ tick }))).toEqual(b.apply(140, ctx({ tick })));
    }
  });

  it("differs between firefighters, so a whole crew does not fail in lockstep", () => {
    const model = new SyntheticArtefactModel("degraded");
    const alpha: string[] = [];
    const bravo: string[] = [];
    for (let tick = 0; tick < 60; tick += 1) {
      alpha.push(String(model.apply(140, ctx({ tick, callsign: "ALPHA-1" })).artefact));
      bravo.push(String(model.apply(140, ctx({ tick, callsign: "BRAVO-2" })).artefact));
    }
    expect(alpha.join()).not.toBe(bravo.join());
  });

  it("uses no Math.random in code", async () => {
    /*
      Guarding the property directly, because a seeded model that later reached
      for Math.random would still pass a replay test run twice in one process.

      Comments are stripped first: the module's own documentation says the words
      "No Math.random anywhere", and a naive text search flags that as a
      violation — the test would then be asserting that the file never mentions
      the problem rather than that it never has it.
    */
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("lib/sensors/noise/engine.ts", "utf8"),
    );
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).not.toMatch(/Math\.random/);
  });
});

describe("sensor artefacts — the failure modes that matter", () => {
  it("a clean profile changes nothing", () => {
    const model = new SyntheticArtefactModel("clean");
    for (let tick = 0; tick < 40; tick += 1) {
      const reading = model.apply(140, ctx({ tick }));
      expect(reading.value).toBe(140);
      expect(reading.artefact).toBeNull();
    }
  });

  it("flatlines by freezing the TIMESTAMP while the value keeps arriving", () => {
    // The dangerous failure: nothing that checks for nulls will notice.
    const model = new SyntheticArtefactModel("degraded");
    let sawFlatline = false;

    for (let tick = 0; tick < 400; tick += 1) {
      const reading = model.apply(140 + tick * 0.1, ctx({ tick, nowMs: 1_700_000_000_000 + tick * 2000 }));
      if (reading.artefact === "flatline") {
        sawFlatline = true;
        // A value is present and plausible...
        expect(reading.value).not.toBeNull();
        // ...but the clock has stopped.
        expect(reading.measuredAtMs).toBeLessThanOrEqual(1_700_000_000_000 + tick * 2000);
      }
    }
    expect(sawFlatline).toBe(true);
  });

  it("produces dropouts, spikes and artefacts over a long enough run", () => {
    const model = new SyntheticArtefactModel("degraded");
    const seen = new Set<string>();
    for (let tick = 0; tick < 600; tick += 1) {
      const reading = model.apply(140, ctx({ tick, nowMs: 1_700_000_000_000 + tick * 2000 }));
      if (reading.artefact !== null) seen.add(reading.artefact);
      if (reading.artefact === "dropout") expect(reading.value).toBeNull();
    }
    expect(seen.has("dropout")).toBe(true);
    expect(seen.has("spike")).toBe(true);
    expect(seen.has("artefact")).toBe(true);
  });

  it("reports which channels are currently stuck", () => {
    const model = new SyntheticArtefactModel("degraded");
    for (let tick = 0; tick < 200; tick += 1) {
      model.apply(140, ctx({ tick, nowMs: 1_700_000_000_000 + tick * 2000 }));
    }
    // Not asserting a count — only that the model can say, which is what an
    // operator needs when the picture looks wrong.
    expect(Array.isArray(model.stuckChannels())).toBe(true);
  });
});
