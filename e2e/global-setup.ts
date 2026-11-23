import { randomBytes } from "node:crypto";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { resetAdmin } from "../scripts/create-admin.ts";
import { ADMIN_ACCOUNTS, passwordVar, type AdminAccount } from "./admin.ts";

// M2 plan D3, D14 (write W4): create or reset the e2e admin accounts on the development branch before the run.
// M3 plan D24 (W3): delete the products a failed product spec left behind.
export default async function globalSetup() {
  // Never write to a deployed database: return before .env is even loaded.
  if (process.env.PLAYWRIGHT_BASE_URL) return;
  process.loadEnvFile();
  assertDevelopmentDatabase();
  // Dynamic import: db.ts reads DATABASE_URL on load, so .env must be loaded and checked first.
  const { db } = await import("../src/lib/db.ts");
  const now = new Date();
  for (const [account, email] of Object.entries(ADMIN_ACCOUNTS) as [AdminAccount, string][]) {
    const password = randomBytes(24).toString("base64url");
    // resetAdmin also clears the lockout and deletes the account's sessions.
    await db.$transaction((tx) => resetAdmin(tx, { email, password, now }));
    // Workers are forked after the global setup with a copy of this process's environment (C5).
    process.env[passwordVar(account)] = password;
  }
  // M3 plan D5, D24 (write W3): products left by a failed run of a product spec would break the storefront specs.
  // They have no media before M3.4, so the row is deleted directly (M3.3 moves this to the delete path).
  // shortcut: this runs outside a request, so it can't expire the storefront cache; a leftover that was still visible
  // (a run killed before its afterAll hid it) stays in the cached list until the next updateTag or the hour.
  await db.product.deleteMany({ where: { name: { startsWith: "E2E " } } });
}
