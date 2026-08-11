import { prisma } from "@/lib/db/client";
import { appendAuditEvent } from "@/lib/db/audit";
import { conflict, notFound, ok, parseJsonBody } from "@/lib/api/respond";
import { startIncidentSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const parsed = await parseJsonBody(request, startIncidentSchema);
  if (!parsed.ok) return parsed.response;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);
  if (incident.status === "running") {
    return conflict("Incident is already running");
  }
  if (incident.status === "stopped") {
    return conflict("Incident has been stopped and cannot be restarted");
  }

  const nowUtc = new Date();
  const updated = await prisma.incident.update({
    where: { id },
    data: { status: "running", startedAtUtc: nowUtc },
  });

  await appendAuditEvent({
    incidentId: id,
    eventType: "incident_started",
    actorLabel: parsed.data.actorLabel,
    summary: `Incident "${incident.name}" started by ${parsed.data.actorLabel}`,
    detail: { incidentId: id, startedAtUtc: nowUtc.toISOString() },
    occurredAtUtc: nowUtc,
  });

  return ok({
    incident: {
      id: updated.id,
      status: updated.status,
      startedAtUtc: updated.startedAtUtc?.toISOString() ?? null,
    },
  });
}
