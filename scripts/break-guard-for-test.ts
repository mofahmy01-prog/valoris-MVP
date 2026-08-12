/**
 * Deliberately drops one database guard, to prove the self-healing path works.
 * Development aid only — never part of a demo.
 */

export {}; // module scope

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "Observation_no_update"`);
  const rows = await prisma.$queryRawUnsafe<Array<{ name: string }>>(
    "SELECT name FROM sqlite_master WHERE type='trigger' ORDER BY name",
  );
  console.log("guards now installed:", rows.map((r) => r.name).join(", "));
}

main()
  .catch((e: unknown) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
