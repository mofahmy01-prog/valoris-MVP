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
import { DEFAULT_PURPLEAIR_CONFIG } from "@/lib/sensors/default-config";
import { correctPurpleAir } from "@/lib/sensors/purpleair-correction";
import { parameterValues } from "@/lib/params/parameters";
import { DEFAULT_PHYSIOLOGY_CONFIG } from "@/lib/physiology/default-config";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { assessRisk } from "@/lib/risk/engine";
import {
  toEnvironment,
  toHealthProfile,
  toPosition,
  toVitals,
} from "@/lib/incident/mapping";
import {
  derivePhysiology,
  EMPTY_CARRY_OVER,
  type PhysiologyCarryOver,
} from "@/lib/incident/physiology-pipeline";
import { resolveFireFront } from "@/lib/incident/snapshot";
import {
  assertObservationProvenanceCoherent,
  isFullySimulated,
  PROVENANCE,
  tierSummary,
  type ObservationProvenance,
} from "@/lib/provenance";

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

  /* --- Provenance ------------------------------------------------------- */
  // The fire front is the one domain that can be Tier A: a real observed
  // perimeter from an operator-supplied NIFC export. Everything else in this
  // build is Tier C. Nothing claims Tier B, because no noise model exists.
  const fireFrontProvenance = !havePerimeter
    ? PROVENANCE.unavailableFireFront
    : "isFireBehaviourPrediction" in front && front.isFireBehaviourPrediction
      ? {
          ...PROVENANCE.observedPerimeter,
          source: `${PROVENANCE.observedPerimeter.source} (${front.providerKey})`,
          retrievedAt: new Date(front.validAtMs).toISOString(),
          modelRef: front.provenance,
        }
      : {
          ...PROVENANCE.geometricFireFront,
          modelRef: "provenance" in front ? front.provenance : undefined,
        };

  // A real PurpleAir reading promotes the environment domain to Tier A. Only a
  // caller that actually pulled from the sensor network may assert this, and
  // `isRealSensorData` defaults to false, so simulated data stays Tier C.
  const anyRealPurpleAir = parsed.data.observations.some(
    (o) => o.environment.purpleAir?.isRealSensorData === true,
  );

  const observationProvenance: ObservationProvenance = {
    environment: anyRealPurpleAir
      ? PROVENANCE.purpleAirEnvironment
      : PROVENANCE.simulatedEnvironment,
    vitals: PROVENANCE.simulatedVitals,
    position: PROVENANCE.simulatedPosition,
    derivedPhysiology: PROVENANCE.derivedPhysiology,
    fireFront: fireFrontProvenance,
  };
  assertObservationProvenanceCoherent(observationProvenance, "observation");
  const provenanceSummary = tierSummary(observationProvenance);
  const fullySimulated = isFullySimulated(observationProvenance);

  const results: Array<{
    callsign: string;
    observationId: string;
    band: string;
    score: number;
    confidence: string;
    previousBand: string | null;
    distanceToFireFrontM: number | null;
    fireFrontConfidence: string | null;
    physiology: {
      coreTempC: number;
      coreTempSource: string;
      reportedCoreTempC: number | null;
      fatiguePct: number;
      reportedFatiguePct: number | null;
      hrrFraction: number | null;
      metabolicRateWm2: number;
      heatStorageWm2: number;
      dlimMin: number | null;
      heatStrainLimiter: string;
      cohbPct: number;
      toxicCombinedIndex: number;
      stepMinutes: number;
      modelVersion: string;
      configHash: string;
    };
  }> = [];

  for (const input of parsed.data.observations) {
    const deployment = byCallsign.get(input.callsign);
    if (deployment === undefined) continue; // already rejected above

    const recordedAt = input.recordedAtUtc;

    /* --- PurpleAir: correct before anything else sees the number --------- */
    // Raw PurpleAir overreads by roughly 60% and is non-linear above 300 ug/m3.
    // Correction happens here, once, on the ingestion path — so nothing
    // downstream can accidentally consume a raw value.
    const pa = input.environment.purpleAir;
    const corrected = pa === undefined ? null : correctPurpleAir(
      {
        pm25_cf_1_a: pa.pm25_cf_1_a,
        pm25_cf_1_b: pa.pm25_cf_1_b,
        humidityPct: pa.humidityPct,
        temperatureC: pa.temperatureC,
        timestampMs: (pa.updatedAtUtc ?? recordedAt).getTime(),
      },
      DEFAULT_PURPLEAIR_CONFIG,
    );

    // A rejected reading is MISSING, not zero and not the raw value. Null here
    // flows into the staleness rules, which score it at worst case and move the
    // band to UNKNOWN.
    const pm25ForEngine =
      corrected === null
        ? channelValue(input.environment.pm25UgM3)
        : corrected.valueUgM3;
    const pm25Timestamp =
      corrected === null
        ? channelTimestamp(input.environment.pm25UgM3, recordedAt)
        : corrected.valueUgM3 === null
          ? null
          : (pa?.updatedAtUtc ?? recordedAt);

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

    /* --- Physiology: derive core temperature and fatigue ------------------ */
    // Runs before the observation is written, so the derived values are stored
    // on the same append-only row as the readings they came from.
    const [previousObservation, exposureSoFar] = await Promise.all([
      prisma.observation.findFirst({
        where: { deploymentId: deployment.id },
        orderBy: { recordedAtUtc: "desc" },
      }),
      prisma.observation.aggregate({
        where: { deploymentId: deployment.id },
        _max: { coPpm: true, pm25UgM3: true },
      }),
    ]);

    const carryOver: PhysiologyCarryOver =
      previousObservation === null
        ? EMPTY_CARRY_OVER
        : {
            coreTempC: previousObservation.derivedCoreTempC,
            coreTempVarianceC2: previousObservation.derivedCoreTempVarianceC2,
            fatiguePct: previousObservation.derivedFatiguePct,
            cohbPct: previousObservation.derivedCohbPct,
            pm25DoseUgMinM3: previousObservation.derivedPm25DoseUgMinM3,
            worstCoPpm: exposureSoFar._max.coPpm,
            worstPm25UgM3: exposureSoFar._max.pm25UgM3,
            previousObservedAtMs: previousObservation.recordedAtUtc.getTime(),
          };

    const tsMs = (value: Date | null | undefined): number | undefined =>
      value === null || value === undefined ? undefined : value.getTime();

    const hrTimestamp = channelTimestamp(input.vitals.hrBpm, recordedAt);
    const ambientTimestamp = channelTimestamp(
      input.environment.ambientTempC,
      recordedAt,
    );
    const humidityTimestamp = channelTimestamp(
      input.environment.humidityPct,
      recordedAt,
    );

    const physiology = derivePhysiology({
      profile: toHealthProfile(deployment.firefighter),
      readings: {
        hrBpm: channelValue(input.vitals.hrBpm),
        spo2Pct: channelValue(input.vitals.spo2Pct),
        reportedCoreTempC: channelValue(input.vitals.coreTempC),
        reportedFatiguePct: channelValue(input.vitals.fatiguePct),
        ambientTempC: channelValue(input.environment.ambientTempC),
        humidityPct: channelValue(input.environment.humidityPct),
        meanRadiantTempC: null,
        airVelocityMs: channelValue(input.environment.windSpeedMs),
        coPpm: channelValue(input.environment.coPpm),
        pm25UgM3: channelValue(input.environment.pm25UgM3),
        wearingPpe: input.position.wearingPpe,
        scbaOnAir: input.position.scbaOnAir,
      },
      timestamps: {
        hrBpm: tsMs(hrTimestamp),
        ambientTempC: tsMs(ambientTimestamp),
        humidityPct: tsMs(humidityTimestamp),
        coPpm: tsMs(channelTimestamp(input.environment.coPpm, recordedAt)),
        pm25UgM3: tsMs(channelTimestamp(input.environment.pm25UgM3, recordedAt)),
      },
      carryOver,
      observedAtMs: recordedAt.getTime(),
      config: DEFAULT_PHYSIOLOGY_CONFIG,
    });

    const observation = await prisma.observation.create({
      data: {
        incidentId: incident.id,
        deploymentId: deployment.id,
        recordedAtUtc: recordedAt,
        source: input.source,

        wearingPpe: input.position.wearingPpe,

        derivedCoreTempC: physiology.coreTempC,
        derivedCoreTempUpdatedAtUtc:
          physiology.coreTempUpdatedAtMs === undefined
            ? null
            : new Date(physiology.coreTempUpdatedAtMs),
        derivedCoreTempVarianceC2: physiology.coreTempVarianceC2,
        derivedCoreTempSdC: physiology.coreTempSdC,
        derivedCoreTempObserved: physiology.coreTempObservationApplied,
        derivedFatiguePct: physiology.fatiguePct,
        derivedFatigueUpdatedAtUtc:
          physiology.fatigueUpdatedAtMs === undefined
            ? null
            : new Date(physiology.fatigueUpdatedAtMs),
        derivedHrrFraction: physiology.hrrFraction,
        derivedEffectiveHrReserveBpm: physiology.effectiveHrReserveBpm,
        derivedMetabolicRateWm2: physiology.metabolicRateWm2,
        derivedHeatStorageWm2: physiology.heatStorageWm2,
        derivedSweatRateGPerHour: Number.isFinite(
          physiology.predictedSweatRateGPerHour,
        )
          ? physiology.predictedSweatRateGPerHour
          : null,
        derivedDlimMin: physiology.dlimMin,
        derivedHeatStrainLimiter: physiology.heatStrainLimiter,
        derivedCoreTempLimitC: physiology.coreTempLimitC,
        derivedCohbPct: physiology.cohbPct,
        derivedCoIndex: physiology.coIndex,
        derivedPm25DoseUgMinM3: physiology.pm25DoseUgMinM3,
        derivedPm25Index: physiology.pm25Index,
        derivedStepMinutes: physiology.stepMinutes,
        derivedStepCapped: physiology.stepCapped,
        physiologyCaveatsJson: JSON.stringify(physiology.caveats),
        physiologyModelVersion: physiology.modelVersion,
        physiologyConfigHash: physiology.configHash,

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
        pm25UgM3: pm25ForEngine,
        windSpeedMs: channelValue(input.environment.windSpeedMs),
        windDirDeg: channelValue(input.environment.windDirDeg),

        pm25RawUgM3: corrected?.rawUgM3 ?? null,
        pm25CorrectedUgM3: corrected?.valueUgM3 ?? null,
        pm25CorrectionMethod: corrected?.correctionMethod ?? null,
        pm25CorrectionRegime: corrected?.regime ?? null,
        pm25QualityFlag: corrected?.qualityFlag ?? null,
        pm25ChannelAgreement:
          corrected !== null && Number.isFinite(corrected.channelAgreement)
            ? corrected.channelAgreement
            : null,
        pm25SensorId: pa?.sensorId ?? null,
        pm25IsRealSensorData: pa?.isRealSensorData ?? false,

        ambientTempUpdatedAtUtc: channelTimestamp(input.environment.ambientTempC, recordedAt),
        humidityUpdatedAtUtc: channelTimestamp(input.environment.humidityPct, recordedAt),
        coUpdatedAtUtc: channelTimestamp(input.environment.coPpm, recordedAt),
        pm25UpdatedAtUtc: pm25Timestamp,
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

        positionFixUpdatedAtUtc: input.position.fixUpdatedAtUtc ?? recordedAt,
        escapeRouteUpdatedAtUtc: input.position.escapeRouteUpdatedAtUtc ?? recordedAt,
        distanceToFireFrontUpdatedAtUtc:
          distanceToFireFrontM === null
            ? null
            : (input.position.distanceToFireFrontUpdatedAtUtc ?? recordedAt),
        distanceToSafeZoneUpdatedAtUtc:
          input.position.distanceToSafeZoneM === null ||
          input.position.distanceToSafeZoneM === undefined
            ? null
            : (input.position.distanceToSafeZoneUpdatedAtUtc ?? recordedAt),
        scbaPressureUpdatedAtUtc:
          input.position.scbaPressurePct === null ||
          input.position.scbaPressurePct === undefined
            ? null
            : (input.position.scbaPressureUpdatedAtUtc ?? recordedAt),

        fireProviderKey: incident.fireProviderKey,
        fireFrontConfidence,

        dataTierSummary: provenanceSummary,
        environmentDataTier: observationProvenance.environment.dataTier,
        vitalsDataTier: observationProvenance.vitals.dataTier,
        positionDataTier: observationProvenance.position.dataTier,
        physiologyDataTier: observationProvenance.derivedPhysiology.dataTier,
        fireFrontDataTier: observationProvenance.fireFront.dataTier,
        provenanceJson: JSON.stringify(observationProvenance),
        isFullySimulated: fullySimulated,
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

    // The exact profile scored against, captured before the assessment so the
    // stored snapshot and the scored value cannot diverge.
    const scoredProfile = toHealthProfile(deployment.firefighter);

    const assessment = assessRisk(
      scoredProfile,
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
        profileSnapshotJson: JSON.stringify(scoredProfile),
        riskConfigValuesJson: JSON.stringify(
          parameterValues(DEFAULT_RISK_CONFIG.parameters),
        ),
        physiologyConfigValuesJson: JSON.stringify(
          parameterValues(DEFAULT_PHYSIOLOGY_CONFIG.parameters),
        ),
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
        physiology: {
          coreTempC: physiology.coreTempC,
          coreTempIsModelled: true,
          reportedCoreTempC: channelValue(input.vitals.coreTempC),
          fatiguePct: physiology.fatiguePct,
          hrrFraction: physiology.hrrFraction,
          heatStorageWm2: physiology.heatStorageWm2,
          dlimMin: physiology.dlimMin,
          heatStrainLimiter: physiology.heatStrainLimiter,
          cohbPct: physiology.cohbPct,
          modelVersion: physiology.modelVersion,
          configHash: physiology.configHash,
          caveats: physiology.caveats,
        },
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
      physiology: {
        coreTempC: physiology.coreTempC,
        coreTempSource: "modelled_estimate",
        reportedCoreTempC: channelValue(input.vitals.coreTempC),
        fatiguePct: physiology.fatiguePct,
        reportedFatiguePct: channelValue(input.vitals.fatiguePct),
        hrrFraction: physiology.hrrFraction,
        metabolicRateWm2: physiology.metabolicRateWm2,
        heatStorageWm2: physiology.heatStorageWm2,
        dlimMin: physiology.dlimMin,
        heatStrainLimiter: physiology.heatStrainLimiter,
        cohbPct: physiology.cohbPct,
        toxicCombinedIndex: physiology.toxicCombinedIndex,
        stepMinutes: physiology.stepMinutes,
        modelVersion: physiology.modelVersion,
        configHash: physiology.configHash,
      },
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
      provenance: {
        dataTierSummary: provenanceSummary,
        isFullySimulated: fullySimulated,
        domains: observationProvenance,
      },
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
    provenanceNote:
      "Every observation carries its data tiers per domain. Tier letters are never collapsed into one for a row that mixes them.",
    observations: observations.map((o) => ({
      id: o.id,
      callsign: o.deployment.firefighter.callsign,
      recordedAtUtc: o.recordedAtUtc.toISOString(),
      source: o.source,
      dataTierSummary: o.dataTierSummary,
      dataTiers: {
        environment: o.environmentDataTier,
        vitals: o.vitalsDataTier,
        position: o.positionDataTier,
        derivedPhysiology: o.physiologyDataTier,
        fireFront: o.fireFrontDataTier,
      },
      isFullySimulated: o.isFullySimulated,
      provenance: JSON.parse(o.provenanceJson) as unknown,
      hrBpm: o.hrBpm,
      spo2Pct: o.spo2Pct,
      coreTempC: o.coreTempC,
      fatiguePct: o.fatiguePct,
      ambientTempC: o.ambientTempC,
      coPpm: o.coPpm,
      /** The CORRECTED value the engine consumed. Null when rejected. */
      pm25UgM3: o.pm25UgM3,
      /** What the sensor actually said, never overwritten. */
      pm25RawUgM3: o.pm25RawUgM3,
      pm25CorrectedUgM3: o.pm25CorrectedUgM3,
      pm25CorrectionMethod: o.pm25CorrectionMethod,
      pm25CorrectionRegime: o.pm25CorrectionRegime,
      pm25QualityFlag: o.pm25QualityFlag,
      pm25ChannelAgreement: o.pm25ChannelAgreement,
      pm25SensorId: o.pm25SensorId,
      pm25IsRealSensorData: o.pm25IsRealSensorData,
      distanceToFireFrontM: o.distanceToFireFrontM,
      escapeRouteStatus: o.escapeRouteStatus,
      scbaPressurePct: o.scbaPressurePct,
      timeOnTaskMin: o.timeOnTaskMin,
      fireProviderKey: o.fireProviderKey,
      fireFrontConfidence: o.fireFrontConfidence,
    })),
  });
}
