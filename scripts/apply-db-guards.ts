/**
 * (Re)apply the database integrity guards and prove they enforce.
 *
 * Run by `npm run seed` (part of the documented startup) and by
 * `npm run migrate`. Also runnable directly: `npm run db:guards`.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope

import { PrismaClient } from "@prisma/client";

import { applyDatabaseGuards, DATABASE_GUARDS } from "../lib/db/guards";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.log("SIMULATION MODE — NOT FOR OPERATIONAL USE");
  const report = await applyDatabaseGuards(prisma);

  if (report.missingBefore.length > 0) {
    console.log("");
    console.log("!".repeat(78));
    console.log(
      `GUARD INTEGRITY FAILURE: ${report.missingBefore.length} guard(s) were MISSING and have been restored:`,
    );
    for (const name of report.missingBefore) console.log(`  - ${name}`);
    console.log(
      "A Prisma migration that rebuilds a table drops its triggers. See docs/KNOWN_LIMITATIONS.md item 22.",
    );
    console.log("!".repeat(78));
    console.log("");
  } else {
    console.log("All guards were already present.");
  }

  for (const guard of DATABASE_GUARDS) {
    const ok = report.installed.includes(guard.name);
    console.log(`  [${ok ? "OK" : "FAIL"}] ${guard.name} — ${guard.purpose}`);
  }
  console.log(
    `  [${report.enforcing ? "OK" : "FAIL"}] enforcement proven: ${report.enforcementDetail}`,
  );

  const ok =
    report.enforcing &&
    DATABASE_GUARDS.every((g) => report.installed.includes(g.name));
  console.log(
    ok ? "RESULT: all guards installed and enforcing" : "RESULT: GUARDS NOT ENFORCED",
  );
  if (!ok) process.exitCode = 1;
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
