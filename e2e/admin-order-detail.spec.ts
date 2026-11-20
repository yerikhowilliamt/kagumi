import { devices, expect, test as base, type Page, type Request } from "@playwright/test";
import { formatDateLong } from "../src/lib/order";
import { loginAs } from "./admin";

// M2.5 order detail (FR29, System Design §4.9 Detail and Status change, M2 plan D15, D18, D19).
// One storefront order per project per run (plan W6) with the M1 test data: customer "E2E Playwright", a fake number,
// wa.me intercepted; then its status changes. The admin account is the "detail" account of e2e/global-setup.ts (W4).
if (process.env.PLAYWRIGHT_BASE_URL) {
  // M1-D26: never write orders or sessions to a deployed database.
  throw new Error("e2e/admin-order-detail.spec.ts writes orders: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}

// M1-D26: every test is its own visitor, so the checkout rate limit never carries over.
const runId = Date.now().toString(36);
const test = base.extend({
  userAgent: async ({}, provide, info) => provide(`${devices["Desktop Chrome"].userAgent} kagumi-e2e/${info.testId}-${runId}`),
});

const NAME = "E2E Playwright";
const NOTE = "Catatan E2E: kartu ucapan";
// A requested date the server accepts in any run (as in e2e/checkout.spec.ts).
const LATER = new Date(Date.now() + 7 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) > 760;
const cartButton = (page: Page) => page.getByRole("button", { name: /^Buka keranjang/ });
const sheet = (page: Page) => page.locator("dialog[open]");
const card = (page: Page, name: string) =>
  page.locator("#menu").getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
const picker = (page: Page) => page.getByRole("group", { name: "Ubah status" });
const option = (page: Page, label: string) => picker(page).getByRole("button", { name: label, exact: true });
const historyItems = (page: Page) => page.locator("section", { has: page.getByRole("heading", { name: "Riwayat" }) }).getByRole("listitem");
const statusBar = (page: Page) => page.locator("p", { hasText: "pesanan baru" });

// A click before hydration does nothing, so it is repeated only while the cart button still shows the old count.
async function add(page: Page, name: string, expectedTotal: number) {
  await expect(async () => {
    if ((await cartButton(page).getAttribute("aria-label")) !== `Buka keranjang, ${expectedTotal} item`) {
      await card(page, name).getByRole("button", { name: /keranjang/ }).click();
    }
    await expect(cartButton(page)).toHaveAccessibleName(`Buka keranjang, ${expectedTotal} item`, { timeout: 500 });
  }).toPass();
}

/** Places Kastengel × 2 and Bolu Gulung × 1 for delivery, with a note, and returns the order id from the message. */
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
  await s.getByLabel(/^Catatan/).fill(NOTE);
  await s.getByRole("button", { name: "Kirim pesanan via WhatsApp" }).click();
  await expect(s.getByRole("heading", { name: "Terima kasih!" })).toBeVisible();
  await expect.poll(() => sent.length).toBe(1);
  await page.unroute("https://wa.me/**");
  const text = new URL(sent[0]).searchParams.get("text") ?? "";
  const number = text.match(/^No\. pesanan: KD-(\d{4,})$/m)?.[1];
  expect(number, "the order number in the message").toBeDefined();
  return Number(number);
}

/** Clicks or presses a picker option and waits for the server's new render (the action revalidates the layout). */
async function expectPicked(page: Page, label: string) {
  for (const other of ["Baru", "Dikonfirmasi", "Selesai", "Dibatalkan"]) {
    await expect(option(page, other)).toHaveAttribute("aria-pressed", String(other === label));
  }
  await expect(historyItems(page).first()).toContainText(`Status diubah ke ${label}`);
}

test("a storefront order: its detail, a status change in the picker, the history, the list, the chat link (K1, K2, K6, K8)", async ({ page }) => {
  const id = await checkout(page);
  const number = `KD-${String(id).padStart(4, "0")}`;
  await loginAs(page, "detail");
  await page.goto(`/admin/pesanan/${id}`);

  // K1
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Pesanan ${number}`);
  await expect(page.getByText(/^Masuk hari ini, ([01]\d|2[0-3])\.[0-5]\d · dari website$/)).toBeVisible();
  await expect(page.locator("main").getByRole("link", { name: "Pesanan", exact: true })).toHaveAttribute("href", "/admin/pesanan");
  const items = page.locator("section", { has: page.getByRole("heading", { name: "Item pesanan" }) });
  await expect(items).toContainText("3 item");
  const lines = items.getByRole("listitem");
  await expect(lines).toHaveCount(2);
  await expect(lines.filter({ hasText: "Kastengel" })).toContainText("Rp85.000 × 2");
  await expect(lines.filter({ hasText: "Kastengel" }).locator("> span").last()).toHaveText("Rp170.000");
  await expect(lines.filter({ hasText: "Bolu Gulung" })).toContainText("Harga via WA × 1");
  await expect(lines.filter({ hasText: "Bolu Gulung" }).locator("> span").last()).toHaveText("—");
  await expect(items.getByText(/^Subtotal/).locator("..")).toHaveText(/^SubtotalRp170\.000 \+ 1 item tanpa harga$/);
  const dl = items.locator("dl");
  await expect(dl.locator("dt")).toHaveText(["Nama", "WhatsApp", "Pengambilan", "Alamat", "Tanggal diminta"]);
  await expect(dl.locator("dd")).toHaveText([NAME, "0812-0000-0000", "Diantar", "Jalan Test E2E", formatDateLong(LATER)]);
  await expect(items.getByText(`Catatan: ${NOTE}`)).toBeVisible();

  // History before any change: the checkout entry only.
  await expect(historyItems(page)).toHaveCount(1);
  await expect(historyItems(page).first()).toContainText("Pesanan masuk");
  await expect(historyItems(page).first()).toContainText("Checkout dari website");
  await expect(historyItems(page).first()).toContainText("Baru");
  await expect(option(page, "Baru")).toHaveAttribute("aria-pressed", "true");

  // K6: the customer's number, the D19 greeting, no customer name.
  const chat = page.getByRole("link", { name: "Buka chat WhatsApp" });
  const greeting = `Halo kak, ini Kagumi Dough soal pesanan ${number} dari website.`;
  await expect(chat).toHaveAttribute("href", `https://wa.me/6281200000000?text=${encodeURIComponent(greeting)}`);
  expect(await chat.getAttribute("href")).not.toMatch(/E2E|Playwright/);
  await expect(chat).toHaveAttribute("target", "_blank");

  // K2 and claim C8: the action's response carries the re-rendered admin layout (its status bar), so the bar on
  // this page is refreshed without a reload. Other workers place orders meanwhile, so the count itself is not compared.
  const actionResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.request().headers()["next-action"] !== undefined);
  await option(page, "Dikonfirmasi").click();
  expect(await (await actionResponse).text()).toContain("pesanan baru");
  await expectPicked(page, "Dikonfirmasi");
  await expect(historyItems(page)).toHaveCount(2);
  await expect(historyItems(page).first()).toContainText("oleh Admin");
  await expect(historyItems(page).last()).toContainText("Pesanan masuk");
  // History times read like the list's "Masuk" column (D18, O6; BSA-M2.5-01).
  await expect(historyItems(page).locator("time")).toHaveText([/^Hari ini, ([01]\d|2[0-3])\.[0-5]\d$/, /^Hari ini, ([01]\d|2[0-3])\.[0-5]\d$/]);
  await expect(statusBar(page)).toBeVisible();

  // K8: keyboard. From the chat link, Tab reaches the options in order; Enter and Space change the status.
  await chat.focus();
  for (const label of ["Baru", "Dikonfirmasi", "Selesai"]) {
    await page.keyboard.press("Tab");
    await expect(option(page, label)).toBeFocused();
  }
  await page.keyboard.press("Enter");
  await expectPicked(page, "Selesai");
  await expect(option(page, "Selesai")).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(option(page, "Baru")).toBeFocused();
  await page.keyboard.press("Space");
  await expectPicked(page, "Baru");
  await expect(historyItems(page)).toHaveCount(4);

  // Back to "Dikonfirmasi" for the list check.
  await option(page, "Dikonfirmasi").click();
  await expectPicked(page, "Dikonfirmasi");
  await expect(historyItems(page)).toHaveCount(5);

  // K2: the list shows the new status for that order.
  await page.goto(`/admin/pesanan?q=${number}`);
  const detail = `/admin/pesanan/${id}`;
  const entry = isDesktop(page)
    ? page.getByRole("row").filter({ has: page.locator(`a[href="${detail}"]`) }).getByRole("cell").last()
    : page.locator(`main ul > li > a[href="${detail}"] > span:last-child`);
  await expect(entry).toHaveText("Dikonfirmasi");
});

