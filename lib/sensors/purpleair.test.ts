import { readFileSync } from "node:fs";
import { join } from "node:path";

import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { DEFAULT_PURPLEAIR_CONFIG } from "./default-config";
import {
  loadPurpleAirConfig,
  paParam,
  PURPLEAIR_PARAM_NAMES,
} from "./purpleair-config";
import {
  channelAgreement,
  correctPurpleAir,
  extremeSmokeCorrection,
  usWideCorrection,
  type PurpleAirRaw,
} from "./purpleair-correction";

const CONFIG = DEFAULT_PURPLEAIR_CONFIG;
const NOW = 1_700_000_000_000;

function raw(over: Partial<PurpleAirRaw> = {}): PurpleAirRaw {
  return {
    pm25_cf_1_a: 40,
    pm25_cf_1_b: 41,
    humidityPct: 55,
    temperatureC: 24,
    timestampMs: NOW,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Configuration and honesty                                                   */
/* -------------------------------------------------------------------------- */

describe("PurpleAir configuration", () => {
  it("has every named parameter, bounded, nothing validated", () => {
    expect(Object.keys(CONFIG.parameters)).toHaveLength(
      PURPLEAIR_PARAM_NAMES.length,
    );
    for (const p of Object.values(CONFIG.parameters)) {
      expect(["illustrative", "literature_derived"]).toContain(p.sourceStatus);
      expect(p.clinicalReviewStatus).toBe("unreviewed");
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
    }
  });

  it("every published coefficient carries a citation and says UNVERIFIED", () => {
    const derived = Object.values(CONFIG.parameters).filter(
      (p) => p.sourceStatus === "literature_derived",
    );
    expect(derived.length).toBeGreaterThan(0);
    for (const p of derived) {
      expect(p.citation).toMatch(/ref \[\d+\]/);
      expect(p.rationale).toContain("UNVERIFIED");
    }
  });

  it("rejects a literature claim with no citation", () => {
    const params = JSON.parse(
      readFileSync(join(process.cwd(), "config", "purpleair-default.json"), "utf8"),
    ) as { modelVersion: string; parameters: Record<string, Record<string, unknown>> };
    delete params.parameters["us_wide_slope"]!["citation"];
    expect(() => loadPurpleAirConfig(params)).toThrow(/carries no citation/);
  });

  it("states the residual smoke bias rather than hiding it", () => {
    const corrected = correctPurpleAir(raw(), CONFIG);
    expect(corrected.knownBiasNote).toContain("0.88");
    expect(corrected.knownBiasNote).toContain("underestimate");
    expect(corrected.knownBiasNote).toContain("Raw sensor values are retained");
  });

  it("never claims the coefficients are verified", () => {
    const corrected = correctPurpleAir(raw(), CONFIG);
    expect(corrected.coefficientsVerified).toBe(false);
    expect(corrected.citation).toContain("UNVERIFIED");
  });
});

/* -------------------------------------------------------------------------- */
/* Correction behaviour                                                        */
/* -------------------------------------------------------------------------- */

describe("PurpleAir correction", () => {
  it("corrects downward — raw PurpleAir overreads", () => {
    const corrected = correctPurpleAir(raw({ pm25_cf_1_a: 100, pm25_cf_1_b: 100 }), CONFIG);
    expect(corrected.valueUgM3).not.toBeNull();
    expect(corrected.valueUgM3 as number).toBeLessThan(100);
  });

  it("keeps the raw reading alongside the corrected one, always", () => {
    const corrected = correctPurpleAir(raw({ pm25_cf_1_a: 80, pm25_cf_1_b: 90 }), CONFIG);
    expect(corrected.rawUgM3).toBe(85);
    expect(corrected.valueUgM3).not.toBe(corrected.rawUgM3);
  });

  it("uses the US-wide regime below the transition", () => {
    const corrected = correctPurpleAir(raw({ pm25_cf_1_a: 50, pm25_cf_1_b: 50 }), CONFIG);
    expect(corrected.regime).toBe("us_wide");
    expect(corrected.correctionApplied).toContain("US-wide");
  });

  it("uses the extreme smoke regime above the transition", () => {
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: 600, pm25_cf_1_b: 600 }),
      CONFIG,
    );
    expect(corrected.regime).toBe("extreme_smoke");
    expect(corrected.correctionApplied).toContain("extreme smoke");
  });

  it("blends across the transition band", () => {
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: 350, pm25_cf_1_b: 350 }),
      CONFIG,
    );
    expect(corrected.regime).toBe("transition");
    expect(corrected.correctionApplied).toContain("blended");
  });

  it("has no discontinuity at either regime boundary", () => {
    // A jump at a boundary would make an alert appear or vanish on a 1 ug/m3
    // change in the raw reading.
    const low = paParam(CONFIG, "transition_low_ug_m3");
    const high = paParam(CONFIG, "transition_high_ug_m3");
    const at = (v: number) =>
      correctPurpleAir(raw({ pm25_cf_1_a: v, pm25_cf_1_b: v }), CONFIG)
        .valueUgM3 as number;

    expect(Math.abs(at(low) - at(low + 0.5))).toBeLessThan(1);
    expect(Math.abs(at(high - 0.5) - at(high))).toBeLessThan(1);
  });

  it("responds to humidity", () => {
    const dry = correctPurpleAir(raw({ humidityPct: 20 }), CONFIG).valueUgM3 as number;
    const humid = correctPurpleAir(raw({ humidityPct: 90 }), CONFIG)
      .valueUgM3 as number;
    expect(humid).toBeLessThan(dry);
  });

  it("never returns a negative concentration", () => {
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: 0, pm25_cf_1_b: 0, humidityPct: 100 }),
      CONFIG,
    );
    expect(corrected.valueUgM3 as number).toBeGreaterThanOrEqual(0);
  });

  it("exposes both correction forms for inspection", () => {
    expect(usWideCorrection(100, 50, CONFIG)).toBeLessThan(100);
    expect(extremeSmokeCorrection(600, 50, CONFIG)).toBeLessThan(600);
  });
});

