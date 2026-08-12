import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_PHYSIOLOGY_CONFIG } from "@/lib/physiology/default-config";
import { physParam } from "@/lib/physiology/config";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import type {
  Environment,
  HealthProfile,
  Position,
  Vitals,
} from "@/lib/risk/types";

import {
  derivePhysiology,
  EMPTY_CARRY_OVER,
  toPhysiologySubject,
  type PhysiologyCarryOver,
  type RawReadings,
  type ReadingTimestamps,
} from "./physiology-pipeline";

const PHYS = DEFAULT_PHYSIOLOGY_CONFIG;
const RISK = DEFAULT_RISK_CONFIG;
const NOW_MS = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/* The six seeded profiles                                                     */
/* -------------------------------------------------------------------------- */

const PROFILES: HealthProfile[] = [
  { id: "ff-1", callsign: "ALPHA-1", age: 28, fitness: "high", restingHrBpm: 50, spo2BaselinePct: 98, conditions: [], respiratoryRisk: "none", heatTolerance: "high", prevShiftHours: 0, cumulativeCoExposureIndex: 0.05, cumulativeHeatExposureIndex: 0.05 },
  { id: "ff-2", callsign: "ALPHA-2", age: 41, fitness: "moderate", restingHrBpm: 62, spo2BaselinePct: 97, conditions: ["mild hypertension"], respiratoryRisk: "none", heatTolerance: "avg", prevShiftHours: 4, cumulativeCoExposureIndex: 0.15, cumulativeHeatExposureIndex: 0.2 },
  { id: "ff-3", callsign: "BRAVO-1", age: 34, fitness: "high", restingHrBpm: 55, spo2BaselinePct: 98, conditions: ["type 1 diabetes"], respiratoryRisk: "none", heatTolerance: "avg", prevShiftHours: 2, cumulativeCoExposureIndex: 0.1, cumulativeHeatExposureIndex: 0.1 },
  { id: "ff-4", callsign: "BRAVO-2", age: 52, fitness: "moderate", restingHrBpm: 70, spo2BaselinePct: 95, conditions: ["moderate asthma"], respiratoryRisk: "moderate", heatTolerance: "low", prevShiftHours: 6, cumulativeCoExposureIndex: 0.35, cumulativeHeatExposureIndex: 0.3 },
  { id: "ff-5", callsign: "CHARLIE-1", age: 45, fitness: "low", restingHrBpm: 78, spo2BaselinePct: 96, conditions: [], respiratoryRisk: "none", heatTolerance: "low", prevShiftHours: 11, cumulativeCoExposureIndex: 0.4, cumulativeHeatExposureIndex: 0.45 },
  { id: "ff-6", callsign: "CHARLIE-2", age: 38, fitness: "moderate", restingHrBpm: 64, spo2BaselinePct: 96, conditions: ["mild reactive airway"], respiratoryRisk: "mild", heatTolerance: "avg", prevShiftHours: 3, cumulativeCoExposureIndex: 0.2, cumulativeHeatExposureIndex: 0.2 },
];

function readings(over: Partial<RawReadings> = {}): RawReadings {
  return {
    hrBpm: 148,
    spo2Pct: 93,
    reportedCoreTempC: null,
    reportedFatiguePct: null,
    ambientTempC: 38,
    humidityPct: 55,
    meanRadiantTempC: null,
    airVelocityMs: 7,
    coPpm: 60,
    pm25UgM3: 140,
    wearingPpe: true,
    scbaOnAir: true,
    ...over,
  };
}

const FRESH_TIMESTAMPS: ReadingTimestamps = {
  hrBpm: NOW_MS - 2_000,
  ambientTempC: NOW_MS - 3_000,
  humidityPct: NOW_MS - 3_000,
  coPpm: NOW_MS - 3_000,
  pm25UgM3: NOW_MS - 3_000,
};

