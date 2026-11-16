import { PrismaNeon } from "@prisma/adapter-neon";
// Relative .ts import so `node prisma/seed.ts` (type stripping, no @ alias) can load this file.
import { PrismaClient } from "../generated/prisma/client.ts";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

function createClient() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");
  return new PrismaClient({ adapter: new PrismaNeon({ connectionString }) });
}

// Pooled URL at runtime (ADR-0002). Cached in development so hot reload doesn't open a new pool each time.
export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
