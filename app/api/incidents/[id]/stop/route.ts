import { prisma } from "@/lib/db/client";
import { appendAuditEvent } from "@/lib/db/audit";
import { conflict, notFound, ok, parseJsonBody } from "@/lib/api/respond";
import { stopIncidentSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, stopIncidentSchema);
  if (!parsed.ok) return parsed.response;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);
  if (incident.status === "stopped") return conflict("Incident is already stopped");

  const nowUtc = new Date();
  const updated = await prisma.incident.update({
    where: { id },
    data: { status: "stopped", stoppedAtUtc: nowUtc },
  });

  // Open recommendations do not survive the incident. Each closure is audited.
  const open = await prisma.recommendation.findMany({
    where: { incidentId: id, status: { in: ["open", "acknowledged"] } },
    include: { deployment: { include: { firefighter: true } } },
  });
  if (open.length > 0) {
    await prisma.recommendation.updateMany({
      where: { incidentId: id, status: { in: ["open", "acknowledged"] } },
      data: { status: "expired", resolvedAtUtc: nowUtc },
    });
    for (const rec of open) {
      await appendAuditEvent({
        incidentId: id,
        eventType: "recommendation_expired",
        actorLabel: "system",
        summary: `${rec.type} recommendation for ${rec.deployment.firefighter.callsign} expired because the incident stopped`,
        detail: {
          recommendationId: rec.id,
          previousStatus: rec.status,
          callsign: rec.deployment.firefighter.callsign,
        },
        occurredAtUtc: nowUtc,
      });
    }
  }

  await appendAuditEvent({
    incidentId: id,
    eventType: "incident_stopped",
    actorLabel: parsed.data.actorLabel,
    summary: `Incident "${incident.name}" stopped by ${parsed.data.actorLabel}`,
    detail: {
      incidentId: id,
      stoppedAtUtc: nowUtc.toISOString(),
      reason: parsed.data.reason ?? null,
      recommendationsExpired: open.length,
    },
    occurredAtUtc: nowUtc,
  });

  return ok({
    incident: {
      id: updated.id,
      status: updated.status,
      stoppedAtUtc: updated.stoppedAtUtc?.toISOString() ?? null,
    },
    recommendationsExpired: open.length,
  });
}
