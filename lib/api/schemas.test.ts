import { describe, expect, it } from "vitest";

import {
  commanderActionSchema,
  observationSchema,
  overrideSchema,
  reasonSchema,
  rejectSchema,
} from "./schemas";

describe("reason validation", () => {
  const emptyish: Array<{ label: string; value: unknown }> = [
    { label: "empty string", value: "" },
    { label: "single space", value: " " },
    { label: "several spaces", value: "   " },
    { label: "tab", value: "\t" },
    { label: "newline", value: "\n" },
    { label: "mixed whitespace", value: " \t\n " },
    { label: "undefined", value: undefined },
    { label: "null", value: null },
    { label: "a number", value: 42 },
  ];

  it.each(emptyish)("rejects a reason of $label", ({ value }) => {
    expect(reasonSchema.safeParse(value).success).toBe(false);
  });

  it("accepts a real reason and trims it", () => {
    const parsed = reasonSchema.safeParse("  crew already rotating  ");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe("crew already rotating");
  });

  it("requires a reason on reject", () => {
    expect(rejectSchema.safeParse({}).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "   " }).success).toBe(false);
    expect(rejectSchema.safeParse({ reason: "relief already en route" }).success).toBe(
      true,
    );
  });

  it("requires a reason on override", () => {
    expect(overrideSchema.safeParse({}).success).toBe(false);
    expect(overrideSchema.safeParse({ reason: "\t\n" }).success).toBe(false);
    expect(
      overrideSchema.safeParse({ reason: "holding position, exit compromised" })
        .success,
    ).toBe(true);
  });

  it("requires a reason for reject and override but not acknowledge or accept", () => {
    expect(
      commanderActionSchema.safeParse({ action: "acknowledge" }).success,
    ).toBe(true);
    expect(commanderActionSchema.safeParse({ action: "accept" }).success).toBe(true);
    expect(commanderActionSchema.safeParse({ action: "reject" }).success).toBe(false);
    expect(
      commanderActionSchema.safeParse({ action: "reject", reason: " " }).success,
    ).toBe(false);
    expect(commanderActionSchema.safeParse({ action: "override" }).success).toBe(
      false,
    );
    expect(
      commanderActionSchema.safeParse({ action: "override", reason: "my call" })
        .success,
    ).toBe(true);
  });

  it("names the offending field so the API can report it", () => {
    const parsed = rejectSchema.safeParse({ reason: "" });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.path).toEqual(["reason"]);
    }
  });
});

describe("observation validation", () => {
  const valid = {
    callsign: "ALPHA-1",
    recordedAtUtc: "2026-08-11T12:00:00.000Z",
    source: "simulated_wearable",
    vitals: {
      hrBpm: { value: 118, updatedAtUtc: "2026-08-11T12:00:00.000Z" },
      spo2Pct: { value: 96, updatedAtUtc: "2026-08-11T12:00:00.000Z" },
      coreTempC: { value: 37.4, updatedAtUtc: "2026-08-11T12:00:00.000Z" },
      fallDetected: false,
    },
    environment: {
      coPpm: { value: 12, updatedAtUtc: "2026-08-11T12:00:00.000Z" },
    },
    position: {
      lat: 37.35,
      lng: -122.05,
      escapeRouteStatus: "clear",
      scbaPressurePct: 88,
      scbaOnAir: true,
      timeOnTaskMin: 6,
    },
  };

  it("accepts a well-formed observation", () => {
    expect(observationSchema.safeParse(valid).success).toBe(true);
  });

  it("accepts an explicit null reading — a dropped sensor is legitimate input", () => {
    const parsed = observationSchema.safeParse({
      ...valid,
      vitals: { ...valid.vitals, hrBpm: { value: null }, fallDetected: false },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.vitals.hrBpm?.value).toBeNull();
  });

  it("rejects an out-of-range latitude", () => {
    expect(
      observationSchema.safeParse({
        ...valid,
        position: { ...valid.position, lat: 120 },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown escape route status", () => {
    expect(
      observationSchema.safeParse({
        ...valid,
        position: { ...valid.position, escapeRouteStatus: "probably fine" },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown source", () => {
    expect(
      observationSchema.safeParse({ ...valid, source: "real_draeger_scba" }).success,
    ).toBe(false);
  });

  it("rejects unrecognised fields rather than silently dropping them", () => {
    expect(
      observationSchema.safeParse({
        ...valid,
        position: { ...valid.position, hoursUntilRescue: 3 },
      }).success,
    ).toBe(false);
  });

  it("rejects a negative time on task", () => {
    expect(
      observationSchema.safeParse({
        ...valid,
        position: { ...valid.position, timeOnTaskMin: -5 },
      }).success,
    ).toBe(false);
  });

  it("defaults scbaOnAir to true and mayday to false", () => {
    const parsed = observationSchema.safeParse({
      ...valid,
      position: {
        lat: 37.35,
        lng: -122.05,
        escapeRouteStatus: "clear",
        timeOnTaskMin: 1,
      },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.position.scbaOnAir).toBe(true);
      expect(parsed.data.position.manualMaydayActive).toBe(false);
    }
  });
});
