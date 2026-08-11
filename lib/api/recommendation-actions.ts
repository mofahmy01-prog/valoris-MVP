/**
 * The four commander actions share one code path, so the reason requirement
 * cannot be enforced on some routes and forgotten on others.
 *
 * Reject and override require a reason. It is checked three times, on purpose:
 * by Zod on the request body, by an assertion here, and by a SQLite trigger on
 * insert. A UI bug, a direct API call, or a future internal caller all hit a
 * wall.
 */

import type { NextResponse } from "next/server";

import { prisma } from "@/lib/db/client";
import { appendAuditEvent } from "@/lib/db/audit";
import {
  ACTIONS_REQUIRING_REASON,
  type AuditEventType,
  type CommanderActionKind,
  type RecommendationStatus,
} from "@/lib/db/enums";

import { badRequest, conflict, notFound, ok, parseJsonBody } from "./respond";
import {
  acceptSchema,
  acknowledgeSchema,
  overrideSchema,
  rejectSchema,
} from "./schemas";

const NEXT_STATUS: Record<CommanderActionKind, RecommendationStatus> = {
  acknowledge: "acknowledged",
  accept: "accepted",
  reject: "rejected",
  override: "overridden",
};

const AUDIT_TYPE: Record<CommanderActionKind, AuditEventType> = {
  acknowledge: "recommendation_acknowledged",
  accept: "recommendation_accepted",
  reject: "recommendation_rejected",
  override: "recommendation_overridden",
};

/** Terminal states — a resolved recommendation cannot be re-decided. */
const TERMINAL: readonly RecommendationStatus[] = [
  "accepted",
  "rejected",
  "overridden",
  "expired",
];

const SCHEMAS = {
  acknowledge: acknowledgeSchema,
  accept: acceptSchema,
  reject: rejectSchema,
  override: overrideSchema,
} as const;

export async function handleRecommendationAction(
  request: Request,
  recommendationId: string,
  action: CommanderActionKind,
): Promise<NextResponse> {
  const parsed = await parseJsonBody(request, SCHEMAS[action]);
  if (!parsed.ok) return parsed.response;
  const body = parsed.data as {
    actorLabel: string;
    reason?: string;
    note?: string;
    replacementAction?: string;
  };

  // Belt and braces: Zod already guarantees this for reject and override, but
  // the invariant is too important to rely on one layer.
  const requiresReason = ACTIONS_REQUIRING_REASON.includes(action);
  const reason = body.reason?.trim() ?? "";
  if (requiresReason && reason === "") {
    return badRequest(`A ${action} requires a non-empty reason`, [
      { path: "reason", message: "A reason is required and cannot be empty or whitespace only" },
    ]);
  }

  const recommendation = await prisma.recommendation.findUnique({
    where: { id: recommendationId },
    include: { deployment: { include: { firefighter: true } } },
  });
  if (recommendation === null) {
    return notFound(`No recommendation with id ${recommendationId}`);
  }

  if (TERMINAL.includes(recommendation.status as RecommendationStatus)) {
    return conflict(
      `Recommendation is already ${recommendation.status} and cannot be ${action}ed`,
    );
  }

  const nowUtc = new Date();
  const resolves = action !== "acknowledge";

  const [, updated] = await prisma.$transaction([
    prisma.commanderAction.create({
      data: {
        incidentId: recommendation.incidentId,
        recommendationId: recommendation.id,
        action,
        reasonText: requiresReason ? reason : (body.note?.trim() ?? null),
        actorLabel: body.actorLabel,
        createdAtUtc: nowUtc,
      },
    }),
    prisma.recommendation.update({
      where: { id: recommendation.id },
      data: {
        status: NEXT_STATUS[action],
        resolvedAtUtc: resolves ? nowUtc : null,
      },
    }),
  ]);

  await appendAuditEvent({
    incidentId: recommendation.incidentId,
    eventType: AUDIT_TYPE[action],
    actorLabel: body.actorLabel,
    summary: `${body.actorLabel} ${NEXT_STATUS[action]} a ${recommendation.type} recommendation for ${recommendation.deployment.firefighter.callsign}`,
    detail: {
      recommendationId: recommendation.id,
      recommendationType: recommendation.type,
      callsign: recommendation.deployment.firefighter.callsign,
      action,
      reason: requiresReason ? reason : (body.note?.trim() ?? null),
      replacementAction: body.replacementAction ?? null,
      previousStatus: recommendation.status,
      newStatus: NEXT_STATUS[action],
      commanderRetainsControl: true,
    },
    occurredAtUtc: nowUtc,
  });

  return ok({
    recommendation: {
      id: updated.id,
      type: updated.type,
      status: updated.status,
      resolvedAtUtc: updated.resolvedAtUtc?.toISOString() ?? null,
    },
    action: {
      action,
      actorLabel: body.actorLabel,
      reason: requiresReason ? reason : null,
      recordedAtUtc: nowUtc.toISOString(),
    },
  });
}
