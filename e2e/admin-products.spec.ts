import { randomBytes } from "node:crypto";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { loginAs } from "./admin";

// M3.1 products list (FR7, FR22, M3 plan D5, D9, D14, D24; exit criterion 4) and M3.2 product form (D2, D9, D12, D18,
// D19): on desktop one more product per run, created through the form (shown), edited, and hidden through the switch
// before afterAll deletes it. M3.3 delete (FR27, D4, design.md §7): on desktop one more product per run, shown through
// the switch and deleted through the confirmation; afterAll deletes through the same path (deleteProductRow +
// processDeletions). Runs in the products-360 and
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
const { deleteProductRow, processDeletions } = await import("../src/lib/products.ts");
const { destroyAsset } = await import("../src/lib/cloudinary.ts");

const runId = randomBytes(4).toString("hex");
const SHOP = "https://wa.me/6285159545168";

type Fixture = { id: string; name: string };
let listed: Fixture; // ready stock, Rp12.345, deadline 10 Des 2099: the switch's subject
let closed: Fixture; // pre-order, no price, deadline 30 Mar 2026 (past): always hidden
let created: string | undefined; // the form's product (M3.2), desktop only
let doomed: string | undefined; // the delete test's product (M3.3), desktop only
const fixtureIds = () => [listed?.id, closed?.id, created, doomed].filter((id): id is string => Boolean(id));

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
test.afterAll(async ({ browser }, info) => {
  // The form's product is also found by its run id, in case the test failed before reading it from the URL.
  const formMade = await db.product.findMany({
    where: { OR: ["E2E form ", "E2E hapus "].map((prefix) => ({ name: { startsWith: prefix, endsWith: ` ${runId} ${info.project.name}` } })) },
    select: { id: true },
  });
  const ids = [...new Set([...fixtureIds(), ...formMade.map((p) => p.id)])];
  const visible = await db.product.findMany({ where: { id: { in: ids }, isActive: true } });
  if (visible.length > 0) {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    for (const product of visible) await toggle(page, product.name, false);
    await context.close();
  }
  // The app's delete path (D4); a product the delete test already removed is null here.
  for (const id of ids) {
    const assets = await db.$transaction((tx) => deleteProductRow(tx, id), { maxWait: 10_000 });
    if (assets?.length) await processDeletions(db, assets, (publicId, kind) => destroyAsset(publicId, kind));
  }
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
    // The FAB is a narrow-screen layout only (TR-M3-03): on desktop the button stays in the head.
    expect(await page.getByRole("link", { name: "+ Tambah produk" }).evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("static");

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

  test("by keyboard the switch keeps focus after each save; other rows step back while it saves; a newer saved state wins (TR-M3-02, -05)", async ({ page, context }) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    const control = switchOf(page, listed.name);
    const other = row(page, closed.name);

    // The action's POST is held until the busy state has been seen.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    await page.route("**/admin/produk", async (route) => {
      if (route.request().headers()["next-action"]) await released;
      await route.fallback();
    });
    await control.focus();
    await page.keyboard.press("Space");
    await expect(control).toHaveAttribute("aria-busy", "true");
    await expect(other).toHaveCSS("opacity", "0.55");
    await expect(other).toHaveCSS("cursor", "progress");
    await expect(row(page, listed.name)).toHaveCSS("opacity", "1");
    release();
    await expect(control).toHaveAttribute("aria-checked", "true");
    await expect(control).not.toHaveAttribute("aria-busy");
    await expect(control).toBeFocused();
    await expect(other).toHaveCSS("opacity", "1");
    await page.unroute("**/admin/produk");

    await page.keyboard.press("Space");
    await expect(control).toHaveAttribute("aria-checked", "false");
    await expect(control).not.toHaveAttribute("aria-busy");
    await expect(control).toBeFocused();

    // Shown from a second tab: this tab's next refresh (an action on another row) adopts the saved state.
    const second = await context.newPage();
    await second.goto("/admin/produk");
    await toggle(second, listed.name, true);
    await expect(control).toHaveAttribute("aria-checked", "false"); // not refreshed yet
    await toggle(page, closed.name, true);
    await toggle(page, closed.name, false);
    await expect(control).toHaveAttribute("aria-checked", "true");

    // Hidden before the test ends (the storefront's cache never keeps an E2E product).
    await toggle(page, listed.name, false);
    await second.close();
  });

  for (const theme of ["light", "dark"] as const) {
    test(`the off switch reaches 3:1 in ${theme}: ring against the surface, knob against the track (TR-M3-04)`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "products");
      await page.goto("/admin/produk");
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      const control = switchOf(page, closed.name);
      await expect(control).toHaveAttribute("aria-checked", "false");
      const { ring, knob } = await control.evaluate((el) => {
        const rgba = (value: string) => {
          const [r, g, b, a = 1] = (value.match(/[\d.]+/g) ?? []).map(Number);
          return { r, g, b, a };
        };
        const over = (top: ReturnType<typeof rgba>, base: ReturnType<typeof rgba>) => ({
          r: top.r * top.a + base.r * (1 - top.a),
          g: top.g * top.a + base.g * (1 - top.a),
          b: top.b * top.a + base.b * (1 - top.a),
          a: 1,
        });
        const luminance = ({ r, g, b }: ReturnType<typeof rgba>) => {
          const lin = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
          return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        };
        const contrast = (x: ReturnType<typeof rgba>, y: ReturnType<typeof rgba>) => {
          const [hi, lo] = [luminance(x), luminance(y)].sort((p, q) => q - p);
          return (hi + 0.05) / (lo + 0.05);
        };
        // The first opaque background behind the switch.
        let node: Element | null = el.parentElement;
        let surface = rgba("rgba(0, 0, 0, 0)");
        while (node && surface.a === 0) {
          surface = rgba(getComputedStyle(node).backgroundColor);
          node = node.parentElement;
        }
        const track = el.querySelector("span")!;
        const style = getComputedStyle(track);
        const ringColor = rgba(style.boxShadow.match(/rgba?\([^)]*\)/)?.[0] ?? "rgba(0, 0, 0, 0)");
        const trackFill = over(rgba(style.backgroundColor), surface);
        const knobColor = rgba(getComputedStyle(track, "::after").backgroundColor);
        return { ring: contrast(over(ringColor, surface), surface), knob: contrast(knobColor, trackFill) };
      });
      expect(ring).toBeGreaterThanOrEqual(3);
      expect(knob).toBeGreaterThanOrEqual(3);
    });
  }

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

  test('"+ Tambah produk" is a FAB above the bottom nav with cta-glow, and the last card scrolls clear of it (TR-M3-03)', async ({ page }) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    const add = page.getByRole("link", { name: "+ Tambah produk" });
    await expect(add).toBeVisible();
    expect(await add.evaluate((el) => getComputedStyle(el.parentElement!).position)).toBe("fixed");
    await expect(add).toHaveCSS("box-shadow", "rgba(11, 78, 173, 0.6) 0px 16px 32px -12px");
    await expect(add).toHaveCSS("height", "52px");
    const nav = await page.getByRole("navigation", { name: "Menu admin" }).boundingBox();
    const fab = await add.boundingBox();
    expect(fab && nav && fab.y + fab.height <= nav.y).toBe(true);
    expect(fab!.x + fab!.width).toBeLessThanOrEqual(page.viewportSize()!.width - 16 + 0.5);

    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect(async () => {
      const last = await page.locator("main ul li").last().boundingBox();
      const button = await add.boundingBox();
      expect(last && button && last.y + last.height <= button.y).toBe(true);
    }).toPass();
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

// M3.2 product form (FR22, M3 plan D2, D9, D12, D19).
const UUID = /^\/admin\/produk\/[0-9a-f-]{36}$/;
const field = (page: Page, label: string | RegExp) => page.getByLabel(label, { exact: typeof label === "string" });

test.describe("product form on desktop (M3.2)", () => {
  test.beforeEach(({ page }) => test.skip(!isDesktop(page), "products-desktop only: one created product per run"));

  test("create through the form, then edit name and price: the list and the storefront follow (K2, K4)", async ({ page, browser }, info) => {
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    await page.getByRole("link", { name: "+ Tambah produk" }).click();
    await expect(page).toHaveURL(/\/admin\/produk\/baru$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Tambah produk");
    await expect(page.getByText("Simpan informasi produk dulu, lalu tambahkan foto dan video.")).toBeVisible();

    // Defaults: pre-order, shown, sorted after the last product (K4).
    const pills = page.getByRole("group", { name: "Tipe produk" }).getByRole("button");
    await expect(pills).toHaveText(["Pre-order", "Ready stock"]);
    await expect(pills.first()).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("switch", { name: "Tampilkan di website" })).toHaveAttribute("aria-checked", "true");
    const { _max } = await db.product.aggregate({ _max: { sortOrder: true } });
    await expect(field(page, "Urutan tampil")).toHaveValue(String(Math.min((_max.sortOrder ?? -1) + 1, 9999)));
    // The category field suggests every existing category (K4).
    const existing = (await db.product.findMany({ distinct: ["category"], select: { category: true } })).map((p) => p.category);
    const suggested = await page.locator("#product-categories option").evaluateAll((options) => options.map((o) => (o as HTMLOptionElement).value));
    expect(suggested.toSorted()).toEqual(existing.toSorted());
    await expect(field(page, "Kategori")).toHaveAttribute("list", "product-categories");

    const name = `E2E form ${runId} ${info.project.name}`;
    const category = `E2E Kat ${runId}`; // a new category
    await field(page, "Nama produk").fill(name);
    await field(page, "Kategori").fill(category);
    await field(page, /^Harga/).fill("23.456");
    await field(page, "Deskripsi").fill("Produk uji form e2e.");
    await pills.filter({ hasText: "Ready stock" }).click();
    await expect(pills.filter({ hasText: "Ready stock" })).toHaveAttribute("aria-pressed", "true");
    await field(page, /^Batas order/).fill("2099-12-11");
    await field(page, "Urutan tampil").fill("9999");
    await page.getByRole("button", { name: "Simpan produk" }).click();

    await expect(page).toHaveURL((url) => UUID.test(url.pathname));
    created = new URL(page.url()).pathname.split("/").pop();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(field(page, "Nama produk")).toHaveValue(name);
    await expect(field(page, /^Harga/)).toHaveValue("23.456");
    expect(await db.product.findUniqueOrThrow({ where: { id: created } })).toMatchObject({
      name,
      category,
      price: 23456,
      type: "READY_STOCK",
      orderDeadline: new Date("2099-12-11T00:00:00Z"),
      isActive: true,
      sortOrder: 9999,
      description: "Produk uji form e2e.",
    });

    // The list shows it with its fields.
    await page.goto("/admin/produk");
    await expect(row(page, name).getByRole("cell")).toHaveText([`${name}${category} · belum ada foto`, "Ready stock", "Rp23.456", "11 Des 2099", "", ""]);
    await expect(switchOf(page, name)).toHaveAttribute("aria-checked", "true");

    // The storefront lists it at once (D9).
    const shop = await shopper(browser, info.testId, "created");
    await shop.goto("/");
    const card = menuCard(shop, name);
    await expect(card).toHaveCount(1);
    for (const text of [category, "Rp23.456", "Ready stock", "Batas order 11 Des"]) await expect(card).toContainText(text);

    // The new category is now suggested (K4).
    await page.goto("/admin/produk/baru");
    await expect(page.locator(`#product-categories option[value="${category}"]`)).toHaveCount(1);

    // Edit name and price: "Tersimpan.", and the storefront's next request shows the new values (D9, C1).
    await page.goto(`/admin/produk/${created}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
    await expect(page.getByRole("button", { name: "Simpan perubahan" })).toBeVisible();
    const renamed = `E2E form baru ${runId} ${info.project.name}`;
    await field(page, "Nama produk").fill(renamed);
    await field(page, /^Harga/).fill("45.000");
    await page.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Tersimpan." })).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(renamed);
    await expect(page).toHaveURL(new RegExp(`/admin/produk/${created}$`));

    const after = await shopper(browser, info.testId, "edited");
    await after.goto("/");
    await expect(menuCard(after, renamed)).toContainText("Rp45.000");
    await expect(after.getByText(name, { exact: true })).toHaveCount(0);

    // "Tersimpan." clears as soon as a field changes again (TR-M3-06): typing, then a type pill after a new save.
    const saved = page.getByRole("status").filter({ hasText: "Tersimpan." });
    await field(page, /^Harga/).fill("46.000");
    await expect(saved).toHaveCount(0);
    await field(page, /^Harga/).fill("45.000");
    await page.getByRole("button", { name: "Simpan perubahan" }).click();
    await expect(saved).toBeVisible();
    await page.getByRole("group", { name: "Tipe produk" }).getByRole("button", { name: "Pre-order" }).click();
    await expect(saved).toHaveCount(0);

    // "Batal" goes back to the list (the unsaved type change is dropped).
    await page.getByRole("link", { name: "Batal" }).click();
    await expect(page).toHaveURL(/\/admin\/produk$/);
    await expect(row(page, renamed).getByRole("cell").nth(2)).toHaveText("Rp45.000");

    // Hidden before the spec ends, so the cached storefront never keeps an E2E product (afterAll deletes the row).
    await toggle(page, renamed, false);
    for (const p of [shop, after]) await p.context().close();
  });

  test("a bad or unknown id is the admin 404 (K5)", async ({ page }) => {
    await loginAs(page, "products");
    for (const id of ["abc", "-".repeat(36), "019a8f3e-7c2b-7abc-8def-000000000000"]) {
      const response = await page.goto(`/admin/produk/${id}`);
      expect(response?.status(), id).toBe(404);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("tidak ditemukan");
    }
  });
});

test.describe("delete on desktop (M3.3)", () => {
  test.beforeEach(({ page }) => test.skip(!isDesktop(page), "products-desktop only: one deleted product per run"));

  test("the confirmation opens on Batal; Esc, Batal, Enter and a failed request keep the product; Hapus deletes it from the list and the storefront (K6)", async ({ page, browser }, info) => {
    const name = `E2E hapus ${runId} ${info.project.name}`;
    doomed = (
      await db.product.create({
        data: { name, category: "E2E", description: "Produk uji hapus.", type: "READY_STOCK", price: 11111, isActive: false, sortOrder: 9999 },
      })
    ).id;
    await loginAs(page, "products");
    await page.goto("/admin/produk");
    // Shown through the switch (D9), so the storefront lists it before the delete.
    await toggle(page, name, true);
    const before = await shopper(browser, info.testId, "before");
    await before.goto("/");
    await expect(menuCard(before, name)).toHaveCount(1);

    await page.goto(`/admin/produk/${doomed}`);
    const open = page.getByRole("button", { name: "Hapus produk" });
    const dialog = page.getByRole("dialog", { name: `Hapus ${name}?` });
    const cancel = dialog.getByRole("button", { name: "Batal" });
    await open.click();
    await expect(dialog).toBeVisible();
    await expect(cancel).toBeFocused();
    await expect(dialog).toContainText("Produk beserta semua foto dan videonya akan dihapus permanen. Pesanan lama tetap tersimpan.");
    await expect(dialog.getByRole("button")).toHaveText(["Batal", "Hapus"]);
    // Esc closes it and focus returns to "Hapus produk".
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(open).toBeFocused();
    // "Batal" closes it; Enter on the first focus is "Batal" too.
    await open.click();
    await cancel.click();
    await expect(dialog).toBeHidden();
    await open.click();
    await expect(cancel).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    expect(await db.product.count({ where: { id: doomed } })).toBe(1);

    // A failed delete (the request dropped) keeps the dialog open with the alert; the next open starts clean
    // (decision 3, BSA-M3.3-02).
    const failed = `**/admin/produk/${doomed}`;
    await page.route(failed, (route) => (route.request().method() === "POST" ? route.abort() : route.continue()));
    await open.click();
    await dialog.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(dialog.getByRole("alert")).toHaveText("Perubahan belum tersimpan. Coba lagi.");
    await expect(dialog).toBeVisible();
    await page.unroute(failed);
    await cancel.click();
    await expect(dialog).toBeHidden();
    await open.click();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await cancel.click();
    expect(await db.product.count({ where: { id: doomed } })).toBe(1);

    // "Hapus": "Menghapus…" while the action runs (held back here), then the list without it.
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**/admin/produk/${doomed}`, async (route) => {
      if (route.request().method() === "POST") await held;
      await route.continue();
    });
    await open.click();
    await dialog.getByRole("button", { name: "Hapus", exact: true }).click();
    await expect(dialog.getByRole("button", { name: "Menghapus…" })).toHaveAttribute("aria-busy", "true");
    release();
    await expect(page).toHaveURL(/\/admin\/produk$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Produk");
    await expect(row(page, name)).toHaveCount(0);
    expect(await db.product.count({ where: { id: doomed } })).toBe(0);
    // The storefront's next request lacks it (D9).
    const after = await shopper(browser, info.testId, "after");
    await after.goto("/");
    await expect(after.locator("#menu")).toBeVisible();
    await expect(after.getByText(name, { exact: true })).toHaveCount(0);
    for (const p of [before, after]) await p.context().close();
  });
});

test.describe("product form at 360 px (M3.2)", () => {
  test.beforeEach(({ page }) => test.skip(isDesktop(page), "products-360 only"));

  test("a refused save keeps the typed values, marks each invalid field and focuses the first (K3)", async ({ page }) => {
    const category = `E2E tolak ${runId}`;
    await loginAs(page, "products");
    await page.goto("/admin/produk/baru");
    await field(page, "Kategori").fill(category);
    await field(page, /^Harga/).fill("3,5");
    await field(page, "Urutan tampil").fill("10000");
    await page.getByRole("button", { name: "Simpan produk" }).click();

    const name = field(page, "Nama produk");
    await expect(name).toHaveAttribute("aria-invalid", "true");
    await expect(name).toHaveAccessibleDescription("Isi nama produk (maks. 80 karakter).");
    await expect(name).toBeFocused();
    await expect(field(page, /^Harga/)).toHaveAttribute("aria-invalid", "true");
    await expect(field(page, /^Harga/)).toHaveAccessibleDescription(/Isi angka tanpa koma, misalnya 35\.000\./);
    await expect(field(page, "Urutan tampil")).toHaveAccessibleDescription(/Isi angka 0–9999\./);
    await expect(field(page, "Kategori")).not.toHaveAttribute("aria-invalid");
    // Every typed value stays.
    await expect(field(page, "Kategori")).toHaveValue(category);
    await expect(field(page, /^Harga/)).toHaveValue("3,5");
    await expect(field(page, "Urutan tampil")).toHaveValue("10000");
    await expect(page).toHaveURL(/\/admin\/produk\/baru$/);

    // Name fixed: focus moves to the next invalid field, the price.
    await name.fill(`E2E tolak ${runId}`);
    await page.getByRole("button", { name: "Simpan produk" }).click();
    await expect(field(page, /^Harga/)).toBeFocused();
    await expect(name).not.toHaveAttribute("aria-invalid");
    expect(await db.product.count({ where: { category } })).toBe(0);
  });

  for (const theme of ["light", "dark"] as const) {
    test(`new and edit pages in ${theme}: no horizontal scroll, action bar above the bottom nav, every control by Tab (K6)`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "products");
      for (const [path, submit] of [
        ["/admin/produk/baru", "Simpan produk"],
        [`/admin/produk/${listed.id}`, "Simpan perubahan"],
      ] as const) {
        await page.goto(path);
        await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
        await expect(page.getByRole("button", { name: submit })).toBeVisible();
        expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), path).toBe(false);

        // The sticky bar sits above the fixed bottom nav, inside the window.
        const bar = await page.getByRole("button", { name: submit }).boundingBox();
        const nav = await page.getByRole("navigation", { name: "Menu admin" }).boundingBox();
        expect(bar && nav && bar.y + bar.height <= nav.y, path).toBe(true);
        expect(bar!.y + bar!.height).toBeLessThanOrEqual(page.viewportSize()!.height);

        // The type pills use aria-pressed.
        const pills = page.getByRole("group", { name: "Tipe produk" }).getByRole("button");
        await expect(pills.first()).toHaveAttribute("aria-pressed", path.endsWith("baru") ? "true" : "false");
        await expect(pills.last()).toHaveAttribute("aria-pressed", path.endsWith("baru") ? "false" : "true");

        // Tab from the top reaches every control of the form, each with a visible focus ring.
        const controls = [
          field(page, "Nama produk"),
          field(page, "Kategori"),
          field(page, /^Harga/),
          field(page, "Deskripsi"),
          pills.first(),
          pills.last(),
          field(page, /^Batas order/),
          page.getByRole("switch", { name: "Tampilkan di website" }),
          field(page, "Urutan tampil"),
          // M3.3: "Hapus produk" on the edit page only.
          ...(path.endsWith("baru") ? [] : [page.getByRole("button", { name: "Hapus produk" })]),
          page.getByRole("link", { name: "Batal" }),
          page.getByRole("button", { name: submit }),
        ];
        const handles = await Promise.all(controls.map((c) => c.elementHandle()));
        const seen = new Set<number>();
        for (let i = 0; i < 80 && seen.size < controls.length; i += 1) {
          await page.keyboard.press("Tab");
          for (const [index, handle] of handles.entries()) {
            if (seen.has(index) || !(await handle!.evaluate((el) => el === document.activeElement))) continue;
            const ring = await handle!.evaluate((el) => {
              const style = getComputedStyle(el);
              return style.outlineStyle === "solid" || style.boxShadow !== "none";
            });
            expect(ring, `focus ring on control ${index} of ${path}`).toBe(true);
            seen.add(index);
          }
        }
        expect([...seen].sort((a, b) => a - b), path).toEqual(controls.map((_, i) => i));
      }
    });
  }
});
