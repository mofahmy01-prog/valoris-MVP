/**
 * (Re)apply the database-level append-only and reason guards, then verify them.
 *
 * Run this after ANY Prisma migration that touches `Observation` or
 * `AuditEvent`. Prisma implements column additions on SQLite by rebuilding the
 * table, and SQLite drops triggers attached to a dropped table — so a routine
 * migration silently removes these guards. That happened twice during
 * Milestone 3, and only `npm run verify:m2` caught it.
 *
 * npm run db:guards
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type Guard = { name: string; sql: string };

const GUARDS: Guard[] = [
  {
    name: "Observation_no_update",
    sql: `CREATE TRIGGER "Observation_no_update"
BEFORE UPDATE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: UPDATE is not permitted');
END`,
  },
  {
    name: "Observation_no_delete",
    sql: `CREATE TRIGGER "Observation_no_delete"
BEFORE DELETE ON "Observation"
BEGIN
  SELECT RAISE(ABORT, 'Observation is append-only: DELETE is not permitted');
END`,
  },
  {
    name: "AuditEvent_no_update",
    sql: `CREATE TRIGGER "AuditEvent_no_update"
BEFORE UPDATE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: UPDATE is not permitted');
END`,
  },
  {
    name: "AuditEvent_no_delete",
    sql: `CREATE TRIGGER "AuditEvent_no_delete"
BEFORE DELETE ON "AuditEvent"
BEGIN
  SELECT RAISE(ABORT, 'AuditEvent is append-only: DELETE is not permitted');
END`,
  },
  {
    name: "CommanderAction_reason_required_insert",
    sql: `CREATE TRIGGER "CommanderAction_reason_required_insert"
BEFORE INSERT ON "CommanderAction"
WHEN NEW."action" IN ('reject', 'override')
     AND (NEW."reasonText" IS NULL OR TRIM(NEW."reasonText") = '')
BEGIN
  SELECT RAISE(ABORT, 'A reject or override requires a non-empty reason');
END`,
  },
];

async function main(): Promise<void> {
  const before = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  const present = new Set(before.map((t) => t.name));
  console.log("SIMULATION MODE — NOT FOR OPERATIONAL USE");
  console.log(`Triggers before: ${before.length === 0 ? "(none)" : [...present].join(", ")}`);

  const missing = GUARDS.filter((g) => !present.has(g.name));
  if (missing.length > 0) {
    console.log(
      `MISSING ${missing.length} guard(s): ${missing.map((g) => g.name).join(", ")}`,
    );
  }

  for (const guard of GUARDS) {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${guard.name}"`);
    await prisma.$executeRawUnsafe(guard.sql);
  }

  const after = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  const now = new Set(after.map((t) => t.name));
  console.log(`Triggers after:  ${[...now].join(", ")}`);

  let ok = true;
  for (const guard of GUARDS) {
    const installed = now.has(guard.name);
    console.log(`  [${installed ? "OK" : "FAIL"}] ${guard.name}`);
    if (!installed) ok = false;
  }

  // Prove the guard actually bites, rather than merely existing.
  const observation = await prisma.observation.findFirst();
  if (observation !== null) {
    try {
      await prisma.$executeRawUnsafe(
        `UPDATE "Observation" SET "hrBpm" = "hrBpm" WHERE id = ?`,
        observation.id,
      );
      console.log("  [FAIL] an UPDATE on Observation still succeeded");
      ok = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const bites = message.includes("append-only");
      console.log(`  [${bites ? "OK" : "FAIL"}] Observation UPDATE refused: ${message.split("\n").pop()}`);
      if (!bites) ok = false;
    }
  } else {
    console.log("  [skip] no observation rows to test the guard against");
  }

  console.log(ok ? "RESULT: all guards installed and enforcing" : "RESULT: GUARDS NOT ENFORCED");
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