function carryOver(over: Partial<PhysiologyCarryOver> = {}): PhysiologyCarryOver {
  return {
    coreTempC: 37.2,
    coreTempVarianceC2: 0.01,
    fatiguePct: 30,
    cohbPct: 2,
    pm25DoseUgMinM3: 500,
    worstCoPpm: 60,
    worstPm25UgM3: 140,
    previousObservedAtMs: NOW_MS - 5 * 60_000,
    ...over,
  } as PhysiologyCarryOver;
}

function derive(
  profile: HealthProfile,
  over: Partial<RawReadings> = {},
  carry: PhysiologyCarryOver = carryOver(),
  timestamps = FRESH_TIMESTAMPS,
) {
  return derivePhysiology({
    profile,
    readings: readings(over),
    timestamps,
    carryOver: carry,
    observedAtMs: NOW_MS,
    config: PHYS,
  });
}

/* -------------------------------------------------------------------------- */
/* Composition                                                                 */
/* -------------------------------------------------------------------------- */

describe("physiology pipeline — composition", () => {
  it("produces core temperature and fatigue rather than passing them through", () => {
    const d = derive(PROFILES[0] as HealthProfile, {
      reportedCoreTempC: 41.9,
      reportedFatiguePct: 99,
    });
    // The wearable's numbers are recorded elsewhere; they must not become the
    // model's output.
    expect(d.coreTempC).not.toBe(41.9);
    expect(d.fatiguePct).not.toBe(99);
    expect(d.caveats.join(" ")).toContain("model output is authoritative");
  });

  it("maps a HealthProfile onto a physiology Subject conservatively", () => {
    const subject = toPhysiologySubject(PROFILES[3] as HealthProfile);
    expect(subject.ageYears).toBe(52);
    expect(subject.restingHrBpm).toBe(70);
    expect(subject.heatTolerance).toBe("low");
    // Not captured on the profile — defaults must be the safe direction.
    expect(subject.heatAcclimatised).toBe(false);
    expect(subject.bodyMassKg).toBeNull();
  });

  it("is deterministic", () => {
    const a = derive(PROFILES[3] as HealthProfile);
    const b = derive(PROFILES[3] as HealthProfile);
    expect(a).toEqual(b);
  });

  it("carries model version and config hash through", () => {
    const d = derive(PROFILES[0] as HealthProfile);
    expect(d.modelVersion).toBe(PHYS.modelVersion);
    expect(d.configHash).toBe(PHYS.configHash);
  });

  it("accumulates rather than restarting each tick", () => {
    const first = derive(PROFILES[4] as HealthProfile, {}, {
      ...carryOver(),
      coreTempC: 37.2,
      fatiguePct: 30,
      pm25DoseUgMinM3: 0,
      cohbPct: null,
    });
    const second = derive(PROFILES[4] as HealthProfile, {}, {
      ...carryOver(),
      coreTempC: first.coreTempC,
      fatiguePct: first.fatiguePct,
      pm25DoseUgMinM3: first.pm25DoseUgMinM3,
      cohbPct: first.cohbPct,
    });
    expect(second.coreTempC).toBeGreaterThan(first.coreTempC);
    expect(second.fatiguePct).toBeGreaterThan(first.fatiguePct);
    expect(second.pm25DoseUgMinM3).toBeGreaterThan(first.pm25DoseUgMinM3);
    expect(second.cohbPct).toBeGreaterThan(first.cohbPct);
  });

  it("starts from the filter's configured initial state on the first observation", () => {
    const d = derive(PROFILES[0] as HealthProfile, {}, EMPTY_CARRY_OVER);
    expect(d.stepMinutes).toBe(0);
    expect(d.coreTempC).toBeCloseTo(physParam(PHYS, "kalman_initial_core_temp_c"), 2);
  });

  it("carries the filter variance between ticks, not just the estimate", () => {
    // With an observation the variance converges to a steady state, so it
    // legitimately forgets where it started. The carry matters during a DROPOUT,
    // when variance only grows: accumulated uncertainty must survive the tick
    // boundary rather than silently resetting.
    const noHr = { hrBpm: null };
    const timestamps = { ...FRESH_TIMESTAMPS, hrBpm: undefined };

    const carriedUncertainty = derive(
      PROFILES[0] as HealthProfile,
      noHr,
      { ...carryOver(), coreTempVarianceC2: 0.09 },
      timestamps,
    );
    const freshFilter = derive(
      PROFILES[0] as HealthProfile,
      noHr,
      { ...carryOver(), coreTempVarianceC2: null },
      timestamps,
    );

    expect(carriedUncertainty.coreTempVarianceC2).toBeGreaterThan(
      freshFilter.coreTempVarianceC2,
    );
    expect(carriedUncertainty.coreTempSdC).toBeGreaterThan(freshFilter.coreTempSdC);
    // And accumulated uncertainty widens the bound handed downstream.
    expect(
      carriedUncertainty.coreTempUpperBoundC - carriedUncertainty.coreTempC,
    ).toBeGreaterThan(freshFilter.coreTempUpperBoundC - freshFilter.coreTempC);
  });

  it("caps a long gap between observations and says so", () => {
    const d = derive(PROFILES[0] as HealthProfile, {}, {
      ...carryOver(),
      previousObservedAtMs: NOW_MS - 120 * 60_000,
    });
    expect(d.stepCapped).toBe(true);
    expect(d.stepMinutes).toBe(physParam(PHYS, "max_step_minutes"));
    expect(d.caveats.join(" ")).toContain("accumulation across the gap is understated");
  });

  it("de-duplicates caveats from the five models", () => {
    const d = derive(PROFILES[0] as HealthProfile);
    expect(d.caveats.length).toBeGreaterThan(0);
    expect(new Set(d.caveats).size).toBe(d.caveats.length);
  });
});

