/**
 * Compare view data — the demo's main moment.
 *
 * Runs the REAL `assessRisk` against the six profiles under IDENTICAL vitals,
 * environment and position, at a chosen severity step. No database involved.
 *
 * Nothing here recomputes or reinterprets the engine: it calls it and renders
 * what comes back.
 */

import { ok } from "@/lib/api/respond";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import type {
  Environment,
  HealthProfile,
  Position,
  Vitals,
} from "@/lib/risk/types";

export const dynamic = "force-dynamic";

const NOW_MS = 1_700_000_000_000;

const PROFILES: HealthProfile[] = [
  { id: "ff-1", callsign: "ALPHA-1", age: 28, fitness: "high", restingHrBpm: 50, spo2BaselinePct: 98, conditions: [], respiratoryRisk: "none", heatTolerance: "high", prevShiftHours: 0, cumulativeCoExposureIndex: 0.05, cumulativeHeatExposureIndex: 0.05 },
  { id: "ff-3", callsign: "BRAVO-1", age: 34, fitness: "high", restingHrBpm: 55, spo2BaselinePct: 98, conditions: ["type 1 diabetes"], respiratoryRisk: "none", heatTolerance: "avg", prevShiftHours: 2, cumulativeCoExposureIndex: 0.1, cumulativeHeatExposureIndex: 0.1 },
  { id: "ff-6", callsign: "CHARLIE-2", age: 38, fitness: "moderate", restingHrBpm: 64, spo2BaselinePct: 96, conditions: ["mild reactive airway"], respiratoryRisk: "mild", heatTolerance: "avg", prevShiftHours: 3, cumulativeCoExposureIndex: 0.2, cumulativeHeatExposureIndex: 0.2 },
  { id: "ff-2", callsign: "ALPHA-2", age: 41, fitness: "moderate", restingHrBpm: 62, spo2BaselinePct: 97, conditions: ["mild hypertension"], respiratoryRisk: "none", heatTolerance: "avg", prevShiftHours: 4, cumulativeCoExposureIndex: 0.15, cumulativeHeatExposureIndex: 0.2 },
  { id: "ff-5", callsign: "CHARLIE-1", age: 45, fitness: "low", restingHrBpm: 78, spo2BaselinePct: 96, conditions: [], respiratoryRisk: "none", heatTolerance: "low", prevShiftHours: 11, cumulativeCoExposureIndex: 0.4, cumulativeHeatExposureIndex: 0.45 },
  { id: "ff-4", callsign: "BRAVO-2", age: 52, fitness: "moderate", restingHrBpm: 70, spo2BaselinePct: 95, conditions: ["moderate asthma"], respiratoryRisk: "moderate", heatTolerance: "low", prevShiftHours: 6, cumulativeCoExposureIndex: 0.35, cumulativeHeatExposureIndex: 0.3 },
];

const CONDITION_LABEL: Record<string, string> = {
  "ALPHA-1": "—",
  "ALPHA-2": "hypertension",
  "BRAVO-1": "T1 diabetes",
  "BRAVO-2": "mod. asthma",
  "CHARLIE-1": "prev shift 11h",
  "CHARLIE-2": "mild resp.",
};

const SEVERITY_STEPS = [
  { label: "benign", ambientTempC: 18, humidityPct: 35, coPpm: 2, pm25UgM3: 8, fireFrontM: 2000, scbaPressurePct: 95, timeOnTaskMin: 5, escapeRouteStatus: "clear" },
  { label: "light", ambientTempC: 26, humidityPct: 45, coPpm: 15, pm25UgM3: 30, fireFrontM: 900, scbaPressurePct: 80, timeOnTaskMin: 12, escapeRouteStatus: "clear" },
  { label: "moderate", ambientTempC: 32, humidityPct: 55, coPpm: 35, pm25UgM3: 70, fireFrontM: 450, scbaPressurePct: 65, timeOnTaskMin: 20, escapeRouteStatus: "clear" },
  { label: "heavy", ambientTempC: 38, humidityPct: 60, coPpm: 70, pm25UgM3: 130, fireFrontM: 250, scbaPressurePct: 50, timeOnTaskMin: 30, escapeRouteStatus: "degraded" },
  { label: "severe", ambientTempC: 46, humidityPct: 70, coPpm: 130, pm25UgM3: 220, fireFrontM: 120, scbaPressurePct: 38, timeOnTaskMin: 42, escapeRouteStatus: "degraded" },
  { label: "extreme", ambientTempC: 55, humidityPct: 80, coPpm: 220, pm25UgM3: 380, fireFrontM: 60, scbaPressurePct: 28, timeOnTaskMin: 55, escapeRouteStatus: "degraded" },
] as const;

/** Identical for every firefighter — that is the entire point. */
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

export async function GET(request: Request) {
  const url = new URL(request.url);
  const raw = Number.parseInt(url.searchParams.get("severity") ?? "2", 10);
  const index = Number.isFinite(raw)
    ? Math.min(SEVERITY_STEPS.length - 1, Math.max(0, raw))
    : 2;
  const step = SEVERITY_STEPS[index] as (typeof SEVERITY_STEPS)[number];

  const env: Environment = {
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

  const pos: Position = {
    lat: 34.0459,
    lng: -118.5426,
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

  const hrMaxConstant = DEFAULT_RISK_CONFIG.parameters["hr_max_age_constant_bpm"].value;

  const rows = PROFILES.map((profile) => {
    const r = assessRisk(profile, IDENTICAL_VITALS, env, pos, DEFAULT_RISK_CONFIG, NOW_MS);
    const hrMax = hrMaxConstant - profile.age;
    return {
      callsign: profile.callsign,
      age: profile.age,
      fitness: profile.fitness,
      conditions: CONDITION_LABEL[profile.callsign] ?? "—",
      hrMaxBpm: hrMax,
      hrPercentOfMax: Math.round(((IDENTICAL_VITALS.hrBpm as number) / hrMax) * 100),
      score: r.score,
      band: r.band,
      topDriver: r.topDrivers[0] ?? "",
    };
  });

  return ok({
    severityIndex: index,
    severityLabel: step.label,
    conditions: {
      hrBpm: IDENTICAL_VITALS.hrBpm,
      spo2Pct: IDENTICAL_VITALS.spo2Pct,
      ambientTempC: step.ambientTempC,
      humidityPct: step.humidityPct,
      coPpm: step.coPpm,
      pm25UgM3: step.pm25UgM3,
      fireFrontM: step.fireFrontM,
      scbaPressurePct: step.scbaPressurePct,
    },
    steps: SEVERITY_STEPS.map((s) => s.label),
    rows,
  });
}
