/**
 * Severity sweep. Diagnostic only — changes nothing.
 *
 * Holds the six seeded profiles and one fixed set of vitals constant, then
 * escalates environmental and proximity severity across six steps from benign
 * to extreme, and reports which band each firefighter occupies at each step.
 *
 * The question it answers: does the personalisation ever separate firefighters
 * across a band boundary, or does it only move them within one band?
 *
 * Thresholds are NOT adjusted here. Calibration is a clinical decision.
 *
 * npm run sweep
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { BAND_SEVERITY } from "../lib/risk/bands";
import { DEFAULT_RISK_CONFIG } from "../lib/risk/default-config";
import { assessRisk } from "../lib/risk/engine";
import type {
  Environment,
  HealthProfile,
  Position,
  RiskBand,
  Vitals,
} from "../lib/risk/types";

const CONFIG = DEFAULT_RISK_CONFIG;
const NOW_MS = 1_700_000_000_000;

const PROFILES: HealthProfile[] = [
  {
    id: "ff-1", callsign: "ALPHA-1", age: 28, fitness: "high", restingHrBpm: 50,
    spo2BaselinePct: 98, conditions: [], respiratoryRisk: "none", heatTolerance: "high",
    prevShiftHours: 0, cumulativeCoExposureIndex: 0.05, cumulativeHeatExposureIndex: 0.05,
  },
  {
    id: "ff-2", callsign: "ALPHA-2", age: 41, fitness: "moderate", restingHrBpm: 62,
    spo2BaselinePct: 97, conditions: ["mild hypertension"], respiratoryRisk: "none",
    heatTolerance: "avg", prevShiftHours: 4, cumulativeCoExposureIndex: 0.15,
    cumulativeHeatExposureIndex: 0.2,
  },
  {
    id: "ff-3", callsign: "BRAVO-1", age: 34, fitness: "high", restingHrBpm: 55,
    spo2BaselinePct: 98, conditions: ["type 1 diabetes"], respiratoryRisk: "none",
    heatTolerance: "avg", prevShiftHours: 2, cumulativeCoExposureIndex: 0.1,
    cumulativeHeatExposureIndex: 0.1,
  },
  {
    id: "ff-4", callsign: "BRAVO-2", age: 52, fitness: "moderate", restingHrBpm: 70,
    spo2BaselinePct: 95, conditions: ["moderate asthma"], respiratoryRisk: "moderate",
    heatTolerance: "low", prevShiftHours: 6, cumulativeCoExposureIndex: 0.35,
    cumulativeHeatExposureIndex: 0.3,
  },
  {
    id: "ff-5", callsign: "CHARLIE-1", age: 45, fitness: "low", restingHrBpm: 78,
    spo2BaselinePct: 96, conditions: [], respiratoryRisk: "none", heatTolerance: "low",
    prevShiftHours: 11, cumulativeCoExposureIndex: 0.4, cumulativeHeatExposureIndex: 0.45,
  },
  {
    id: "ff-6", callsign: "CHARLIE-2", age: 38, fitness: "moderate", restingHrBpm: 64,
    spo2BaselinePct: 96, conditions: ["mild reactive airway"], respiratoryRisk: "mild",
    heatTolerance: "avg", prevShiftHours: 3, cumulativeCoExposureIndex: 0.2,
    cumulativeHeatExposureIndex: 0.2,
  },
];

/** Fixed across every step, so only environment and proximity vary. */
const FIXED_VITALS: Vitals = {
  hrBpm: 148,
  spo2Pct: 93,
  coreTempC: 38.2,
  respRatePerMin: 26,
  fatiguePct: 45,
  hydrationPct: 68,
  fallDetected: false,
  lastUpdatedMs: {
    hrBpm: NOW_MS - 2_000,
    spo2Pct: NOW_MS - 2_000,
    coreTempC: NOW_MS - 2_000,
    respRatePerMin: NOW_MS - 2_000,
    fatiguePct: NOW_MS - 2_000,
    hydrationPct: NOW_MS - 2_000,
  },
  recentSpo2Pct: [94, 93, 93],
};

