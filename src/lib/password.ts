// Password hashing (System Design §4.4, M2 plan D10, D23). Imports only node:crypto, so that
// `node scripts/create-admin.ts` can load it under plain Node. Server only.
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const COST = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 64;
// scrypt$N$r$p$<salt: 16 bytes hex>$<key: 64 bytes hex>
const STORED = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([0-9a-f]{32})\$([0-9a-f]{128})$/;

function derive(password: string, salt: Buffer, cost: { N: number; r: number; p: number }) {
  // scrypt throws synchronously on bad parameters; inside the executor that becomes a rejection.
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, KEY_BYTES, cost, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const key = await derive(password, salt, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Reads N, r and p from the stored string, so raising them later needs no migration. False for any malformed string. */
export async function verifyPassword(password: string, stored: string) {
  const parts = STORED.exec(stored);
  if (!parts) return false;
  try {
    const key = await derive(password, Buffer.from(parts[4], "hex"), { N: Number(parts[1]), r: Number(parts[2]), p: Number(parts[3]) });
    return timingSafeEqual(key, Buffer.from(parts[5], "hex"));
  } catch {
    return false;
  }
}

let dummy: Promise<string> | undefined;

/** One scrypt against a dummy hash (computed once per process), so a missing or locked account costs the same time. Always false. */
export async function verifyDummy(password: string) {
  dummy ??= hashPassword(randomBytes(32).toString("hex"));
  await verifyPassword(password, await dummy);
  return false;
}

export function normalizeEmail(raw: string) {
  return raw.trim().toLowerCase();
}
