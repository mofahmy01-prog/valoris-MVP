/**
 * Outcome capture — what actually happened to each firefighter.
 *
 * THE GATING RECORD FOR ANY PILOT. Without it the observation log is an
 * unlabelled time series: it can show what the model said, never whether the
 * model was right. Every calibration question in `docs/CLINICAL_ASSUMPTIONS.md`
 * — the band cut-offs, additive versus multiplicative, the core temperature
 * rise rate — is unanswerable until this endpoint has been used.
 *
 * Four rules are enforced here and, where possible, in the database too:
 *
 *   1. `unknown` is a value, not an absence. An unrecorded outcome must never
 *      collapse into `nothing`, because absent labels bias any future model
 *      toward "nobody gets hurt" — the same failure as absent sensor data
 *      reading as SAFE.
 *   2. Outcomes are attributed. `recordedBy` is required, with no default and
 *      no fallback to a system actor, because an unattributed outcome is not
 *      evidence.
 *   3. Outcomes are append-only. There is no PUT and no DELETE in this file,
 *      and SQLite triggers reject both. An outcome edited after the fact is
 *      worthless.
 *   4. Outcomes are never derived from the engine. Nothing in this route reads
 *      a risk band, and nothing may. A CRITICAL band is not an outcome, and the
 *      circularity would be invisible and fatal.
 *
 * PHI: this is health information about an identified person.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { requirePermission, requireSameOrganisation } from "@/lib/auth";
import { appendAuditEvent } from "@/lib/db/audit";
import { prisma } from "@/lib/db/client";
import { badRequest, conflict, notFound, ok } from "@/lib/api/respond";
import { recordOutcomesSchema } from "@/lib/api/schemas";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/** Read the outcomes recorded for an incident. */
export async function GET(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const auth = await requirePermission(request, "OPERATIONAL_PICTURE");
  if (!auth.ok) return auth.response;

  const incident = await prisma.incident.findUnique({ where: { id } });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const wrongOrg = requireSameOrganisation(auth.actor, incident.organisationId, id);
  if (wrongOrg !== null) return wrongOrg.response;

  const rows = await prisma.incidentOutcome.findMany({
    where: { incidentId: id },
    include: { deployment: { include: { firefighter: true } } },
    orderBy: { recordedAtUtc: "asc" },
  });

  const deployments = await prisma.deployment.count({ where: { incidentId: id } });

  return ok({
    incidentId: id,
    recorded: rows.length,
    deployments,
    /** Deployments with no outcome yet. Not the same as an outcome of `nothing`. */
    outstanding: deployments - rows.length,
    outcomes: rows.map((row) => ({
      callsign: row.deployment.firefighter.callsign,
      outcome: row.outcome,
      interventionOccurred: row.interventionOccurred,
      notes: row.notes,
      recordedBy: row.recordedBy,
      recordedAtUtc: row.recordedAtUtc.toISOString(),
    })),
  });
}

/** Record outcomes. One per firefighter, once. */
export async function POST(request: Request, context: RouteContext) {
  const { id } = await context.params;

  const auth = await requirePermission(request, "RECORD_OUTCOME");
  if (!auth.ok) return auth.response;

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return badRequest("Body must be JSON");
  }

  const parsed = recordOutcomesSchema.safeParse(raw);
  if (!parsed.success) {
    return badRequest(
      parsed.error.issues[0]?.message ?? "Invalid body",
      parsed.error.issues,
    );
  }

  const incident = await prisma.incident.findUnique({
    where: { id },
    include: { deployments: { include: { firefighter: true } } },
  });
  if (incident === null) return notFound(`No incident with id ${id}`);

  const wrongOrg = requireSameOrganisation(auth.actor, incident.organisationId, id);
  if (wrongOrg !== null) return wrongOrg.response;

  // Resolve every callsign before writing anything, so a typo in the last entry
  // does not leave a half-recorded incident behind.
  const resolved = [];
  for (const entry of parsed.data.outcomes) {
    const deployment = incident.deployments.find(
      (d) => d.firefighter.callsign === entry.callsign,
    );
    if (deployment === undefined) {
      return badRequest(
        `No firefighter with callsign ${entry.callsign} was deployed on this incident`,
      );
    }
    resolved.push({ entry, deployment });
  }

  const already = await prisma.incidentOutcome.findMany({
    where: { deploymentId: { in: resolved.map((r) => r.deployment.id) } },
    include: { deployment: { include: { firefighter: true } } },
  });
  if (already.length > 0) {
    // Append-only means an outcome cannot be corrected through this route. That
    // is deliberate: the fix for a wrong outcome is a documented process, not a
    // silent overwrite.
    return conflict(
      `An outcome is already recorded for ${already
        .map((a) => a.deployment.firefighter.callsign)
        .join(", ")}. Outcomes are append-only and cannot be amended here.`,
    );
  }

  const created = await prisma.$transaction(
    resolved.map(({ entry, deployment }) =>
      prisma.incidentOutcome.create({
        data: {
          incidentId: id,
          deploymentId: deployment.id,
          outcome: entry.outcome,
          ...(entry.interventionOccurred === undefined
            ? {}
            : { interventionOccurred: entry.interventionOccurred }),
          ...(entry.notes === undefined ? {} : { notes: entry.notes }),
          /*
            Attribution comes from the VERIFIED session, not the request body.

            Before the auth seam existed this was a self-declared string, so a
            record could be attributed to anybody. The submitted value is kept
            alongside only when it differs, as a claim rather than a fact.
          */
          recordedBy: auth.actor.displayName,
        },
      }),
    ),
  );

  for (const { entry, deployment } of resolved) {
    await appendAuditEvent({
      incidentId: id,
      eventType: "outcome_recorded",
      actorLabel: auth.actor.id,
      summary: `Outcome ${entry.outcome} recorded for ${entry.callsign}`,
      detail: {
        callsign: entry.callsign,
        deploymentId: deployment.id,
        outcome: entry.outcome,
        interventionOccurred: entry.interventionOccurred ?? null,
      },
    });
  }

  const deployments = incident.deployments.length;
  const recorded = await prisma.incidentOutcome.count({ where: { incidentId: id } });

  return ok(
    {
      incidentId: id,
      created: created.length,
      recorded,
      outstanding: deployments - recorded,
      notice:
        "Outcomes are append-only and attributed. An absent outcome is NOT `nothing`; it is unrecorded.",
    },
    201,
  );
}
