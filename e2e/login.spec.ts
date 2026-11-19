import { randomBytes } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { ADMIN_ACCOUNTS, adminPassword, fillLogin, loginAs } from "./admin";

// M2.2 login (PRD FR15, FR19–FR21, design.md §7 Login, M2 plan D2, D4, D8, D11, D14, D21, D22).
// Logs in with the e2e accounts that e2e/global-setup.ts resets on the development branch (plan W4).
if (process.env.PLAYWRIGHT_BASE_URL) {
  // D14: the admin accounts exist only on the development branch; never log in against a deployed database.
  throw new Error("e2e/login.spec.ts writes sessions: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}

const INVALID = "Email atau password salah.";
const COOKIE = "kd_session";

// Next renders its route announcer with role="alert" outside <main>.
const formAlert = (page: Page) => page.locator("main").getByRole("alert");

const sessionCookie = async (context: BrowserContext) => (await context.cookies()).find((c) => c.name === COOKIE);

/** Submits the form and waits for the action's response, so a stale alert from the previous attempt isn't read. */
async function submit(page: Page, email: string, password: string) {
  const response = page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).pathname === "/admin/login");
  await fillLogin(page, email, password);
  await response;
}

test.describe("login page (K1, D21, D22)", () => {
  for (const theme of ["light", "dark"] as const) {
    test(`shows the design.md §7 login in ${theme} without horizontal scroll`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await page.goto("/admin/login");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page).toHaveTitle("Admin · Kagumi Dough");
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex, nofollow");

      await expect(page.getByRole("img", { name: "Kagumi Dough" })).toBeVisible();
      await expect(page.getByText("Admin", { exact: true })).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Masuk ke dashboard");
      await expect(page.getByText("Kelola menu, pesanan, dan statistik toko.")).toBeVisible();
      for (const label of ["Email", "Password"]) {
        const field = page.getByLabel(label);
        await expect(field).toBeVisible();
        expect((await field.boundingBox())?.height, label).toBe(44);
      }
      await expect(page.getByLabel("Email")).toHaveAttribute("autocomplete", "username");
      await expect(page.getByLabel("Password")).toHaveAttribute("autocomplete", "current-password");
      await expect(page.getByRole("button", { name: "Masuk" })).toBeVisible();
      await expect(page.getByText("Lupa password? Hubungi pengelola website.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Ganti tema terang/gelap" })).toBeVisible();
      await expect(formAlert(page)).toHaveCount(0);

      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
});

test("right credentials land on the orders page with the D8 session cookie (K2)", async ({ page, context }) => {
  await loginAs(page, "login");
  await expect(page).toHaveURL(/\/admin\/pesanan$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Pesanan dari website");
  const cookie = await sessionCookie(context);
  expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax", path: "/", expires: -1 });
  expect(cookie?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
});

test("a wrong password and an unknown email get the same alert, keep the email and set no cookie (K3)", async ({ page, context }) => {
  await page.goto("/admin/login");
  const alerts: string[] = [];
  // At most one wrong password per project on the login account, so parallel projects never reach the lockout (D14).
  for (const [email, password] of [
    [ADMIN_ACCOUNTS.login, `salah-${randomBytes(6).toString("hex")}`],
    [`tidak-ada-${randomBytes(6).toString("hex")}@kagumi.test`, adminPassword("login")],
  ]) {
    await submit(page, email, password);
    await expect(formAlert(page)).toHaveText(INVALID);
    alerts.push((await formAlert(page).textContent()) ?? "");
    await expect(page.getByLabel("Email")).toHaveValue(email);
    await expect(page.getByLabel("Password")).toHaveValue("");
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect(await sessionCookie(context)).toBeUndefined();
  }
  expect(alerts[0]).toBe(alerts[1]);
});

test("five wrong passwords lock the account: the right one then fails the same way (K4)", async ({ page, context }, info) => {
  test.skip(info.project.name !== "desktop", "D14: the lockout account is used by the desktop project only");
  await page.goto("/admin/login");
  for (let i = 0; i < 5; i++) {
    await submit(page, ADMIN_ACCOUNTS.lockout, `salah-${i}-${randomBytes(6).toString("hex")}`);
    await expect(formAlert(page)).toHaveText(INVALID);
  }
  await submit(page, ADMIN_ACCOUNTS.lockout, adminPassword("lockout"));
  await expect(formAlert(page)).toHaveText(INVALID);
  await expect(page).toHaveURL(/\/admin\/login$/);
  expect(await sessionCookie(context)).toBeUndefined();
});

test.describe("the protected boundary (K5)", () => {
  for (const path of ["/admin", "/admin/pesanan"]) {
    test(`${path} without a cookie and with a random token redirects to the login`, async ({ page, context, baseURL }) => {
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
      await context.addCookies([{ name: COOKIE, value: randomBytes(32).toString("base64url"), url: baseURL, httpOnly: true, secure: true, sameSite: "Lax" }]);
      await page.goto(path);
      await expect(page).toHaveURL(/\/admin\/login$/);
    });
  }

  test("a logged-in visit to the login lands on the orders; after Keluar the old cookie no longer opens them", async ({ page, context, baseURL }) => {
    await loginAs(page, "login");
    await page.goto("/admin/login");
    await expect(page).toHaveURL(/\/admin\/pesanan$/);

    const old = await sessionCookie(context);
    expect(old).toBeDefined();
    await page.getByRole("button", { name: "Keluar" }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect(await sessionCookie(context)).toBeUndefined();

    // The row is gone, not only the cookie.
    await context.addCookies([{ name: COOKIE, value: old!.value, url: baseURL, httpOnly: true, secure: true, sameSite: "Lax" }]);
    await page.goto("/admin/pesanan");
    await expect(page).toHaveURL(/\/admin\/login$/);
  });
});
