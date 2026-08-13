import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { AbbottLibreAdapter } from "./abbott-libre-adapter";
import { dbParam, DIABETES_PARAM_NAMES } from "./config";
import { DEFAULT_DIABETES_CONFIG } from "./default-config";
import {
  DexcomSandboxAdapter,
  mgDlToMmolL,
  type DexcomEgvRecord,
} from "./dexcom-sandbox-adapter";
import { createCgmAdapter, listCgmAdapters } from "./index";
import { assessGlucose, latencyBreakdown } from "./lag-correction";
import { stepSimulatedGlucose } from "./simulated-cgm-adapter";
import type { GlucoseReading, GlucoseTrend } from "./types";

const CONFIG = DEFAULT_DIABETES_CONFIG;
const NOW = 1_700_000_000_000;

function reading(over: Partial<GlucoseReading> = {}): GlucoseReading {
  return {
    valueMmolL: 6.2,
    trend: "flat",
    trendRateMmolLPerMin: 0,
    recordedAtMs: NOW - 60_000,
    receivedAtMs: NOW - 60_000,
    latencySec: 0,
    vendor: "simulated",
    dataTier: "C_SYNTHETIC_MODEL_DRIVEN",
    isSandbox: false,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Claims discipline                                                           */
/* -------------------------------------------------------------------------- */

describe("CGM claims discipline", () => {
  const files = [
    "types.ts",
    "dexcom-sandbox-adapter.ts",
    "simulated-cgm-adapter.ts",
    "abbott-libre-adapter.ts",
    "lag-correction.ts",
    "index.ts",
  ];

  it("never asserts real-time capability in code", () => {
    // Prose may discuss real-time access in order to disclaim it; what must
    // never happen is an adapter declaring itself real-time.
    for (const file of files) {
      const source = readFileSync(join(process.cwd(), "lib", "sensors", "cgm", file), "utf8");
      expect(source, file).not.toMatch(/isRealTime\s*[:=]\s*true/);
      expect(source, file).not.toMatch(/isRealTime\s*=\s*true/);
    }
  });

  it("carries the exact honest access statement", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "sensors", "cgm", "types.ts"),
      "utf8",
    );
    expect(source).toContain(
      "Glucose monitoring is developed against the Dexcom sandbox API. Real-time",
    );
    expect(source).toContain("Partner status, which we have not yet obtained");
    // And it names the two forbidden phrasings explicitly, so they are on the
    // record as forbidden rather than merely absent.
    expect(source).toContain('NEVER say "integrated with Dexcom"');
  });

  it("never targets the Dexcom production host", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "sensors", "cgm", "dexcom-sandbox-adapter.ts"),
      "utf8",
    );
    expect(source).toContain("it is an integration with their sandbox");
    // The production host, specifically — sandbox-api.dexcom.com is fine.
    expect(source).not.toMatch(/https:\/\/api\.dexcom\.com/);
    expect(source).toContain("https://sandbox-api.dexcom.com");
  });

  it("every adapter reports isRealTime false", () => {
    for (const entry of listCgmAdapters()) {
      expect(entry.isRealTime).toBe(false);
    }
  });

  it("the Dexcom entry states the access position accurately", () => {
    const dexcom = listCgmAdapters().find((a) => a.key === "dexcom_sandbox");
    expect(dexcom?.accessStatement).toContain("Dexcom sandbox API");
    expect(dexcom?.accessStatement).toContain("have not yet obtained");
  });
});

/* -------------------------------------------------------------------------- */
/* Tier mapping                                                                */
/* -------------------------------------------------------------------------- */

