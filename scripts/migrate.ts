/**
 * Migrate, then restore the database integrity guards.
 *
 * Use this instead of `npx prisma migrate dev`. Prisma rebuilds SQLite tables to
 * add columns, which drops their triggers — so a migration must always be
 * followed by re-applying the guards. Chaining them here removes the dependency
 * on anyone remembering.
 *
 *   npm run migrate                          (prompts for a name, as Prisma does)
 *   npm run migrate -- --name my_change      (arguments pass through to Prisma)
 *
 * Arguments are forwarded to `prisma migrate dev` specifically, not appended to
 * the end of a shell chain where they would land on the wrong command.
 *
 * SIMULATION MODE — NOT FOR OPERATIONAL USE.
 */

export {}; // module scope

import { spawnSync } from "node:child_process";

const passthrough = process.argv.slice(2);

console.log(
  `> prisma migrate dev ${passthrough.join(" ")}`.trimEnd(),
);
const migrate = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["prisma", "migrate", "dev", ...passthrough],
  { stdio: "inherit" },
);

if (migrate.status !== 0) {
  console.error(
    `\nMigration failed (exit ${migrate.status ?? "unknown"}). Guards NOT re-applied.`,
  );
  process.exit(migrate.status ?? 1);
}

console.log("\n> restoring database integrity guards");
const guards = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsx", "scripts/apply-db-guards.ts"],
  { stdio: "inherit" },
);
process.exit(guards.status ?? 1);
