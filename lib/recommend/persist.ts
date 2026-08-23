/**
 * Turning generated advice into rows, without flooding the queue.
 *
 * The observation feed produces an assessment for every firefighter every few
 * seconds. Writing a recommendation each time would put hundreds of identical
 * rows in front of a commander within minutes, and a queue nobody can read is a
 * queue nobody reads — which is how a safety system gets muted in practice.
 *
 * So this module does three things in order:
 *
 *   1. Expires open recommendations that have outlived their evidence.
 *   2. Suppresses advice that is already open and unresolved for the same
 *      firefighter and the same reason.
 *   3. Writes only what is genuinely new.
 *
 * Suppression is deliberately keyed on (deployment, type) rather than on the
 * exact wording. "Rotate ALPHA-1" twice is one piece of advice even if the
 * driver list shifted between readings; re-raising it because a number moved
 * would be the flood by another route.
 *
 * A commander who has already REJECTED advice does not get it again while that
 * decision stands. That is the point of asking them.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { appendAuditEvent } from "@/lib/db/audit";
import { prisma } from "@/lib/db/client";

import {
  recommendFor,
  RECOMMENDATION_TTL_MS,
  type RecommendationContext,
} from "./engine";
import type { RiskAssessment } from "@/lib/risk/types";

export type PersistInput = {
  incidentId: string;
  deploymentId: string;
  riskAssessmentRecordId?: string | null;
  assessment: RiskAssessment;
  context: RecommendationContext;
  /** The moment being assessed, so replays stay deterministic. */
  atMs: number;
  actorLabel: string;
};

export type PersistResult = {
  created: number;
  suppressed: number;
  expired: number;
};

/**
 * Statuses that mean "this advice is still in front of the commander".
 *
 * `rejected` and `overridden` are NOT here. A commander who has considered the
 * advice and declined it has made a decision, and re-raising it every few
 * seconds would be nagging rather than informing. It returns when the
 * recommendation expires and the situation still warrants it.
 */
const LIVE_STATUSES = ["open", "acknowledged"] as const;

export async function persistRecommendations(
  input: PersistInput,
): Promise<PersistResult> {
  const now = new Date(input.atMs);

  // 1. Expire anything that has outlived its evidence.
  const expired = await prisma.recommendation.updateMany({
    where: {
      deploymentId: input.deploymentId,
      status: { in: [...LIVE_STATUSES] },
      expiresAtUtc: { lt: now },
    },
    data: { status: "expired", resolvedAtUtc: now },
  });

  const generated = recommendFor(input.assessment, input.context);
  if (generated.length === 0) {
    return { created: 0, suppressed: 0, expired: expired.count };
  }

  // 2. Find what is already in front of the commander for this firefighter.
  const live = await prisma.recommendation.findMany({
    where: {
      deploymentId: input.deploymentId,
      status: { in: [...LIVE_STATUSES, "rejected", "overridden"] },
      expiresAtUtc: { gte: now },
    },
    select: { type: true },
  });
  const alreadyLive = new Set(live.map((r) => r.type));

  let created = 0;
  let suppressed = 0;

  for (const recommendation of generated) {
    if (alreadyLive.has(recommendation.type)) {
      suppressed += 1;
      continue;
    }

    await prisma.recommendation.create({
      data: {
        incidentId: input.incidentId,
        deploymentId: input.deploymentId,
        riskAssessmentRecordId: input.riskAssessmentRecordId ?? null,
        type: recommendation.type,
        priorityRank: recommendation.priorityRank,
        rationale: recommendation.rationale,
        suggestedAction: recommendation.suggestedAction,
        alternativesJson: JSON.stringify(recommendation.alternatives),
        confidence: recommendation.confidence,
        status: "open",
        createdAtUtc: now,
        expiresAtUtc: new Date(input.atMs + RECOMMENDATION_TTL_MS),
      },
    });
    created += 1;

    await appendAuditEvent({
      incidentId: input.incidentId,
      eventType: "recommendation_created",
      actorLabel: input.actorLabel,
      summary: `${recommendation.type} recommended for ${input.context.callsign}: ${recommendation.suggestedAction}`,
      detail: {
        callsign: input.context.callsign,
        deploymentId: input.deploymentId,
        type: recommendation.type,
        priorityRank: recommendation.priorityRank,
        confidence: recommendation.confidence,
        rationale: recommendation.rationale,
        alternatives: recommendation.alternatives,
        band: input.assessment.band,
        score: input.assessment.score,
      },
      occurredAtUtc: now,
    });
  }

  return { created, suppressed, expired: expired.count };
}
