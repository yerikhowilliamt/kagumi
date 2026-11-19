import type { Page } from "@playwright/test";

// M2 plan D14: one e2e admin account per admin spec file, plus the lockout account (desktop project only).
// e2e/global-setup.ts resets each with a random password per run and hands it to the workers in process.env
// (claim C5); it is never written to a file or printed. A spec added later adds its account here.
export const ADMIN_ACCOUNTS = {
  login: "e2e-login@kagumi.test",
  shell: "e2e-shell@kagumi.test",
  orders: "e2e-orders@kagumi.test",
  detail: "e2e-detail@kagumi.test",
  lockout: "e2e-lockout@kagumi.test",
} as const;

export type AdminAccount = keyof typeof ADMIN_ACCOUNTS;

export const passwordVar = (account: AdminAccount) => `KAGUMI_E2E_PASSWORD_${account.toUpperCase()}`;

export function adminPassword(account: AdminAccount): string {
  const password = process.env[passwordVar(account)];
  if (!password) throw new Error(`no e2e password for the ${account} account: e2e/global-setup.ts did not run`);
  return password;
}

export async function fillLogin(page: Page, email: string, password: string) {
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Masuk" }).click();
}

/** Logs in through the form and waits for the orders page. */
export async function loginAs(page: Page, account: AdminAccount) {
  await page.goto("/admin/login");
  await fillLogin(page, ADMIN_ACCOUNTS[account], adminPassword(account));
  await page.waitForURL("**/admin/pesanan");
}
