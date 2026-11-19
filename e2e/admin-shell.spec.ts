import { expect, test, type Page } from "@playwright/test";
import { loginAs } from "./admin";

// M2.3 admin shell (design.md §7 Shell and Status bar, PRD FR36, M2 plan D6, D17, D22).
// Logs in with the shell account that e2e/global-setup.ts resets on the development branch (plan W4).
if (process.env.PLAYWRIGHT_BASE_URL) {
  // D14: the admin accounts exist only on the development branch; never log in against a deployed database.
  throw new Error("e2e/admin-shell.spec.ts writes sessions: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}

const TOGGLE = "Ganti tema terang/gelap";
const STATUS = /^(\d+) pesanan baru · (\d+) PO aktif · Diperbarui ([01]\d|2[0-3])\.[0-5]\d$/;

const statusText = (page: Page) => page.getByText(/pesanan baru ·/);

async function newOrderCount(page: Page) {
  const text = ((await statusText(page).textContent()) ?? "").replace(/\s+/g, " ").trim();
  const match = STATUS.exec(text);
  expect(match, `status bar text "${text}"`).not.toBeNull();
  return Number(match![1]);
}

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) > 760;

test.describe("desktop shell (K1, K3)", () => {
  test.beforeEach(({ page }) => test.skip(!isDesktop(page), "desktop project only"));

  test("sidebar: brand, Pesanan current with the NEW pill, bottom group; status bar text", async ({ page }) => {
    await loginAs(page, "shell");
    const side = page.locator("aside");
    await expect(side).toBeVisible();
    const brand = side.locator("div", { has: page.locator("small") }).last();
    await expect(brand).toHaveText("Kagumi DoughAdmin");
    await expect(brand.locator("small")).toHaveText("Admin");

    // D6: only pages that exist.
    const nav = page.getByRole("navigation", { name: "Menu admin" });
    await expect(nav).toHaveCount(1);
    await expect(nav.getByRole("link")).toHaveCount(1);
    const orders = nav.getByRole("link", { name: /^Pesanan/ });
    await expect(orders).toHaveAttribute("href", "/admin/pesanan");
    await expect(orders).toHaveAttribute("aria-current", "page");

    // D17: the pill shows the NEW count of the status bar and is absent at 0.
    const count = await newOrderCount(page);
    if (count === 0) await expect(orders).toHaveText("Pesanan");
    else await expect(orders).toHaveText(`Pesanan${count}`);

    const toggle = side.getByRole("button", { name: TOGGLE });
    await expect(toggle).toHaveText("Ganti tema");
    const site = side.getByRole("link", { name: "Lihat website" });
    await expect(site).toHaveAttribute("href", "/");
    await expect(site).toHaveAttribute("target", "_blank");
    await expect(site).toHaveAttribute("rel", "noopener");
    await expect(side.getByRole("button", { name: "Keluar" })).toBeVisible();

    await expect(page.locator("header")).toBeHidden();
    await expect(page.getByRole("button", { name: TOGGLE })).toHaveCount(1);
  });
});

test.describe("360 px shell (K2)", () => {
  test.beforeEach(({ page }) => test.skip(isDesktop(page), "mobile-360 project only"));

  test("top bar with logo, toggle and Keluar; fixed bottom nav; no sidebar", async ({ page }) => {
    await loginAs(page, "shell");
    const top = page.locator("header");
    await expect(top).toBeVisible();
    await expect(top.locator("img")).toBeVisible();
    await expect(top.getByText("Kagumi Admin")).toBeVisible();
    await expect(top.getByRole("button", { name: TOGGLE })).toBeVisible();
    await expect(top.getByRole("button", { name: "Keluar" })).toBeVisible();
    expect((await top.boundingBox())?.height).toBe(60);

    await expect(page.locator("aside")).toBeHidden();
    const nav = page.getByRole("navigation", { name: "Menu admin" });
    await expect(nav).toHaveCount(1);
    await expect(nav).toHaveCSS("position", "fixed");
    await expect(nav.getByRole("link")).toHaveCount(1);
    await expect(nav.getByRole("link", { name: "Pesanan" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("button", { name: TOGGLE })).toHaveCount(1);
    await expect(statusText(page)).toHaveText(STATUS);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`no horizontal scroll on /admin/pesanan in ${theme} (K5)`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "shell");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
});

test("the admin toggle switches the theme and the storefront opened afterwards uses it (K5, FR36)", async ({ page }) => {
  await page.addInitScript(() => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem("kagumi-theme", "light");
      sessionStorage.setItem("seeded", "1");
    }
  });
  await loginAs(page, "shell");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: TOGGLE }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.goto("/");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("Keluar from the shell ends the session (K6)", async ({ page }) => {
  await loginAs(page, "shell");
  // The visible one: the sidebar's on desktop, the top bar's at 360 px.
  const keluar = page.getByRole("button", { name: "Keluar" });
  await expect(keluar).toHaveCount(1);
  await expect(isDesktop(page) ? page.locator("aside").getByRole("button", { name: "Keluar" }) : page.locator("header").getByRole("button", { name: "Keluar" })).toBeVisible();
  await keluar.click();
  await page.waitForURL("**/admin/login");
  await page.goto("/admin/pesanan");
  await expect(page).toHaveURL(/\/admin\/login$/);
});

test("Tab reaches every nav item and Keluar with a visible focus ring (K6)", async ({ page }) => {
  await loginAs(page, "shell");
  const targets = isDesktop(page)
    ? ["Pesanan", TOGGLE, "Lihat website", "Keluar"]
    : [TOGGLE, "Keluar", "Pesanan"];
  const reached = new Set<string>();
  for (let i = 0; i < 30 && reached.size < targets.length; i += 1) {
    await page.keyboard.press("Tab");
    const focused = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const name = (el.getAttribute("aria-label") ?? el.textContent ?? "").replace(/\d+$/, "").trim();
      const style = getComputedStyle(el);
      return { name, outline: style.outlineStyle, width: style.outlineWidth };
    });
    if (focused && targets.includes(focused.name)) {
      expect(focused, focused.name).toMatchObject({ outline: "solid", width: "2px" });
      reached.add(focused.name);
    }
  }
  expect([...reached].sort()).toEqual([...targets].sort());
});

test("the live dot pulses, and not under prefers-reduced-motion (K7)", async ({ page }) => {
  await loginAs(page, "shell");
  const dot = page.locator("p", { hasText: "pesanan baru" }).locator("b");
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).not.toBe("none");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await dot.evaluate((el) => getComputedStyle(el).animationName)).toBe("none");
});