/* -------------------------------------------------------------------------- */
/* Freshness of derived channels                                               */
/* -------------------------------------------------------------------------- */

describe("physiology pipeline — derived freshness", () => {
  it("ages a derived value at its oldest contributing input", () => {
    const d = derive(PROFILES[0] as HealthProfile, {}, carryOver(), {
      ...FRESH_TIMESTAMPS,
      ambientTempC: NOW_MS - 45_000,
    });
    // Core temperature used heart rate (2 s) and ambient (45 s): 45 s wins.
    expect(d.coreTempUpdatedAtMs).toBe(NOW_MS - 45_000);
    // Fatigue does not use ambient, so it keeps the heart rate age.
    expect(d.fatigueUpdatedAtMs).toBe(NOW_MS - 2_000);
  });

  it("hands over unaged values when heart rate cannot be aged", () => {
    const d = derive(PROFILES[0] as HealthProfile, { hrBpm: null }, carryOver(), {
      ...FRESH_TIMESTAMPS,
      hrBpm: undefined,
    });
    expect(d.coreTempUpdatedAtMs).toBeUndefined();
    expect(d.fatigueUpdatedAtMs).toBeUndefined();
    expect(d.caveats.join(" ")).toContain("treated as missing");
  });

  it("is pessimistic, not optimistic, when heart rate is absent", () => {
    const withHr = derive(PROFILES[0] as HealthProfile, { hrBpm: 100 });
    const withoutHr = derive(PROFILES[0] as HealthProfile, { hrBpm: null }, carryOver(), {
      ...FRESH_TIMESTAMPS,
      hrBpm: undefined,
    });

    expect(withoutHr.metabolicRateWm2).toBeGreaterThan(withHr.metabolicRateWm2);
    expect(withoutHr.cohbPct).toBeGreaterThan(withHr.cohbPct);
    expect(withoutHr.fatiguePct).toBeGreaterThan(withHr.fatiguePct);

    // The Kalman filter does NOT inflate the point estimate on a dropout — it
    // holds it and grows the variance instead. The pessimism therefore lives in
    // the uncertainty and in the upper bound handed downstream, not in the
    // reported value.
    expect(withoutHr.coreTempObservationApplied).toBe(false);
    expect(withoutHr.coreTempSdC).toBeGreaterThan(withHr.coreTempSdC);
    expect(withoutHr.coreTempUpperBoundC).toBeGreaterThan(withoutHr.coreTempC);
    // And the derived channel is handed over unaged, so the risk engine scores
    // core temperature at worst case rather than trusting a modelled number.
    expect(withoutHr.coreTempUpdatedAtMs).toBeUndefined();
  });

  it("hands downstream models an upper bound, never a comfortable point estimate", () => {
    const certain = derive(PROFILES[0] as HealthProfile, {}, {
      ...carryOver(),
      coreTempVarianceC2: 0,
    });
    const uncertain = derive(PROFILES[0] as HealthProfile, { hrBpm: null }, {
      ...carryOver(),
      coreTempVarianceC2: 0.2,
    });
    expect(uncertain.coreTempUpperBoundC - uncertain.coreTempC).toBeGreaterThan(
      certain.coreTempUpperBoundC - certain.coreTempC,
    );
    expect(uncertain.caveats.join(" ")).toContain("upper confidence bound");
  });

  it("propagates unaged derived values into an UNKNOWN band, not a confident one", () => {
    const profile = PROFILES[0] as HealthProfile;
    const quietEnv: Environment = {
      ambientTempC: 21,
      humidityPct: 40,
      coPpm: 3,
      pm25UgM3: 10,
      windSpeedMs: 2,
      windDirDeg: 180,
      lastUpdatedMs: {
        ambientTempC: NOW_MS - 3_000,
        humidityPct: NOW_MS - 3_000,
        coPpm: NOW_MS - 3_000,
        pm25UgM3: NOW_MS - 3_000,
        windSpeedMs: NOW_MS - 3_000,
        windDirDeg: NOW_MS - 3_000,
      },
    };
    const quietPos: Position = {
      lat: 37.35,
      lng: -122.05,
      distanceToFireFrontM: 1200,
      distanceToSafeZoneM: 60,
      escapeRouteStatus: "clear",
      scbaPressurePct: 92,
      scbaOnAir: true,
      timeOnTaskMin: 4,
      lastUpdatedMs: {
        positionFix: NOW_MS - 4_000,
        distanceToFireFrontM: NOW_MS - 4_000,
        distanceToSafeZoneM: NOW_MS - 4_000,
        escapeRouteStatus: NOW_MS - 4_000,
        scbaPressurePct: NOW_MS - 4_000,
      },
    };

    const d = derivePhysiology({
      profile,
      readings: readings({
        hrBpm: null,
        ambientTempC: 21,
        humidityPct: 40,
        coPpm: 3,
        pm25UgM3: 10,
      }),
      timestamps: { ...FRESH_TIMESTAMPS, hrBpm: undefined },
      carryOver: carryOver(),
      observedAtMs: NOW_MS,
      config: PHYS,
    });

    const lastUpdatedMs: Record<string, number> = {
      spo2Pct: NOW_MS - 2_000,
      respRatePerMin: NOW_MS - 2_000,
      hydrationPct: NOW_MS - 2_000,
    };
    if (d.coreTempUpdatedAtMs !== undefined) {
      lastUpdatedMs["coreTempC"] = d.coreTempUpdatedAtMs;
    }
    if (d.fatigueUpdatedAtMs !== undefined) {
      lastUpdatedMs["fatiguePct"] = d.fatigueUpdatedAtMs;
    }

    const vitals: Vitals = {
      hrBpm: null,
      spo2Pct: 98,
      coreTempC: d.coreTempC,
      respRatePerMin: 16,
      fatiguePct: d.fatiguePct,
      hydrationPct: 90,
      fallDetected: false,
      lastUpdatedMs,
    };

    const assessment = assessRisk(profile, vitals, quietEnv, quietPos, RISK, NOW_MS);
    expect(assessment.band).toBe("UNKNOWN");
    expect(assessment.dataQuality.confidence).toBe("low");
    expect(assessment.dataQuality.missingInputs).toContain("hrBpm");
    expect(assessment.dataQuality.missingInputs).toContain("coreTempC");
    expect(assessment.band).not.toBe("SAFE");
  });
});