type Step = {
  label: string;
  ambientTempC: number;
  humidityPct: number;
  coPpm: number;
  pm25UgM3: number;
  fireFrontM: number;
  escapeRouteStatus: Position["escapeRouteStatus"];
  scbaPressurePct: number;
  timeOnTaskMin: number;
};

/**
 * Six steps. The escape route never reaches "blocked" and SCBA never drops to
 * the override threshold, deliberately: a hard override sends everyone to
 * CRITICAL at once and would hide exactly the separation being measured.
 */
const STEPS: Step[] = [
  { label: "1 benign",       ambientTempC: 18, humidityPct: 35, coPpm: 2,   pm25UgM3: 8,   fireFrontM: 2000, escapeRouteStatus: "clear",    scbaPressurePct: 95, timeOnTaskMin: 5 },
  { label: "2 light",        ambientTempC: 26, humidityPct: 45, coPpm: 15,  pm25UgM3: 30,  fireFrontM: 900,  escapeRouteStatus: "clear",    scbaPressurePct: 80, timeOnTaskMin: 12 },
  { label: "3 moderate",     ambientTempC: 32, humidityPct: 55, coPpm: 35,  pm25UgM3: 70,  fireFrontM: 450,  escapeRouteStatus: "clear",    scbaPressurePct: 65, timeOnTaskMin: 20 },
  { label: "4 heavy",        ambientTempC: 38, humidityPct: 60, coPpm: 70,  pm25UgM3: 130, fireFrontM: 250,  escapeRouteStatus: "degraded", scbaPressurePct: 50, timeOnTaskMin: 30 },
  { label: "5 severe",       ambientTempC: 46, humidityPct: 70, coPpm: 130, pm25UgM3: 220, fireFrontM: 120,  escapeRouteStatus: "degraded", scbaPressurePct: 38, timeOnTaskMin: 42 },
  { label: "6 extreme",      ambientTempC: 55, humidityPct: 80, coPpm: 220, pm25UgM3: 380, fireFrontM: 60,   escapeRouteStatus: "degraded", scbaPressurePct: 28, timeOnTaskMin: 55 },
];

