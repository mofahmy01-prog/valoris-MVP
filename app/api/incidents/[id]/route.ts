import { prisma } from "@/lib/db/client";
import { notFound, ok } from "@/lib/api/respond";
import { createFireFrontProvider } from "@/lib/fire/registry";
import type { FireFrontProviderKey } from "@/lib/fire/types";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: {
      organisation: true,
      crews: { orderBy: { name: "asc" } },
      deployments: {
        include: { firefighter: true, crew: true },
        orderBy: { assignedAtUtc: "asc" },
      },
      _count: {
        select: {
          observations: true,
          riskAssessments: true,
          recommendations: true,
          commanderActions: true,
          auditEvents: true,
        },
      },
    },
  });

  if (incident === null) return notFound(`No incident with id ${id}`);

  const provider = createFireFrontProvider(
    incident.fireProviderKey as FireFrontProviderKey,
  );

  return ok({
    incident: {
      id: incident.id,
      name: incident.name,
      status: incident.status,
      scenarioKey: incident.scenarioKey,
      organisation: { id: incident.organisation.id, name: incident.organisation.name },
      centroidLat: incident.centroidLat,
      centroidLng: incident.centroidLng,
      modelVersion: incident.modelVersion,
      configHash: incident.configHash,
      createdAtUtc: incident.createdAtUtc.toISOString(),
      startedAtUtc: incident.startedAtUtc?.toISOString() ?? null,
      stoppedAtUtc: incident.stoppedAtUtc?.toISOString() ?? null,
    },
    fireFrontProvider: {
      key: provider.key,
      label: provider.label,
      available: provider.isAvailable(),
      unavailableReason: provider.unavailableReason(),
      valorisModelsFireBehaviour: false,
    },
    crews: incident.crews.map((c) => ({ id: c.id, name: c.name })),
    deployments: incident.deployments.map((d) => ({
      id: d.id,
      crewName: d.crew.name,
      sector: d.sector,
      assignedAtUtc: d.assignedAtUtc.toISOString(),
      releasedAtUtc: d.releasedAtUtc?.toISOString() ?? null,
      firefighter: {
        id: d.firefighter.id,
        callsign: d.firefighter.callsign,
        ageYears: d.firefighter.ageYears,
        fitness: d.firefighter.fitness,
        restingHrBpm: d.firefighter.restingHrBpm,
        spo2BaselinePct: d.firefighter.spo2BaselinePct,
        conditions: JSON.parse(d.firefighter.conditionsJson) as string[],
        respiratoryRisk: d.firefighter.respiratoryRisk,
        heatTolerance: d.firefighter.heatTolerance,
        prevShiftHours: d.firefighter.prevShiftHours,
        cumulativeCoExposureIndex: d.firefighter.cumulativeCoExposureIndex,
        cumulativeHeatExposureIndex: d.firefighter.cumulativeHeatExposureIndex,
      },
    })),
    counts: incident._count,
  });
}
