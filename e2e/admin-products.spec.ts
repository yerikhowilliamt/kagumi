import { randomBytes } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { loginAs } from "./admin";

// M3.1 products list (FR7, FR22, M3 plan D5, D9, D14, D24; exit criterion 4). Runs in the products-360 and
// products-desktop projects, after every storefront spec (D5). Write W4: per project two products named "E2E …",
// inserted hidden (a direct insert can't expire the storefront cache, so a product becomes visible only through the
// switch, D9), shown and hidden again through the switch, and deleted in afterAll; one rejected checkout on desktop
// (a rate_limits row, no order). Seed products are never changed.
if (process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("e2e/admin-products.spec.ts writes products: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}
process.loadEnvFile();
assertDevelopmentDatabase();
// After the guard: db.ts reads DATABASE_URL on load.
const { db } = await import("../src/lib/db.ts");

const runId = randomBytes(4).toString("hex");
const SHOP = "https://wa.me/6285159545168";

type Fixture = { id: string; name: string };
let listed: Fixture; // ready stock, Rp12.345, deadline 10 Des 2099: the switch's subject
let closed: Fixture; // pre-order, no price, deadline 30 Mar 2026 (past): always hidden

test.beforeAll(async ({}, info) => {
  const base = { category: "E2E", isActive: false, sortOrder: 9999, description: "Produk uji e2e." } as const;
  listed = await db.product.create({
    data: { ...base, name: `E2E list ${runId} ${info.project.name}`, type: "READY_STOCK", price: 12345, orderDeadline: new Date("2099-12-10T00:00:00Z") },
  });
  closed = await db.product.create({
    data: { ...base, name: `E2E closed ${runId} ${info.project.name}`, type: "PRE_ORDER", price: null, orderDeadline: new Date("2026-03-30T00:00:00Z") },
  });
});

// A product still visible here would stay in the storefront's cached list after its row is deleted, so it is hidden
// through the switch (updateTag) first, also when a test failed half-way.
test.afterAll(async ({ browser }) => {
  const visible = await db.product.findMany({ where: { id: { in: [listed?.id, closed?.id].filter(Boolean) }, isActive: true } });
  if (visible.length > 0) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    for (const product of visible) await toggle(page, product.name, false);
    await context.close();
  }
  await db.product.deleteMany({ where: { id: { in: [listed?.id, closed?.id].filter(Boolean) } } });
});

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) > 760;
const row = (page: Page, name: string) => page.getByRole("row").filter({ hasText: name });
const switchOf = (page: Page, name: string) => page.getByRole("switch", { name: `Tampilkan ${name}` });

/** Flips the switch and waits until the action has answered (the switch leaves its busy state). */
async function toggle(page: Page, name: string, to: boolean) {
  const control = switchOf(page, name);
  await expect(control).toHaveAttribute("aria-checked", String(!to));
  await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(to));
  await expect(control).not.toHaveAttribute("aria-busy");
}

/** A storefront visitor of its own (M1-D26: a user agent unique to the test and run); wa.me never reached. */
async function shopper(browser: Browser, testId: string, label: string) {
  const context = await browser.newContext({ userAgent: `${devices["Desktop Chrome"].userAgent} kagumi-e2e/${testId}-${runId}-${label}` });
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 204 }));
  return context.newPage();
}

const menuCard = (page: Page, name: string) =>
  page.locator("#menu").getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });

