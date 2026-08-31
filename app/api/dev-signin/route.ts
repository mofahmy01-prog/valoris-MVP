/**
 * Development sign-in. Local use only.
 *
 * Issues a signed session for a chosen role so the guards can be exercised
 * without an identity provider. It refuses entirely unless VALORIS_AUTH=dev, so
 * it cannot be reached in a deployment that has not deliberately opted in.
 *
 * There is no password. That is not an oversight — adding one would imply this
 * is an authentication system, and it is a development fixture.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { NextResponse } from "next/server";
import { z } from "zod";

import { SIMULATION_NOTICE } from "@/lib/api/respond";
import { DevIdentityProvider, DEV_SESSION_COOKIE, ROLES } from "@/lib/auth";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  role: z.enum(ROLES),
  displayName: z.string().trim().min(1).max(120).default("Dev User"),
  organisationId: z.string().trim().min(1).optional(),
});

export async function POST(request: Request) {
  if (process.env.VALORIS_AUTH !== "dev") {
    return NextResponse.json(
      {
        error: "forbidden",
        message:
          "Development sign-in is disabled. Set VALORIS_AUTH=dev to enable it locally. It must never be enabled anywhere holding real data.",
        notice: SIMULATION_NOTICE,
      },
      { status: 403 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json(
      { error: "bad_request", message: "Body must be JSON", notice: SIMULATION_NOTICE },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: parsed.error.issues[0]?.message ?? "Invalid body",
        notice: SIMULATION_NOTICE,
      },
      { status: 400 },
    );
  }

  // Default to the seeded organisation so a developer does not have to look one
  // up, but never invent an id that does not exist.
  const organisationId =
    parsed.data.organisationId ??
    (await prisma.organisation.findFirst({ orderBy: { name: "asc" } }))?.id;

  if (organisationId === undefined) {
    return NextResponse.json(
      {
        error: "bad_request",
        message: "No organisation exists to sign in against. Run npm run seed first.",
        notice: SIMULATION_NOTICE,
      },
      { status: 400 },
    );
  }

  const provider = new DevIdentityProvider();
  const session = provider.issue({
    id: `dev-${parsed.data.role}`,
    displayName: parsed.data.displayName,
    role: parsed.data.role,
    organisationId,
  });

  const response = NextResponse.json({
    signedInAs: { role: parsed.data.role, displayName: parsed.data.displayName, organisationId },
    warning: provider.disclosure,
    notice: SIMULATION_NOTICE,
  });
  response.cookies.set(DEV_SESSION_COOKIE, session, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  return response;
}
