/**
 * Post-incident report.
 *
 * Read-only. Assembling a report must never write, derive or infer anything —
 * in particular it must never fill a missing outcome, because a report that
 * quietly completes itself is worse than an incomplete one.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { prisma } from "@/lib/db/client";
import { notFound, ok } from "@/lib/api/respond";
import { buildIncidentReport } from "@/lib/report/incident-report";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const [deployments, assessments, recommendations, outcomes] = await Promise.all([
    prisma.deployment.findMany({
      where: { incidentId: id },
      include: { firefighter: true },
      orderBy: { assignedAtUtc: "asc" },
    }),
    prisma.riskAssessmentRecord.findMany({
      where: { incidentId: id },
      orderBy: { calculatedAtUtc: "asc" },
    }),
    prisma.recommendation.findMany({
      where: { incidentId: id },
      include: { commanderActions: true },
      orderBy: { createdAtUtc: "asc" },
    }),
    prisma.incidentOutcome.findMany({ where: { incidentId: id } }),
  ]);

  return ok(
    buildIncidentReport({ incident, deployments, assessments, recommendations, outcomes }),
  );
}
