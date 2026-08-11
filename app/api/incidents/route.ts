import { prisma } from "@/lib/db/client";
import { appendAuditEvent } from "@/lib/db/audit";
import { DEFAULT_RISK_CONFIG } from "@/lib/risk/default-config";
import { badRequest, ok, parseJsonBody } from "@/lib/api/respond";
import { createIncidentSchema } from "@/lib/api/schemas";
import { createFireFrontProvider } from "@/lib/fire/registry";
import type { FireFrontProviderKey } from "@/lib/fire/types";

export const dynamic = "force-dynamic";

/** Crew assignment: callsign prefix before the dash, e.g. ALPHA-1 -> ALPHA. */
function crewNameFor(callsign: string): string {
  const dash = callsign.indexOf("-");
  return dash > 0 ? callsign.slice(0, dash) : callsign;
}

export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, createIncidentSchema);
  if (!parsed.ok) return parsed.response;
  const input = parsed.data;

  const organisation =
    input.organisationId === undefined
      ? await prisma.organisation.findFirst({ orderBy: { createdAtUtc: "asc" } })
      : await prisma.organisation.findUnique({ where: { id: input.organisationId } });

  if (organisation === null) {
    return badRequest(
      "No organisation found. Run `npm run seed` first, or pass an organisationId.",
    );
  }

  const profiles = await prisma.firefighterProfile.findMany({
    where: {
      organisationId: organisation.id,
      ...(input.callsigns === undefined ? {} : { callsign: { in: input.callsigns } }),
    },
    orderBy: { callsign: "asc" },
  });

  if (profiles.length === 0) {
    return badRequest(
      "No firefighter profiles matched. Run `npm run seed`, or check the callsigns.",
    );
  }

  const provider = createFireFrontProvider(
    input.fireProviderKey as FireFrontProviderKey,
  );

  const incident = await prisma.incident.create({
    data: {
      organisationId: organisation.id,
      name: input.name,
      status: "created",
      scenarioKey: input.scenarioKey,
      fireProviderKey: input.fireProviderKey,
      centroidLat: input.centroidLat,
      centroidLng: input.centroidLng,
      modelVersion: DEFAULT_RISK_CONFIG.modelVersion,
      configHash: DEFAULT_RISK_CONFIG.configHash,
    },
  });

  // One crew per callsign prefix, then deploy each firefighter into theirs.
  const crewNames = [...new Set(profiles.map((p) => crewNameFor(p.callsign)))].sort();
  const crews = new Map<string, string>();
  for (const name of crewNames) {
    const crew = await prisma.crew.create({
      data: { incidentId: incident.id, name },
    });
    crews.set(name, crew.id);
  }

  await prisma.deployment.createMany({
    data: profiles.map((profile) => ({
      incidentId: incident.id,
      crewId: crews.get(crewNameFor(profile.callsign)) as string,
      firefighterProfileId: profile.id,
      sector: crewNameFor(profile.callsign),
    })),
  });

  await appendAuditEvent({
    incidentId: incident.id,
    eventType: "incident_created",
    actorLabel: "system",
    summary: `Incident "${incident.name}" created with ${profiles.length} firefighters across ${crewNames.length} crews`,
    detail: {
      incidentId: incident.id,
      scenarioKey: incident.scenarioKey,
      callsigns: profiles.map((p) => p.callsign),
      crews: crewNames,
      modelVersion: incident.modelVersion,
      configHash: incident.configHash,
    },
  });

  await appendAuditEvent({
    incidentId: incident.id,
    eventType: "fire_front_provider_selected",
    actorLabel: "system",
    summary: `Fire front provider set to ${provider.label}`,
    detail: {
      providerKey: provider.key,
      providerLabel: provider.label,
      available: provider.isAvailable(),
      unavailableReason: provider.unavailableReason(),
      note: "Valoris does not model fire behaviour. The provider supplies a perimeter; Valoris translates it into individual risk.",
    },
  });

  return ok(
    {
      incident: {
        id: incident.id,
        name: incident.name,
        status: incident.status,
        scenarioKey: incident.scenarioKey,
        fireProviderKey: incident.fireProviderKey,
        centroidLat: incident.centroidLat,
        centroidLng: incident.centroidLng,
        modelVersion: incident.modelVersion,
        configHash: incident.configHash,
        createdAtUtc: incident.createdAtUtc.toISOString(),
      },
      crews: crewNames,
      deployedCallsigns: profiles.map((p) => p.callsign),
    },
    201,
  );
}

export async function GET() {
  const incidents = await prisma.incident.findMany({
    orderBy: { createdAtUtc: "desc" },
    take: 50,
    include: { _count: { select: { deployments: true, observations: true } } },
  });

  return ok({
    incidents: incidents.map((i) => ({
      id: i.id,
      name: i.name,
      status: i.status,
      scenarioKey: i.scenarioKey,
      fireProviderKey: i.fireProviderKey,
      createdAtUtc: i.createdAtUtc.toISOString(),
      startedAtUtc: i.startedAtUtc?.toISOString() ?? null,
      stoppedAtUtc: i.stoppedAtUtc?.toISOString() ?? null,
      deploymentCount: i._count.deployments,
      observationCount: i._count.observations,
    })),
  });
}
