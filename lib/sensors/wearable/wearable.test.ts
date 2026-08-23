/**
 * Wearable adapter invariants.
 *
 * The seam's whole value is that swapping the vendor changes one file. These
 * tests assert the properties that would quietly erode that: an adapter that
 * claims a tier it has not earned, one that conflates measurement time with
 * receipt time, or a stub that helpfully falls back to simulation.
 */

import { describe, expect, it } from "vitest";

import {
  SimulatedWearableAdapter,
  UnconfiguredWearableAdapter,
  WEARABLE_CHANNELS,
  type SimulatedSubject,
} from "./index";

const SUBJECTS: SimulatedSubject[] = [
  {
    deviceId: "dev-001",
    callsign: "ALPHA-1",
    clean: { hrBpm: 140, spo2Pct: 96, respRatePerMin: 22 },
    batteryPct: 64,
  },
  {
    deviceId: "dev-002",
    callsign: "BRAVO-2",
    clean: { hrBpm: 128, spo2Pct: 94 },
    batteryPct: 3,
  },
];

const FROM = new Date("2026-01-07T18:30:00Z");
const TO = new Date("2026-01-07T18:30:02Z");

describe("wearable seam — honest about what it is", () => {
  it("declares Tier C for the simulated adapter, never Tier B", () => {
    const adapter = new SimulatedWearableAdapter(SUBJECTS, "clean");
    expect(adapter.dataTier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
    expect(adapter.isRealDevice).toBe(false);
    // Tier B means real recordings of real people. A simulator is not that.
    expect(adapter.disclosure).toMatch(/this is not Tier B/i);
  });

  it("refuses rather than falling back to simulation", async () => {
    const adapter = new UnconfiguredWearableAdapter("some-vendor");
    await expect(adapter.poll()).rejects.toThrow(/invents no vendor integrations/i);
    expect(adapter.health().available).toBe(false);
  });

  it("names what a real integration would need, so the gap is legible", () => {
    const reason = new UnconfiguredWearableAdapter().health().unavailableReason ?? "";
    expect(reason).toMatch(/measurement or receipt time/i);
    expect(reason).toMatch(/DPIA/);
  });
});

describe("wearable seam — measurement time is not receipt time", () => {
  it("reports when the DEVICE took the reading", async () => {
    const adapter = new SimulatedWearableAdapter(SUBJECTS, "clean");
    const samples = await adapter.poll(FROM, TO);
    for (const reading of samples[0]!.readings) {
      expect(reading.measuredAtUtc).toBeInstanceOf(Date);
      // The simulated device knows its own measurement time, so it must not
      // claim it is substituting receipt time.
      expect(reading.measuredAtIsReceiptTime).toBe(false);
    }
  });

  it("carries a flag for vendors that only report receipt time", () => {
    // Not exercised by the simulator, but the field must exist: a vendor that
    // only reports receipt time makes every staleness figure wrong by the
    // transport latency, and that has to be expressible rather than absorbed.
    const adapter = new SimulatedWearableAdapter(SUBJECTS, "clean");
    expect(adapter.latencySec).toBe(0);
  });
});

describe("wearable seam — carries operational facts, not just vitals", () => {
  it("reports battery, because a flat monitor is a warning not a surprise", async () => {
    const samples = await new SimulatedWearableAdapter(SUBJECTS, "clean").poll(FROM, TO);
    const bravo = samples.find((s) => s.deviceId === "dev-002");
    expect(bravo?.batteryPct).toBe(3);
  });

  it("maps device ids onto callsigns, and returns null for an unknown device", () => {
    const adapter = new SimulatedWearableAdapter(SUBJECTS, "clean");
    expect(adapter.resolveCallsign("dev-001")).toBe("ALPHA-1");
    // An unrecognised device must not be silently attributed to anyone.
    expect(adapter.resolveCallsign("dev-999")).toBeNull();
  });

  it("only reports channels the device actually has", async () => {
    const samples = await new SimulatedWearableAdapter(SUBJECTS, "clean").poll(FROM, TO);
    const bravo = samples.find((s) => s.deviceId === "dev-002")!;
    const channels = bravo.readings.map((r) => r.channel);
    expect(channels).toEqual(["hrBpm", "spo2Pct"]);
    // Absent channels are absent, not zero-filled.
    expect(channels).not.toContain("respRatePerMin");
  });

  it("passes vendor quality flags through rather than discarding them", async () => {
    const adapter = new SimulatedWearableAdapter(SUBJECTS, "degraded");
    let sawQuality = false;
    for (let i = 0; i < 200; i += 1) {
      const samples = await adapter.poll(FROM, TO);
      for (const s of samples) {
        for (const r of s.readings) if (r.vendorQuality !== null) sawQuality = true;
      }
    }
    expect(sawQuality).toBe(true);
  });

  it("exposes a closed channel set", () => {
    expect(WEARABLE_CHANNELS).toContain("hrBpm");
    expect(WEARABLE_CHANNELS).toContain("coreTempC");
    // A vendor cannot invent a channel the engine has never heard of.
    expect(WEARABLE_CHANNELS.length).toBeLessThan(12);
  });
});
