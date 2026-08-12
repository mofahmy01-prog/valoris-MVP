import fc from "fast-check";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ageAdjustedHrMaxBpm,
  assessCardiacStrain,
  inferMetabolicRateWm2,
} from "./cardiac";
import { loadPhysiologyConfig, PHYSIOLOGY_PARAM_NAMES, physParam } from "./config";
import { estimateCoreTemp } from "./core-temp";
import { DEFAULT_PHYSIOLOGY_CONFIG } from "./default-config";
import { accumulateFatigue, prevShiftCarryOverPct } from "./fatigue";
import {
  ambientVapourPressureKpa,
  assessHeatStrain,
  personalCoreTempLimitC,
  saturatedVapourPressureKpa,
} from "./heat-strain";
import {
  accumulateToxicExposure,
  inhaledFraction,
  ventilationMultiplier,
} from "./toxic-exposure";
import type { Subject, WorkContext } from "./types";

const CONFIG = DEFAULT_PHYSIOLOGY_CONFIG;

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const ALPHA_1: Subject = {
  id: "ff-1",
  callsign: "ALPHA-1",
  ageYears: 28,
  restingHrBpm: 50,
  fitness: "high",
  heatTolerance: "high",
  prevShiftHours: 0,
  heatAcclimatised: true,
};

const BRAVO_2: Subject = {
  id: "ff-4",
  callsign: "BRAVO-2",
  ageYears: 52,
  restingHrBpm: 70,
  fitness: "moderate",
  heatTolerance: "low",
  prevShiftHours: 6,
  heatAcclimatised: false,
};

const CHARLIE_1: Subject = {
  id: "ff-5",
  callsign: "CHARLIE-1",
  ageYears: 45,
  restingHrBpm: 78,
  fitness: "low",
  heatTolerance: "low",
  prevShiftHours: 11,
};

