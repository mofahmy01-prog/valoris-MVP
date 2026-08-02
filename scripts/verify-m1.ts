/**
 * Milestone 1 acceptance harness. Runs the real engine — no mocks, no fixtures
 * beyond the inputs printed below.
 *
 * npm run verify:m1
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { DEFAULT_RISK_CONFIG } from "../lib/risk/default-config";
import { assessRisk } from "../lib/risk/engine";
import type {
  Environment,
  HealthProfile,
  Position,
  RiskAssessment,
  Vitals,
} from "../lib/risk/types";

const CONFIG = DEFAULT_RISK_CONFIG;
const NOW_MS = 1_700_000_000_000;

const rule = (c = "=") => console.log(c.repeat(78));

function report(label: string, r: RiskAssessment): void {
  console.log(`${label}`);
  console.log(`  score            ${r.score} / 100`);
  console.log(`  band             ${r.band}`);
  console.log(`  hardOverride     ${r.hardOverride}`);
  if (r.hardOverrideReasons.length > 0) {
    for (const reason of r.hardOverrideReasons) console.log(`    trigger: ${reason}`);
  }
  console.log(
    `  subscores        phys ${r.subscores.physiological} | env ${r.subscores.environmental} | prox ${r.subscores.proximity} | profile ${r.subscores.profile}`,
  );
  console.log(`  confidence       ${r.dataQuality.confidence}`);
  console.log(
    `  missingInputs    ${r.dataQuality.missingInputs.length > 0 ? r.dataQuality.missingInputs.join(", ") : "(none)"}`,
  );
  console.log(
    `  staleInputs      ${r.dataQuality.staleInputs.length > 0 ? r.dataQuality.staleInputs.join(", ") : "(none)"}`,
  );
  for (const d of r.topDrivers) console.log(`  driver           ${d}`);
  console.log(`  explanation      ${r.explanation}`);
}

function check(label: string, passed: boolean): void {
  console.log(`  [${passed ? "PASS" : "FAIL"}] ${label}`);
  if (!passed) process.exitCode = 1;
}

/* -------------------------------------------------------------------------- */

const ALPHA_1: HealthProfile = {
  id: "ff-alpha-1",
  callsign: "ALPHA-1",
  age: 28,
  fitness: "high",
  restingHrBpm: 50,
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
  restingHrBpm: 70,
  spo2BaselinePct: 95,
  conditions: ["moderate asthma"],
  respiratoryRisk: "moderate",
  heatTolerance: "low",
  prevShiftHours: 6,
  cumulativeCoExposureIndex: 0.35,
  cumulativeHeatExposureIndex: 0.3,
};

const freshTs = (keys: string[], ageMs = 2_000): Record<string, number> =>
  Object.fromEntries(keys.map((k) => [k, NOW_MS - ageMs]));

const VITAL_KEYS = [
  "hrBpm",
  "spo2Pct",
  "coreTempC",
  "respRatePerMin",
  "fatiguePct",
  "hydrationPct",
];
const ENV_KEYS = [
  "ambientTempC",
  "humidityPct",
  "coPpm",
  "pm25UgM3",
  "windSpeedMs",
  "windDirDeg",
];

/* ========================================================================== */
/* 2. Identical vitals, different profiles                                     */
/* ========================================================================== */

rule();
console.log("QUESTION 2 — identical vitals, different profiles");
rule();

const SHARED_VITALS: Vitals = {
  hrBpm: 148,
  spo2Pct: 93,
  coreTempC: 38.2,
  respRatePerMin: 26,
  fatiguePct: 45,
  hydrationPct: 68,
  fallDetected: false,
  lastUpdatedMs: freshTs(VITAL_KEYS),
  recentSpo2Pct: [94, 93, 93],
};

const SHARED_ENV: Environment = {
  ambientTempC: 38,
  humidityPct: 55,
  coPpm: 60,
  pm25UgM3: 140,
  windSpeedMs: 7,
  windDirDeg: 240,
  lastUpdatedMs: freshTs(ENV_KEYS, 3_000),
};

const SHARED_POS: Position = {
  lat: 37.351,
  lng: -122.052,
  distanceToFireFrontM: 240,
  distanceToSafeZoneM: 180,
  escapeRouteStatus: "clear",
  scbaPressurePct: 52,
  scbaOnAir: true,
  timeOnTaskMin: 28,
};

console.log("INPUT — byte-identical for both firefighters:");
console.log(`  vitals   ${JSON.stringify(SHARED_VITALS)}`);
console.log(`  env      ${JSON.stringify(SHARED_ENV)}`);
console.log(`  position ${JSON.stringify(SHARED_POS)}`);
console.log();

const a = assessRisk(ALPHA_1, SHARED_VITALS, SHARED_ENV, SHARED_POS, CONFIG, NOW_MS);
const b = assessRisk(BRAVO_2, SHARED_VITALS, SHARED_ENV, SHARED_POS, CONFIG, NOW_MS);

report("ALPHA-1 — 28, high fitness, no conditions", a);
console.log();
report("BRAVO-2 — 52, moderate fitness, moderate asthma", b);
console.log();
console.log(
  `DELTA: ${b.score} - ${a.score} = +${(b.score - a.score).toFixed(1)} points (${(((b.score - a.score) / a.score) * 100).toFixed(0)}% higher for BRAVO-2)`,
);
check("scores differ", a.score !== b.score);
check("BRAVO-2 scores higher", b.score > a.score);
check("difference is at least 5 points", b.score - a.score >= 5);
console.log();

