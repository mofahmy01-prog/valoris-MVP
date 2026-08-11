import { prisma } from "@/lib/db/client";
import { notFound, ok } from "@/lib/api/respond";

export const dynamic = "force-dynamic";

/**
 * Recommendations for an incident, priority first.
 *
 * Generation is Milestone 6. This route reads what is stored and marks anything
 * past its TTL as expired on read, so a stale recommendation is never presented
 * as live.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(request.url);
  const openOnly = url.searchParams.get("open") === "true";

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const recommendations = await prisma.recommendation.findMany({
    where: {
      incidentId: id,
      ...(openOnly ? { status: { in: ["open", "acknowledged"] } } : {}),
    },
    orderBy: [{ priorityRank: "asc" }, { createdAtUtc: "desc" }],
    include: {
      deployment: { include: { firefighter: true } },
      commanderActions: { orderBy: { createdAtUtc: "asc" } },
    },
  });

  const nowMs = Date.now();

  return ok({
    count: recommendations.length,
    generationMilestone:
      "Recommendation generation lands in Milestone 6. This route serves stored recommendations and enforces TTL on read.",
    recommendations: recommendations.map((r) => {
      const expiresMs = r.expiresAtUtc.getTime();
      const isPastTtl = expiresMs <= nowMs;
      const live = r.status === "open" || r.status === "acknowledged";
      return {
        id: r.id,
        callsign: r.deployment.firefighter.callsign,
        deploymentId: r.deploymentId,
        type: r.type,
        priorityRank: r.priorityRank,
        rationale: r.rationale,
        suggestedAction: r.suggestedAction,
        alternatives: JSON.parse(r.alternativesJson) as string[],
        confidence: r.confidence,
        // Reported status never claims a past-TTL recommendation is still live.
        status: live && isPastTtl ? "expired" : r.status,
        storedStatus: r.status,
        createdAtUtc: r.createdAtUtc.toISOString(),
        expiresAtUtc: r.expiresAtUtc.toISOString(),
        expiresInSec: Math.max(0, Math.round((expiresMs - nowMs) / 1000)),
        resolvedAtUtc: r.resolvedAtUtc?.toISOString() ?? null,
        commanderActions: r.commanderActions.map((a) => ({
          id: a.id,
          action: a.action,
          reason: a.reasonText,
          actorLabel: a.actorLabel,
          createdAtUtc: a.createdAtUtc.toISOString(),
        })),
      };
    }),
  });
}
