/**
 * Translates stored rows into the risk engine's plain input types.
 *
 * This is the seam. The engine takes `HealthProfile`, `Vitals`, `Environment`
 * and `Position` — plain data with no Prisma types, no fire providers and no
 * framework. Everything database- or provider-specific stops here.
 */

import type { FirefighterProfile, Observation } from "@prisma/client";

import type {
  Environment,
  HealthProfile,
  Position,
  Vitals,
} from "@/lib/risk/types";
import type { EscapeRouteStatus } from "@/lib/db/enums";

function parseStringArray(json: string): string[] {
  try {
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === "string");
  } catch {
    return [];
  }
}

export function toHealthProfile(row: FirefighterProfile): HealthProfile {
  return {
    id: row.id,
    callsign: row.callsign,
    age: row.ageYears,
    fitness: row.fitness as HealthProfile["fitness"],
    restingHrBpm: row.restingHrBpm,
    spo2BaselinePct: row.spo2BaselinePct,
    conditions: parseStringArray(row.conditionsJson),
    respiratoryRisk: row.respiratoryRisk as HealthProfile["respiratoryRisk"],
    heatTolerance: row.heatTolerance as HealthProfile["heatTolerance"],
    prevShiftHours: row.prevShiftHours,
    cumulativeCoExposureIndex: row.cumulativeCoExposureIndex,
    cumulativeHeatExposureIndex: row.cumulativeHeatExposureIndex,
  };
}

/** Only include a timestamp when both the value and its instant are present. */
function putTimestamp(
  target: Record<string, number>,
  key: string,
  value: number | null,
  updatedAt: Date | null,
): void {
  if (value === null || updatedAt === null) return;
  target[key] = updatedAt.getTime();
}

export function toVitals(
  row: Observation,
  recentSpo2Pct?: number[],
): Vitals {
  const lastUpdatedMs: Record<string, number> = {};
  putTimestamp(lastUpdatedMs, "hrBpm", row.hrBpm, row.hrUpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "spo2Pct", row.spo2Pct, row.spo2UpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "coreTempC", row.coreTempC, row.coreTempUpdatedAtUtc);
  putTimestamp(
    lastUpdatedMs,
    "respRatePerMin",
    row.respRatePerMin,
    row.respRateUpdatedAtUtc,
  );
  putTimestamp(lastUpdatedMs, "fatiguePct", row.fatiguePct, row.fatigueUpdatedAtUtc);
  putTimestamp(
    lastUpdatedMs,
    "hydrationPct",
    row.hydrationPct,
    row.hydrationUpdatedAtUtc,
  );

  const vitals: Vitals = {
    hrBpm: row.hrBpm,
    spo2Pct: row.spo2Pct,
    coreTempC: row.coreTempC,
    respRatePerMin: row.respRatePerMin,
    fatiguePct: row.fatiguePct,
    hydrationPct: row.hydrationPct,
    fallDetected: row.fallDetected,
    lastUpdatedMs,
  };
  if (recentSpo2Pct !== undefined && recentSpo2Pct.length > 0) {
    vitals.recentSpo2Pct = recentSpo2Pct;
  }
  return vitals;
}

export function toEnvironment(row: Observation): Environment {
  const lastUpdatedMs: Record<string, number> = {};
  putTimestamp(
    lastUpdatedMs,
    "ambientTempC",
    row.ambientTempC,
    row.ambientTempUpdatedAtUtc,
  );
  putTimestamp(lastUpdatedMs, "humidityPct", row.humidityPct, row.humidityUpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "coPpm", row.coPpm, row.coUpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "pm25UgM3", row.pm25UgM3, row.pm25UpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "windSpeedMs", row.windSpeedMs, row.windSpeedUpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "windDirDeg", row.windDirDeg, row.windDirUpdatedAtUtc);

  return {
    ambientTempC: row.ambientTempC,
    humidityPct: row.humidityPct,
    coPpm: row.coPpm,
    pm25UgM3: row.pm25UgM3,
    windSpeedMs: row.windSpeedMs,
    windDirDeg: row.windDirDeg,
    lastUpdatedMs,
  };
}

export function toPosition(row: Observation): Position {
  return {
    lat: row.lat,
    lng: row.lng,
    distanceToFireFrontM: row.distanceToFireFrontM,
    distanceToSafeZoneM: row.distanceToSafeZoneM,
    escapeRouteStatus: row.escapeRouteStatus as EscapeRouteStatus,
    scbaPressurePct: row.scbaPressurePct,
    scbaOnAir: row.scbaOnAir,
    timeOnTaskMin: row.timeOnTaskMin,
    manualMaydayActive: row.manualMaydayActive,
  };
}
