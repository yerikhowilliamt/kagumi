// Creates or resets an admin account from ADMIN_EMAIL and ADMIN_PASSWORD (System Design §4.4, M2 plan D13).
// Run: `node scripts/create-admin.ts` against the development branch. The production account (M5 plan D1, D10):
// `node --env-file=.env.prod-admin scripts/create-admin.ts` with CREATE_ADMIN_TARGET=production, run by the user.
// Relative .ts imports: Node's type stripping does not know the @ alias.
import type { Prisma, PrismaClient } from "../src/generated/prisma/client.ts";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { hashPassword, normalizeEmail } from "../src/lib/password.ts";

/** A broken input or target rule. Its message names the rule, never the value. */
export class AdminInputError extends Error {}

type AdminInput = { email: string; password: string; now: Date };

/** Throws AdminInputError on a broken input rule; returns the normalized email. */
export function checkAdminInput(input: { email: string; password: string }) {
  const email = normalizeEmail(input.email);
  const { password } = input;
  if (email.split("@").length !== 2) throw new AdminInputError("ADMIN_EMAIL must contain exactly one @");
  if (email.length > 254) throw new AdminInputError("ADMIN_EMAIL must be at most 254 characters");
  if (password.length < 12) throw new AdminInputError("ADMIN_PASSWORD must be at least 12 characters");
  if (password.length > 1024) throw new AdminInputError("ADMIN_PASSWORD must be at most 1024 characters");
  return email;
}

/**
 * Production mode (M5 plan §4.3): DATABASE_URL must be the host named in PROD_DATABASE_HOST (direct host, the
 * pooled URL's "-pooler." removed), and that host must not be DEV_DATABASE_HOST.
 */
export function assertProductionTarget(env: Record<string, string | undefined>) {
  if (env.CREATE_ADMIN_TARGET !== "production") throw new AdminInputError("CREATE_ADMIN_TARGET must be production or unset");
  if (!env.PROD_DATABASE_HOST) throw new AdminInputError("PROD_DATABASE_HOST must be set in production mode");
  const url = env.DATABASE_URL && URL.canParse(env.DATABASE_URL) ? new URL(env.DATABASE_URL) : undefined;
  if (url?.hostname.replace("-pooler.", ".") !== env.PROD_DATABASE_HOST) {
    throw new AdminInputError("DATABASE_URL host must equal PROD_DATABASE_HOST");
  }
  if (env.PROD_DATABASE_HOST === env.DEV_DATABASE_HOST) throw new AdminInputError("PROD_DATABASE_HOST must not be DEV_DATABASE_HOST");
}

/**
 * Inserts the admin, or updates it by email: a new hash, the lock cleared, and that admin's sessions deleted.
 * Other admin rows are untouched. The caller runs it in one transaction.
 */
export async function resetAdmin(
  client: Prisma.TransactionClient,
  input: AdminInput,
): Promise<"created" | "reset"> {
  const email = checkAdminInput(input);
  const { password, now } = input;

  const passwordHash = await hashPassword(password);
  const existing = await client.adminUser.findUnique({ where: { email }, select: { id: true } });
  if (!existing) {
    await client.adminUser.create({ data: { email, passwordHash, createdAt: now, updatedAt: now } });
    return "created";
  }
  await client.adminUser.update({
    where: { id: existing.id },
    data: { passwordHash, failedAttempts: 0, lockedUntil: null, updatedAt: now },
  });
  await client.session.deleteMany({ where: { adminId: existing.id } });
  return "reset";
}

/** resetAdmin in one transaction (TD-007: a new Neon connection can take longer than Prisma's 2 s default). */
export function createAdmin(client: Pick<PrismaClient, "$transaction">, input: AdminInput) {
  return client.$transaction((tx) => resetAdmin(tx, input), { maxWait: 10_000 });
}

if (import.meta.main) {
  // Read before .env: production mode never loads it, so no development value can reach the guard (D10).
  const target = process.env.CREATE_ADMIN_TARGET;
  if (target === undefined) {
    try {
      process.loadEnvFile();
    } catch {}
    assertDevelopmentDatabase();
  }
  const input = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "", now: new Date() };
  try {
    if (target !== undefined) assertProductionTarget(process.env);
    checkAdminInput(input); // D9: before the database, so a broken rule is reported even when it can't be reached
  } catch (error) {
    console.error((error as Error).message);
    process.exit(1);
  }
  // Dynamic import: db.ts reads DATABASE_URL on load, so .env must be loaded and checked first.
  const { db } = await import("../src/lib/db.ts");
  try {
    const result = await createAdmin(db, input);
    console.log(`admin account ${result}`);
  } catch (error) {
    // Never the email, the password or a driver message that could quote them.
    const { name, code } = error as { name?: string; code?: string };
    console.error(error instanceof AdminInputError ? error.message : `create-admin failed: ${name ?? "Error"}${code ? ` ${code}` : ""}`);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