/* ========================================================================== */
/* 3. Missing required input -> UNKNOWN, not SAFE                              */
/* ========================================================================== */

rule();
console.log("QUESTION 3 — missing required input");
rule();

const QUIET_ENV: Environment = {
  ambientTempC: 21,
  humidityPct: 40,
  coPpm: 3,
  pm25UgM3: 10,
  windSpeedMs: 2,
  windDirDeg: 180,
  lastUpdatedMs: freshTs(ENV_KEYS, 3_000),
};

const QUIET_POS: Position = {
  lat: 37.35,
  lng: -122.05,
  distanceToFireFrontM: 1200,
  distanceToSafeZoneM: 60,
  escapeRouteStatus: "clear",
  scbaPressurePct: 92,
  scbaOnAir: true,
  timeOnTaskMin: 4,
};

const CALM_VITALS: Vitals = {
  hrBpm: 92,
  spo2Pct: 98,
  coreTempC: 37.0,
  respRatePerMin: 16,
  fatiguePct: 10,
  hydrationPct: 90,
  fallDetected: false,
  lastUpdatedMs: freshTs(VITAL_KEYS),
};

const baseline = assessRisk(ALPHA_1, CALM_VITALS, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);
report("BASELINE — everything present and quiet", baseline);
console.log();

const noHrTs = { ...CALM_VITALS.lastUpdatedMs };
delete noHrTs["hrBpm"];
const noHr: Vitals = { ...CALM_VITALS, hrBpm: null, lastUpdatedMs: noHrTs };

const missing = assessRisk(ALPHA_1, noHr, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);
report("SAME INPUTS, heart rate removed", missing);
console.log();

check("baseline was SAFE", baseline.band === "SAFE");
check("band is UNKNOWN once HR is missing", missing.band === "UNKNOWN");
check("band is NOT SAFE", missing.band !== "SAFE");
check("confidence dropped to low", missing.dataQuality.confidence === "low");
check("hrBpm is listed as missing", missing.dataQuality.missingInputs.includes("hrBpm"));
check("score did not fall", missing.score >= baseline.score);
console.log();

// Same thing via staleness alone — the sensor still exists, it just stopped reporting.
const staleHr: Vitals = {
  ...CALM_VITALS,
  lastUpdatedMs: { ...CALM_VITALS.lastUpdatedMs, hrBpm: NOW_MS - 180_000 },
};
const stale = assessRisk(ALPHA_1, staleHr, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);
console.log("VARIANT — heart rate value present but last updated 180 s ago:");
console.log(
  `  band ${stale.band} | confidence ${stale.dataQuality.confidence} | missing: ${stale.dataQuality.missingInputs.join(", ")}`,
);
check("stale beyond the missing threshold also yields UNKNOWN", stale.band === "UNKNOWN");
console.log();

/* ========================================================================== */
/* 4. Hard override fires while another input is missing                       */
/* ========================================================================== */

rule();
console.log("QUESTION 4 — hard override with a missing sibling input");
rule();

const fallNoSpo2Ts = { ...CALM_VITALS.lastUpdatedMs };
delete fallNoSpo2Ts["spo2Pct"];
const fallNoSpo2: Vitals = {
  ...CALM_VITALS,
  fallDetected: true,
  spo2Pct: null,
  lastUpdatedMs: fallNoSpo2Ts,
};

const override = assessRisk(ALPHA_1, fallNoSpo2, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);
report("Fall detected, SpO2 sensor absent, everything else quiet", override);
console.log();

check("band is CRITICAL", override.band === "CRITICAL");
check("hardOverride is true", override.hardOverride);
check("fall is the recorded trigger", override.hardOverrideReasons.includes("Fall detected"));
check("SpO2 is recorded as missing", override.dataQuality.missingInputs.includes("spo2Pct"));
check("confidence is low", override.dataQuality.confidence === "low");
check("low confidence did not suppress the override", override.band === "CRITICAL");
console.log();

// A second, personalised override: 170 bpm is survivable at 28 and not at 52.
const hotHr: Vitals = { ...CALM_VITALS, hrBpm: 170, coreTempC: null };
const hotHrTs = { ...hotHr.lastUpdatedMs };
delete hotHrTs["coreTempC"];
const hotHrVitals: Vitals = { ...hotHr, lastUpdatedMs: hotHrTs };

const young = assessRisk(ALPHA_1, hotHrVitals, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);
const older = assessRisk(BRAVO_2, hotHrVitals, QUIET_ENV, QUIET_POS, CONFIG, NOW_MS);

console.log("VARIANT — HR 170 bpm with core temperature sensor absent:");
console.log(
  `  ALPHA-1 (28, max 192): band ${young.band} | override ${young.hardOverride} | confidence ${young.dataQuality.confidence}`,
);
console.log(
  `  BRAVO-2 (52, max 168): band ${older.band} | override ${older.hardOverride} | confidence ${older.dataQuality.confidence}`,
);
for (const reason of older.hardOverrideReasons) console.log(`    trigger: ${reason}`);
check("28-year-old does not trip the HR override at 170 bpm", !young.hardOverride);
check("52-year-old does trip it on the same reading", older.hardOverride);
check("override fires despite the missing core temperature", older.band === "CRITICAL");
console.log();

rule();
console.log(
  process.exitCode === 1 ? "RESULT: ONE OR MORE CHECKS FAILED" : "RESULT: ALL CHECKS PASSED",
);
console.log(`model ${CONFIG.modelVersion} | config ${CONFIG.configHash}`);
rule();