test.describe("desktop list and switch", () => {
  test.beforeEach(({ page }) => test.skip(!isDesktop(page), "products-desktop only: at 360 px the cards have no switch (D14)"));

  test("head, chips, rows and the edit link (K2, K3)", async ({ page }) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Produk");
    await expect(page.getByRole("link", { name: "+ Tambah produk" })).toHaveAttribute("href", "/admin/produk/baru");

    const chips = page.getByRole("group", { name: "Filter produk" }).getByRole("button");
    await expect(chips).toHaveText([/^Semua \d+$/, /^Ready stock \d+$/, /^Pre-order \d+$/, /^Disembunyikan \d+$/]);
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("columnheader")).toHaveText(["Produk", "Tipe", "Harga", "Batas order", "Tampil", "Edit"]);

    // The switch's product: hidden at first.
    const a = row(page, listed.name);
    await expect(a.getByRole("cell")).toHaveText([`${listed.name}E2E · belum ada foto`, "Disembunyikan", "Rp12.345", "10 Des 2099", "", ""]);
    await expect(switchOf(page, listed.name)).toHaveAttribute("aria-checked", "false");
    await expect(a.getByRole("link", { name: `Edit ${listed.name}` })).toHaveAttribute("href", `/admin/produk/${listed.id}`);
    const b = row(page, closed.name);
    await expect(b.getByRole("cell")).toHaveText([`${closed.name}E2E · belum ada foto`, "Disembunyikan", "—", "Ditutup 30 Mar 2026", "", ""]);

    // A chip is a GET form button; the selected one is pressed and filters the rows.
    await chips.filter({ hasText: "Disembunyikan" }).click();
    await expect(page).toHaveURL(/\/admin\/produk\?filter=HIDDEN$/);
    await expect(chips.filter({ hasText: "Disembunyikan" })).toHaveAttribute("aria-pressed", "true");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "false");
    await expect(row(page, listed.name)).toHaveCount(1);
    const types = await page.locator("tbody tr td:nth-child(2)").allTextContents();
    expect(types.length).toBeGreaterThan(0);
    expect(new Set(types)).toEqual(new Set(["Disembunyikan"]));

    await chips.filter({ hasText: "Pre-order" }).click();
    await expect(page).toHaveURL(/\?filter=PRE_ORDER$/);
    await expect(row(page, closed.name)).toHaveCount(1); // a type chip lists hidden products too
    await expect(row(page, listed.name)).toHaveCount(0);

    // An unknown filter lists all.
    await page.goto("/admin/produk?filter=nope");
    await expect(chips.first()).toHaveAttribute("aria-pressed", "true");
    await expect(row(page, listed.name)).toHaveCount(1);
    await expect(row(page, closed.name)).toHaveCount(1);
  });

  test("a failed save puts the switch back and says so (D14)", async ({ page }) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    // The action's request never leaves the browser.
    await page.route("**/admin/produk", (route) => (route.request().headers()["next-action"] ? route.abort() : route.fallback()));
    const control = switchOf(page, closed.name);
    await control.click();
    await expect(row(page, closed.name).getByRole("alert")).toHaveText("Perubahan belum tersimpan. Coba lagi.");
    await expect(control).toHaveAttribute("aria-checked", "false");
    expect((await db.product.findUniqueOrThrow({ where: { id: closed.id } })).isActive).toBe(false);
  });

  test("exit criterion 4: show, hide (storefront, checkout), show again; the switch survives a reload (K5)", async ({ page, browser }, info) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");

    // Shown through the switch: the storefront lists it.
    await toggle(page, listed.name, true);
    await expect(row(page, listed.name).getByRole("cell").nth(1)).toHaveText("Ready stock");
    const shop = await shopper(browser, info.testId, "cart");
    await shop.goto("/");
    await expect(menuCard(shop, listed.name)).toHaveCount(1);
    // A click before hydration does nothing, so it is repeated only while the cart is still empty.
    const cartButton = shop.getByRole("button", { name: /^Buka keranjang/ });
    await expect(async () => {
      if ((await cartButton.getAttribute("aria-label")) !== "Buka keranjang, 1 item") {
        await menuCard(shop, listed.name).getByRole("button", { name: /keranjang/ }).click();
      }
      await expect(cartButton).toHaveAccessibleName("Buka keranjang, 1 item", { timeout: 500 });
    }).toPass();

    // Hidden: the switch keeps its state after a reload, and the next storefront request lacks it (C1).
    await toggle(page, listed.name, false);
    await page.reload();
    await expect(switchOf(page, listed.name)).toHaveAttribute("aria-checked", "false");
    await expect(row(page, listed.name).getByRole("cell").nth(1)).toHaveText("Disembunyikan");
    const fresh = await shopper(browser, info.testId, "fresh");
    await fresh.goto("/");
    await expect(fresh.locator("#menu").getByRole("heading").first()).toBeVisible();
    await expect(menuCard(fresh, listed.name)).toHaveCount(0);
    await expect(fresh.getByText(listed.name)).toHaveCount(0);

    // The tab that already had it in the cart: checkout rejects the line (FR7, FR12).
    await cartButton.click();
    const sheet = shop.locator("dialog[open]");
    await sheet.getByRole("button", { name: "Lanjut isi data" }).click();
    await sheet.getByLabel("Nama", { exact: true }).fill("E2E Playwright");
    await sheet.getByLabel("Nomor WhatsApp").fill("0812-0000-0000");
    const later = new Date(Date.now() + 7 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);
    await sheet.getByLabel("Tanggal diminta").fill(later);
    await sheet.getByRole("button", { name: /Kirim pesanan via WhatsApp/ }).click();
    await expect(sheet.getByRole("heading", { name: "Keranjang" })).toBeVisible();
    await expect(sheet.getByRole("alert")).toHaveText("Ada produk yang sudah tidak bisa dipesan. Hapus dulu untuk melanjutkan.");
    const line = sheet.getByRole("listitem").filter({ has: shop.getByText(listed.name, { exact: true }) });
    await expect(line.getByText("Produk tidak tersedia")).toBeVisible();
    await expect(sheet.getByRole("button", { name: "Lanjut isi data" })).toBeDisabled();
    expect(await db.order.count({ where: { items: { some: { productId: listed.id } } } })).toBe(0);
    expect(shop.url()).not.toContain(SHOP);

    // Shown again: the storefront lists it, and the switch survives a reload.
    await toggle(page, listed.name, true);
    await page.reload();
    await expect(switchOf(page, listed.name)).toHaveAttribute("aria-checked", "true");
    const again = await shopper(browser, info.testId, "again");
    await again.goto("/");
    await expect(menuCard(again, listed.name)).toHaveCount(1);

    // Hidden before the spec ends, so the cached storefront never keeps an E2E product (afterAll deletes the rows).
    await toggle(page, listed.name, false);
    for (const p of [shop, fresh, again]) await p.context().close();
  });
});

test.describe("360 px cards (K4)", () => {
  test.beforeEach(({ page }) => test.skip(isDesktop(page), "products-360 only"));

  test("cards replace the table; each card is a link to the edit page, reached by Tab", async ({ page }) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    await expect(page.locator("table")).toBeHidden();
    await expect(page.getByRole("switch")).toHaveCount(0);

    const card = page.getByRole("link", { name: listed.name });
    await expect(card).toHaveAttribute("href", `/admin/produk/${listed.id}`);
    await expect(card).toContainText("Disembunyikan");
    await expect(page.getByRole("link", { name: closed.name })).toContainText("DisembunyikanDitutup");

    let reached = false;
    for (let i = 0; i < 80 && !reached; i += 1) {
      await page.keyboard.press("Tab");
      reached = await card.evaluate((el) => el === document.activeElement);
    }
    expect(reached).toBe(true);
    await expect(card).toHaveCSS("outline-style", "solid");
    await expect(card).toHaveCSS("outline-width", "2px");
  });

  for (const theme of ["light", "dark"] as const) {
    test(`no horizontal scroll on /admin/produk in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "products");
      await page.goto("/admin/produk");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("link", { name: listed.name })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
});
