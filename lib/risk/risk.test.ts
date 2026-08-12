import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { BAND_SEVERITY, CONFIDENCE_RANK } from "./bands";
import { loadRiskConfig } from "./config";
import { DEFAULT_RISK_CONFIG } from "./default-config";
import { assessRisk } from "./engine";
import type { Environment, HealthProfile, Position, Vitals } from "./types";

const CONFIG = DEFAULT_RISK_CONFIG;
const NOW_MS = 1_700_000_000_000;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ALPHA_1: HealthProfile = {
  id: "ff-alpha-1",
  callsign: "ALPHA-1",
  age: 28,
  fitness: "high",
  restingHrBpm: 52,
  spo2BaselinePct: 98,
  conditions: [],
  respiratoryRisk: "none",
  heatTolerance: "high",
  prevShiftHours: 0,
  cumulativeCoExposureIndex: 0,
  cumulativeHeatExposureIndex: 0,
};

const BRAVO_2: HealthProfile = {
  id: "ff-bravo-2",
  callsign: "BRAVO-2",
  age: 52,
  fitness: "moderate",
  restingHrBpm: 68,
  spo2BaselinePct: 95,
  conditions: ["moderate asthma"],
  respiratoryRisk: "moderate",
  heatTolerance: "low",
  prevShiftHours: 6,
  cumulativeCoExposureIndex: 0.35,
  cumulativeHeatExposureIndex: 0.25,
};

function freshVitals(over: Partial<Vitals> = {}): Vitals {
  const lastUpdatedMs: Record<string, number> = {
    hrBpm: NOW_MS - 2_000,
    spo2Pct: NOW_MS - 2_000,
    coreTempC: NOW_MS - 2_000,
    respRatePerMin: NOW_MS - 2_000,
    fatiguePct: NOW_MS - 2_000,
    hydrationPct: NOW_MS - 2_000,
  };
  return {
    hrBpm: 118,
    spo2Pct: 95,
    coreTempC: 37.6,
    respRatePerMin: 20,
    fatiguePct: 30,
    hydrationPct: 80,
    fallDetected: false,
    lastUpdatedMs,
    ...over,
  };
}

function benignEnvironment(over: Partial<Environment> = {}): Environment {
  const lastUpdatedMs: Record<string, number> = {
    ambientTempC: NOW_MS - 3_000,
    humidityPct: NOW_MS - 3_000,
    coPpm: NOW_MS - 3_000,
    pm25UgM3: NOW_MS - 3_000,
    windSpeedMs: NOW_MS - 3_000,
    windDirDeg: NOW_MS - 3_000,
  };
  return {
    ambientTempC: 24,
    humidityPct: 40,
    coPpm: 5,
    pm25UgM3: 12,
    windSpeedMs: 3,
    windDirDeg: 210,
    lastUpdatedMs,
    ...over,
  };
}

function freshPositionTimestamps(ageMs = 4_000): Record<string, number> {
  return {
    positionFix: NOW_MS - ageMs,
    distanceToFireFrontM: NOW_MS - ageMs,
    distanceToSafeZoneM: NOW_MS - ageMs,
    escapeRouteStatus: NOW_MS - ageMs,
    scbaPressurePct: NOW_MS - ageMs,
  };
}