/* -------------------------------------------------------------------------- */
/* Quality checks                                                              */
/* -------------------------------------------------------------------------- */

describe("PurpleAir quality checks", () => {
  it("computes channel agreement as a fraction of the mean", () => {
    expect(channelAgreement(50, 50)).toBe(0);
    expect(channelAgreement(40, 60)).toBeCloseTo(0.4, 5);
  });

  it("flags a degraded reading but still corrects it", () => {
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: 40, pm25_cf_1_b: 55 }),
      CONFIG,
    );
    expect(corrected.qualityFlag).toBe("degraded");
    expect(corrected.valueUgM3).not.toBeNull();
    expect(corrected.treatAsMissing).toBe(false);
    expect(corrected.rejectionReasons.join(" ")).toContain("disagree");
  });

  it("rejects a reading whose channels disagree beyond the limit, as MISSING", () => {
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: 20, pm25_cf_1_b: 200 }),
      CONFIG,
    );
    expect(corrected.qualityFlag).toBe("rejected");
    expect(corrected.valueUgM3).toBeNull();
    // The critical property: rejected means MISSING, not zero and not the raw
    // value. Missing then drives the UNKNOWN band in the risk engine.
    expect(corrected.treatAsMissing).toBe(true);
    expect(corrected.rawUgM3).toBe(110);
  });

  it("rejects a negative reading as a sensor fault, not as clean air", () => {
    const corrected = correctPurpleAir(raw({ pm25_cf_1_a: -5 }), CONFIG);
    expect(corrected.qualityFlag).toBe("rejected");
    expect(corrected.valueUgM3).toBeNull();
    expect(corrected.treatAsMissing).toBe(true);
    expect(corrected.rejectionReasons.join(" ")).toContain("not smoke");
  });

  it("rejects an implausibly high reading as a sensor fault", () => {
    const ceiling = paParam(CONFIG, "max_plausible_ug_m3");
    const corrected = correctPurpleAir(
      raw({ pm25_cf_1_a: ceiling + 1, pm25_cf_1_b: ceiling + 1 }),
      CONFIG,
    );
    expect(corrected.qualityFlag).toBe("rejected");
    expect(corrected.rejectionReasons.join(" ")).toContain("plausibility ceiling");
  });

  it("rejects a reading whose humidity is out of range", () => {
    for (const humidityPct of [-1, 101, Number.NaN]) {
      const corrected = correctPurpleAir(raw({ humidityPct }), CONFIG);
      expect(corrected.qualityFlag).toBe("rejected");
      expect(corrected.treatAsMissing).toBe(true);
    }
  });

  it("only ever accepts the cf_1 channel", () => {
    const corrected = correctPurpleAir(raw(), CONFIG);
    expect(corrected.channel).toBe("pm2.5_cf_1");
    const source = readFileSync(
      join(process.cwd(), "lib", "sensors", "purpleair-correction.ts"),
      "utf8",
    );
    // The atm channel diverges above 30 ug/m3; applying a cf_1 correction to it
    // compounds the error. The module must not accept it.
    expect(source).not.toMatch(/pm25_atm|pm2\.5_atm_[ab]/);
    expect(source).toContain("accepts cf_1 only");
  });
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