// What the owner sees while the action runs, when it never answers, and when another tab got there first.
test("the picker says it is saving, confirms, survives a dropped request and catches up with another tab", async ({ page }) => {
  const id = await checkout(page);
  await loginAs(page, "detail");
  const url = `/admin/pesanan/${id}`;
  await page.goto(url);
  const isAction = (request: Request) => request.method() === "POST" && request.headers()["next-action"] !== undefined;
  const saved = page.getByRole("status").filter({ hasText: "Status diubah" });
  const alert = page.getByRole("alert").filter({ hasText: "belum tersimpan" });

  // Saving: the action is held at the network until released, so the pending state is observed, not raced.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**${url}`, async (route) => {
    if (!isAction(route.request())) return route.fallback();
    await held;
    return route.continue();
  });
  await option(page, "Dikonfirmasi").click();
  await expect(picker(page)).toHaveAttribute("aria-busy", "true");
  await expect(option(page, "Dikonfirmasi").getByText("Menyimpan…")).toBeVisible();
  await expect(option(page, "Baru")).toHaveAttribute("aria-pressed", "true");
  await expect(saved).toHaveCount(0);
  release();
  await expectPicked(page, "Dikonfirmasi");
  await expect(saved).toHaveText("Status diubah ke Dikonfirmasi.");
  // Announced to a screen reader only: the pressed option and the history row are what the owner sees.
  await expect(saved).toHaveCSS("width", "1px");
  await expect(picker(page).getByText("Menyimpan…")).toHaveCount(0);
  await page.unroute(`**${url}`);

  // A dropped request: the alert, on the same page, with nothing changed. Then the retry goes through.
  await page.route(`**${url}`, (route) => (isAction(route.request()) ? route.abort("failed") : route.fallback()));
  await option(page, "Selesai").click();
  await expect(alert).toHaveText("Status belum tersimpan. Coba lagi.");
  await expect(option(page, "Dikonfirmasi")).toHaveAttribute("aria-pressed", "true");
  await expect(saved).toHaveCount(0);
  await expect(historyItems(page)).toHaveCount(2);
  await page.unroute(`**${url}`);
  await option(page, "Selesai").click();
  await expectPicked(page, "Selesai");
  await expect(alert).toHaveCount(0);
  await expect(saved).toHaveText("Status diubah ke Selesai.");

  // Another tab sets "Dibatalkan". This page still shows "Selesai"; picking what the server already has changes
  // nothing there, so the page asks for its data again instead of staying wrong.
  const other = await page.context().newPage();
  await other.goto(url);
  await option(other, "Dibatalkan").click();
  await expectPicked(other, "Dibatalkan");
  await other.close();
  await expect(option(page, "Selesai")).toHaveAttribute("aria-pressed", "true");
  await option(page, "Dibatalkan").click();
  await expectPicked(page, "Dibatalkan");
  await expect(historyItems(page)).toHaveCount(4);
  await expect(saved).toHaveCount(0);

  // BSA-M2.5-02: another tab sets "Baru"; this page still shows "Dibatalkan" pressed. Tapping that stale option
  // still reaches the server, which sets "Dibatalkan" again.
  const third = await page.context().newPage();
  await third.goto(url);
  await option(third, "Baru").click();
  await expectPicked(third, "Baru");
  await third.close();
  await expect(option(page, "Dibatalkan")).toHaveAttribute("aria-pressed", "true");
  await option(page, "Dibatalkan").click();
  await expect(historyItems(page)).toHaveCount(6);
  await expectPicked(page, "Dibatalkan");
});

