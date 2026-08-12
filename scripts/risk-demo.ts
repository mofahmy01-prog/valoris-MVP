/**
 * Standalone proof that the risk engine runs with no framework, no database
 * and no UI. Run with: npm run risk:demo
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { DEFAULT_RISK_CONFIG } from "../lib/risk/default-config";
import { assessRisk } from "../lib/risk/engine";
import type { Environment, HealthProfile, Position, Vitals } from "../lib/risk/types";

const NOW_MS = 1_700_000_000_000;
const CONFIG = DEFAULT_RISK_CONFIG;

const PROFILES: HealthProfile[] = [
  {
    id: "ff-1",
    callsign: "ALPHA-1",
    age: 28,
    fitness: "high",
    restingHrBpm: 50,
    spo2BaselinePct: 98,
    conditions: [],
    respiratoryRisk: "none",
    heatTolerance: "high",
    prevShiftHours: 0,
    cumulativeCoExposureIndex: 0.05,
    cumulativeHeatExposureIndex: 0.05,
  },
  {
    id: "ff-2",
    callsign: "ALPHA-2",
    age: 41,
    fitness: "moderate",
    restingHrBpm: 62,
    spo2BaselinePct: 97,
    conditions: ["mild hypertension"],
    respiratoryRisk: "none",
    heatTolerance: "avg",
    prevShiftHours: 4,
    cumulativeCoExposureIndex: 0.15,
    cumulativeHeatExposureIndex: 0.2,
  },
  {
    id: "ff-3",
    callsign: "BRAVO-1",
    age: 34,
    fitness: "high",
    restingHrBpm: 55,
    spo2BaselinePct: 98,
    conditions: ["type 1 diabetes"],
    respiratoryRisk: "none",
    heatTolerance: "avg",
    prevShiftHours: 2,
    cumulativeCoExposureIndex: 0.1,
    cumulativeHeatExposureIndex: 0.1,
  },
  {
    id: "ff-4",
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
  },
  {
    id: "ff-5",
    callsign: "CHARLIE-1",
    age: 45,
    fitness: "low",
    restingHrBpm: 78,
    spo2BaselinePct: 96,
    conditions: [],
    respiratoryRisk: "none",
    heatTolerance: "low",
    prevShiftHours: 11,
    cumulativeCoExposureIndex: 0.4,
    cumulativeHeatExposureIndex: 0.45,
  },
  {
    id: "ff-6",
    callsign: "CHARLIE-2",
    age: 38,
    fitness: "moderate",
    restingHrBpm: 64,
    spo2BaselinePct: 96,
    conditions: ["mild reactive airway"],
    respiratoryRisk: "mild",
    heatTolerance: "avg",
    prevShiftHours: 3,
    cumulativeCoExposureIndex: 0.2,
    cumulativeHeatExposureIndex: 0.2,
  },
];

const IDENTICAL_VITALS: Vitals = {
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

const IDENTICAL_POSITION: Position = {
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

function line(char = "-"): string {
  return char.repeat(78);
}

console.log(line("="));
console.log("VALORIS — SIMULATION MODE — NOT FOR OPERATIONAL USE");
console.log("Not a medical device. Not clinically validated. Illustrative thresholds only.");
console.log(`model ${CONFIG.modelVersion}   config ${CONFIG.configHash}`);
console.log(line("="));
console.log();
console.log("Identical vitals, identical environment, identical position.");
console.log(
  `HR ${IDENTICAL_VITALS.hrBpm} bpm · SpO2 ${IDENTICAL_VITALS.spo2Pct}% · est. core ${IDENTICAL_VITALS.coreTempC} C · fatigue ${IDENTICAL_VITALS.fatiguePct}%`,
);
console.log(
  `Ambient ${IDENTICAL_ENV.ambientTempC} C · CO ${IDENTICAL_ENV.coPpm} ppm · PM2.5 ${IDENTICAL_ENV.pm25UgM3} ug/m3 · fire front ${IDENTICAL_POSITION.distanceToFireFrontM} m · SCBA ${IDENTICAL_POSITION.scbaPressurePct}%`,
);
console.log();

for (const profile of PROFILES) {
  const r = assessRisk(
    profile,
    IDENTICAL_VITALS,
    IDENTICAL_ENV,
    IDENTICAL_POSITION,
    CONFIG,
    NOW_MS,
  );
  console.log(line());
  console.log(
    `${profile.callsign.padEnd(10)} age ${String(profile.age).padStart(2)}  ${profile.fitness.padEnd(8)} fitness  resp:${profile.respiratoryRisk.padEnd(8)} heat:${profile.heatTolerance}`,
  );
  console.log(
    `  score ${String(r.score).padStart(5)}   band ${r.band.padEnd(9)} confidence ${r.dataQuality.confidence}`,
  );
  console.log(
    `  subscores  phys ${r.subscores.physiological}  env ${r.subscores.environmental}  prox ${r.subscores.proximity}  profile ${r.subscores.profile}`,
  );
  for (const d of r.topDrivers) console.log(`  driver: ${d}`);
  console.log(`  ${r.explanation}`);
}

console.log(line());
console.log();

// Sensor dropout: the staleness rules alone move the band. No special case.
const droppedVitals: Vitals = {
  ...IDENTICAL_VITALS,
  lastUpdatedMs: { ...IDENTICAL_VITALS.lastUpdatedMs, hrBpm: NOW_MS - 180_000 },
};

const BENIGN_ENV: Environment = {
  ...IDENTICAL_ENV,
  ambientTempC: 21,
  humidityPct: 40,
  coPpm: 3,
  pm25UgM3: 10,
};
const BENIGN_POSITION: Position = {
  ...IDENTICAL_POSITION,
  distanceToFireFrontM: 1200,
  scbaPressurePct: 92,
  timeOnTaskMin: 4,
};

const droppedBenign = assessRisk(
  PROFILES[0] as HealthProfile,
  droppedVitals,
  BENIGN_ENV,
  BENIGN_POSITION,
  CONFIG,
  NOW_MS,
);
console.log(
  "Sensor dropout — ALPHA-1 heart rate last updated 180 s ago, otherwise quiet:",
);
console.log(
  `  band ${droppedBenign.band}  confidence ${droppedBenign.dataQuality.confidence}`,
);
console.log(`  ${droppedBenign.dataQuality.note}`);
console.log();

const droppedHot = assessRisk(
  PROFILES[0] as HealthProfile,
  droppedVitals,
  IDENTICAL_ENV,
  IDENTICAL_POSITION,
  CONFIG,
  NOW_MS,
);
console.log(
  "Same dropout, but the remaining evidence is already elevated — the more",
);
console.log("severe band wins rather than collapsing to UNKNOWN:");
console.log(`  band ${droppedHot.band}  confidence ${droppedHot.dataQuality.confidence}`);
console.log();

// Determinism.
const a = assessRisk(
  PROFILES[3] as HealthProfile,
  IDENTICAL_VITALS,
  IDENTICAL_ENV,
  IDENTICAL_POSITION,
  CONFIG,
  NOW_MS,
);
const b = assessRisk(
  PROFILES[3] as HealthProfile,
  IDENTICAL_VITALS,
  IDENTICAL_ENV,
  IDENTICAL_POSITION,
  CONFIG,
  NOW_MS,
);
console.log(
  `Determinism check: ${JSON.stringify(a) === JSON.stringify(b) ? "identical output" : "MISMATCH"}`,
);