describe("glucose data tiers", () => {
  it("sandbox data is Tier C, never Tier A", () => {
    const adapter = new DexcomSandboxAdapter({ nowMs: () => NOW });
    const record: DexcomEgvRecord = {
      systemTime: new Date(NOW - 300_000).toISOString(),
      value: 110,
      trend: "flat",
      trendRate: 0,
    };
    const r = adapter.toReading(record, NOW);
    expect(r?.dataTier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
    expect(r?.isSandbox).toBe(true);
  });

  it("modelled glucose is Tier C", () => {
    const { reading: r } = stepSimulatedGlucose(
      { previous: null, hrrFraction: 0.5, wearingPpe: true, effectiveTempC: 35, elapsedMin: 10, nowMs: NOW },
      CONFIG,
    );
    expect(r.dataTier).toBe("C_SYNTHETIC_MODEL_DRIVEN");
  });

  it("the tier union excludes Tier A entirely — glucose is not environmental", () => {
    const source = readFileSync(
      join(process.cwd(), "lib", "sensors", "cgm", "types.ts"),
      "utf8",
    );
    expect(source).toContain("B_REAL_WEARABLE_NON_FIREFIGHTER");
    expect(source).toContain("C_SYNTHETIC_MODEL_DRIVEN");
    expect(source).not.toMatch(/GlucoseDataTier[\s\S]{0,400}A_REAL_ENVIRONMENTAL/);
  });
});

/* -------------------------------------------------------------------------- */
/* Units                                                                       */
/* -------------------------------------------------------------------------- */

describe("units", () => {
  it("converts mg/dL to mmol/L", () => {
    expect(mgDlToMmolL(180)).toBeCloseTo(9.99, 1);
    expect(mgDlToMmolL(72)).toBeCloseTo(4.0, 1);
  });

  it("honours a reading already reported in mmol/L", () => {
    const adapter = new DexcomSandboxAdapter({ nowMs: () => NOW });
    const r = adapter.toReading(
      { systemTime: new Date(NOW).toISOString(), value: 6.5, unit: "mmol/L", trend: "flat" },
      NOW,
    );
    expect(r?.valueMmolL).toBeCloseTo(6.5, 3);
  });

  it("every glucose parameter is expressed in mmol/L or seconds, never mg/dL", () => {
    for (const p of Object.values(CONFIG.parameters)) {
      expect(p.unit).not.toMatch(/mg\/dL/i);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Interstitial lag correction                                                 */
/* -------------------------------------------------------------------------- */

describe("interstitial lag correction", () => {
  it("corrects downward only when glucose is falling", () => {
    const falling = assessGlucose(reading({ valueMmolL: 4.8, trend: "singleDown" }), NOW, CONFIG);
    expect(falling.isFalling).toBe(true);
    expect(falling.correctionAppliedMmolL).toBeGreaterThan(0);
    expect(falling.correctedMmolL).toBeLessThan(falling.reportedMmolL);

    const stable = assessGlucose(reading({ valueMmolL: 4.8, trend: "flat" }), NOW, CONFIG);
    expect(stable.correctionAppliedMmolL).toBe(0);
    expect(stable.correctedMmolL).toBe(stable.reportedMmolL);
    expect(stable.caveats.join(" ")).toContain("manufacture hypoglycaemia");
  });

  it("applies the larger correction in the danger band", () => {
    const caution = assessGlucose(reading({ valueMmolL: 4.8, trend: "singleDown" }), NOW, CONFIG);
    const danger = assessGlucose(reading({ valueMmolL: 3.8, trend: "singleDown" }), NOW, CONFIG);
    expect(caution.correctionBand).toBe("caution");
    expect(danger.correctionBand).toBe("danger");
    expect(danger.correctionAppliedMmolL).toBeGreaterThan(caution.correctionAppliedMmolL);
    expect(caution.correctionAppliedMmolL).toBe(
      dbParam(CONFIG, "lag_correction_caution_mmol_l"),
    );
    expect(danger.correctionAppliedMmolL).toBe(
      dbParam(CONFIG, "lag_correction_danger_mmol_l"),
    );
  });

  it("applies no correction to a high reading even when falling", () => {
    const r = assessGlucose(reading({ valueMmolL: 9, trend: "doubleDown" }), NOW, CONFIG);
    expect(r.correctionBand).toBe("none");
    expect(r.correctionAppliedMmolL).toBe(0);
  });

  it("always says the correction is illustrative", () => {
    expect(assessGlucose(reading(), NOW, CONFIG).caveats.join(" ")).toContain(
      "ILLUSTRATIVE and invented",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Latency                                                                     */
/* -------------------------------------------------------------------------- */

describe("total latency", () => {
  it("includes the physiological lag even at zero API latency", () => {
    const l = latencyBreakdown(reading({ recordedAtMs: NOW }), NOW, CONFIG);
    expect(l.apiLatencySec).toBe(0);
    expect(l.physiologicalLagSec).toBe(dbParam(CONFIG, "interstitial_lag_max_sec"));
    expect(l.totalLatencySec).toBeGreaterThan(0);
  });

  it("summarises in plain English for a commander", () => {
    const l = latencyBreakdown(reading({ recordedAtMs: NOW - 120_000 }), NOW, CONFIG);
    expect(l.summary).toContain("behind blood glucose");
    expect(l.summary).toContain("physiological lag");
  });

  it("a sandbox reading is usable; a Dexcom-standard UK reading is not", () => {
    // Sandbox: fresh sample, only the physiological lag.
    const sandbox = assessGlucose(reading({ recordedAtMs: NOW - 60_000 }), NOW, CONFIG);
    expect(sandbox.usableMmolL).not.toBeNull();
    expect(sandbox.latency.exceedsUsableLimit).toBe(false);

    // Dexcom standard outside the US: three hours behind.
    const ukStandard = assessGlucose(
      reading({ recordedAtMs: NOW - 180 * 60_000, latencySec: 10800 }),
      NOW,
      CONFIG,
    );
    expect(ukStandard.usableMmolL).toBeNull();
    expect(ukStandard.latency.exceedsUsableLimit).toBe(true);
    expect(ukStandard.unusableReason).toContain("does not contribute");
    expect(ukStandard.unusableReason).toContain("UNKNOWN");
  });

  it("reports the value even when unusable, so the age is visible", () => {
    const stale = assessGlucose(
      reading({ valueMmolL: 5.5, recordedAtMs: NOW - 200 * 60_000 }),
      NOW,
      CONFIG,
    );
    expect(stale.reportedMmolL).toBe(5.5);
    expect(stale.usableMmolL).toBeNull();
    expect(stale.latency.totalLatencySec).toBeGreaterThan(10000);
  });
});

/* -------------------------------------------------------------------------- */
/* Adapters                                                                    */
/* -------------------------------------------------------------------------- */

describe("adapters", () => {
  it("the Dexcom adapter is unavailable until connected, and says how", () => {
    const adapter = new DexcomSandboxAdapter({ nowMs: () => NOW });
    const health = adapter.health();
    expect(health.available).toBe(false);
    expect(health.unavailableReason).toContain("developer.dexcom.com");
    expect(health.unavailableReason).toContain("no real-time access");
  });

  it("the Dexcom adapter refuses an expired token", async () => {
    const adapter = new DexcomSandboxAdapter({ nowMs: () => NOW });
    await adapter.connect({ accessToken: "sandbox-token", expiresAtMs: NOW - 1 });
    expect(adapter.health().available).toBe(false);
    await expect(adapter.getReadings(new Date(NOW - 1000), new Date(NOW))).rejects.toThrow(
      /expired/,
    );
  });

  it("the Dexcom adapter uses the sandbox host and no other", async () => {
    let called = "";
    const adapter = new DexcomSandboxAdapter({
      nowMs: () => NOW,
      fetchImpl: (async (url: string) => {
        called = String(url);
        return {
          ok: true,
          json: async () => ({ records: [] }),
        } as unknown as Response;
      }) as unknown as typeof fetch,
    });
    await adapter.connect({ accessToken: "sandbox-token", expiresAtMs: NOW + 60_000 });
    await adapter.getReadings(new Date(NOW - 3_600_000), new Date(NOW));
    expect(called).toContain("https://sandbox-api.dexcom.com");
    expect(called).not.toContain("//api.dexcom.com");
  });

  it("the Abbott adapter refuses everything and says why", async () => {
    const adapter = new AbbottLibreAdapter();
    expect(adapter.health().available).toBe(false);
    expect(adapter.health().unavailableReason).toContain("Not implemented");
    await expect(adapter.connect({ accessToken: "x", expiresAtMs: NOW })).rejects.toThrow();
    await expect(adapter.getReadings(new Date(), new Date())).rejects.toThrow();
  });

  it("the registry exposes all three with honest availability", () => {
    const all = listCgmAdapters();
    expect(all.map((a) => a.key).sort()).toEqual([
      "abbott_libre",
      "dexcom_sandbox",
      "simulated",
    ]);
    expect(all.find((a) => a.key === "simulated")?.available).toBe(true);
    expect(all.find((a) => a.key === "abbott_libre")?.available).toBe(false);
    for (const key of ["dexcom_sandbox", "simulated", "abbott_libre"] as const) {
      expect(createCgmAdapter(key)).toBeDefined();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Simulated glucose                                                           */
/* -------------------------------------------------------------------------- */

describe("simulated glucose", () => {
  const step = (over: Partial<Parameters<typeof stepSimulatedGlucose>[0]> = {}) =>
    stepSimulatedGlucose(
      {
        previous: { glucoseMmolL: 7, lastUpdatedMs: NOW - 600_000 },
        hrrFraction: 0.5,
        wearingPpe: true,
        effectiveTempC: 35,
        elapsedMin: 10,
        nowMs: NOW,
        ...over,
      },
      CONFIG,
    );

  it("is deterministic", () => {
    expect(step()).toEqual(step());
  });

  it("consumes faster under load", () => {
    const light = step({ hrrFraction: 0.1 });
    const heavy = step({ hrrFraction: 0.95 });
    expect(heavy.state.glucoseMmolL).toBeLessThan(light.state.glucoseMmolL);
  });

  it("consumes faster in PPE and in heat", () => {
    expect(step({ wearingPpe: true }).state.glucoseMmolL).toBeLessThan(
      step({ wearingPpe: false }).state.glucoseMmolL,
    );
    expect(step({ effectiveTempC: 50 }).state.glucoseMmolL).toBeLessThan(
      step({ effectiveTempC: 20 }).state.glucoseMmolL,
    );
  });

  it("assumes maximum consumption when heart rate is unavailable", () => {
    expect(step({ hrrFraction: null }).state.glucoseMmolL).toBeLessThanOrEqual(
      step({ hrrFraction: 0.5 }).state.glucoseMmolL,
    );
  });

  it("reports a falling trend when it is falling", () => {
    const r = step({ hrrFraction: 1, elapsedMin: 30, effectiveTempC: 50 });
    expect(["fortyFiveDown", "singleDown", "doubleDown", "flat"]).toContain(r.reading.trend);
  });

  it("stays in a physiological range for any input", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 25, noNaN: true }),
        fc.option(fc.double({ min: 0, max: 1, noNaN: true }), { nil: null }),
        fc.double({ min: 0, max: 600, noNaN: true }),
        (start, hrr, mins) => {
          const r = stepSimulatedGlucose(
            {
              previous: { glucoseMmolL: start, lastUpdatedMs: NOW },
              hrrFraction: hrr,
              wearingPpe: true,
              effectiveTempC: 40,
              elapsedMin: mins,
              nowMs: NOW,
            },
            CONFIG,
          );
          expect(r.state.glucoseMmolL).toBeGreaterThanOrEqual(1);
          expect(r.state.glucoseMmolL).toBeLessThanOrEqual(30);
        },
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Configuration and boundary                                                  */
/* -------------------------------------------------------------------------- */

describe("diabetes configuration", () => {
  it("is entirely illustrative and unreviewed", () => {
    expect(Object.keys(CONFIG.parameters)).toHaveLength(DIABETES_PARAM_NAMES.length);
    for (const p of Object.values(CONFIG.parameters)) {
      expect(p.sourceStatus).toBe("illustrative");
      expect(p.clinicalReviewStatus).toBe("unreviewed");
      expect(p.citation).toBeUndefined();
    }
  });

  it("names the hypoglycaemia override as invented and unsourced", () => {
    expect(CONFIG.parameters["glucose_hypo_override_mmol_l"].rationale).toContain(
      "INVENTED",
    );
  });
});

describe("CGM module boundary", () => {
  it("is pure of framework and database imports", () => {
    for (const file of ["types.ts", "config.ts", "lag-correction.ts", "simulated-cgm-adapter.ts", "abbott-libre-adapter.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "sensors", "cgm", file), "utf8");
      expect(source).not.toMatch(/@prisma\/client/);
      expect(source).not.toMatch(/from\s+["']next/);
    }
  });

  it("the risk engine does not import the CGM module", () => {
    for (const file of ["engine.ts", "config.ts", "types.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "risk", file), "utf8");
      expect(source).not.toMatch(/(import|from)\s+["'][^"']*cgm/i);
    }
  });

  it("only the Dexcom adapter performs network access, and only to the sandbox", () => {
    for (const file of ["lag-correction.ts", "simulated-cgm-adapter.ts", "abbott-libre-adapter.ts", "config.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "sensors", "cgm", file), "utf8");
      expect(source).not.toMatch(/fetch\(/);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

describe("glucose assessment properties", () => {
  const arbTrend: fc.Arbitrary<GlucoseTrend> = fc.constantFrom(
    "doubleUp", "singleUp", "fortyFiveUp", "flat",
    "fortyFiveDown", "singleDown", "doubleDown", "notComputable",
  );

  it("correction never raises the reported value", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 25, noNaN: true }),
        arbTrend,
        (valueMmolL, trend) => {
          const r = assessGlucose(reading({ valueMmolL, trend }), NOW, CONFIG);
          expect(r.correctedMmolL).toBeLessThanOrEqual(r.reportedMmolL + 1e-9);
          expect(r.correctedMmolL).toBeGreaterThanOrEqual(0);
        },
      ),
    );
  });

  it("a longer-latency reading is never more usable than a fresher one", () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 300, noNaN: true }),
        (aMin, bMin) => {
          const fresher = Math.min(aMin, bMin);
          const older = Math.max(aMin, bMin);
          const a = assessGlucose(reading({ recordedAtMs: NOW - fresher * 60_000 }), NOW, CONFIG);
          const b = assessGlucose(reading({ recordedAtMs: NOW - older * 60_000 }), NOW, CONFIG);
          expect(b.latency.totalLatencySec).toBeGreaterThanOrEqual(a.latency.totalLatencySec);
          if (a.usableMmolL === null) expect(b.usableMmolL).toBeNull();
        },
      ),
    );
  });
});
