/**
 * The single ingestion path. The simulator uses exactly this route, so nothing
 * in the demo takes a shortcut a real sensor feed would not have.
 *
 * Per observation:
 *  1. Validate with Zod (400 on anything malformed)
 *  2. Derive distance to the fire front, if the caller did not supply one, from
 *     whichever provider the incident selected — this is the only place fire
 *     geometry touches an observation
 *  3. Append the observation (append-only table)
 *  4. Run the risk engine and append the assessment
 *  5. Append audit events, including a band transition when the band changed
 */

import { prisma } from "@/lib/db/client";
import { appendAuditEvent } from "@/lib/db/audit";
import { notFound, ok, parseJsonBody } from "@/lib/api/respond";
import { postObservationsSchema } from "@/lib/api/schemas";
import { distanceToPerimeterM } from "@/lib/fire/geometry";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import {
  toEnvironment,
  toHealthProfile,
  toPosition,
  toVitals,
} from "@/lib/incident/mapping";
import { resolveFireFront } from "@/lib/incident/snapshot";

export const dynamic = "force-dynamic";

const SPO2_HISTORY_TICKS = 3;

type Channel = { value: number | null; updatedAtUtc?: Date | null } | undefined;

function channelValue(channel: Channel): number | null {
  return channel?.value ?? null;
}

/**
 * A channel's timestamp. Defaults to the observation time when the caller gave
 * a value without one; a value with no instant would otherwise be unusable by
 * the staleness rules.
 */
