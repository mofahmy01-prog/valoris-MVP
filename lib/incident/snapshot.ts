/**
 * Builds the live incident picture: latest observation per deployed
 * firefighter, the risk assessment derived from it, and the current fire front.
 *
 * The fire front is fetched from whichever provider the incident selected, and
 * its provenance travels with it. The engine call below receives only the
 * numbers already stored on the observation.
 */

import { prisma } from "@/lib/db/client";
import { createFireFrontProvider } from "@/lib/fire/registry";
import type { FireFront, FireFrontProviderKey } from "@/lib/fire/types";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import type { RiskAssessment } from "@/lib/risk/types";

import {
  toEnvironment,
  toHealthProfile,
  toPosition,
  toVitals,
} from "./mapping";

/** How many prior SpO2 readings to hand the engine for override confirmation. */
const SPO2_HISTORY_TICKS = 3;

export type FirefighterSnapshot = {
  deploymentId: string;
  firefighterId: string;
  callsign: string;
  crewName: string;
  profile: {
    ageYears: number;
    fitness: string;
    respiratoryRisk: string;
    heatTolerance: string;
    conditions: string[];
    prevShiftHours: number;
    restingHrBpm: number;
    spo2BaselinePct: number;
  };
  latestObservationAtUtc: string | null;
  risk: RiskAssessment | null;
  reason?: string;
};

export type IncidentSnapshot = {
  incident: {
    id: string;
    name: string;
    status: string;
    scenarioKey: string;
    createdAtUtc: string;
    startedAtUtc: string | null;
    stoppedAtUtc: string | null;
    centroidLat: number;
    centroidLng: number;
    modelVersion: string;
    configHash: string;
  };
  fireFront: (FireFront & { unavailableReason?: string }) | { unavailableReason: string; providerKey: string; providerLabel: string };
  firefighters: FirefighterSnapshot[];
  generatedAtUtc: string;
};

export async function buildIncidentSnapshot(
  incidentId: string,
  nowMs: number = Date.now(),
): Promise<IncidentSnapshot | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      deployments: {
        include: { firefighter: true, crew: true },
        orderBy: { assignedAtUtc: "asc" },
      },
    },
  });
  if (incident === null) return null;

  const config = DEFAULT_RISK_CONFIG;
  const firefighters: FirefighterSnapshot[] = [];

  for (const deployment of incident.deployments) {
    const history = await prisma.observation.findMany({
      where: { deploymentId: deployment.id },
      orderBy: { recordedAtUtc: "desc" },
      take: SPO2_HISTORY_TICKS,
    });
    const latest = history[0];

    const base = {
      deploymentId: deployment.id,
      firefighterId: deployment.firefighterProfileId,
      callsign: deployment.firefighter.callsign,
      crewName: deployment.crew.name,
      profile: {
        ageYears: deployment.firefighter.ageYears,
        fitness: deployment.firefighter.fitness,
        respiratoryRisk: deployment.firefighter.respiratoryRisk,
        heatTolerance: deployment.firefighter.heatTolerance,
        conditions: JSON.parse(deployment.firefighter.conditionsJson) as string[],
        prevShiftHours: deployment.firefighter.prevShiftHours,
        restingHrBpm: deployment.firefighter.restingHrBpm,
        spo2BaselinePct: deployment.firefighter.spo2BaselinePct,
      },
    };

    if (latest === undefined) {
      firefighters.push({
        ...base,
        latestObservationAtUtc: null,
        risk: null,
        reason:
          "No observation recorded yet. Absence of data is not a safe reading — no band is reported.",
      });
      continue;
    }

    // Oldest first, current last, as the engine expects.
    const recentSpo2Pct = history
      .slice()
      .reverse()
      .map((row) => row.spo2Pct)
      .filter((v): v is number => v !== null);

    firefighters.push({
      ...base,
      latestObservationAtUtc: latest.recordedAtUtc.toISOString(),
      risk: assessRisk(
        toHealthProfile(deployment.firefighter),
        toVitals(latest, recentSpo2Pct),
        toEnvironment(latest),
        toPosition(latest),
        config,
        nowMs,
      ),
    });
  }

  const fireFront = await resolveFireFront(incident, nowMs);

  return {
    incident: {
      id: incident.id,
      name: incident.name,
      status: incident.status,
      scenarioKey: incident.scenarioKey,
      createdAtUtc: incident.createdAtUtc.toISOString(),
      startedAtUtc: incident.startedAtUtc?.toISOString() ?? null,
      stoppedAtUtc: incident.stoppedAtUtc?.toISOString() ?? null,
      centroidLat: incident.centroidLat,
      centroidLng: incident.centroidLng,
      modelVersion: incident.modelVersion,
      configHash: incident.configHash,
    },
    fireFront,
    firefighters,
    generatedAtUtc: new Date(nowMs).toISOString(),
  };
}

type IncidentRow = {
  id: string;
  fireProviderKey: string;
  centroidLat: number;
  centroidLng: number;
  startedAtUtc: Date | null;
};

export async function resolveFireFront(
  incident: IncidentRow,
  nowMs: number,
  atMs: number = nowMs,
): Promise<IncidentSnapshot["fireFront"]> {
  const provider = createFireFrontProvider(
    incident.fireProviderKey as FireFrontProviderKey,
  );
  if (!provider.isAvailable()) {
    return {
      providerKey: provider.key,
      providerLabel: provider.label,
      unavailableReason: provider.unavailableReason(),
    };
  }

  // Latest reported wind for the incident, if any observation carries it.
  const windRow = await prisma.observation.findFirst({
    where: { incidentId: incident.id, windSpeedMs: { not: null } },
    orderBy: { recordedAtUtc: "desc" },
    select: { windSpeedMs: true, windDirDeg: true },
  });

  const startedMs = incident.startedAtUtc?.getTime() ?? nowMs;
  try {
    return await provider.getFireFront({
      atMs,
      nowMs,
      origin: { lat: incident.centroidLat, lng: incident.centroidLng },
      windSpeedMs: windRow?.windSpeedMs ?? null,
      windDirDeg: windRow?.windDirDeg ?? null,
      elapsedMs: Math.max(0, atMs - startedMs),
    });
  } catch (error) {
    return {
      providerKey: provider.key,
      providerLabel: provider.label,
      unavailableReason:
        error instanceof Error ? error.message : "Fire front unavailable",
    };
  }
}