function benignPosition(over: Partial<Position> = {}): Position {
  return {
    lat: 37.35,
    lng: -122.05,
    distanceToFireFrontM: 900,
    distanceToSafeZoneM: 150,
    escapeRouteStatus: "clear",
    scbaPressurePct: 88,
    scbaOnAir: true,
    timeOnTaskMin: 6,
    lastUpdatedMs: freshPositionTimestamps(),
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Arbitraries                                                                 */
/* -------------------------------------------------------------------------- */

const arbAgeSec = fc.integer({ min: 0, max: 400 });

function arbTimestamps(channels: readonly string[]) {
  return fc
    .array(fc.option(arbAgeSec, { nil: undefined }), {
      minLength: channels.length,
      maxLength: channels.length,
    })
    .map((ages) => {
      const map: Record<string, number> = {};
      channels.forEach((channel, i) => {
        const age = ages[i];
        if (age !== undefined) map[channel] = NOW_MS - age * 1000;
      });
      return map;
    });
}

const arbProfile: fc.Arbitrary<HealthProfile> = fc.record({
  id: fc.constantFrom("ff-a", "ff-b", "ff-c"),
  callsign: fc.constantFrom("ALPHA-1", "BRAVO-2", "CHARLIE-1"),
  age: fc.integer({ min: 18, max: 64 }),
  fitness: fc.constantFrom("low", "moderate", "high"),
  restingHrBpm: fc.integer({ min: 40, max: 95 }),
  spo2BaselinePct: fc.integer({ min: 90, max: 100 }),
  conditions: fc.array(
    fc.constantFrom("asthma", "hypertension", "type 1 diabetes", "prior heat injury"),
    { maxLength: 4 },
  ),
  respiratoryRisk: fc.constantFrom("none", "mild", "moderate", "high"),
  heatTolerance: fc.constantFrom("low", "avg", "high"),
  prevShiftHours: fc.integer({ min: 0, max: 18 }),
  cumulativeCoExposureIndex: fc.double({ min: 0, max: 1, noNaN: true }),
  cumulativeHeatExposureIndex: fc.double({ min: 0, max: 1, noNaN: true }),
});

const arbVitals: fc.Arbitrary<Vitals> = fc.record({
  hrBpm: fc.option(fc.integer({ min: 40, max: 220 }), { nil: null }),
  spo2Pct: fc.option(fc.integer({ min: 70, max: 100 }), { nil: null }),
  coreTempC: fc.option(fc.double({ min: 35, max: 42, noNaN: true }), { nil: null }),
  respRatePerMin: fc.option(fc.integer({ min: 8, max: 60 }), { nil: null }),
  fatiguePct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  hydrationPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  fallDetected: fc.boolean(),
  lastUpdatedMs: arbTimestamps([
    "hrBpm",
    "spo2Pct",
    "coreTempC",
    "respRatePerMin",
    "fatiguePct",
    "hydrationPct",
  ]),
});

const arbEnvironment: fc.Arbitrary<Environment> = fc.record({
  ambientTempC: fc.option(fc.double({ min: -10, max: 120, noNaN: true }), { nil: null }),
  humidityPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  coPpm: fc.option(fc.double({ min: 0, max: 1500, noNaN: true }), { nil: null }),
  pm25UgM3: fc.option(fc.double({ min: 0, max: 1000, noNaN: true }), { nil: null }),
  windSpeedMs: fc.option(fc.double({ min: 0, max: 40, noNaN: true }), { nil: null }),
  windDirDeg: fc.option(fc.integer({ min: 0, max: 359 }), { nil: null }),
  lastUpdatedMs: arbTimestamps([
    "ambientTempC",
    "humidityPct",
    "coPpm",
    "pm25UgM3",
    "windSpeedMs",
    "windDirDeg",
  ]),
});

const arbPosition: fc.Arbitrary<Position> = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lng: fc.double({ min: -180, max: 180, noNaN: true }),
  distanceToFireFrontM: fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), {
    nil: null,
  }),
  distanceToSafeZoneM: fc.option(fc.double({ min: 0, max: 5000, noNaN: true }), {
    nil: null,
  }),
  escapeRouteStatus: fc.constantFrom("clear", "degraded", "blocked"),
  scbaPressurePct: fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
  scbaOnAir: fc.boolean(),
  timeOnTaskMin: fc.double({ min: 0, max: 240, noNaN: true }),
  manualMaydayActive: fc.boolean(),
  lastUpdatedMs: arbTimestamps([
    "positionFix",
    "distanceToFireFrontM",
    "distanceToSafeZoneM",
    "escapeRouteStatus",
    "scbaPressurePct",
  ]),
});

const arbScenario = fc.tuple(arbProfile, arbVitals, arbEnvironment, arbPosition);

/* -------------------------------------------------------------------------- */
/* Property tests                                                              */
/* -------------------------------------------------------------------------- */

