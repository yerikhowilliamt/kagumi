import { randomBytes } from "node:crypto";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { resetAdmin } from "../scripts/create-admin.ts";
import { ADMIN_ACCOUNTS, passwordVar, type AdminAccount } from "./admin.ts";

// M2 plan D3, D14 (write W4): create or reset the e2e admin accounts on the development branch before the run.
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
}
