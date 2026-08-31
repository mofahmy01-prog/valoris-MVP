/**
 * Route guards.
 *
 * The helpers a route handler uses to ask "who is this, may they see this, and
 * is this even their organisation's data".
 *
 * The tenancy check is separate from the permission check on purpose. Holding a
 * permission says what KIND of thing you may see; belonging to the organisation
 * says WHOSE. Conflating them is how one brigade ends up reading another's data
 * with a perfectly valid session.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { NextResponse } from "next/server";

import { SIMULATION_NOTICE } from "@/lib/api/respond";

import { currentProvider } from "./providers";
import { can, type Actor, type Permission } from "./types";

export type GuardFailure = { ok: false; response: NextResponse };
export type GuardSuccess = { ok: true; actor: Actor };
export type GuardResult = GuardFailure | GuardSuccess;

function deny(status: number, error: string, message: string): GuardFailure {
  return {
    ok: false,
    response: NextResponse.json({ error, message, notice: SIMULATION_NOTICE }, { status }),
  };
}

/** Identify the caller, or refuse. */
export async function requireActor(request: Request): Promise<GuardResult> {
  const result = await currentProvider().authenticate(request);
  if (!result.authenticated) {
    return deny(401, "unauthenticated", result.reason);
  }
  return { ok: true, actor: result.actor };
}

/** Identify the caller and check they hold a permission. */
export async function requirePermission(
  request: Request,
  permission: Permission,
): Promise<GuardResult> {
  const auth = await requireActor(request);
  if (!auth.ok) return auth;

  if (!can(auth.actor, permission)) {
    return deny(
      403,
      "forbidden",
      `Role "${auth.actor.role}" does not hold ${permission}. This is a deliberate separation: an operational role is not automatically entitled to clinical detail.`,
    );
  }
  return auth;
}

/**
 * Check the caller's organisation owns this incident.
 *
 * Returns 404 rather than 403 when it does not. Confirming that an incident
 * exists but belongs to someone else is itself a disclosure — it tells an
 * outsider which incident ids are real.
 */
export function requireSameOrganisation(
  actor: Actor,
  incidentOrganisationId: string,
  incidentId: string,
): GuardFailure | null {
  if (actor.organisationId !== incidentOrganisationId) {
    return deny(404, "not_found", `No incident with id ${incidentId}`);
  }
  return null;
}