test("a bad or unknown id is the 404 page with a session, in the stored theme (K7)", async ({ page }) => {
  // The 404 is rendered in the browser, where the <head> theme script never runs; ThemeToggle applies it instead.
  await page.addInitScript(() => window.localStorage.setItem("kagumi-theme", "dark"));
  await loginAs(page, "detail");
  for (const id of ["abc", "0", "999999999", "1e3", "-1", "0123456789"]) {
    const response = await page.goto(`/admin/pesanan/${id}`);
    expect(response?.status(), id).toBe(404);
  }
  // The admin's own 404 inside the shell, with a way back to the list.
  await expect(page.getByRole("heading", { level: 1 })).toContainText("tidak ditemukan");
  await expect(page.locator("main").getByRole("link")).toHaveAttribute("href", "/admin/pesanan");
  await expect(statusBar(page)).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
});

test("without a session the detail redirects to the login (K7)", async ({ page }) => {
  for (const id of ["abc", "0", "999999999", "1"]) {
    await page.goto(`/admin/pesanan/${id}`);
    await expect(page, id).toHaveURL((url) => url.pathname === "/admin/login");
  }
});

test.describe("360 px (K8)", () => {
  test.beforeEach(({ page }) => test.skip(isDesktop(page), "mobile-360 project only"));

  for (const theme of ["light", "dark"] as const) {
    test(`no horizontal scroll on the detail in ${theme}`, async ({ page }) => {
      await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
      await loginAs(page, "detail");
      // The newest order of the list (read only): every order has the same parts.
      await page.locator("main ul > li > a").first().click();
      await expect(page).toHaveURL(/\/admin\/pesanan\/\d+$/);
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(picker(page)).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
    });
  }
});