function channelTimestamp(channel: Channel, fallback: Date): Date | null {
  if (channel === undefined || channel.value === null) return null;
  return channel.updatedAtUtc ?? fallback;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, postObservationsSchema);
  if (!parsed.ok) return parsed.response;

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      deployments: { include: { firefighter: true } },
    },
  });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const byCallsign = new Map(
    incident.deployments.map((d) => [d.firefighter.callsign, d]),
  );

  const unknownCallsigns = parsed.data.observations
    .map((o) => o.callsign)
    .filter((callsign) => !byCallsign.has(callsign));
  if (unknownCallsigns.length > 0) {
    return notFound(
      `These callsigns are not deployed on this incident: ${[...new Set(unknownCallsigns)].join(", ")}`,
    );
  }

  const nowMs = Date.now();
  const front = await resolveFireFront(incident, nowMs);
  const havePerimeter = "perimeter" in front && front.perimeter.length >= 3;

  const results: Array<{
    callsign: string;
    observationId: string;
    band: string;
    score: number;
    confidence: string;
    previousBand: string | null;
    distanceToFireFrontM: number | null;
    fireFrontConfidence: string | null;
  }> = [];

  for (const input of parsed.data.observations) {
    const deployment = byCallsign.get(input.callsign);
    if (deployment === undefined) continue; // already rejected above

    const recordedAt = input.recordedAtUtc;

    // Derive the distance only when the caller did not measure one. Valoris
    // computes separation from a supplied perimeter; it never invents the
    // perimeter itself.
    let distanceToFireFrontM = input.position.distanceToFireFrontM ?? null;
    let fireFrontConfidence: string | null = null;
    if (distanceToFireFrontM === null && havePerimeter && "perimeter" in front) {
      distanceToFireFrontM = Math.round(
        distanceToPerimeterM(
          { lat: input.position.lat, lng: input.position.lng },
          front.perimeter,
        ),
      );
      fireFrontConfidence = front.confidence;
    } else if ("confidence" in front) {
      fireFrontConfidence = front.confidence;
    }

    const observation = await prisma.observation.create({
      data: {
        incidentId: incident.id,
        deploymentId: deployment.id,
        recordedAtUtc: recordedAt,
        source: input.source,

        hrBpm: channelValue(input.vitals.hrBpm),
        spo2Pct: channelValue(input.vitals.spo2Pct),
        coreTempC: channelValue(input.vitals.coreTempC),
        respRatePerMin: channelValue(input.vitals.respRatePerMin),
        fatiguePct: channelValue(input.vitals.fatiguePct),
        hydrationPct: channelValue(input.vitals.hydrationPct),
        fallDetected: input.vitals.fallDetected,

        hrUpdatedAtUtc: channelTimestamp(input.vitals.hrBpm, recordedAt),
        spo2UpdatedAtUtc: channelTimestamp(input.vitals.spo2Pct, recordedAt),
        coreTempUpdatedAtUtc: channelTimestamp(input.vitals.coreTempC, recordedAt),
        respRateUpdatedAtUtc: channelTimestamp(input.vitals.respRatePerMin, recordedAt),
        fatigueUpdatedAtUtc: channelTimestamp(input.vitals.fatiguePct, recordedAt),
        hydrationUpdatedAtUtc: channelTimestamp(input.vitals.hydrationPct, recordedAt),

        ambientTempC: channelValue(input.environment.ambientTempC),
        humidityPct: channelValue(input.environment.humidityPct),
        coPpm: channelValue(input.environment.coPpm),
        pm25UgM3: channelValue(input.environment.pm25UgM3),
        windSpeedMs: channelValue(input.environment.windSpeedMs),
        windDirDeg: channelValue(input.environment.windDirDeg),

        ambientTempUpdatedAtUtc: channelTimestamp(input.environment.ambientTempC, recordedAt),
        humidityUpdatedAtUtc: channelTimestamp(input.environment.humidityPct, recordedAt),
        coUpdatedAtUtc: channelTimestamp(input.environment.coPpm, recordedAt),
        pm25UpdatedAtUtc: channelTimestamp(input.environment.pm25UgM3, recordedAt),
        windSpeedUpdatedAtUtc: channelTimestamp(input.environment.windSpeedMs, recordedAt),
        windDirUpdatedAtUtc: channelTimestamp(input.environment.windDirDeg, recordedAt),

        lat: input.position.lat,
        lng: input.position.lng,
        distanceToFireFrontM,
        distanceToSafeZoneM: input.position.distanceToSafeZoneM ?? null,
        escapeRouteStatus: input.position.escapeRouteStatus,
        scbaPressurePct: input.position.scbaPressurePct ?? null,
        scbaOnAir: input.position.scbaOnAir,
        timeOnTaskMin: input.position.timeOnTaskMin,
        manualMaydayActive: input.position.manualMaydayActive,

        fireProviderKey: incident.fireProviderKey,
        fireFrontConfidence,
      },
    });

    // Prior SpO2 readings for the override confirmation window, and the prior
    // band for transition detection.
    const [history, previous] = await Promise.all([
      prisma.observation.findMany({
        where: { deploymentId: deployment.id },
        orderBy: { recordedAtUtc: "desc" },
        take: SPO2_HISTORY_TICKS,
      }),
      prisma.riskAssessmentRecord.findFirst({
        where: { deploymentId: deployment.id },
        orderBy: { calculatedAtUtc: "desc" },
      }),
    ]);

    const recentSpo2Pct = history
      .slice()
      .reverse()
      .map((row) => row.spo2Pct)
      .filter((v): v is number => v !== null);

    const assessment = assessRisk(
      toHealthProfile(deployment.firefighter),
      toVitals(observation, recentSpo2Pct),
      toEnvironment(observation),
      toPosition(observation),
      DEFAULT_RISK_CONFIG,
      recordedAt.getTime(),
    );

    await prisma.riskAssessmentRecord.create({
      data: {
        incidentId: incident.id,
        deploymentId: deployment.id,
        observationId: observation.id,
        calculatedAtUtc: new Date(assessment.calculatedAtMs),
        scoreValue: assessment.score,
        band: assessment.band,
        physiologicalSubscore: assessment.subscores.physiological,
        environmentalSubscore: assessment.subscores.environmental,
        proximitySubscore: assessment.subscores.proximity,
        profileSubscore: assessment.subscores.profile,
        hardOverride: assessment.hardOverride,
        hardOverrideReasonsJson: JSON.stringify(assessment.hardOverrideReasons),
        topDriversJson: JSON.stringify(assessment.topDrivers),
        explanation: assessment.explanation,
        confidence: assessment.dataQuality.confidence,
        staleInputsJson: JSON.stringify(assessment.dataQuality.staleInputs),
        missingInputsJson: JSON.stringify(assessment.dataQuality.missingInputs),
        oldestReadingAgeSec: assessment.dataQuality.oldestReadingAgeSec,
        dataQualityNote: assessment.dataQuality.note,
        modelVersion: assessment.modelVersion,
        configHash: assessment.configHash,
      },
    });

    await appendAuditEvent({
      incidentId: incident.id,
      eventType: "risk_assessed",
      actorLabel: parsed.data.actorLabel,
      summary: `${deployment.firefighter.callsign} assessed ${assessment.band} at ${assessment.score}/100 (confidence ${assessment.dataQuality.confidence})`,
      detail: {
        callsign: deployment.firefighter.callsign,
        observationId: observation.id,
        band: assessment.band,
        score: assessment.score,
        subscores: assessment.subscores,
        hardOverride: assessment.hardOverride,
        hardOverrideReasons: assessment.hardOverrideReasons,
        topDrivers: assessment.topDrivers,
        confidence: assessment.dataQuality.confidence,
        staleInputs: assessment.dataQuality.staleInputs,
        missingInputs: assessment.dataQuality.missingInputs,
        modelVersion: assessment.modelVersion,
        configHash: assessment.configHash,
      },
      occurredAtUtc: recordedAt,
    });

    const previousBand = previous?.band ?? null;
    if (previousBand !== null && previousBand !== assessment.band) {
      await appendAuditEvent({
        incidentId: incident.id,
        eventType: "band_transition",
        actorLabel: "system",
        summary: `${deployment.firefighter.callsign} moved ${previousBand} to ${assessment.band}`,
        detail: {
          callsign: deployment.firefighter.callsign,
          from: previousBand,
          to: assessment.band,
          score: assessment.score,
          confidence: assessment.dataQuality.confidence,
          missingInputs: assessment.dataQuality.missingInputs,
          topDrivers: assessment.topDrivers,
        },
        occurredAtUtc: recordedAt,
      });
    }

    results.push({
      callsign: deployment.firefighter.callsign,
      observationId: observation.id,
      band: assessment.band,
      score: assessment.score,
      confidence: assessment.dataQuality.confidence,
      previousBand,
      distanceToFireFrontM,
      fireFrontConfidence,
    });
  }

  await appendAuditEvent({
    incidentId: incident.id,
    eventType: "observation_ingested",
    actorLabel: parsed.data.actorLabel,
    summary: `${results.length} observation(s) ingested`,
    detail: {
      count: results.length,
      callsigns: results.map((r) => r.callsign),
      fireProviderKey: incident.fireProviderKey,
      fireFrontAvailable: havePerimeter,
    },
  });

  return ok(
    {
      ingested: results.length,
      fireFront: havePerimeter
        ? {
            providerKey: "providerKey" in front ? front.providerKey : null,
            providerLabel: "providerLabel" in front ? front.providerLabel : null,
            confidence: "confidence" in front ? front.confidence : null,
            isFireBehaviourPrediction:
              "isFireBehaviourPrediction" in front
                ? front.isFireBehaviourPrediction
                : false,
            provenance: "provenance" in front ? front.provenance : null,
          }
        : { unavailableReason: front.unavailableReason ?? "unavailable" },
      results,
    },
    201,
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50),
  );

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const observations = await prisma.observation.findMany({
    where: { incidentId: id },
    orderBy: { recordedAtUtc: "desc" },
    take: limit,
    include: { deployment: { include: { firefighter: true } } },
  });

  return ok({
    appendOnly: true,
    count: observations.length,
    observations: observations.map((o) => ({
      id: o.id,
      callsign: o.deployment.firefighter.callsign,
      recordedAtUtc: o.recordedAtUtc.toISOString(),
      source: o.source,
      hrBpm: o.hrBpm,
      spo2Pct: o.spo2Pct,
      coreTempC: o.coreTempC,
      fatiguePct: o.fatiguePct,
      ambientTempC: o.ambientTempC,
      coPpm: o.coPpm,
      pm25UgM3: o.pm25UgM3,
      distanceToFireFrontM: o.distanceToFireFrontM,
      escapeRouteStatus: o.escapeRouteStatus,
      scbaPressurePct: o.scbaPressurePct,
      timeOnTaskMin: o.timeOnTaskMin,
      fireProviderKey: o.fireProviderKey,
      fireFrontConfidence: o.fireFrontConfidence,
    })),
  });
}
