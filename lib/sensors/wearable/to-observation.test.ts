/**
 * Translation invariants.
 *
 * An adapter that quietly improves its input is the most dangerous kind. Every
 * test here asserts something the translator must REFUSE to do.
 */

import { describe, expect, it } from "vitest";

import { DROPPED_CHANNELS, toObservation, toObservations } from "./to-observation";
import type { WearableSample } from "./types";

const T = new Date("2026-01-07T18:30:00Z");

function sample(over: Partial<WearableSample> = {}): WearableSample {
  return {
    deviceId: "dev-1",
    batteryPct: 50,
    readings: [
      { channel: "hrBpm", value: 142, measuredAtUtc: T, measuredAtIsReceiptTime: false, vendorQuality: null },
      { channel: "spo2Pct", value: 95, measuredAtUtc: T, measuredAtIsReceiptTime: false, vendorQuality: null },
    ],
    ...over,
  };
}

describe("translation — it translates, it does not improve", () => {
  it("leaves an absent channel absent rather than filling it", () => {
    const out = toObservation(
      sample({
        readings: [
          { channel: "hrBpm", value: null, measuredAtUtc: T, measuredAtIsReceiptTime: false, vendorQuality: null },
        ],
      }),
      "ALPHA-1",
    );
    // The engine's staleness and projection rules handle a gap better than any
    // value invented here.
    expect(out.vitals.hrBpm).toBeUndefined();
    expect(out.absentChannels).toEqual(["hrBpm"]);
  });

  it("carries the DEVICE's measurement time, not the moment of receipt", () => {
    const out = toObservation(sample(), "ALPHA-1");
    expect(out.vitals.hrBpm?.updatedAtUtc).toBe(T.toISOString());
  });

  it("flags when ages are only approximate", () => {
    const out = toObservation(
      sample({
        readings: [
          { channel: "hrBpm", value: 140, measuredAtUtc: T, measuredAtIsReceiptTime: true, vendorQuality: null },
        ],
      }),
      "ALPHA-1",
    );
    // Every staleness figure downstream inherits the transport latency as
    // error. That must travel with the data, not be absorbed in silence.
    expect(out.agesAreApproximate).toBe(true);
  });

  it("does not substitute skin temperature for core temperature", () => {
    const out = toObservation(
      sample({
        readings: [
          { channel: "skinTempC", value: 36.4, measuredAtUtc: T, measuredAtIsReceiptTime: false, vendorQuality: null },
        ],
      }),
      "ALPHA-1",
    );
    // The engine has no threshold for skin temperature. Mapping it onto core
    // would be an unvalidated physiological inference wearing an adapter's
    // clothes.
    expect(out.vitals.coreTempC).toBeUndefined();
    expect(DROPPED_CHANNELS).toContain("skinTempC");
  });
});

describe("translation — never guess who a reading belongs to", () => {
  it("discards a sample whose device maps to nobody", () => {
    const result = toObservations([sample({ deviceId: "unknown-device" })], () => null);
    expect(result.translated).toHaveLength(0);
    // A reading attributed to the wrong firefighter is worse than one
    // discarded, because it looks like knowledge about them.
    expect(result.unmappedDevices).toEqual(["unknown-device"]);
  });

  it("translates the samples it can map", () => {
    const result = toObservations([sample()], (id) => (id === "dev-1" ? "ALPHA-1" : null));
    expect(result.translated).toHaveLength(1);
    expect(result.translated[0]!.callsign).toBe("ALPHA-1");
    expect(result.unmappedDevices).toEqual([]);
  });

  it("carries battery through", () => {
    const out = toObservation(sample({ batteryPct: 4 }), "ALPHA-1");
    expect(out.batteryPct).toBe(4);
  });
});