describe("PurpleAir properties", () => {
  const arbRaw = fc.record({
    pm25_cf_1_a: fc.double({ min: 0, max: 1500, noNaN: true }),
    pm25_cf_1_b: fc.double({ min: 0, max: 1500, noNaN: true }),
    humidityPct: fc.double({ min: 0, max: 100, noNaN: true }),
    temperatureC: fc.double({ min: -20, max: 60, noNaN: true }),
    timestampMs: fc.constant(NOW),
  });

  it("is deterministic", () => {
    fc.assert(
      fc.property(arbRaw, (r) => {
        expect(correctPurpleAir(r, CONFIG)).toEqual(correctPurpleAir(r, CONFIG));
      }),
    );
  });

  it("never produces a negative or non-finite corrected value", () => {
    fc.assert(
      fc.property(arbRaw, (r) => {
        const c = correctPurpleAir(r, CONFIG);
        if (c.valueUgM3 !== null) {
          expect(Number.isFinite(c.valueUgM3)).toBe(true);
          expect(c.valueUgM3).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it("always retains the raw reading, whatever the outcome", () => {
    fc.assert(
      fc.property(arbRaw, (r) => {
        const c = correctPurpleAir(r, CONFIG);
        expect(Number.isFinite(c.rawUgM3)).toBe(true);
        expect(c.rawUgM3).toBeCloseTo((r.pm25_cf_1_a + r.pm25_cf_1_b) / 2, 1);
      }),
    );
  });

  it("a rejected reading is always missing, never a number", () => {
    fc.assert(
      fc.property(arbRaw, (r) => {
        const c = correctPurpleAir(r, CONFIG);
        if (c.qualityFlag === "rejected") {
          expect(c.valueUgM3).toBeNull();
          expect(c.treatAsMissing).toBe(true);
          expect(c.rejectionReasons.length).toBeGreaterThan(0);
        } else {
          expect(c.treatAsMissing).toBe(false);
        }
      }),
    );
  });

  it("correction is monotonic in the raw reading at fixed humidity", () => {
    // A higher raw reading must never correct to a lower concentration, or a
    // rising smoke plume could reduce the reported exposure.
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 1400, noNaN: true }),
        fc.double({ min: 1, max: 100, noNaN: true }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        (base, delta, humidityPct) => {
          const lower = correctPurpleAir(
            raw({ pm25_cf_1_a: base, pm25_cf_1_b: base, humidityPct }),
            CONFIG,
          );
          const higher = correctPurpleAir(
            raw({
              pm25_cf_1_a: base + delta,
              pm25_cf_1_b: base + delta,
              humidityPct,
            }),
            CONFIG,
          );
          if (lower.valueUgM3 !== null && higher.valueUgM3 !== null) {
            expect(higher.valueUgM3).toBeGreaterThanOrEqual(lower.valueUgM3 - 1e-6);
          }
        },
      ),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Boundary                                                                    */
/* -------------------------------------------------------------------------- */

describe("sensor module boundary", () => {
  it("is pure — no framework, database or clock", () => {
    for (const file of ["purpleair-correction.ts", "purpleair-config.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "sensors", file), "utf8");
      expect(source).not.toMatch(/@prisma\/client/);
      expect(source).not.toMatch(/from\s+["']next/);
      expect(source).not.toMatch(/Date\.now\(\)/);
      expect(source).not.toMatch(/Math\.random/);
      // No live API client. Valoris fetches fixtures with a documented script,
      // never during a demo.
      expect(source).not.toMatch(/fetch\(/);
    }
  });

  it("the risk engine does not import the sensor module", () => {
    for (const file of ["engine.ts", "config.ts", "types.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "risk", file), "utf8");
      expect(source).not.toMatch(/(import|from)\s+["'][^"']*sensors/i);
    }
  });
});
