import { prisma } from "@/lib/db/client";
import { notFound, ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * Stored risk assessments. `latest=true` returns the most recent per
 * firefighter; otherwise the full history, newest first.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const latestOnly = url.searchParams.get("latest") === "true";
  const limit = Math.min(
    1000,
    Math.max(1, Number.parseInt(url.searchParams.get("limit") ?? "200", 10) || 200),
  );

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { deployments: { include: { firefighter: true } } },
  });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const shape = (r: {
    id: string;
    deploymentId: string;
    observationId: string;
    calculatedAtUtc: Date;
    scoreValue: number;
    band: string;
    physiologicalSubscore: number;
    environmentalSubscore: number;
    proximitySubscore: number;
    profileSubscore: number;
    hardOverride: boolean;
    hardOverrideReasonsJson: string;
    topDriversJson: string;
    explanation: string;
    confidence: string;
    staleInputsJson: string;
    missingInputsJson: string;
    oldestReadingAgeSec: number;
    dataQualityNote: string;
    modelVersion: string;
    configHash: string;
    deployment: { firefighter: { callsign: string } };
  }) => ({
    id: r.id,
    callsign: r.deployment.firefighter.callsign,
    deploymentId: r.deploymentId,
    observationId: r.observationId,
    calculatedAtUtc: r.calculatedAtUtc.toISOString(),
    score: r.scoreValue,
    band: r.band,
    subscores: {
      physiological: r.physiologicalSubscore,
      environmental: r.environmentalSubscore,
      proximity: r.proximitySubscore,
      profile: r.profileSubscore,
    },
    hardOverride: r.hardOverride,
    hardOverrideReasons: JSON.parse(r.hardOverrideReasonsJson) as string[],
    topDrivers: JSON.parse(r.topDriversJson) as string[],
    explanation: r.explanation,
    dataQuality: {
      confidence: r.confidence,
      staleInputs: JSON.parse(r.staleInputsJson) as string[],
      missingInputs: JSON.parse(r.missingInputsJson) as string[],
      oldestReadingAgeSec: r.oldestReadingAgeSec,
      note: r.dataQualityNote,
    },
    modelVersion: r.modelVersion,
    configHash: r.configHash,
  });

  if (latestOnly) {
    const latest = [];
    for (const deployment of incident.deployments) {
      const record = await prisma.riskAssessmentRecord.findFirst({
        where: { deploymentId: deployment.id },
        orderBy: { calculatedAtUtc: "desc" },
        include: { deployment: { include: { firefighter: true } } },
      });
      if (record === null) {
        latest.push({
          callsign: deployment.firefighter.callsign,
          deploymentId: deployment.id,
          band: "UNKNOWN",
          reason:
            "No assessment recorded yet. Absence of data is not a safe reading.",
        });
      } else {
        latest.push(shape(record));
      }
    }
    return ok({ latest: true, count: latest.length, risks: latest });
  }

  const records = await prisma.riskAssessmentRecord.findMany({
    where: { incidentId: id },
    orderBy: { calculatedAtUtc: "desc" },
    take: limit,
    include: { deployment: { include: { firefighter: true } } },
  });

  return ok({
    latest: false,
    count: records.length,
    risks: records.map(shape),
  });
}
