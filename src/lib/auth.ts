// Admin authentication (ADR-0001, System Design §4.4, M2 plan D8, D9, D11). Server only.
// Functions that touch the database take the client as a parameter and `now`, so tests/db can run them
// in rolled-back transactions; getAdmin and requireAdmin bind them to the request.
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "./db";
import { normalizeEmail, verifyDummy, verifyPassword } from "./password";

export const SESSION_COOKIE = "kd_session";

const SESSION_MS = 7 * 24 * 60 * 60_000;
const RENEW_BELOW_MS = 24 * 60 * 60_000;
const MAX_PASSWORD = 1024;
const MAX_EMAIL = 254;

type Client = Prisma.TransactionClient;
export type AdminSession = { sessionId: string; admin: { id: string; email: string } };

const sha256 = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * One login attempt (D9). An atomic UPDATE reserves the attempt on an unlocked account and locks it on the
 * fifth, then exactly one scrypt runs: against the account's hash, or a dummy when no row came back
 * (unknown email or locked). Every failure returns the same value.
 */
export async function attemptLogin(
  client: Client,
  input: { email: string; password: string; now: Date },
): Promise<{ ok: true; adminId: string } | { ok: false }> {
  const email = normalizeEmail(input.email);
  const { password, now } = input;
  if (!email || email.length > MAX_EMAIL || password.length < 1 || password.length > MAX_PASSWORD) return { ok: false };

  // Runs on its own (no row lock held during scrypt); concurrent attempts are serialized by the row lock.
  const [row] = await client.$queryRaw<{ id: string; password_hash: string }[]>`
    UPDATE admin_users SET
      failed_attempts = CASE WHEN failed_attempts + 1 >= 5 THEN 0 ELSE failed_attempts + 1 END,
      locked_until    = CASE WHEN failed_attempts + 1 >= 5 THEN ${now}::timestamptz + interval '15 minutes' ELSE NULL END,
      updated_at      = ${now}::timestamptz
    WHERE email = ${email} AND (locked_until IS NULL OR locked_until <= ${now}::timestamptz)
    RETURNING id, password_hash`;

  const matches = row ? await verifyPassword(password, row.password_hash) : await verifyDummy(password);
  if (!row || !matches) return { ok: false };

  await client.adminUser.update({ where: { id: row.id }, data: { failedAttempts: 0, lockedUntil: null, updatedAt: now } });
  return { ok: true, adminId: row.id };
}

/** A new session (D8): the token goes only to the cookie, the database keeps sha256(token). */
export async function createSession(client: Client, adminId: string, now: Date) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_MS);
  await client.session.create({ data: { adminId, tokenHash: sha256(token), expiresAt } });
  return { token, expiresAt };
}

/** The session of a token, or null when unknown or expired. Renews to now + 7 days when less than 1 day is left. */
export async function findSession(client: Client, token: string, now: Date): Promise<AdminSession | null> {
  const session = await client.session.findUnique({
    where: { tokenHash: sha256(token) },
    select: { id: true, expiresAt: true, admin: { select: { id: true, email: true } } },
  });
  if (!session || session.expiresAt <= now) return null;
  if (session.expiresAt.getTime() - now.getTime() < RENEW_BELOW_MS) {
    await client.session.update({ where: { id: session.id }, data: { expiresAt: new Date(now.getTime() + SESSION_MS) } });
  }
  return { sessionId: session.id, admin: session.admin };
}

export async function deleteSession(client: Client, sessionId: string) {
  await client.session.deleteMany({ where: { id: sessionId } });
}

/** The admin of the current request, read once per request (React cache). */
export const getAdmin = cache(async (): Promise<AdminSession | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? findSession(db, token, new Date()) : null;
});

/** Called by every protected layout, page, Server Action and Route Handler (FR21, D4). */
export async function requireAdmin(): Promise<AdminSession> {
  return (await getAdmin()) ?? redirect("/admin/login");
}
