/**
 * Database-level integrity guards, defined in one place.
 *
 * WHY THIS MODULE EXISTS. Prisma implements column additions on SQLite by
 * rebuilding the table — CREATE, copy, DROP, RENAME — and SQLite drops every
 * trigger attached to a dropped table. Two routine migrations silently removed
 * the `Observation` append-only guards during Milestone 3.
 *
 * A guarantee that depends on someone remembering to re-run a script is not a
 * guarantee. So the guards are applied by `npm run seed`, which is part of the
 * documented startup sequence, and by `npm run migrate`, and they are asserted
 * by `npm run verify:m2`. Any one of those three restores or reports them.
 */

import type { PrismaClient } from "@prisma/client";

export type DatabaseGuard = {
  name: string;
  purpose: string;
  createSql: string;
};

export const DATABASE_GUARDS: DatabaseGuard[] = [
  {
    name: "Observation_no_update",
    purpose: "Observation is append-only",
    createSql: `CREATE TRIGGER "Observation_no_update"
BEFORE UPDATE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: UPDATE is not permitted');
END`,
  },
  {
    name: "Observation_no_delete",
    purpose: "Observation is append-only",
    createSql: `CREATE TRIGGER "Observation_no_delete"
BEFORE DELETE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: DELETE is not permitted');
END`,
  },
  {
    name: "AuditEvent_no_update",
    purpose: "AuditEvent is append-only",
    createSql: `CREATE TRIGGER "AuditEvent_no_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: UPDATE is not permitted');
END`,
  },
  {
    name: "AuditEvent_no_delete",
    purpose: "AuditEvent is append-only",
    createSql: `CREATE TRIGGER "AuditEvent_no_delete"
BEFORE DELETE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: DELETE is not permitted');
END`,
  },
  {
    name: "CommanderAction_reason_required_insert",
    purpose: "A reject or override requires a non-empty reason",
    createSql: `CREATE TRIGGER "CommanderAction_reason_required_insert"
BEFORE INSERT ON "CommanderAction"
WHEN NEW."action" IN ('reject', 'override')
     AND (NEW."reasonText" IS NULL OR TRIM(NEW."reasonText") = '')
BEGIN
  SELECT RAISE(ABORT, 'A reject or override requires a non-empty reason');
END`,
  },
];

export async function listInstalledGuards(
  prisma: PrismaClient,
): Promise<string[]> {
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  return rows.map((r) => r.name);
}

export type GuardReport = {
  installed: string[];
  missingBefore: string[];
  applied: string[];
  enforcing: boolean;
  enforcementDetail: string;
};

/** Idempotently (re)create every guard. Safe to run on every startup. */
export async function applyDatabaseGuards(
  prisma: PrismaClient,
): Promise<GuardReport> {
  const before = await listInstalledGuards(prisma);
  const present = new Set(before);
  const missingBefore = DATABASE_GUARDS.filter(
    (g) => !present.has(g.name),
  ).map((g) => g.name);

  for (const guard of DATABASE_GUARDS) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${guard.name}"`);
    await prisma.$executeRawUnsafe(guard.createSql);
  }

  const installed = await listInstalledGuards(prisma);

  // Existence is not enforcement. Prove one guard actually refuses a write.
  let enforcing = true;
  let enforcementDetail = "no observation rows available to test against";
  const observation = await prisma.observation.findFirst();
  if (observation !== null) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Observation" SET "hrBpm" = "hrBpm" WHERE id = ?`,
        observation.id,
      );
      enforcing = false;
      enforcementDetail = "an UPDATE on Observation succeeded — the guard is NOT enforcing";
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      enforcing = message.includes("append-only");
      enforcementDetail = message.split("\n").pop() ?? message;
    }
  }

  return {
    installed,
    missingBefore,
    applied: DATABASE_GUARDS.map((g) => g.name),
    enforcing,
    enforcementDetail,
  };
}

/** Read-only check. Never repairs — used where the truth matters more. */
export async function verifyDatabaseGuards(prisma: PrismaClient): Promise<{
  ok: boolean;
  missing: string[];
  installed: string[];
}> {
  const installed = await listInstalledGuards(prisma);
  const present = new Set(installed);
  const missing = DATABASE_GUARDS.filter((g) => !present.has(g.name)).map(
    (g) => g.name,
  );
  return { ok: missing.length === 0, missing, installed };
}