function environmentFor(step: Step): Environment {
  return {
    ambientTempC: step.ambientTempC,
    humidityPct: step.humidityPct,
    coPpm: step.coPpm,
    pm25UgM3: step.pm25UgM3,
    windSpeedMs: 6,
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
}

function positionFor(step: Step): Position {
  return {
    lat: 37.351,
    lng: -122.052,
    distanceToFireFrontM: step.fireFrontM,
    distanceToSafeZoneM: 200,
    escapeRouteStatus: step.escapeRouteStatus,
    scbaPressurePct: step.scbaPressurePct,
    scbaOnAir: true,
    timeOnTaskMin: step.timeOnTaskMin,
    lastUpdatedMs: {
      positionFix: NOW_MS - 4_000,
      distanceToFireFrontM: NOW_MS - 4_000,
      distanceToSafeZoneM: NOW_MS - 4_000,
      escapeRouteStatus: NOW_MS - 4_000,
      scbaPressurePct: NOW_MS - 4_000,
    },
  };
}

const BAND_GLYPH: Record<RiskBand, string> = {
  UNKNOWN: "?",
  SAFE: "SAFE",
  CAUTION: "CAUT",
  HIGH: "HIGH",
  CRITICAL: "CRIT",
};

function rule(c = "="): void {
  console.log(c.repeat(96));
}

rule();
console.log("VALORIS SEVERITY SWEEP — SIMULATION MODE, NOT FOR OPERATIONAL USE");
console.log(`model ${CONFIG.modelVersion}   config ${CONFIG.configHash}`);
console.log("Thresholds unchanged. Diagnostic only.");
rule();
console.log();
console.log("Fixed vitals for every firefighter at every step:");
console.log(
  `  HR ${FIXED_VITALS.hrBpm} bpm · SpO2 ${FIXED_VITALS.spo2Pct}% · est. core ${FIXED_VITALS.coreTempC} C · fatigue ${FIXED_VITALS.fatiguePct}% · hydration ${FIXED_VITALS.hydrationPct}%`,
);
console.log();
console.log("Escalation steps (environment and proximity only):");
console.log(
  "  step        ambient  hum   CO ppm  PM2.5   fire front  route      SCBA   time on task",
);
for (const s of STEPS) {
  console.log(
    `  ${s.label.padEnd(11)} ${String(s.ambientTempC).padStart(5)} C ${String(s.humidityPct).padStart(4)}% ${String(s.coPpm).padStart(7)} ${String(s.pm25UgM3).padStart(6)} ${String(s.fireFrontM).padStart(9)} m  ${s.escapeRouteStatus.padEnd(9)} ${String(s.scbaPressurePct).padStart(4)}% ${String(s.timeOnTaskMin).padStart(9)} min`,
  );
}
console.log();

type Cell = { band: RiskBand; score: number };
const grid = new Map<string, Cell[]>();

for (const profile of PROFILES) {
  const row: Cell[] = [];
  for (const step of STEPS) {
    const r = assessRisk(
      profile,
      FIXED_VITALS,
      environmentFor(step),
      positionFor(step),
      CONFIG,
      NOW_MS,
    );
    row.push({ band: r.band, score: r.score });
  }
  grid.set(profile.callsign, row);
}

/* ------------------------------------------------------------------------- */
rule("-");
console.log("BAND BY STEP");
rule("-");
console.log(
  `${"callsign".padEnd(11)}${"profile".padEnd(30)}${STEPS.map((s) => s.label.split(" ")[1]?.padStart(9) ?? "").join("")}`,
);
for (const profile of PROFILES) {
  const row = grid.get(profile.callsign) as Cell[];
  const summary = `${profile.age}y ${profile.fitness}/${profile.respiratoryRisk}/${profile.heatTolerance}`;
  console.log(
    `${profile.callsign.padEnd(11)}${summary.padEnd(30)}${row.map((c) => BAND_GLYPH[c.band].padStart(9)).join("")}`,
  );
}
console.log();

rule("-");
console.log("SCORE BY STEP");
rule("-");
console.log(
  `${"callsign".padEnd(11)}${STEPS.map((s) => s.label.split(" ")[1]?.padStart(9) ?? "").join("")}`,
);
for (const profile of PROFILES) {
  const row = grid.get(profile.callsign) as Cell[];
  console.log(
    `${profile.callsign.padEnd(11)}${row.map((c) => c.score.toFixed(1).padStart(9)).join("")}`,
  );
}
console.log();

/* ------------------------------------------------------------------------- */
rule("-");
console.log("SPREAD WITHIN EACH STEP");
rule("-");
console.log(
  `${"step".padEnd(12)}${"min".padStart(7)}${"max".padStart(8)}${"spread".padStart(9)}   distinct bands`,
);
STEPS.forEach((step, i) => {
  const scores = PROFILES.map(
    (p) => (grid.get(p.callsign) as Cell[])[i] as Cell,
  );
  const values = scores.map((c) => c.score);
  const bands = [...new Set(scores.map((c) => c.band))];
  const min = Math.min(...values);
  const max = Math.max(...values);
  console.log(
    `${step.label.padEnd(12)}${min.toFixed(1).padStart(7)}${max.toFixed(1).padStart(8)}${(max - min).toFixed(1).padStart(9)}   ${bands.join(", ")}${bands.length > 1 ? "   <- separated" : ""}`,
  );
});
console.log();

/* ------------------------------------------------------------------------- */
rule("-");
console.log("FIRST STEP AT WHICH EACH BAND IS REACHED");
rule("-");
const firstReached = new Map<string, Partial<Record<RiskBand, number>>>();
for (const profile of PROFILES) {
  const row = grid.get(profile.callsign) as Cell[];
  const first: Partial<Record<RiskBand, number>> = {};
  row.forEach((cell, i) => {
    if (first[cell.band] === undefined) first[cell.band] = i + 1;
  });
  firstReached.set(profile.callsign, first);
  console.log(
    `${profile.callsign.padEnd(11)} SAFE ${String(first.SAFE ?? "-").padStart(3)}   CAUTION ${String(first.CAUTION ?? "-").padStart(3)}   HIGH ${String(first.HIGH ?? "-").padStart(3)}   CRITICAL ${String(first.CRITICAL ?? "-").padStart(3)}`,
  );
}
console.log();

/* ------------------------------------------------------------------------- */
rule("-");
console.log("THE QUESTION ASKED: does BRAVO-2 reach HIGH while ALPHA-1 is still CAUTION?");
rule("-");
const alpha1 = grid.get("ALPHA-1") as Cell[];
const bravo2 = grid.get("BRAVO-2") as Cell[];
const separationSteps: number[] = [];
STEPS.forEach((step, i) => {
  const a = alpha1[i] as Cell;
  const b = bravo2[i] as Cell;
  const separated = BAND_SEVERITY[b.band] > BAND_SEVERITY[a.band];
  if (separated) separationSteps.push(i + 1);
  console.log(
    `  ${step.label.padEnd(12)} ALPHA-1 ${BAND_GLYPH[a.band].padEnd(5)} (${a.score.toFixed(1).padStart(5)})   BRAVO-2 ${BAND_GLYPH[b.band].padEnd(5)} (${b.score.toFixed(1).padStart(5)})   gap ${(b.score - a.score).toFixed(1).padStart(5)}${separated ? "   <- DIFFERENT BANDS" : ""}`,
  );
});
console.log();
const bravoHigh = firstReached.get("BRAVO-2")?.HIGH;
const alphaHigh = firstReached.get("ALPHA-1")?.HIGH;
if (bravoHigh === undefined) {
  console.log("  BRAVO-2 never reaches HIGH within this sweep.");
} else if (alphaHigh === undefined) {
  console.log(
    `  BRAVO-2 reaches HIGH at step ${bravoHigh}. ALPHA-1 never reaches HIGH within this sweep — separation of at least ${STEPS.length - bravoHigh + 1} step(s).`,
  );
} else {
  console.log(
    `  BRAVO-2 reaches HIGH at step ${bravoHigh}; ALPHA-1 at step ${alphaHigh}. Separation: ${alphaHigh - bravoHigh} step(s).`,
  );
}
console.log(
  separationSteps.length === 0
    ? "  The two never occupy different bands in this sweep."
    : `  They occupy different bands at step(s): ${separationSteps.join(", ")} of ${STEPS.length}.`,
);
console.log();

/* ------------------------------------------------------------------------- */
rule("-");
console.log("SUBSCORE BREAKDOWN AT EACH STEP — where the separation comes from");
rule("-");
for (const step of STEPS) {
  console.log(`  ${step.label}`);
  console.log(
    `    ${"callsign".padEnd(11)}${"phys".padStart(7)}${"env".padStart(7)}${"prox".padStart(7)}${"profile".padStart(9)}${"score".padStart(8)}   band`,
  );
  for (const profile of PROFILES) {
    const r = assessRisk(
      profile,
      FIXED_VITALS,
      environmentFor(step),
      positionFor(step),
      CONFIG,
      NOW_MS,
    );
    console.log(
      `    ${profile.callsign.padEnd(11)}${r.subscores.physiological.toFixed(1).padStart(7)}${r.subscores.environmental.toFixed(1).padStart(7)}${r.subscores.proximity.toFixed(1).padStart(7)}${r.subscores.profile.toFixed(1).padStart(9)}${r.score.toFixed(1).padStart(8)}   ${r.band}`,
    );
  }
  console.log();
}

rule();
console.log("No thresholds were changed. Band cut-offs remain 25 / 50 / 75, illustrative.");
rule();
