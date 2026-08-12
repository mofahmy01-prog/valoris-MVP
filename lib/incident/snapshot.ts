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
  PROVENANCE,
  provenanceStrip,
  tierSummary,
  TIER_DISCLOSURE,
  type ObservationProvenance,
  type ProvenanceStripLine,
} from "@/lib/provenance";

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
  /**
   * What the physiology models produced for this tick. `coreTempC` and
   * `fatiguePct` in `risk` came from here, not from a sensor.
   */
  physiology: {
    coreTempC: number | null;
    coreTempIsModelled: boolean;
    reportedCoreTempC: number | null;
    coreTempLimitC: number | null;
    /** Estimator uncertainty. This is what reduces risk confidence. */
    coreTempSdC: number | null;
    /** False when heart rate was absent and the filter only extrapolated. */
    coreTempObserved: boolean | null;
    fatiguePct: number | null;
    hrrFraction: number | null;
    effectiveHrReserveBpm: number | null;
    metabolicRateWm2: number | null;
    heatStorageWm2: number | null;
    predictedSweatRateGPerHour: number | null;
    dlimMin: number | null;
    heatStrainLimiter: string | null;
    cohbPct: number | null;
    coIndex: number | null;
    pm25DoseUgMinM3: number | null;
    pm25Index: number | null;
    stepMinutes: number | null;
    stepCapped: boolean | null;
    caveats: string[];
    modelVersion: string | null;
    configHash: string | null;
  } | null;
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
  /**
   * The data provenance strip the Data Addendum requires on the commander
   * dashboard. Structured, so the UI cannot paraphrase it into something softer
   * than the truth.
   */
  provenance: {
    dataTierSummary: string;
    strip: ProvenanceStripLine[];
    domains: ObservationProvenance;
    disclosures: string[];
    tierBInUse: boolean;
    note: string;
  };
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
        physiology: null,
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
      physiology: {
        coreTempC: latest.derivedCoreTempC,
        coreTempIsModelled: latest.derivedCoreTempC !== null,
        reportedCoreTempC: latest.coreTempC,
        coreTempLimitC: latest.derivedCoreTempLimitC,
        coreTempSdC: latest.derivedCoreTempSdC,
        coreTempObserved: latest.derivedCoreTempObserved,
        fatiguePct: latest.derivedFatiguePct,
        hrrFraction: latest.derivedHrrFraction,
        effectiveHrReserveBpm: latest.derivedEffectiveHrReserveBpm,
        metabolicRateWm2: latest.derivedMetabolicRateWm2,
        heatStorageWm2: latest.derivedHeatStorageWm2,
        predictedSweatRateGPerHour: latest.derivedSweatRateGPerHour,
        dlimMin: latest.derivedDlimMin,
        heatStrainLimiter: latest.derivedHeatStrainLimiter,
        cohbPct: latest.derivedCohbPct,
        coIndex: latest.derivedCoIndex,
        pm25DoseUgMinM3: latest.derivedPm25DoseUgMinM3,
        pm25Index: latest.derivedPm25Index,
        stepMinutes: latest.derivedStepMinutes,
        stepCapped: latest.derivedStepCapped,
        caveats:
          latest.physiologyCaveatsJson === null
            ? []
            : (JSON.parse(latest.physiologyCaveatsJson) as string[]),
        modelVersion: latest.physiologyModelVersion,
        configHash: latest.physiologyConfigHash,
      },
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

  // Provenance for the strip. Read from the most recent observation where one
  // exists, so the strip reflects what was actually recorded rather than what
  // this code assumes; otherwise fall back to the declared defaults.
  const latestWithProvenance = await prisma.observation.findFirst({
    where: { incidentId },
    orderBy: { recordedAtUtc: "desc" },
    select: { provenanceJson: true },
  });

  let domains: ObservationProvenance = {
    environment: PROVENANCE.simulatedEnvironment,
    vitals: PROVENANCE.simulatedVitals,
    position: PROVENANCE.simulatedPosition,
    derivedPhysiology: PROVENANCE.derivedPhysiology,
    fireFront:
      "isFireBehaviourPrediction" in fireFront && fireFront.isFireBehaviourPrediction
        ? PROVENANCE.observedPerimeter
        : "perimeter" in fireFront
          ? PROVENANCE.geometricFireFront
          : PROVENANCE.unavailableFireFront,
  };
  if (
    latestWithProvenance !== null &&
    latestWithProvenance.provenanceJson !== "{}"
  ) {
    try {
      domains = JSON.parse(
        latestWithProvenance.provenanceJson,
      ) as ObservationProvenance;
    } catch {
      // Keep the defaults rather than reporting a provenance we cannot parse.
    }
  }

  const strip = provenanceStrip(domains);
  const tierBInUse = strip.some(
    (line) => line.tier === "B_REAL_WEARABLE_NON_FIREFIGHTER",
  );

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
    provenance: {
      dataTierSummary: tierSummary(domains),
      strip,
      domains,
      disclosures: [...new Set(strip.map((line) => TIER_DISCLOSURE[line.tier]))],
      tierBInUse,
      note: tierBInUse
        ? "Tier B signal characteristics are in use. They come from non-firefighter human subjects and do not validate firefighter thresholds."
        : "No Tier B data is in use: no signal-noise model has been built, so nothing here claims real wearable texture.",
    },
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
