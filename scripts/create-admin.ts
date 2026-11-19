// Creates or resets the development admin account from ADMIN_EMAIL and ADMIN_PASSWORD (System Design §4.4,
// M2 plan D13). Run: `node scripts/create-admin.ts`. Development branch only; never against production.
// Relative .ts imports: Node's type stripping does not know the @ alias.
import type { Prisma } from "../src/generated/prisma/client.ts";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { hashPassword, normalizeEmail } from "../src/lib/password.ts";

/** A broken input rule. Its message names the rule, never the value. */
export class AdminInputError extends Error {}

/**
 * Inserts the admin, or updates it by email: a new hash, the lock cleared, and that admin's sessions deleted.
 * Other admin rows are untouched. The caller runs it in one transaction.
 */
export async function resetAdmin(
  client: Prisma.TransactionClient,
  input: { email: string; password: string; now: Date },
): Promise<"created" | "reset"> {
  const email = normalizeEmail(input.email);
  const { password, now } = input;
  if (email.split("@").length !== 2) throw new AdminInputError("ADMIN_EMAIL must contain exactly one @");
  if (email.length > 254) throw new AdminInputError("ADMIN_EMAIL must be at most 254 characters");
  if (password.length < 12) throw new AdminInputError("ADMIN_PASSWORD must be at least 12 characters");
  if (password.length > 1024) throw new AdminInputError("ADMIN_PASSWORD must be at most 1024 characters");

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

if (import.meta.main) {
  try {
    process.loadEnvFile();
  } catch {}
  assertDevelopmentDatabase();
  // Dynamic import: db.ts reads DATABASE_URL on load, so .env must be loaded and checked first.
  const { db } = await import("../src/lib/db.ts");
  try {
    const input = { email: process.env.ADMIN_EMAIL ?? "", password: process.env.ADMIN_PASSWORD ?? "", now: new Date() };
    const result = await db.$transaction((tx) => resetAdmin(tx, input));
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
