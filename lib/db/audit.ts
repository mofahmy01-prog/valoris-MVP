/**
 * Audit log access.
 *
 * This module exposes exactly two operations: append and read. There is no
 * update function and no delete function anywhere in the codebase, and the
 * database rejects both with a trigger. That is the whole point of an audit log.
 */

import type { AuditEventType } from "./enums";
import { prisma } from "./client";

export type AuditAppendInput = {
  incidentId?: string | null;
  eventType: AuditEventType;
  actorLabel: string;
  summary: string;
  detail?: Record<string, unknown>;
  occurredAtUtc?: Date;
};

export async function appendAuditEvent(input: AuditAppendInput): Promise<void> {
  await prisma.auditEvent.create({
    data: {
      incidentId: input.incidentId ?? null,
      eventType: input.eventType,
      actorLabel: input.actorLabel,
      summary: input.summary,
      detailJson: JSON.stringify(input.detail ?? {}),
      ...(input.occurredAtUtc === undefined
        ? {}
        : { occurredAtUtc: input.occurredAtUtc }),
    },
  });
}

/** Append many events in one transaction, preserving order. */
export async function appendAuditEvents(
  inputs: AuditAppendInput[],
): Promise<void> {
  if (inputs.length === 0) return;
  await prisma.auditEvent.createMany({
    data: inputs.map((input) => ({
      incidentId: input.incidentId ?? null,
      eventType: input.eventType,
      actorLabel: input.actorLabel,
      summary: input.summary,
      detailJson: JSON.stringify(input.detail ?? {}),
      ...(input.occurredAtUtc === undefined
        ? {}
        : { occurredAtUtc: input.occurredAtUtc }),
    })),
  });
}

export type AuditQuery = {
  incidentId?: string;
  eventType?: string;
  limit: number;
  offset: number;
};

export async function readAuditEvents(query: AuditQuery) {
  const where = {
    ...(query.incidentId === undefined ? {} : { incidentId: query.incidentId }),
    ...(query.eventType === undefined ? {} : { eventType: query.eventType }),
  };
  const [total, events] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      orderBy: [{ occurredAtUtc: "desc" }, { id: "desc" }],
      take: query.limit,
      skip: query.offset,
    }),
  ]);
  return {
    total,
    limit: query.limit,
    offset: query.offset,
    events: events.map((e) => ({
      id: e.id,
      incidentId: e.incidentId,
      occurredAtUtc: e.occurredAtUtc.toISOString(),
      eventType: e.eventType,
      actorLabel: e.actorLabel,
      summary: e.summary,
      detail: JSON.parse(e.detailJson) as unknown,
    })),
  };
}