describe("assessRisk — invariants", () => {
  it("always produces a score within 0-100", () => {
    fc.assert(
      fc.property(arbScenario, ([profile, vitals, env, pos]) => {
        const r = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        expect(Number.isFinite(r.score)).toBe(true);
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(100);
      }),
    );
  });

  it("always produces CRITICAL when a hard override fires", () => {
    fc.assert(
      fc.property(arbScenario, ([profile, vitals, env, pos]) => {
        const r = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        if (r.hardOverride) {
          expect(r.band).toBe("CRITICAL");
          expect(r.hardOverrideReasons.length).toBeGreaterThan(0);
        }
      }),
    );
  });

  it("yields CRITICAL for a forced override regardless of everything else", () => {
    fc.assert(
      fc.property(arbScenario, ([profile, vitals, env, pos]) => {
        const r = assessRisk(
          profile,
          { ...vitals, fallDetected: true },
          env,
          pos,
          CONFIG,
          NOW_MS,
        );
        expect(r.band).toBe("CRITICAL");
        expect(r.hardOverride).toBe(true);
        expect(r.hardOverrideReasons).toContain("Fall detected");
      }),
    );
  });

  it("never reports SAFE at low confidence", () => {
    fc.assert(
      fc.property(arbScenario, ([profile, vitals, env, pos]) => {
        const r = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        if (r.dataQuality.confidence === "low") {
          expect(r.band).not.toBe("SAFE");
        }
      }),
    );
  });

  it("is deterministic — identical input and version give deep-equal output", () => {
    fc.assert(
      fc.property(arbScenario, ([profile, vitals, env, pos]) => {
        const a = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        const b = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        expect(a).toEqual(b);
        expect(a.configHash).toBe(CONFIG.configHash);
        expect(a.modelVersion).toBe(CONFIG.modelVersion);
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Monotonicity under data loss                                                */
/* -------------------------------------------------------------------------- */

const REMOVABLE_VITALS = [
  "hrBpm",
  "spo2Pct",
  "coreTempC",
  "respRatePerMin",
  "fatiguePct",
  "hydrationPct",
] as const;

const REMOVABLE_ENV = [
  "ambientTempC",
  "humidityPct",
  "coPpm",
  "pm25UgM3",
  "windSpeedMs",
  "windDirDeg",
] as const;

const REMOVABLE_POSITION = [
  "distanceToFireFrontM",
  "distanceToSafeZoneM",
  "scbaPressurePct",
] as const;

const arbRemovable = fc.constantFrom(
  ...REMOVABLE_VITALS.map((k) => `vitals.${k}`),
  ...REMOVABLE_ENV.map((k) => `env.${k}`),
  ...REMOVABLE_POSITION.map((k) => `pos.${k}`),
);

function withInputRemoved(
  path: string,
  vitals: Vitals,
  env: Environment,
  pos: Position,
): [Vitals, Environment, Position] {
  const [group, key] = path.split(".") as [string, string];
  if (group === "vitals") {
    const lastUpdatedMs = { ...vitals.lastUpdatedMs };
    delete lastUpdatedMs[key];
    return [{ ...vitals, [key]: null, lastUpdatedMs }, env, pos];
  }
  if (group === "env") {
    const lastUpdatedMs = { ...env.lastUpdatedMs };
    delete lastUpdatedMs[key];
    return [vitals, { ...env, [key]: null, lastUpdatedMs }, pos];
  }
  const lastUpdatedMs = { ...(pos.lastUpdatedMs ?? {}) };
  delete lastUpdatedMs[key];
  return [vitals, env, { ...pos, [key]: null, lastUpdatedMs }];
}

describe("assessRisk — removing an input is never rewarded", () => {
  it("never lowers the score, never improves confidence, never turns non-SAFE into SAFE", () => {
    fc.assert(
      fc.property(arbScenario, arbRemovable, ([profile, vitals, env, pos], path) => {
        const before = assessRisk(profile, vitals, env, pos, CONFIG, NOW_MS);
        const [v2, e2, p2] = withInputRemoved(path, vitals, env, pos);
        const after = assessRisk(profile, v2, e2, p2, CONFIG, NOW_MS);

        expect(after.score).toBeGreaterThanOrEqual(before.score - 1e-9);
        expect(CONFIDENCE_RANK[after.dataQuality.confidence]).toBeLessThanOrEqual(
          CONFIDENCE_RANK[before.dataQuality.confidence],
        );
        if (before.band !== "SAFE") {
          expect(after.band).not.toBe("SAFE");
        }
        // The band can only fall if the removed input was the evidence for a
        // hard override — see docs/KNOWN_LIMITATIONS.md.
        if (!before.hardOverride || after.hardOverride) {
          expect(BAND_SEVERITY[after.band]).toBeGreaterThanOrEqual(
            BAND_SEVERITY[before.band],
          );
        }
      }),
    );
  });

  it("documents the one exception: losing the vital that triggered an override", () => {
    const vitals = freshVitals({ coreTempC: 40.2 });
    const critical = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );
    expect(critical.band).toBe("CRITICAL");
    expect(critical.hardOverride).toBe(true);

    const [v2] = withInputRemoved("vitals.coreTempC", vitals, benignEnvironment(), benignPosition());
    const after = assessRisk(
      ALPHA_1,
      v2,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );
    expect(after.hardOverride).toBe(false);
    expect(after.band).not.toBe("SAFE");
    expect(after.dataQuality.confidence).toBe("low");
    expect(after.dataQuality.missingInputs).toContain("coreTempC");
  });
});

/* -------------------------------------------------------------------------- */
/* Personalisation                                                             */
/* -------------------------------------------------------------------------- */

describe("assessRisk — personalisation", () => {
  it("gives two profiles materially different scores for identical inputs", () => {
    const vitals = freshVitals();
    const env = benignEnvironment({ ambientTempC: 34, coPpm: 30, pm25UgM3: 60 });
    const pos = benignPosition({ distanceToFireFrontM: 300, timeOnTaskMin: 25 });

    const young = assessRisk(ALPHA_1, vitals, env, pos, CONFIG, NOW_MS);
    const older = assessRisk(BRAVO_2, vitals, env, pos, CONFIG, NOW_MS);

    expect(young.score).not.toBe(older.score);
    expect(older.score).toBeGreaterThan(young.score);
    expect(BAND_SEVERITY[older.band]).toBeGreaterThanOrEqual(BAND_SEVERITY[young.band]);
  });

  it("applies an age-adjusted maximum heart rate", () => {
    const vitals = freshVitals({ hrBpm: 170 });
    const env = benignEnvironment();
    const pos = benignPosition();

    const young = assessRisk(ALPHA_1, vitals, env, pos, CONFIG, NOW_MS);
    const older = assessRisk(BRAVO_2, vitals, env, pos, CONFIG, NOW_MS);

    // 170 bpm is 89% of max for a 28-year-old but 101% for a 52-year-old.
    expect(young.hardOverride).toBe(false);
    expect(older.hardOverride).toBe(true);
    expect(older.hardOverrideReasons.join(" ")).toContain("age-adjusted max");
  });

  it("fires the SpO2 override earlier for a firefighter with respiratory risk", () => {
    const vitals = freshVitals({
      spo2Pct: 89,
      recentSpo2Pct: [89, 89, 89],
    });
    const env = benignEnvironment();
    const pos = benignPosition();

    const young = assessRisk(ALPHA_1, vitals, env, pos, CONFIG, NOW_MS);
    const asthmatic = assessRisk(BRAVO_2, vitals, env, pos, CONFIG, NOW_MS);

    expect(young.hardOverride).toBe(false); // threshold 88%
    expect(asthmatic.hardOverride).toBe(true); // threshold 90%
  });

  it("requires consecutive confirming readings for the SpO2 override", () => {
    const env = benignEnvironment();
    const pos = benignPosition();

    const oneOff = assessRisk(
      ALPHA_1,
      freshVitals({ spo2Pct: 85, recentSpo2Pct: [97, 96, 85] }),
      env,
      pos,
      CONFIG,
      NOW_MS,
    );
    expect(oneOff.hardOverride).toBe(false);

    const sustained = assessRisk(
      ALPHA_1,
      freshVitals({ spo2Pct: 85, recentSpo2Pct: [86, 85, 85] }),
      env,
      pos,
      CONFIG,
      NOW_MS,
    );
    expect(sustained.hardOverride).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Missing data                                                                */
/* -------------------------------------------------------------------------- */

describe("assessRisk — missing data is never safe", () => {
  it("returns UNKNOWN when heart rate is missing", () => {
    const vitals = freshVitals({ hrBpm: null });
    delete vitals.lastUpdatedMs["hrBpm"];

    const r = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );

    expect(r.band).toBe("UNKNOWN");
    expect(r.dataQuality.confidence).toBe("low");
    expect(r.dataQuality.missingInputs).toContain("hrBpm");
    expect(r.explanation).toContain("UNKNOWN");
  });

  it("returns UNKNOWN when a reading is older than the missing threshold", () => {
    const vitals = freshVitals();
    vitals.lastUpdatedMs["spo2Pct"] = NOW_MS - 130_000;

    const r = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );

    expect(r.dataQuality.missingInputs).toContain("spo2Pct");
    expect(r.band).toBe("UNKNOWN");
  });

  it("marks a reading between the stale and missing thresholds as stale, not missing", () => {
    const vitals = freshVitals();
    vitals.lastUpdatedMs["fatiguePct"] = NOW_MS - 90_000;

    const r = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );

    expect(r.dataQuality.staleInputs).toContain("fatiguePct");
    expect(r.dataQuality.missingInputs).not.toContain("fatiguePct");
  });

  it("drops confidence one step once two or more inputs are stale", () => {
    const vitals = freshVitals();
    vitals.lastUpdatedMs["fatiguePct"] = NOW_MS - 90_000;
    vitals.lastUpdatedMs["hydrationPct"] = NOW_MS - 90_000;

    const r = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );

    expect(r.dataQuality.staleInputs.length).toBeGreaterThanOrEqual(2);
    expect(r.dataQuality.confidence).toBe("medium");
  });

  it("still yields CRITICAL for a fall when SpO2 is missing", () => {
    const vitals = freshVitals({ fallDetected: true, spo2Pct: null });
    delete vitals.lastUpdatedMs["spo2Pct"];

    const r = assessRisk(
      ALPHA_1,
      vitals,
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );

    expect(r.band).toBe("CRITICAL");
    expect(r.hardOverride).toBe(true);
    expect(r.hardOverrideReasons).toContain("Fall detected");
    expect(r.dataQuality.confidence).toBe("low");
  });
});

/* -------------------------------------------------------------------------- */
/* Position freshness                                                          */
/* -------------------------------------------------------------------------- */

describe("assessRisk — position and equipment freshness", () => {
  it("treats a frozen SCBA feed as unusable rather than as a confident reading", () => {
    const fresh = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );
    expect(fresh.dataQuality.missingInputs).not.toContain("scbaPressurePct");
    expect(fresh.hardOverride).toBe(false);

    // Same plausible 88% reading, but last refreshed 5 minutes ago.
    const frozen = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          scbaPressurePct: NOW_MS - 300_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(frozen.dataQuality.missingInputs).toContain("scbaPressurePct");
    expect(frozen.score).toBeGreaterThan(fresh.score);
    // Unknown remaining air is itself the dangerous condition.
    expect(frozen.hardOverride).toBe(true);
    expect(frozen.hardOverrideReasons.join(" ")).toContain("too old to trust");
  });

  it("marks a position channel stale between the two thresholds", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          scbaPressurePct: NOW_MS - 90_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.dataQuality.staleInputs).toContain("scbaPressurePct");
    expect(r.dataQuality.missingInputs).not.toContain("scbaPressurePct");
    expect(r.hardOverride).toBe(false);
  });

  it("discards distances measured from a position fix that is too old", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          positionFix: NOW_MS - 300_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.dataQuality.missingInputs).toContain("positionFix");
    // The distances were fresh, but the fix they came from was not.
    expect(r.dataQuality.missingInputs).toContain("distanceToFireFrontM");
    expect(r.dataQuality.missingInputs).toContain("distanceToSafeZoneM");
    expect(r.topDrivers.join(" ")).toContain("Position fix too old to trust");
  });

  it("downgrades fix-derived distances to stale when the fix is stale", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          positionFix: NOW_MS - 90_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.dataQuality.staleInputs).toContain("positionFix");
    expect(r.dataQuality.staleInputs).toContain("distanceToFireFrontM");
    expect(r.dataQuality.missingInputs).not.toContain("distanceToFireFrontM");
  });

  it("scores an unavailable escape route assessment at worst case", () => {
    const withRoute = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition(),
      CONFIG,
      NOW_MS,
    );
    const withoutRoute = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          escapeRouteStatus: NOW_MS - 300_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(withoutRoute.dataQuality.missingInputs).toContain("escapeRouteStatus");
    expect(withoutRoute.subscores.proximity).toBeGreaterThan(
      withRoute.subscores.proximity,
    );
    // Absence must not manufacture a "blocked" determination.
    expect(withoutRoute.hardOverride).toBe(false);
  });

  it("still honours a blocked route whose assessment has gone stale", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        escapeRouteStatus: "blocked",
        distanceToFireFrontM: 80,
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          escapeRouteStatus: NOW_MS - 90_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.hardOverride).toBe(true);
    expect(r.band).toBe("CRITICAL");
  });

  it("treats an entirely absent freshness map as unsafe, not as fresh", () => {
    const noTimestamps: Position = {
      lat: 37.35,
      lng: -122.05,
      distanceToFireFrontM: 900,
      distanceToSafeZoneM: 150,
      escapeRouteStatus: "clear",
      scbaPressurePct: 88,
      scbaOnAir: true,
      timeOnTaskMin: 6,
    };
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      noTimestamps,
      CONFIG,
      NOW_MS,
    );
    for (const channel of [
      "positionFix",
      "distanceToFireFrontM",
      "distanceToSafeZoneM",
      "escapeRouteStatus",
      "scbaPressurePct",
    ]) {
      expect(r.dataQuality.missingInputs).toContain(channel);
    }
    expect(r.band).not.toBe("SAFE");
    expect(r.dataQuality.confidence).not.toBe("high");
  });

  it("counts position channels toward the stale-input confidence rule", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: {
          ...freshPositionTimestamps(),
          scbaPressurePct: NOW_MS - 90_000,
          distanceToSafeZoneM: NOW_MS - 90_000,
        },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.dataQuality.staleInputs.length).toBeGreaterThanOrEqual(2);
    expect(r.dataQuality.confidence).toBe("medium");
  });

  it("includes position ages in the oldest-reading figure", () => {
    const r = assessRisk(
      ALPHA_1,
      freshVitals(),
      benignEnvironment(),
      benignPosition({
        lastUpdatedMs: { ...freshPositionTimestamps(), positionFix: NOW_MS - 45_000 },
      }),
      CONFIG,
      NOW_MS,
    );
    expect(r.dataQuality.oldestReadingAgeSec).toBe(45);
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

describe("risk configuration", () => {
  it("ships every parameter as illustrative and unreviewed", () => {
    for (const p of Object.values(CONFIG.parameters)) {
      expect(p.sourceStatus).toBe("illustrative");
      expect(p.clinicalReviewStatus).toBe("unreviewed");
      expect(p.rationale.trim().length).toBeGreaterThan(0);
      expect(p.unit.trim().length).toBeGreaterThan(0);
    }
  });

  it("produces a stable config hash and changes it when a value changes", () => {
    const again = loadRiskConfig(
      JSON.parse(JSON.stringify({ modelVersion: CONFIG.modelVersion, parameters: rawParameters() })),
    );
    expect(again.configHash).toBe(CONFIG.configHash);

    const mutated = rawParameters();
    const target = mutated["override_spo2_critical_pct"];
    if (target) target.value = 89;
    const changed = loadRiskConfig({
      modelVersion: CONFIG.modelVersion,
      parameters: mutated,
    });
    expect(changed.configHash).not.toBe(CONFIG.configHash);
  });

  it("rejects an unknown parameter name", () => {
    const params = rawParameters();
    params["not_a_real_threshold"] = {
      value: 1,
      unit: "x",
      sourceStatus: "illustrative",
      clinicalReviewStatus: "unreviewed",
      rationale: "nonsense",
      min: 0,
      max: 2,
      editable: true,
    };
    expect(() => loadRiskConfig({ modelVersion: "x", parameters: params })).toThrow(
      /unknown parameter/,
    );
  });

  it("rejects a value outside its declared bounds", () => {
    const params = rawParameters();
    const target = params["override_spo2_critical_pct"];
    if (target) target.value = 5;
    expect(() => loadRiskConfig({ modelVersion: "x", parameters: params })).toThrow(
      /outside/,
    );
  });
});

type RawParameter = {
  value: number;
  unit: string;
  sourceStatus: string;
  clinicalReviewStatus: string;
  rationale: string;
  min: number;
  max: number;
  editable: boolean;
};

function rawParameters(): Record<string, RawParameter> {
  const out: Record<string, RawParameter> = {};
  for (const [name, p] of Object.entries(CONFIG.parameters)) {
    out[name] = {
      value: p.value,
      unit: p.unit,
      sourceStatus: p.sourceStatus,
      clinicalReviewStatus: p.clinicalReviewStatus,
      rationale: p.rationale,
      min: p.min,
      max: p.max,
      editable: p.editable,
    };
  }
  return out;
}