/* -------------------------------------------------------------------------- */
/* Personalisation survives the pipeline                                       */
/* -------------------------------------------------------------------------- */

describe("physiology pipeline — personalisation", () => {
  const IDENTICAL_ENV: Environment = {
    ambientTempC: 38,
    humidityPct: 55,
    coPpm: 60,
    pm25UgM3: 140,
    windSpeedMs: 7,
    windDirDeg: 240,
    lastUpdatedMs: {
      ambientTempC: NOW_MS - 3_000,
      humidityPct: NOW_MS - 3_000,
      coPpm: NOW_MS - 3_000,
      pm25UgM3: NOW_MS - 3_000,
      windSpeedMs: NOW_MS - 3_000,
      windDirDeg: NOW_MS - 3_000,
    },
  };

  const IDENTICAL_POS: Position = {
    lat: 37.351,
    lng: -122.052,
    distanceToFireFrontM: 240,
    distanceToSafeZoneM: 180,
    escapeRouteStatus: "clear",
    scbaPressurePct: 52,
    scbaOnAir: true,
    timeOnTaskMin: 28,
    lastUpdatedMs: {
      positionFix: NOW_MS - 4_000,
      distanceToFireFrontM: NOW_MS - 4_000,
      distanceToSafeZoneM: NOW_MS - 4_000,
      escapeRouteStatus: NOW_MS - 4_000,
      scbaPressurePct: NOW_MS - 4_000,
    },
  };

  /** Full pipeline: identical raw readings in, six scores out. */
  function scoreThroughPipeline(profile: HealthProfile): {
    score: number;
    band: string;
    coreTempC: number;
    fatiguePct: number;
  } {
    const d = derive(profile);
    const vitals: Vitals = {
      hrBpm: 148,
      spo2Pct: 93,
      coreTempC: d.coreTempC,
      respRatePerMin: 26,
      fatiguePct: d.fatiguePct,
      hydrationPct: 68,
      fallDetected: false,
      lastUpdatedMs: {
        hrBpm: NOW_MS - 2_000,
        spo2Pct: NOW_MS - 2_000,
        coreTempC: d.coreTempUpdatedAtMs as number,
        respRatePerMin: NOW_MS - 2_000,
        fatiguePct: d.fatigueUpdatedAtMs as number,
        hydrationPct: NOW_MS - 2_000,
      },
      recentSpo2Pct: [94, 93, 93],
    };
    const r = assessRisk(profile, vitals, IDENTICAL_ENV, IDENTICAL_POS, RISK, NOW_MS);
    return {
      score: r.score,
      band: r.band,
      coreTempC: d.coreTempC,
      fatiguePct: d.fatiguePct,
    };
  }

  it("still produces six distinct scores from identical raw readings", () => {
    const results = PROFILES.map((p) => ({
      callsign: p.callsign,
      ...scoreThroughPipeline(p),
    }));
    const scores = results.map((r) => r.score);
    expect(new Set(scores).size).toBe(6);
  });

  it("produces distinct modelled fatigue per profile", () => {
    const results = PROFILES.map((p) => scoreThroughPipeline(p));
    expect(new Set(results.map((r) => r.fatiguePct)).size).toBeGreaterThan(1);
  });

  it("produces IDENTICAL core temperatures per profile — the published model is HR-only", () => {
    // Consequence of switching to the published sequential estimator: it takes
    // heart rate and nothing else, so identical heart rates give identical core
    // temperature estimates regardless of age, fitness or heat tolerance.
    // Personalisation of core temperature now lives entirely in the LIMITS the
    // estimate is compared against, not in the estimate itself.
    // Pinned deliberately: if this ever starts differing, something has folded
    // profile data back into the published model. See docs/KNOWN_LIMITATIONS.md
    // item 25.
    const results = PROFILES.map((p) => scoreThroughPipeline(p));
    expect(new Set(results.map((r) => r.coreTempC)).size).toBe(1);
  });

  it("keeps the older, asthmatic firefighter above the young fit one on score", () => {
    const alpha1 = scoreThroughPipeline(PROFILES[0] as HealthProfile);
    const bravo2 = scoreThroughPipeline(PROFILES[3] as HealthProfile);
    expect(bravo2.score).toBeGreaterThan(alpha1.score);
    // Their core temperature estimates are now equal — see the test above.
    expect(bravo2.coreTempC).toBe(alpha1.coreTempC);
  });

  it("gives a lower-fitness firefighter more fatigue at the same heart rate", () => {
    const high = derive(PROFILES[0] as HealthProfile);
    const low = derive(PROFILES[4] as HealthProfile);
    expect(low.fatiguePct).toBeGreaterThan(high.fatiguePct);
  });

  it("gates toxic uptake on SCBA through the pipeline", () => {
    const onAir = derive(PROFILES[0] as HealthProfile, { scbaOnAir: true });
    const offAir = derive(PROFILES[0] as HealthProfile, { scbaOnAir: false });
    expect(offAir.cohbPct).toBeGreaterThan(onAir.cohbPct);
    expect(offAir.toxicCombinedIndex).toBeGreaterThan(onAir.toxicCombinedIndex);
  });

  it("shows PPE raising heat storage through the pipeline", () => {
    const inGear = derive(PROFILES[0] as HealthProfile, { wearingPpe: true });
    const outOfGear = derive(PROFILES[0] as HealthProfile, { wearingPpe: false });
    expect(inGear.heatStorageWm2).toBeGreaterThan(outOfGear.heatStorageWm2);
  });
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

describe("physiology pipeline — properties", () => {
  const arbProfile: fc.Arbitrary<HealthProfile> = fc.record({
    id: fc.constant("ff-x"),
    callsign: fc.constant("TEST-1"),
    age: fc.integer({ min: 18, max: 64 }),
    fitness: fc.constantFrom("low", "moderate", "high"),
    restingHrBpm: fc.integer({ min: 40, max: 95 }),
    spo2BaselinePct: fc.integer({ min: 90, max: 100 }),
    conditions: fc.array(fc.constantFrom("asthma", "hypertension"), { maxLength: 2 }),
    respiratoryRisk: fc.constantFrom("none", "mild", "moderate", "high"),
    heatTolerance: fc.constantFrom("low", "avg", "high"),
    prevShiftHours: fc.integer({ min: 0, max: 18 }),
    cumulativeCoExposureIndex: fc.double({ min: 0, max: 1, noNaN: true }),
    cumulativeHeatExposureIndex: fc.double({ min: 0, max: 1, noNaN: true }),
  });

  const arbReadings: fc.Arbitrary<RawReadings> = fc.record({
    hrBpm: fc.option(fc.integer({ min: 40, max: 220 }), { nil: null }),
    spo2Pct: fc.option(fc.integer({ min: 70, max: 100 }), { nil: null }),
    reportedCoreTempC: fc.option(fc.double({ min: 35, max: 42, noNaN: true }), { nil: null }),
    reportedFatiguePct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    ambientTempC: fc.option(fc.double({ min: -10, max: 120, noNaN: true }), { nil: null }),
    humidityPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
    meanRadiantTempC: fc.option(fc.double({ min: -10, max: 300, noNaN: true }), { nil: null }),
    airVelocityMs: fc.option(fc.double({ min: 0, max: 30, noNaN: true }), { nil: null }),
    coPpm: fc.option(fc.double({ min: 0, max: 2000, noNaN: true }), { nil: null }),
    pm25UgM3: fc.option(fc.double({ min: 0, max: 1500, noNaN: true }), { nil: null }),
    wearingPpe: fc.boolean(),
    scbaOnAir: fc.boolean(),
  });

  it("always produces values the risk engine can consume", () => {
    fc.assert(
      fc.property(arbProfile, arbReadings, (profile, raw) => {
        const d = derivePhysiology({
          profile,
          readings: raw,
          timestamps: FRESH_TIMESTAMPS,
          carryOver: carryOver(),
          observedAtMs: NOW_MS,
          config: PHYS,
        });
        expect(Number.isFinite(d.coreTempC)).toBe(true);
        expect(d.coreTempC).toBeGreaterThanOrEqual(physParam(PHYS, "core_temp_min_c"));
        expect(d.coreTempC).toBeLessThanOrEqual(physParam(PHYS, "core_temp_max_c"));
        expect(Number.isFinite(d.fatiguePct)).toBe(true);
        expect(d.fatiguePct).toBeGreaterThanOrEqual(physParam(PHYS, "fatigue_min_pct"));
        expect(d.fatiguePct).toBeLessThanOrEqual(physParam(PHYS, "fatigue_max_pct"));
        expect(Number.isFinite(d.cohbPct)).toBe(true);
        expect(d.caveats.length).toBeGreaterThan(0);
      }),
    );
  });

  it("never treats a missing heart rate as rest", () => {
    // The guarantee is about ABSENCE versus REST, not absence versus any
    // reading. A known 190 bpm is genuinely worse news than an unknown heart
    // rate, and the model is allowed to say so — what it must never do is treat
    // "we cannot see this person" as "this person is sitting down".
    fc.assert(
      fc.property(arbProfile, arbReadings, (profile, raw) => {
        const withHr = derivePhysiology({
          profile,
          readings: { ...raw, hrBpm: 55 },
          timestamps: FRESH_TIMESTAMPS,
          carryOver: carryOver(),
          observedAtMs: NOW_MS,
          config: PHYS,
        });
        const withoutHr = derivePhysiology({
          profile,
          readings: { ...raw, hrBpm: null },
          timestamps: { ...FRESH_TIMESTAMPS, hrBpm: undefined },
          carryOver: carryOver(),
          observedAtMs: NOW_MS,
          config: PHYS,
        });
        expect(withoutHr.metabolicRateWm2).toBeGreaterThanOrEqual(
          withHr.metabolicRateWm2,
        );
        expect(withoutHr.fatiguePct).toBeGreaterThanOrEqual(withHr.fatiguePct);
        expect(withoutHr.coreTempUpdatedAtMs).toBeUndefined();
        // Uncertainty must widen, and the bound handed downstream must not be
        // below the point estimate.
        expect(withoutHr.coreTempSdC).toBeGreaterThanOrEqual(withHr.coreTempSdC);
        expect(withoutHr.coreTempUpperBoundC).toBeGreaterThanOrEqual(
          withoutHr.coreTempC,
        );
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Architectural boundary                                                      */
/* -------------------------------------------------------------------------- */

describe("architectural boundary after wiring", () => {
  const read = (...parts: string[]): string =>
    readFileSync(join(process.cwd(), ...parts), "utf8");

  it("lib/risk still imports nothing from lib/physiology", () => {
    // Prose may reference the physiology models — engine.ts documents that the
    // SCBA parameter is shared with them. The rule is that no *import* crosses.
    for (const file of ["engine.ts", "config.ts", "types.ts", "bands.ts", "index.ts", "default-config.ts"]) {
      const source = read("lib", "risk", file);
      expect(source, `lib/risk/${file}`).not.toMatch(
        /(import|from)\s+["'][^"']*physiology/i,
      );
    }
  });

  it("lib/physiology still imports nothing from lib/risk", () => {
    for (const file of ["cardiac.ts", "heat-strain.ts", "core-temp-kalman.ts", "fatigue.ts", "toxic-exposure.ts", "config.ts", "types.ts"]) {
      const source = read("lib", "physiology", file);
      expect(source, `lib/physiology/${file}`).not.toMatch(/from\s+["'].*risk/);
    }
  });

  it("the composition happens above both, in lib/incident", () => {
    const source = read("lib", "incident", "physiology-pipeline.ts");
    expect(source).toMatch(/@\/lib\/physiology/);
    expect(source).toMatch(/@\/lib\/risk\/types/);
  });

  it("neither model module reads the clock or uses randomness", () => {
    for (const dir of ["risk", "physiology"]) {
      for (const file of ["engine.ts", "cardiac.ts", "heat-strain.ts", "core-temp-kalman.ts", "fatigue.ts", "toxic-exposure.ts"]) {
        let source: string;
        try {
          source = read("lib", dir, file);
        } catch {
          continue; // file belongs to the other module
        }
        expect(source, `lib/${dir}/${file}`).not.toMatch(/Date\.now\(\)/);
        expect(source, `lib/${dir}/${file}`).not.toMatch(/Math\.random/);
      }
    }
  });
});