function context(over: Partial<WorkContext> = {}): WorkContext {
  return {
    ambientTempC: 34,
    humidityPct: 50,
    meanRadiantTempC: 40,
    airVelocityMs: 0.5,
    coPpm: 40,
    pm25UgM3: 120,
    wearingPpe: true,
    scbaOnAir: true,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

describe("physiology configuration", () => {
  it("ships every parameter as illustrative and unreviewed", () => {
    expect(Object.keys(CONFIG.parameters)).toHaveLength(
      PHYSIOLOGY_PARAM_NAMES.length,
    );
    for (const p of Object.values(CONFIG.parameters)) {
      expect(p.sourceStatus).toBe("illustrative");
      expect(p.clinicalReviewStatus).toBe("unreviewed");
      expect(p.rationale.trim().length).toBeGreaterThan(0);
      expect(p.unit.trim().length).toBeGreaterThan(0);
      expect(p.value).toBeGreaterThanOrEqual(p.min);
      expect(p.value).toBeLessThanOrEqual(p.max);
    }
  });

  it("rejects an unknown parameter", () => {
    expect(() =>
      loadPhysiologyConfig({
        modelVersion: "x",
        parameters: { not_real: { value: 1, unit: "x", sourceStatus: "illustrative", clinicalReviewStatus: "unreviewed", rationale: "x", min: 0, max: 2, editable: true } },
      }),
    ).toThrow(/unknown parameter/);
  });

  it("rejects a missing parameter", () => {
    expect(() =>
      loadPhysiologyConfig({ modelVersion: "x", parameters: {} }),
    ).toThrow(/missing parameter/);
  });

  it("never claims to be a conformant ISO 7933 implementation", () => {
    const notice = JSON.parse(
      readFileSync(join(process.cwd(), "config", "physiology-default.json"), "utf8"),
    ) as { notice: string };
    expect(notice.notice).toMatch(/REDUCED/);
    expect(notice.notice).toMatch(/not a conformant ISO 7933 implementation/i);
  });
});

/* -------------------------------------------------------------------------- */
/* Karvonen                                                                    */
/* -------------------------------------------------------------------------- */

describe("Karvonen heart rate reserve with PPE penalty", () => {
  it("uses an age-adjusted maximum", () => {
    expect(ageAdjustedHrMaxBpm(28, CONFIG)).toBe(192);
    expect(ageAdjustedHrMaxBpm(52, CONFIG)).toBe(168);
  });

  it("separates two firefighters at the same heart rate", () => {
    const hr = 148;
    const young = assessCardiacStrain(ALPHA_1, hr, context(), CONFIG);
    const older = assessCardiacStrain(BRAVO_2, hr, context(), CONFIG);

    // 148 bpm from a resting 50 with a 142 bpm reserve is very different from
    // 148 bpm from a resting 70 with a 98 bpm reserve.
    expect(young.hrReserveBpm).toBeGreaterThan(older.hrReserveBpm);
    expect(young.hrrFraction).not.toBeNull();
    expect(older.hrrFraction).not.toBeNull();
    expect(older.hrrFraction as number).toBeGreaterThan(young.hrrFraction as number);
  });

  it("reports a lower effective reserve than nominal when in PPE", () => {
    const strain = assessCardiacStrain(ALPHA_1, 140, context(), CONFIG);
    expect(strain.ppePenaltyFraction).toBeGreaterThan(0);
    expect(strain.effectiveHrReserveBpm).toBeLessThan(strain.hrReserveBpm);
    expect(strain.hrrFraction as number).toBeGreaterThan(
      strain.nominalHrrFraction as number,
    );
  });

  it("applies no PPE penalty out of gear", () => {
    const strain = assessCardiacStrain(
      ALPHA_1,
      140,
      context({ wearingPpe: false, ambientTempC: 20 }),
      CONFIG,
    );
    expect(strain.ppePenaltyFraction).toBe(0);
    expect(strain.heatPenaltyFraction).toBe(0);
    expect(strain.reservePenaltyFraction).toBe(0);
    expect(strain.effectiveHrReserveBpm).toBe(strain.hrReserveBpm);
  });

  it("adds a heat penalty above the reference temperature", () => {
    const cool = assessCardiacStrain(ALPHA_1, 140, context({ ambientTempC: 20 }), CONFIG);
    const hot = assessCardiacStrain(ALPHA_1, 140, context({ ambientTempC: 50 }), CONFIG);
    expect(cool.heatPenaltyFraction).toBe(0);
    expect(hot.heatPenaltyFraction).toBeGreaterThan(0);
    expect(hot.effectiveHrReserveBpm).toBeLessThan(cool.effectiveHrReserveBpm);
  });

  it("caps the combined reserve penalty", () => {
    const strain = assessCardiacStrain(
      ALPHA_1,
      140,
      context({ ambientTempC: 200 }),
      CONFIG,
    );
    expect(strain.reservePenaltyFraction).toBeLessThanOrEqual(
      physParam(CONFIG, "max_reserve_penalty_frac") + 1e-9,
    );
  });

  it("reports no reserve fraction and says why when heart rate is missing", () => {
    const strain = assessCardiacStrain(ALPHA_1, null, context(), CONFIG);
    expect(strain.hrrFraction).toBeNull();
    expect(strain.provenance.caveats.join(" ")).toContain("Heart rate unavailable");
  });

  it("infers maximum metabolic rate when heart rate is missing, not rest", () => {
    const missing = inferMetabolicRateWm2(null, CONFIG);
    expect(missing.metabolicRateWm2).toBe(physParam(CONFIG, "metabolic_rate_max_w_m2"));
    expect(missing.caveat).toContain("not treated as rest");

    const resting = inferMetabolicRateWm2(0, CONFIG);
    expect(resting.metabolicRateWm2).toBe(
      physParam(CONFIG, "metabolic_rate_rest_w_m2"),
    );
  });

  it("always flags itself as estimated", () => {
    expect(assessCardiacStrain(ALPHA_1, 140, context(), CONFIG).provenance.estimated).toBe(
      true,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Reduced ISO 7933 PHS                                                        */
/* -------------------------------------------------------------------------- */

describe("reduced ISO 7933 heat strain", () => {
  const heatStrainFor = (
    subject: Subject,
    over: Partial<WorkContext> = {},
    coreTempC = 37.2,
    metabolicRateWm2 = 300,
  ) =>
    assessHeatStrain(
      { subject, context: context(over), metabolicRateWm2, currentCoreTempC: coreTempC },
      CONFIG,
    );

  it("computes saturated vapour pressure sensibly", () => {
    // ~2.34 kPa at 20 C, ~5.6 kPa at 35 C.
    expect(saturatedVapourPressureKpa(20)).toBeCloseTo(2.34, 1);
    expect(saturatedVapourPressureKpa(35)).toBeCloseTo(5.62, 1);
    expect(ambientVapourPressureKpa(35, 0)).toBe(0);
    expect(ambientVapourPressureKpa(35, 100)).toBeCloseTo(
      saturatedVapourPressureKpa(35),
      5,
    );
  });

  it("labels itself as reduced and not conformant", () => {
    const strain = heatStrainFor(ALPHA_1);
    expect(strain.provenance.modelKey).toBe("iso7933_phs_reduced_v1");
    expect(strain.provenance.modelLabel).toContain("NOT a conformant ISO 7933");
    expect(strain.provenance.caveats.join(" ")).toContain("Reduced implementation");
  });

  it("requires more evaporation as work rate rises", () => {
    const light = heatStrainFor(ALPHA_1, {}, 37.2, 120);
    const heavy = heatStrainFor(ALPHA_1, {}, 37.2, 450);
    expect(heavy.requiredEvaporationWm2).toBeGreaterThan(light.requiredEvaporationWm2);
    expect(heavy.requiredSweatRateGPerHour).toBeGreaterThan(
      light.requiredSweatRateGPerHour,
    );
  });

  it("collapses evaporative capacity as humidity rises", () => {
    const dry = heatStrainFor(ALPHA_1, { humidityPct: 20 });
    const humid = heatStrainFor(ALPHA_1, { humidityPct: 95 });
    expect(humid.maxEvaporationWm2).toBeLessThan(dry.maxEvaporationWm2);
    expect(humid.heatStorageWm2).toBeGreaterThan(dry.heatStorageWm2);
  });

  it("shows PPE as the dominant evaporative barrier", () => {
    const inGear = heatStrainFor(ALPHA_1, { wearingPpe: true });
    const outOfGear = heatStrainFor(ALPHA_1, { wearingPpe: false });
    expect(inGear.maxEvaporationWm2).toBeLessThan(outOfGear.maxEvaporationWm2);
    expect(inGear.heatStorageWm2).toBeGreaterThan(outOfGear.heatStorageWm2);
  });

  it("caps predicted sweat rate at the achievable maximum", () => {
    const strain = heatStrainFor(ALPHA_1, { ambientTempC: 60, humidityPct: 90 }, 37.2, 475);
    expect(strain.predictedSweatRateGPerHour).toBeLessThanOrEqual(
      physParam(CONFIG, "max_sweat_rate_g_per_hour_acclimatised"),
    );
    expect(strain.provenance.caveats.join(" ")).toContain(
      "exceeds the achievable maximum",
    );
  });

  it("never gives an acclimatised subject a shorter water-loss limit", () => {
    // Holds in every regime: acclimatisation raises both the sweat-rate ceiling
    // and the water-loss allowance, so the limit can only move outward.
    for (const metabolicRateWm2 of [100, 150, 200, 250, 300, 350, 400, 475]) {
      const acc = heatStrainFor(
        { ...BRAVO_2, heatAcclimatised: true },
        {},
        37.2,
        metabolicRateWm2,
      );
      const notAcc = heatStrainFor(
        { ...BRAVO_2, heatAcclimatised: false },
        {},
        37.2,
        metabolicRateWm2,
      );
      if (acc.dlimWaterLossMin === null || notAcc.dlimWaterLossMin === null) continue;
      expect(acc.dlimWaterLossMin).toBeGreaterThanOrEqual(notAcc.dlimWaterLossMin);
    }
  });

  it("gives an acclimatised subject strictly longer when sweat rate is not capped", () => {
    // Below the sweat ceiling both subjects sweat at the same required rate, so
    // the larger water-loss allowance is the only difference and must show.
    const found: Array<{ metabolicRateWm2: number; acc: number; notAcc: number }> = [];
    for (const metabolicRateWm2 of [120, 160, 200, 240, 280, 320, 360, 400, 440, 475]) {
      const acc = heatStrainFor(
        { ...BRAVO_2, heatAcclimatised: true },
        {},
        37.2,
        metabolicRateWm2,
      );
      const notAcc = heatStrainFor(
        { ...BRAVO_2, heatAcclimatised: false },
        {},
        37.2,
        metabolicRateWm2,
      );
      const uncapped =
        notAcc.predictedSweatRateGPerHour <
        physParam(CONFIG, "max_sweat_rate_g_per_hour_unacclimatised") - 1e-6;
      if (
        uncapped &&
        acc.dlimWaterLossMin !== null &&
        notAcc.dlimWaterLossMin !== null
      ) {
        found.push({
          metabolicRateWm2,
          acc: acc.dlimWaterLossMin,
          notAcc: notAcc.dlimWaterLossMin,
        });
      }
    }
    expect(
      found.length,
      "no uncapped regime inside the reporting horizon — the configured sweat ceiling and horizon leave no room to show the acclimatisation benefit",
    ).toBeGreaterThan(0);
    for (const row of found) {
      expect(row.acc).toBeGreaterThan(row.notAcc);
    }
  });

  it("documents that acclimatisation buys no water-loss time once sweat is capped", () => {
    // Both allowances divided by both ceilings give the same 2.0 h in the
    // default config (2600/1300 and 2000/1000), so in the sweat-capped regime
    // the two limits coincide exactly. That is an artefact of the illustrative
    // values, not a physiological finding. Pinned so a threshold change that
    // removes the coincidence is visible rather than silent.
    const ratioAcclimatised =
      physParam(CONFIG, "max_water_loss_g_acclimatised") /
      physParam(CONFIG, "max_sweat_rate_g_per_hour_acclimatised");
    const ratioUnacclimatised =
      physParam(CONFIG, "max_water_loss_g_unacclimatised") /
      physParam(CONFIG, "max_sweat_rate_g_per_hour_unacclimatised");
    expect(ratioAcclimatised).toBeCloseTo(ratioUnacclimatised, 6);

    const capped = { ambientTempC: 60, humidityPct: 90 };
    const acc = heatStrainFor({ ...BRAVO_2, heatAcclimatised: true }, capped, 37.2, 475);
    const notAcc = heatStrainFor(
      { ...BRAVO_2, heatAcclimatised: false },
      capped,
      37.2,
      475,
    );
    expect(acc.predictedSweatRateGPerHour).toBe(
      physParam(CONFIG, "max_sweat_rate_g_per_hour_acclimatised"),
    );
    expect(notAcc.predictedSweatRateGPerHour).toBe(
      physParam(CONFIG, "max_sweat_rate_g_per_hour_unacclimatised"),
    );
    expect(acc.dlimWaterLossMin).toBe(notAcc.dlimWaterLossMin);
  });

  it("personalises the core temperature limit by heat tolerance", () => {
    expect(personalCoreTempLimitC(BRAVO_2, CONFIG)).toBeLessThan(
      physParam(CONFIG, "phs_core_temp_limit_c"),
    );
    expect(personalCoreTempLimitC(ALPHA_1, CONFIG)).toBeGreaterThan(
      physParam(CONFIG, "phs_core_temp_limit_c"),
    );
  });

  it("gives a low-heat-tolerance subject less allowable time in the same conditions", () => {
    const hot = { ambientTempC: 48, humidityPct: 60 };
    const tolerant = heatStrainFor(ALPHA_1, hot, 37.4, 350);
    const intolerant = heatStrainFor(BRAVO_2, hot, 37.4, 350);
    expect(intolerant.coreTempLimitC).toBeLessThan(tolerant.coreTempLimitC);
    if (intolerant.dlimCoreTempMin !== null && tolerant.dlimCoreTempMin !== null) {
      expect(intolerant.dlimCoreTempMin).toBeLessThan(tolerant.dlimCoreTempMin);
    }
  });

  it("names which limit binds", () => {
    const strain = heatStrainFor(BRAVO_2, { ambientTempC: 50, humidityPct: 70 }, 37.8, 400);
    expect(["water_loss", "core_temperature"]).toContain(strain.limiter);
    expect(strain.dlimMin).not.toBeNull();
    if (strain.limiter === "core_temperature") {
      expect(strain.dlimMin).toBe(strain.dlimCoreTempMin);
    } else {
      expect(strain.dlimMin).toBe(strain.dlimWaterLossMin);
    }
  });

  it("reports zero allowable time when already at the personalised limit", () => {
    const strain = heatStrainFor(
      BRAVO_2,
      { ambientTempC: 50, humidityPct: 80 },
      39.5,
      400,
    );
    expect(strain.dlimCoreTempMin).toBe(0);
    expect(strain.provenance.caveats.join(" ")).toContain("already at or above");
  });

  it("treats missing ambient temperature as no cooling, not as comfortable", () => {
    const known = heatStrainFor(ALPHA_1, { ambientTempC: 20, meanRadiantTempC: 20 });
    const unknown = heatStrainFor(ALPHA_1, {
      ambientTempC: null,
      meanRadiantTempC: null,
    });
    expect(unknown.heatStorageWm2).toBeGreaterThan(known.heatStorageWm2);
    expect(unknown.provenance.caveats.join(" ")).toContain(
      "removing all convective and radiative cooling",
    );
  });

  it("treats missing humidity as saturated", () => {
    const strain = heatStrainFor(ALPHA_1, { humidityPct: null });
    expect(strain.provenance.caveats.join(" ")).toContain("assumed saturated");
  });

  it("says so when radiant temperature is not reported", () => {
    const strain = heatStrainFor(ALPHA_1, { meanRadiantTempC: null });
    expect(strain.provenance.caveats.join(" ")).toContain("understates radiant load");
  });
});

/* -------------------------------------------------------------------------- */
/* Core temperature estimation                                                 */
/* -------------------------------------------------------------------------- */

describe("core temperature estimation", () => {
  const estimate = (
    over: Partial<Parameters<typeof estimateCoreTemp>[0]> = {},
  ) =>
    estimateCoreTemp(
      {
        subject: ALPHA_1,
        previousCoreTempC: 37.2,
        heatStorageWm2: 40,
        hrrFraction: 0.6,
        elapsedMin: 10,
        ...over,
      },
      CONFIG,
    );

  it("always declares itself estimated, never measured", () => {
    const r = estimate();
    expect(r.provenance.estimated).toBe(true);
    expect(r.provenance.modelLabel).toContain("ESTIMATED not measured");
    expect(r.provenance.caveats.join(" ")).toContain("No core temperature sensor");
  });

  it("rises with positive heat storage", () => {
    const low = estimate({ heatStorageWm2: 5 });
    const high = estimate({ heatStorageWm2: 90 });
    expect(high.coreTempC).toBeGreaterThan(low.coreTempC);
    expect(high.contributions.heatStorageC).toBeGreaterThan(
      low.contributions.heatStorageC,
    );
  });

  it("rises with cardiac strain above the threshold and not below it", () => {
    const below = estimate({
      hrrFraction: physParam(CONFIG, "core_temp_cardiac_hrr_threshold_frac") - 0.05,
    });
    const above = estimate({ hrrFraction: 0.9 });
    expect(below.contributions.cardiacC).toBe(0);
    expect(above.contributions.cardiacC).toBeGreaterThan(0);
  });

  it("recovers toward baseline only when shedding heat at low exertion", () => {
    const recovering = estimate({
      previousCoreTempC: 38.4,
      heatStorageWm2: -30,
      hrrFraction: 0.1,
      elapsedMin: 30,
    });
    expect(recovering.contributions.recoveryC).toBeLessThan(0);
    expect(recovering.coreTempC).toBeLessThan(38.4);

    const notRecovering = estimate({
      previousCoreTempC: 38.4,
      heatStorageWm2: 20,
      hrrFraction: 0.1,
      elapsedMin: 30,
    });
    expect(notRecovering.contributions.recoveryC).toBe(0);
  });

  it("never recovers below the configured baseline", () => {
    const r = estimate({
      previousCoreTempC: 37.0,
      heatStorageWm2: -100,
      hrrFraction: 0,
      elapsedMin: 120,
    });
    expect(r.coreTempC).toBeGreaterThanOrEqual(
      physParam(CONFIG, "core_temp_baseline_c") - 1e-9,
    );
  });

  it("is pessimistic when heart rate is unavailable", () => {
    const known = estimate({ hrrFraction: 0.4 });
    const unknown = estimate({ hrrFraction: null });
    expect(unknown.contributions.cardiacC).toBeGreaterThan(
      known.contributions.cardiacC,
    );
    expect(unknown.provenance.caveats.join(" ")).toContain("deliberately pessimistic");
  });

  it("starts from the configured baseline and says so", () => {
    const r = estimate({ previousCoreTempC: null, heatStorageWm2: 0, hrrFraction: 0.1 });
    expect(r.provenance.caveats.join(" ")).toContain("started from the configured baseline");
  });

  it("clamps to physiological bounds and reports the clamp", () => {
    const r = estimate({
      previousCoreTempC: 41.9,
      heatStorageWm2: 500,
      hrrFraction: 1,
      elapsedMin: 240,
    });
    expect(r.coreTempC).toBeLessThanOrEqual(physParam(CONFIG, "core_temp_max_c"));
    expect(r.clamped).toBe(true);
    expect(r.provenance.caveats.join(" ")).toContain("clamped");
  });

  it("does not change over a zero-length step", () => {
    const r = estimate({ elapsedMin: 0 });
    expect(r.deltaC).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */
/* Fatigue                                                                     */
/* -------------------------------------------------------------------------- */

describe("fatigue accumulation", () => {
  const fatigue = (over: Partial<Parameters<typeof accumulateFatigue>[0]> = {}) =>
    accumulateFatigue(
      {
        subject: ALPHA_1,
        previousFatiguePct: 20,
        hrrFraction: 0.7,
        coreTempC: 37.5,
        coreTempLimitC: 38.3,
        elapsedMin: 15,
        ...over,
      },
      CONFIG,
    );

  it("carries previous-shift hours in as a starting offset", () => {
    expect(prevShiftCarryOverPct(ALPHA_1, CONFIG)).toBe(0);
    expect(prevShiftCarryOverPct(CHARLIE_1, CONFIG)).toBeCloseTo(16.5, 5);

    const fresh = fatigue({ subject: CHARLIE_1, previousFatiguePct: null });
    expect(fresh.carryOverPct).toBeCloseTo(16.5, 5);
    expect(fresh.fatiguePct).toBeGreaterThan(16.5);
  });

  it("accumulates above the threshold and recovers below it", () => {
    const working = fatigue({ hrrFraction: 0.8 });
    expect(working.accumulatedPct).toBeGreaterThan(0);
    expect(working.recoveredPct).toBe(0);
    expect(working.fatiguePct).toBeGreaterThan(20);

    const resting = fatigue({ hrrFraction: 0.1 });
    expect(resting.accumulatedPct).toBe(0);
    expect(resting.recoveredPct).toBeGreaterThan(0);
    expect(resting.fatiguePct).toBeLessThan(20);
  });

  it("recovers more slowly than it accumulates", () => {
    const work = fatigue({ hrrFraction: 1, elapsedMin: 60 });
    const rest = fatigue({ hrrFraction: 0, elapsedMin: 60, previousFatiguePct: 100 });
    expect(work.accumulatedPct).toBeGreaterThan(rest.recoveredPct);
  });

  it("scales with fitness", () => {
    const low = fatigue({ subject: { ...ALPHA_1, fitness: "low" } });
    const moderate = fatigue({ subject: { ...ALPHA_1, fitness: "moderate" } });
    const high = fatigue({ subject: { ...ALPHA_1, fitness: "high" } });
    expect(low.accumulatedPct).toBeGreaterThan(moderate.accumulatedPct);
    expect(moderate.accumulatedPct).toBeGreaterThan(high.accumulatedPct);
  });

  it("accumulates faster as core temperature approaches its limit", () => {
    const cool = fatigue({ coreTempC: 37.0 });
    const hot = fatigue({ coreTempC: 38.3 });
    expect(hot.accumulatedPct).toBeGreaterThan(cool.accumulatedPct);
  });

  it("accumulates at the maximum rate when heart rate is unavailable", () => {
    const known = fatigue({ hrrFraction: 0.5 });
    const unknown = fatigue({ hrrFraction: null });
    expect(unknown.accumulatedPct).toBeGreaterThan(known.accumulatedPct);
    expect(unknown.provenance.caveats.join(" ")).toContain(
      "rather than assuming rest",
    );
  });

  it("stays within its configured bounds", () => {
    const pinnedHigh = fatigue({
      previousFatiguePct: 99,
      hrrFraction: 1,
      elapsedMin: 600,
    });
    expect(pinnedHigh.fatiguePct).toBeLessThanOrEqual(
      physParam(CONFIG, "fatigue_max_pct"),
    );
    const pinnedLow = fatigue({
      previousFatiguePct: 1,
      hrrFraction: 0,
      elapsedMin: 600,
    });
    expect(pinnedLow.fatiguePct).toBeGreaterThanOrEqual(
      physParam(CONFIG, "fatigue_min_pct"),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Toxic exposure                                                              */
/* -------------------------------------------------------------------------- */

describe("toxic exposure accumulation", () => {
  const toxic = (over: Partial<Parameters<typeof accumulateToxicExposure>[0]> = {}) =>
    accumulateToxicExposure(
      {
        context: context(),
        previousCohbPct: null,
        previousPm25DoseUgMinM3: null,
        hrrFraction: 0.5,
        elapsedMin: 30,
        ...over,
      },
      CONFIG,
    );

  it("never credits SCBA with complete protection", () => {
    const onAir = inhaledFraction(context({ scbaOnAir: true }), CONFIG);
    expect(onAir).toBeGreaterThan(0);
    expect(onAir).toBeLessThan(1);
    const offAir = inhaledFraction(context({ scbaOnAir: false }), CONFIG);
    expect(offAir).toBeGreaterThan(onAir);
  });

  it("gates uptake on SCBA status", () => {
    const onAir = toxic({ context: context({ scbaOnAir: true }) });
    const offAir = toxic({ context: context({ scbaOnAir: false }) });
    expect(offAir.cohbPct).toBeGreaterThan(onAir.cohbPct);
    expect(offAir.pm25DoseUgMinM3).toBeGreaterThan(onAir.pm25DoseUgMinM3);
    expect(onAir.scbaOnAir).toBe(true);
  });

  it("scales uptake with minute ventilation", () => {
    expect(ventilationMultiplier(0, CONFIG)).toBe(1);
    expect(ventilationMultiplier(1, CONFIG)).toBe(
      physParam(CONFIG, "cohb_ventilation_multiplier_max"),
    );
    const light = toxic({ hrrFraction: 0.1 });
    const heavy = toxic({ hrrFraction: 0.95 });
    expect(heavy.cohbPct).toBeGreaterThan(light.cohbPct);
  });

  it("assumes maximum ventilation when heart rate is unavailable", () => {
    expect(ventilationMultiplier(null, CONFIG)).toBe(
      physParam(CONFIG, "cohb_ventilation_multiplier_max"),
    );
    expect(toxic({ hrrFraction: null }).provenance.caveats.join(" ")).toContain(
      "deliberately pessimistic",
    );
  });

  it("starts COHb at the configured baseline", () => {
    const r = toxic({ context: context({ coPpm: 0 }), elapsedMin: 0 });
    expect(r.cohbPct).toBeCloseTo(physParam(CONFIG, "cohb_baseline_pct"), 2);
  });

  it("accumulates COHb over time in CO", () => {
    const short = toxic({ context: context({ coPpm: 200, scbaOnAir: false }), elapsedMin: 10 });
    const long = toxic({ context: context({ coPpm: 200, scbaOnAir: false }), elapsedMin: 60 });
    expect(long.cohbPct).toBeGreaterThan(short.cohbPct);
    expect(long.coIndex).toBeGreaterThan(short.coIndex);
  });

  it("eliminates COHb toward baseline in clean air", () => {
    const r = toxic({
      context: context({ coPpm: 0, pm25UgM3: 0 }),
      previousCohbPct: 12,
      elapsedMin: physParam(CONFIG, "cohb_elimination_half_life_min"),
    });
    // One half-life removes half of the excess above baseline.
    const baseline = physParam(CONFIG, "cohb_baseline_pct");
    expect(r.cohbPct).toBeCloseTo(baseline + (12 - baseline) / 2, 1);
  });

  it("never lets PM2.5 dose fall — there is no clearance term", () => {
    const first = toxic({ elapsedMin: 20 });
    const second = toxic({
      previousPm25DoseUgMinM3: first.pm25DoseUgMinM3,
      context: context({ pm25UgM3: 0 }),
      elapsedMin: 60,
    });
    expect(second.pm25DoseUgMinM3).toBeGreaterThanOrEqual(first.pm25DoseUgMinM3);
    expect(second.provenance.caveats.join(" ")).toContain("no elimination term");
  });

  it("treats a dropped CO sensor as the worst seen, not as clean air", () => {
    const clean = toxic({ context: context({ coPpm: 0 }) });
    const dropped = toxic({
      context: context({ coPpm: null }),
      worstKnownCoPpm: 150,
    });
    expect(dropped.cohbPct).toBeGreaterThan(clean.cohbPct);
    expect(dropped.provenance.caveats.join(" ")).toContain(
      "Absence is not treated as clean air",
    );
  });

  it("reports the worse of the two indices", () => {
    const r = toxic({ context: context({ coPpm: 400, scbaOnAir: false }), elapsedMin: 60 });
    expect(r.combinedIndex).toBe(Math.max(r.coIndex, r.pm25Index));
  });

  it("clamps COHb to a physiological maximum", () => {
    const r = toxic({
      context: context({ coPpm: 5000, scbaOnAir: false }),
      hrrFraction: 1,
      elapsedMin: 600,
    });
    expect(r.cohbPct).toBeLessThanOrEqual(physParam(CONFIG, "cohb_max_pct"));
  });

  it("says it is not Coburn-Forster-Kane", () => {
    expect(toxic().provenance.caveats.join(" ")).toContain(
      "Not the Coburn-Forster-Kane equation",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Properties                                                                  */
/* -------------------------------------------------------------------------- */

const arbSubject: fc.Arbitrary<Subject> = fc.record({
  id: fc.constant("ff-x"),
  callsign: fc.constant("TEST-1"),
  ageYears: fc.integer({ min: 18, max: 64 }),
  restingHrBpm: fc.integer({ min: 40, max: 95 }),
  fitness: fc.constantFrom("low", "moderate", "high"),
  heatTolerance: fc.constantFrom("low", "avg", "high"),
  prevShiftHours: fc.integer({ min: 0, max: 18 }),
  bodyMassKg: fc.option(fc.double({ min: 45, max: 150, noNaN: true }), { nil: null }),
  heatAcclimatised: fc.boolean(),
});

const arbContext: fc.Arbitrary<WorkContext> = fc.record({
  ambientTempC: fc.option(fc.double({ min: -20, max: 120, noNaN: true }), { nil: null }),
  humidityPct: fc.option(fc.integer({ min: 0, max: 100 }), { nil: null }),
  meanRadiantTempC: fc.option(fc.double({ min: -20, max: 300, noNaN: true }), { nil: null }),
  airVelocityMs: fc.option(fc.double({ min: 0, max: 30, noNaN: true }), { nil: null }),
  coPpm: fc.option(fc.double({ min: 0, max: 3000, noNaN: true }), { nil: null }),
  pm25UgM3: fc.option(fc.double({ min: 0, max: 2000, noNaN: true }), { nil: null }),
  wearingPpe: fc.boolean(),
  scbaOnAir: fc.boolean(),
});

const arbHrr = fc.option(fc.double({ min: 0, max: 1.4, noNaN: true }), { nil: null });
const arbElapsed = fc.double({ min: 0, max: 120, noNaN: true });

describe("physiology model properties", () => {
  it("every model is deterministic", () => {
    fc.assert(
      fc.property(arbSubject, arbContext, arbHrr, arbElapsed, (subject, ctx, hrr, mins) => {
        const cardiacA = assessCardiacStrain(subject, hrr === null ? null : 120, ctx, CONFIG);
        const cardiacB = assessCardiacStrain(subject, hrr === null ? null : 120, ctx, CONFIG);
        expect(cardiacA).toEqual(cardiacB);

        const metabolic = inferMetabolicRateWm2(hrr, CONFIG).metabolicRateWm2;
        const input = {
          subject,
          context: ctx,
          metabolicRateWm2: metabolic,
          currentCoreTempC: 37.4,
        };
        expect(assessHeatStrain(input, CONFIG)).toEqual(assessHeatStrain(input, CONFIG));

        const toxicInput = {
          context: ctx,
          previousCohbPct: 3,
          previousPm25DoseUgMinM3: 100,
          hrrFraction: hrr,
          elapsedMin: mins,
        };
        expect(accumulateToxicExposure(toxicInput, CONFIG)).toEqual(
          accumulateToxicExposure(toxicInput, CONFIG),
        );
      }),
    );
  });

  it("core temperature always stays within configured bounds", () => {
    fc.assert(
      fc.property(
        arbSubject,
        fc.double({ min: -500, max: 900, noNaN: true }),
        arbHrr,
        arbElapsed,
        (subject, storage, hrr, mins) => {
          const r = estimateCoreTemp(
            {
              subject,
              previousCoreTempC: 37.5,
              heatStorageWm2: storage,
              hrrFraction: hrr,
              elapsedMin: mins,
            },
            CONFIG,
          );
          expect(r.coreTempC).toBeGreaterThanOrEqual(
            physParam(CONFIG, "core_temp_min_c"),
          );
          expect(r.coreTempC).toBeLessThanOrEqual(physParam(CONFIG, "core_temp_max_c"));
          expect(Number.isFinite(r.coreTempC)).toBe(true);
        },
      ),
    );
  });

  it("fatigue always stays within configured bounds", () => {
    fc.assert(
      fc.property(
        arbSubject,
        fc.option(fc.double({ min: 0, max: 100, noNaN: true }), { nil: null }),
        arbHrr,
        arbElapsed,
        (subject, previous, hrr, mins) => {
          const r = accumulateFatigue(
            {
              subject,
              previousFatiguePct: previous,
              hrrFraction: hrr,
              coreTempC: 38,
              coreTempLimitC: 38.3,
              elapsedMin: mins,
            },
            CONFIG,
          );
          expect(r.fatiguePct).toBeGreaterThanOrEqual(
            physParam(CONFIG, "fatigue_min_pct"),
          );
          expect(r.fatiguePct).toBeLessThanOrEqual(physParam(CONFIG, "fatigue_max_pct"));
        },
      ),
    );
  });

  it("toxic indices are non-negative and COHb is bounded", () => {
    fc.assert(
      fc.property(arbContext, arbHrr, arbElapsed, (ctx, hrr, mins) => {
        const r = accumulateToxicExposure(
          {
            context: ctx,
            previousCohbPct: null,
            previousPm25DoseUgMinM3: null,
            hrrFraction: hrr,
            elapsedMin: mins,
          },
          CONFIG,
        );
        expect(r.cohbPct).toBeGreaterThanOrEqual(0);
        expect(r.cohbPct).toBeLessThanOrEqual(physParam(CONFIG, "cohb_max_pct"));
        expect(r.coIndex).toBeGreaterThanOrEqual(0);
        expect(r.pm25Index).toBeGreaterThanOrEqual(0);
        expect(r.pm25DoseUgMinM3).toBeGreaterThanOrEqual(0);
        expect(r.inhaledFraction).toBeGreaterThan(0);
      }),
    );
  });

  it("longer exposure never reduces accumulated dose", () => {
    fc.assert(
      fc.property(
        arbContext,
        arbHrr,
        fc.double({ min: 0, max: 60, noNaN: true }),
        fc.double({ min: 0, max: 60, noNaN: true }),
        (ctx, hrr, a, b) => {
          const shorter = Math.min(a, b);
          const longer = Math.max(a, b);
          const first = accumulateToxicExposure(
            { context: ctx, previousCohbPct: null, previousPm25DoseUgMinM3: 0, hrrFraction: hrr, elapsedMin: shorter },
            CONFIG,
          );
          const second = accumulateToxicExposure(
            { context: ctx, previousCohbPct: null, previousPm25DoseUgMinM3: 0, hrrFraction: hrr, elapsedMin: longer },
            CONFIG,
          );
          expect(second.pm25DoseUgMinM3).toBeGreaterThanOrEqual(first.pm25DoseUgMinM3);
        },
      ),
    );
  });

  it("every model output carries provenance and is flagged estimated", () => {
    fc.assert(
      fc.property(arbSubject, arbContext, arbHrr, (subject, ctx, hrr) => {
        const outputs = [
          assessCardiacStrain(subject, 130, ctx, CONFIG).provenance,
          assessHeatStrain(
            { subject, context: ctx, metabolicRateWm2: 300, currentCoreTempC: 37.4 },
            CONFIG,
          ).provenance,
          estimateCoreTemp(
            { subject, previousCoreTempC: 37.4, heatStorageWm2: 30, hrrFraction: hrr, elapsedMin: 10 },
            CONFIG,
          ).provenance,
          accumulateFatigue(
            { subject, previousFatiguePct: 30, hrrFraction: hrr, coreTempC: 37.8, coreTempLimitC: 38.3, elapsedMin: 10 },
            CONFIG,
          ).provenance,
          accumulateToxicExposure(
            { context: ctx, previousCohbPct: 2, previousPm25DoseUgMinM3: 50, hrrFraction: hrr, elapsedMin: 10 },
            CONFIG,
          ).provenance,
        ];
        for (const p of outputs) {
          expect(p.estimated).toBe(true);
          expect(p.caveats.length).toBeGreaterThan(0);
          expect(p.modelVersion).toBe(CONFIG.modelVersion);
          expect(p.configHash).toBe(CONFIG.configHash);
        }
      }),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* Boundaries                                                                  */
/* -------------------------------------------------------------------------- */

describe("physiology module boundaries", () => {
  const files = [
    "types.ts",
    "config.ts",
    "cardiac.ts",
    "heat-strain.ts",
    "core-temp.ts",
    "fatigue.ts",
    "toxic-exposure.ts",
  ];

  it("is pure — no framework, database or fire-module imports", () => {
    for (const file of files) {
      const source = readFileSync(
        join(process.cwd(), "lib", "physiology", file),
        "utf8",
      );
      expect(source, `${file} must not import Prisma`).not.toMatch(/@prisma\/client/);
      expect(source, `${file} must not import Next`).not.toMatch(/from\s+["']next/);
      expect(source, `${file} must not import React`).not.toMatch(/from\s+["']react/);
      expect(source, `${file} must not import lib/fire`).not.toMatch(/from\s+["'].*\/fire/);
      expect(source, `${file} must not read the clock`).not.toMatch(/Date\.now\(\)/);
      expect(source, `${file} must not use randomness`).not.toMatch(/Math\.random/);
    }
  });

  it("the risk engine does not depend on the physiology module", () => {
    for (const file of ["engine.ts", "config.ts", "types.ts", "bands.ts"]) {
      const source = readFileSync(join(process.cwd(), "lib", "risk", file), "utf8");
      expect(source).not.toMatch(/from\s+["'].*physiology/);
    }
  });
});
