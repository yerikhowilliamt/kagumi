import { devices, expect, test as base, type Page } from "@playwright/test";
import { formatDateMedium } from "../src/lib/order";
import { loginAs } from "./admin";

// M2.4 order list (FR28, FR30, System Design §4.9 and §10 critical flow, M2 plan D5, D16).
// The K1 test places a real order on the storefront (plan W6) with the M1 test data: customer "E2E Playwright",
// a fake number, wa.me intercepted. The admin account is the "orders" account of e2e/global-setup.ts (W4).
if (process.env.PLAYWRIGHT_BASE_URL) {
  // M1-D26: never write orders or sessions to a deployed database.
  throw new Error("e2e/admin-orders.spec.ts writes orders: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}

// M1-D26: every test is its own visitor, so the checkout rate limit never carries over.
const runId = Date.now().toString(36);
const test = base.extend({
  userAgent: async ({}, provide, info) => provide(`${devices["Desktop Chrome"].userAgent} kagumi-e2e/${info.testId}-${runId}`),
});

const NAME = "E2E Playwright";
// A requested date the server accepts in any run (as in e2e/checkout.spec.ts).
const LATER = new Date(Date.now() + 7 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) > 760;
const cartButton = (page: Page) => page.getByRole("button", { name: /^Buka keranjang/ });
const sheet = (page: Page) => page.locator("dialog[open]");
const card = (page: Page, name: string) =>
  page.locator("#menu").getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
const search = (page: Page) => page.getByRole("searchbox", { name: "Cari pesanan" });
const chips = (page: Page) => page.getByRole("group", { name: "Filter status" });

// A click before hydration does nothing, so it is repeated only while the cart button still shows the old count.
async function add(page: Page, name: string, expectedTotal: number) {
  await expect(async () => {
    if ((await cartButton(page).getAttribute("aria-label")) !== `Buka keranjang, ${expectedTotal} item`) {
      await card(page, name).getByRole("button", { name: /keranjang/ }).click();
    }
    await expect(cartButton(page)).toHaveAccessibleName(`Buka keranjang, ${expectedTotal} item`, { timeout: 500 });
  }).toPass();
}

/** Places Kastengel × 2 and Bolu Gulung × 1 for delivery and returns the order id read from the WhatsApp message. */
async function checkout(page: Page) {
  const sent: string[] = [];
  await page.route("https://wa.me/**", (route) => {
    sent.push(route.request().url());
    return route.fulfill({ status: 204 });
  });
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await add(page, "Kastengel", 2);
  await add(page, "Bolu Gulung", 3);
  await cartButton(page).click();
  const s = sheet(page);
  await s.getByRole("button", { name: "Lanjut isi data" }).click();
  await s.getByLabel("Nama", { exact: true }).fill(NAME);
  await s.getByLabel("Nomor WhatsApp").fill("0812-0000-0000");
  await s.getByRole("button", { name: /^Diantar/ }).click();
  await s.getByLabel("Alamat").fill("Jalan Test E2E");
  await s.getByLabel("Tanggal diminta").fill(LATER);
  await s.getByRole("button", { name: "Kirim pesanan via WhatsApp" }).click();
  await expect(s.getByRole("heading", { name: "Terima kasih!" })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  const text = new URL(sent[0]).searchParams.get("text") ?? "";
  const number = text.match(/^No\. pesanan: KD-(\d{4,})$/m)?.[1];
  expect(number, "the order number in the message").toBeDefined();
  return Number(number);
}

async function searchFor(page: Page, q: string) {
  await search(page).fill(q);
  await search(page).press("Enter");
  await expect(page).toHaveURL((url) => url.searchParams.get("q") === q);
}

test("an order placed on the storefront is found by its number in three forms, with its row (K1)", async ({ page }) => {
  const id = await checkout(page);
  const number = `KD-${String(id).padStart(4, "0")}`;
  await loginAs(page, "orders");

  for (const q of [number, String(id).padStart(4, "0"), String(id)]) {
    await searchFor(page, q);
    const detail = `/admin/pesanan/${id}`;
    if (isDesktop(page)) {
      const row = page.getByRole("row").filter({ has: page.locator(`a[href="${detail}"]`) });
      await expect(row).toHaveCount(1);
      await expect(row.getByRole("cell")).toHaveText([
        number,
        /^Hari ini, \d\d\.\d\d$/,
        NAME,
        "Diantar",
        formatDateMedium(LATER),
        "3",
        "Rp170.000+",
        "Baru",
      ]);
    } else {
      const link = page.locator(`main ul > li > a[href="${detail}"]`);
      await expect(link).toHaveCount(1);
      await expect(link).toBeVisible();
      await expect(link.getByText(NAME, { exact: true })).toBeVisible();
      const short = formatDateMedium(LATER).replace(/ \d{4}$/, "");
      await expect(link).toContainText(`${number} · Diantar · ${short} · Rp170.000+`);
      await expect(link).toContainText("Baru");
    }
  }
});

test("chips: counts add up, a status filters and keeps the search, aria-pressed, unknown status is all (K3)", async ({ page }) => {
  await loginAs(page, "orders");
  await page.goto(`/admin/pesanan?q=${encodeURIComponent(NAME)}`);
  const chip = (label: string) => chips(page).getByRole("button", { name: new RegExp(`^${label} \\d+$`) });
  const count = async (label: string) => Number((await chip(label).textContent())!.replace(/\D/g, ""));

  await expect(chip("Semua")).toHaveAttribute("aria-pressed", "true");
  // Counts are compared within one page load only: other workers place orders while this test runs.
  const parts = await Promise.all(["Baru", "Dikonfirmasi", "Selesai", "Dibatalkan"].map(count));
  expect(await count("Semua")).toBe(parts.reduce((a, b) => a + b, 0));

  await chip("Baru").click();
  await expect(page).toHaveURL((url) => url.searchParams.get("status") === "NEW" && url.searchParams.get("q") === NAME);
  await expect(chip("Baru")).toHaveAttribute("aria-pressed", "true");
  await expect(chip("Semua")).toHaveAttribute("aria-pressed", "false");
  const badges = page.locator(isDesktop(page) ? "table tbody td:last-child" : "main ul > li > a > span:last-child");
  await expect(badges.first()).toBeVisible();
  expect(new Set(await badges.allTextContents())).toEqual(new Set(["Baru"]));

  // The search form keeps the status.
  await searchFor(page, "E2E");
  await expect(page).toHaveURL((url) => url.searchParams.get("status") === "NEW");

  await page.goto("/admin/pesanan?status=BOGUS");
  await expect(chip("Semua")).toHaveAttribute("aria-pressed", "true");

  // The counts ignore the search: with a search that matches nothing, "Semua" still counts every order.
  await page.goto(`/admin/pesanan?q=tidak-ada-${runId}`);
  await expect(page.getByText("Tidak ada pesanan yang cocok.", { exact: true })).toBeVisible();
  expect(await count("Semua")).toBeGreaterThan(0);
});

test("a search that matches nothing says so (K8)", async ({ page }) => {
  await loginAs(page, "orders");
  await searchFor(page, `tidak-ada-${runId}`);
  await expect(page.getByText("Tidak ada pesanan yang cocok.", { exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
});

test("the first row (desktop) or card (360 px) is reached by Tab from the search and opens on Enter (K7)", async ({ page }) => {
  await loginAs(page, "orders");
  const first = page.locator(isDesktop(page) ? "table tbody a" : "main ul > li > a").first();
  const href = await first.getAttribute("href");
  expect(href).toMatch(/^\/admin\/pesanan\/\d+$/);
  if (isDesktop(page)) {
    await expect(page.locator("main ul > li > a").first()).toBeHidden();
  } else {
    await expect(page.getByRole("table")).toBeHidden();
    await expect(first.getByText("Baru").or(first.getByText(/Dikonfirmasi|Selesai|Dibatalkan/))).toBeVisible();
  }
  await search(page).focus();
  await page.keyboard.press("Tab");
  await expect(first).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL((url) => url.pathname === href);
});

// Admin pages have no loading.tsx (it would turn the 404 of an unknown order into a 200), so the link says it is opening.
test("the order being opened is marked while its page loads, and the others step back", async ({ page }) => {
  await loginAs(page, "orders");
  const links = page.locator(isDesktop(page) ? "table tbody a" : "main ul > li > a");
  const first = links.first();
  const href = await first.getAttribute("href");
  // Before hydration the link is a plain anchor with no pending state: wait until React owns it.
  await expect.poll(() => first.evaluate((el) => Object.keys(el).some((key) => key.startsWith("__reactProps")))).toBe(true);

  // The navigation is held at the network until released, so the pending state is observed, not raced.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(
    (url) => url.pathname === href,
    async (route) => {
      await held;
      return route.continue();
    },
  );
  await first.click();
  await expect(first.locator("[data-pending]")).toHaveCount(1);
  await expect(links.locator("[data-pending]")).toHaveCount(1);
  await expect(page.locator(isDesktop(page) ? "table tbody tr" : "main ul > li > a").nth(1)).toHaveCSS("opacity", "0.55");
  await expect(page).toHaveURL((url) => url.pathname === "/admin/pesanan");
  release();
  await expect(page).toHaveURL((url) => url.pathname === href);
});

test.describe("360 px (K7)", () => {
  test.beforeEach(({ page }) => test.skip(isDesktop(page), "mobile-360 project only"));

  for (const theme of ["light", "dark"] as const) {
    test(`no horizontal scroll on the list in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "orders");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.locator("main ul > li > a").first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
});
