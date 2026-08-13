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
    glucoseMonitored: row.glucoseMonitored,
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

/**
 * Vitals as the risk engine sees them.
 *
 * `coreTempC` and `fatiguePct` come from the physiology models, not from the
 * reported sensor columns — see lib/incident/physiology-pipeline.ts. The
 * reported values remain on the row for the audit trail. Where a derivation is
 * absent (an observation stored before the models were wired in) the reported
 * value is used and that fact is visible in the row.
 */
export function toVitals(
  row: Observation,
  recentSpo2Pct?: number[],
): Vitals {
  const coreTempC = row.derivedCoreTempC ?? row.coreTempC;
  const coreTempAt =
    row.derivedCoreTempC === null
      ? row.coreTempUpdatedAtUtc
      : row.derivedCoreTempUpdatedAtUtc;
  const fatiguePct = row.derivedFatiguePct ?? row.fatiguePct;
  const fatigueAt =
    row.derivedFatiguePct === null
      ? row.fatigueUpdatedAtUtc
      : row.derivedFatigueUpdatedAtUtc;

  const lastUpdatedMs: Record<string, number> = {};
  putTimestamp(lastUpdatedMs, "hrBpm", row.hrBpm, row.hrUpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "spo2Pct", row.spo2Pct, row.spo2UpdatedAtUtc);
  putTimestamp(lastUpdatedMs, "coreTempC", coreTempC, coreTempAt);
  putTimestamp(
    lastUpdatedMs,
    "respRatePerMin",
    row.respRatePerMin,
    row.respRateUpdatedAtUtc,
  );
  putTimestamp(lastUpdatedMs, "fatiguePct", fatiguePct, fatigueAt);
  putTimestamp(
    lastUpdatedMs,
    "hydrationPct",
    row.hydrationPct,
    row.hydrationUpdatedAtUtc,
  );
  putTimestamp(
    lastUpdatedMs,
    "glucoseMmolL",
    row.glucoseMmolL,
    row.glucoseUpdatedAtUtc,
  );

  const vitals: Vitals = {
    hrBpm: row.hrBpm,
    spo2Pct: row.spo2Pct,
    coreTempC,
    respRatePerMin: row.respRatePerMin,
    fatiguePct,
    hydrationPct: row.hydrationPct,
    fallDetected: row.fallDetected,
    glucoseMmolL: row.glucoseMmolL,
    lastUpdatedMs,
  };
  if (recentSpo2Pct !== undefined && recentSpo2Pct.length > 0) {
    vitals.recentSpo2Pct = recentSpo2Pct;
  }

  // Declare that core temperature is modelled, not measured, and hand over the
  // estimator's own uncertainty. The risk engine uses both to cap confidence:
  // an estimate is weaker evidence than a measurement, and a wide estimate is
  // weaker still. Nothing in Valoris measures core temperature, so whenever a
  // derivation exists this is always true.
  if (row.derivedCoreTempC !== null) {
    vitals.coreTempIsEstimated = true;
    vitals.coreTempEstimateSdC = row.derivedCoreTempSdC;
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
  // positionFix and escapeRouteStatus are never null, so their timestamps are
  // recorded whenever present; the distances follow the nullable-value rule.
  const lastUpdatedMs: Record<string, number> = {};
  if (row.positionFixUpdatedAtUtc !== null) {
    lastUpdatedMs["positionFix"] = row.positionFixUpdatedAtUtc.getTime();
  }
  if (row.escapeRouteUpdatedAtUtc !== null) {
    lastUpdatedMs["escapeRouteStatus"] = row.escapeRouteUpdatedAtUtc.getTime();
  }
  putTimestamp(
    lastUpdatedMs,
    "distanceToFireFrontM",
    row.distanceToFireFrontM,
    row.distanceToFireFrontUpdatedAtUtc,
  );
  putTimestamp(
    lastUpdatedMs,
    "distanceToSafeZoneM",
    row.distanceToSafeZoneM,
    row.distanceToSafeZoneUpdatedAtUtc,
  );
  putTimestamp(
    lastUpdatedMs,
    "scbaPressurePct",
    row.scbaPressurePct,
    row.scbaPressureUpdatedAtUtc,
  );

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
    lastUpdatedMs,
  };
}
