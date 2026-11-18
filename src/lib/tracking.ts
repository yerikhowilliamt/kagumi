// Visitor hash and rate limits (ADR-0003, milestone plan D3 and D5). Server only: it uses node:crypto.
// Reused by /api/t in M4. Raw IPs and user agents are never stored or logged.
import { createHash, createHmac } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { jakartaToday } from "./order";

const WINDOW_MS = 10 * 60_000; // fixed 10-minute windows on UTC boundaries (ERD rate_limits)

/** The client IP and user agent of a request. On Vercel the platform sets x-forwarded-for and x-real-ip. */
export function requestVisitor(headers: Pick<Headers, "get">) {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ip: forwarded || headers.get("x-real-ip")?.trim() || "",
    ua: headers.get("user-agent") ?? "",
  };
}

/** SHA-256(ip + ua + HMAC-SHA256(secret, WIB date)) as 64 hex characters. Throws without a secret. */
export function visitorHash({ ip, ua, now, secret }: { ip: string; ua: string; now: Date; secret: string | undefined }) {
  if (!secret) throw new Error("TRACKING_SECRET is not set");
  const dailySalt = createHmac("sha256", secret).update(jakartaToday(now)).digest("hex");
  return createHash("sha256").update(ip + ua + dailySalt).digest("hex");
}

/**
 * Counts one hit for `key` in the current window and says whether it is within `limit`.
 * One atomic upsert: a concurrent hit on the same key waits for the row lock, so no update is lost.
 */
export async function hitRateLimit(tx: Pick<Prisma.TransactionClient, "$queryRaw">, key: string, now: Date, limit: number) {
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);
  const [{ count }] = await tx.$queryRaw<{ count: number }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${windowStart}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET count = rate_limits.count + 1
    RETURNING count`;
  return count <= limit;
}
