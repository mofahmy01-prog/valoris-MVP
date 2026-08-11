import { PrismaClient } from "@prisma/client";

/**
 * Single Prisma client. Next dev reloads modules, so it is cached on the global
 * object to avoid exhausting SQLite connections.
 */
const globalForPrisma = globalThis as unknown as {
  valorisPrisma?: PrismaClient;
};

export const prisma: PrismaClient =
  globalForPrisma.valorisPrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.valorisPrisma = prisma;
}
