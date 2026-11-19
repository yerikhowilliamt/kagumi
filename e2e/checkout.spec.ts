import { devices, expect, test as base, type Page, type Route } from "@playwright/test";
import { formatDateLong } from "../src/lib/order";

// M1.7 checkout (FR11–FR14, design.md §6 Cart sheet steps 2 and 3, milestone plan D1, D2, D20, D21, D26).
// Tests that submit write real orders to the development branch (plan W4), with fake data only.
if (process.env.PLAYWRIGHT_BASE_URL) {
  // D26: never write orders to a deployed database.
  throw new Error("e2e/checkout.spec.ts writes orders: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}

// D26: every test is its own visitor, so the rate limit (5 per 10 minutes) never carries over between tests or runs.
const runId = Date.now().toString(36);
const test = base.extend({
  userAgent: async ({}, provide, info) => provide(`${devices["Desktop Chrome"].userAgent} kagumi-e2e/${info.testId}-${runId}`),
});

const SHOP = "https://wa.me/6285159545168";
const NAME = "E2E Playwright";
const PHONE = "0812-0000-0000";
// Seed (D7, P15): Kastengel ready stock Rp85.000; Bolu Gulung pre-order without price or deadline;
// Nastar pre-order Rp90.000, deadline 2026-11-01 (closed on the real clock, open on 2026-10-30).
const BEFORE_NASTAR_DEADLINE = "2026-10-30T03:00:00Z";
// A requested date that the server (real clock) accepts in any run.
const LATER = new Date(Date.now() + 7 * 3600_000 + 30 * 86400_000).toISOString().slice(0, 10);

const menu = (page: Page) => page.locator("#menu");
const card = (page: Page, name: string) =>
  menu(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
const cartButton = (page: Page) => page.getByRole("button", { name: /^Buka keranjang/ });
// The sheet's name follows its step title, so it is found as the open dialog.
const sheet = (page: Page) => page.locator("dialog[open]");
const line = (page: Page, name: string) => sheet(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
const next = (page: Page) => sheet(page).getByRole("button", { name: "Lanjut isi data" });
const submit = (page: Page) => sheet(page).getByRole("button", { name: /Kirim pesanan via WhatsApp|Mengirim…/ });
const stored = (page: Page) => page.evaluate(() => localStorage.getItem("kagumi-cart"));
const isAction = (route: Route) => route.request().method() === "POST" && !!route.request().headers()["next-action"];

// A click before hydration does nothing, so it is repeated only while the cart button still shows the old count.
async function add(page: Page, name: string, expectedTotal: number) {
  await expect(async () => {
    if ((await cartButton(page).getAttribute("aria-label")) !== `Buka keranjang, ${expectedTotal} item`) {
      await card(page, name).getByRole("button", { name: /keranjang/ }).click();
    }
    await expect(cartButton(page)).toHaveAccessibleName(`Buka keranjang, ${expectedTotal} item`, { timeout: 500 });
  }).toPass();
}

async function toForm(page: Page) {
  await cartButton(page).click();
  await next(page).click();
  await expect(sheet(page).getByRole("heading", { name: "Data pemesan" })).toBeVisible();
}

async function fill(page: Page) {
  const s = sheet(page);
  await s.getByLabel("Nama", { exact: true }).fill(NAME);
  await s.getByLabel("Nomor WhatsApp").fill(PHONE);
  await s.getByLabel("Tanggal diminta").fill(LATER);
}

/**
 * wa.me is never reached (R3). Each navigation to it is recorded and answered with 204 No Content, which makes the
 * browser stay on the page, so the result step can still be read after the navigation started.
 */
async function stubWhatsApp(page: Page) {
  const seen: { url: string; sameTab: boolean }[] = [];
  await page.route("https://wa.me/**", (route) => {
    const request = route.request();
    seen.push({ url: request.url(), sameTab: request.isNavigationRequest() && request.frame() === page.mainFrame() });
    return route.fulfill({ status: 204 });
  });
  return seen;
}

const textOf = (url: string) => new URL(url).searchParams.get("text");
const bubble = (page: Page) => sheet(page).getByTestId("wa-bubble").evaluate((el) => el.textContent);

const message = (orderLine: string[]) =>
  [
    "Halo Kagumi Dough! Aku mau pesan (dari website)",
    "",
    ...orderLine,
    "• 1× Kastengel — Rp85.000",
    "• 1× Bolu Gulung — harga via WA",
    "",
    "Subtotal: Rp85.000 (+ 1 produk harga via WA)",
    `Nama: ${NAME}`,
    "Pengambilan: Ambil sendiri",
    `Tanggal: ${formatDateLong(LATER)}`,
  ].join("\n");

test("the form: fields in order, Alamat only for Diantar, min date in WIB, empty submit (K1)", async ({ page }) => {
  // 2026-11-21 01:00 WIB is still 2026-11-20 in UTC.
  await page.clock.setFixedTime(new Date("2026-11-20T18:00:00Z"));
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await toForm(page);
  const s = sheet(page);

  const labels = () => s.locator("form label, form [role=group][aria-label='Pengambilan']").evaluateAll((els) =>
    els.map((el) => (el.getAttribute("aria-label") ?? el.textContent ?? "").trim()),
  );
  expect(await labels()).toEqual(["Nama", "Nomor WhatsApp", "Pengambilan", "Tanggal diminta", "Catatan (opsional)"]);
  await expect(s.getByLabel("Nomor WhatsApp")).toHaveAttribute("inputmode", "tel");
  await expect(s.getByLabel("Nomor WhatsApp")).toHaveAccessibleDescription("Supaya kami bisa menghubungi kamu soal pesanan ini.");
  await expect(s.getByLabel("Tanggal diminta")).toHaveAttribute("min", "2026-11-21");
  // Note 8: a fulfillment choice is always selected.
  await expect(s.getByRole("button", { name: /^Ambil sendiri/ })).toHaveAttribute("aria-pressed", "true");
  await expect(s.getByRole("button", { name: /^Diantar/ })).toHaveAttribute("aria-pressed", "false");
  await expect(s.getByLabel("Alamat")).toHaveCount(0);

  await submit(page).click();
  await expect(s.getByLabel("Nama", { exact: true })).toBeFocused();
  await expect(s.getByLabel("Nama", { exact: true })).toHaveAttribute("aria-invalid", "true");
  await expect(s.getByLabel("Nama", { exact: true })).toHaveAccessibleDescription("Nama wajib diisi.");
  await expect(s.getByLabel("Nomor WhatsApp")).toHaveAttribute("aria-invalid", "true");
  await expect(s.getByText("Isi nomor WhatsApp yang benar, contoh 0812-3456-7890.")).toBeVisible();
  await expect(s.getByLabel("Tanggal diminta")).toHaveAttribute("aria-invalid", "true");
  await expect(s.getByText("Pilih tanggal pesanan.")).toBeVisible();
  await expect(s.getByLabel("Catatan (opsional)")).not.toHaveAttribute("aria-invalid");

  await s.getByRole("button", { name: /^Diantar/ }).click();
  await expect(s.getByRole("button", { name: /^Diantar/ })).toHaveAttribute("aria-pressed", "true");
  expect(await labels()).toEqual(["Nama", "Nomor WhatsApp", "Pengambilan", "Alamat", "Tanggal diminta", "Catatan (opsional)"]);
  await fill(page);
  await submit(page).click();
  await expect(s.getByLabel("Alamat")).toBeFocused();
  await expect(s.getByLabel("Alamat")).toHaveAccessibleDescription("Alamat wajib diisi untuk pengantaran.");

  await s.getByRole("button", { name: /^Ambil sendiri/ }).click();
  await expect(s.getByLabel("Alamat")).toHaveCount(0);
});

test("a stored cart with a closed product shows the rejected-line state before any submit (K4, D21)", async ({ page }) => {
  await page.clock.setFixedTime(new Date(BEFORE_NASTAR_DEADLINE));
  await page.goto("/");
  await add(page, "Nastar", 1);
  await add(page, "Kastengel", 2);
  await page.clock.setFixedTime(new Date());
  await page.reload();
  await cartButton(page).click();
  const s = sheet(page);
  await expect(s.getByRole("alert")).toHaveText("Ada produk yang sudah tidak bisa dipesan. Hapus dulu untuk melanjutkan.");
  await expect(line(page, "Nastar").getByText("Order sudah ditutup")).toBeVisible();
  await expect(line(page, "Nastar").getByRole("button", { name: /Kurangi|Tambah/ })).toHaveCount(0);
  await expect(line(page, "Kastengel").getByRole("button", { name: /Tambah/ })).toHaveCount(1);
  await expect(next(page)).toBeDisabled();
  await line(page, "Nastar").getByRole("button", { name: "Hapus Nastar" }).click();
  await expect(s.getByRole("alert")).toHaveCount(0);
  await expect(next(page)).toBeEnabled();
});

test("rejected, then the happy path: same tab to WhatsApp, one request, cart cleared (K2, K3, K4)", async ({ page }) => {
  const popups: string[] = [];
  page.context().on("page", (p) => popups.push(p.url()));
  const actions: string[] = [];
  page.on("request", (r) => r.method() === "POST" && r.headers()["next-action"] && actions.push(r.url()));

  // K4: the browser thinks Nastar is still open; the server (real clock) rejects it.
  await page.clock.setFixedTime(new Date(BEFORE_NASTAR_DEADLINE));
  await page.goto("/");
  await add(page, "Nastar", 1);
  await add(page, "Kastengel", 2);
  await toForm(page);
  await fill(page);
  await submit(page).click();
  const s = sheet(page);
  await expect(s.getByRole("heading", { name: "Keranjang" })).toBeVisible();
  await expect(s.getByRole("alert")).toHaveText("Ada produk yang sudah tidak bisa dipesan. Hapus dulu untuk melanjutkan.");
  await expect(line(page, "Nastar").getByText("Order sudah ditutup")).toBeVisible();
  await expect(line(page, "Nastar").getByRole("button", { name: /Kurangi|Tambah/ })).toHaveCount(0);
  await expect(next(page)).toBeDisabled();
  // The server's reason survives closing and reopening (the browser alone thinks Nastar is open, BSA-M1.7-03).
  await page.keyboard.press("Escape");
  await cartButton(page).click();
  await expect(line(page, "Nastar").getByText("Order sudah ditutup")).toBeVisible();
  await expect(next(page)).toBeDisabled();
  await line(page, "Nastar").getByRole("button", { name: "Hapus Nastar" }).click();
  await expect(next(page)).toBeEnabled();
  expect(actions).toHaveLength(1);

  // K2: Kastengel + Bolu Gulung. The form kept its values.
  await page.keyboard.press("Escape");
  await add(page, "Bolu Gulung", 2);
  await toForm(page);
  await expect(s.getByLabel("Nama", { exact: true })).toHaveValue(NAME);
  const wa = await stubWhatsApp(page);
  // K3: two clicks in one task, before React can render the disabled button.
  await submit(page).evaluate((button: HTMLButtonElement) => {
    button.click();
    button.click();
  });
  await expect(s.getByRole("heading", { name: "Pesanan tersimpan!" })).toBeVisible();
  await expect.poll(() => wa.length).toBe(1);
  const { url, sameTab } = wa[0];
  expect(sameTab).toBe(true);
  expect(popups).toEqual([]);
  expect(actions).toHaveLength(2);
  const text = textOf(url)!;
  const number = text.match(/^No\. pesanan: (KD-\d{4,})$/m)?.[1];
  expect(number).toBeDefined();
  expect(text).toBe(message([`No. pesanan: ${number}`]));
  // The result step: the same number, a bubble equal to the sent text, the same URL on its button.
  await expect(s.getByRole("heading", { name: "Terima kasih!" })).toBeVisible();
  await expect(s.getByText(`Nomor pesanan ${number}.`, { exact: false })).toBeVisible();
  expect(await bubble(page)).toBe(text);
  await expect(s.getByRole("link", { name: "Buka WhatsApp lagi" })).toHaveAttribute("href", url);
  // Back on the page later: the cart is empty.
  await page.reload();
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang");
  expect(await stored(page)).toBe("[]");
});

test("the server action fails: not-saved state, fallback message, same tab, cart kept (K5, D20)", async ({ page }) => {
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await add(page, "Bolu Gulung", 2);
  const before = await stored(page);
  await page.route("**/*", (route) => (isAction(route) ? route.abort() : route.fallback()));
  await toForm(page);
  await fill(page);
  const wa = await stubWhatsApp(page);
  await submit(page).click();
  const s = sheet(page);
  await expect(s.getByRole("heading", { name: "Pesanan belum tercatat di sistem kami" })).toBeVisible();
  await expect.poll(() => wa.length).toBe(1);
  const { url, sameTab } = wa[0];
  expect(sameTab).toBe(true);
  expect(textOf(url)).toBe(message([]));
  await expect(s.getByRole("heading", { name: "Kirim pesanan" })).toBeVisible();
  await expect(s.getByText("Pesananmu tetap bisa dikirim. Tekan tombol di bawah untuk mengirimnya lewat WhatsApp.")).toBeVisible();
  await expect(s.getByText(/KD-\d/)).toHaveCount(0);
  expect(await bubble(page)).toBe(message([]));
  await expect(s.getByRole("link", { name: "Kirim via WhatsApp" })).toHaveAttribute("href", url);
  await expect(s.getByRole("heading", { name: "Kirim pesanan" })).toBeFocused(); // TR-M1.7-04
  // Reopening starts at the cart, which is unchanged (approved 2026-11-19, BSA-M1.7-06).
  await page.keyboard.press("Escape");
  await cartButton(page).click();
  await expect(sheet(page).getByRole("heading", { name: "Keranjang" })).toBeVisible();
  await expect(line(page, "Bolu Gulung")).toBeVisible();
  await page.reload();
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang, 2 item");
  expect(await stored(page)).toBe(before);
});

test("while a submit is pending: no second request by any path, and a closed sheet reopens on the result (BSA-M1.7-01, -02)", async ({ page }) => {
  const actions: string[] = [];
  page.on("request", (r) => r.method() === "POST" && r.headers()["next-action"] && actions.push(r.url()));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  // The first action request is held, then aborted: nothing is written.
  await page.route("**/*", async (route) => {
    if (!isAction(route)) return route.fallback();
    await released;
    return route.abort();
  });
  const wa = await stubWhatsApp(page);
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await toForm(page);
  await fill(page);
  await submit(page).click();
  const s = sheet(page);
  await expect(submit(page)).toHaveText("Mengirim…");
  await expect(submit(page)).toBeDisabled();
  await expect(s.getByRole("button", { name: "← Kembali ke keranjang" })).toBeDisabled();
  // Close and reopen: the sheet is still on the pending form, and a forced submit sends nothing.
  await page.keyboard.press("Escape");
  await cartButton(page).click();
  await expect(s.getByRole("heading", { name: "Data pemesan" })).toBeVisible();
  await expect(submit(page)).toBeDisabled();
  await s.locator("form").evaluate((form: HTMLFormElement) => form.requestSubmit());
  // Closed again while pending: the result opens the sheet before WhatsApp.
  await page.keyboard.press("Escape");
  await expect(sheet(page)).toHaveCount(0);
  release();
  await expect(sheet(page).getByRole("heading", { name: "Pesanan belum tercatat di sistem kami" })).toBeVisible();
  await expect.poll(() => wa.length).toBe(1);
  expect(actions).toHaveLength(1);
});

test("a server validation result shows its field message and focuses the field (TR-M1.7-05, BSA-M1.7-04)", async ({ page }) => {
  // The browser's date passes the schema, the server's real date does not: validation writes nothing (D5).
  await page.clock.setFixedTime(new Date(BEFORE_NASTAR_DEADLINE));
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await toForm(page);
  await fill(page);
  await sheet(page).getByLabel("Tanggal diminta").fill("2026-11-01");
  await submit(page).click();
  const date = sheet(page).getByLabel("Tanggal diminta");
  await expect(date).toHaveAccessibleDescription(/Tanggal tidak boleh sebelum hari ini\./);
  await expect(date).toHaveAttribute("aria-invalid", "true");
  await expect(date).toBeFocused();
  await expect(submit(page)).toHaveText("Kirim pesanan via WhatsApp");
});

test("the sixth checkout of a visitor shows the rate-limit alert and keeps the form (K6)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "five orders on one project only (plan W4)");
  test.setTimeout(240_000);
  // The window is fixed (D5: :00, :10, …). Five checkouts must not straddle a boundary, so near one this waits for the
  // next window: a wait for a clock condition, not for timing.
  const left = 600_000 - (Date.now() % 600_000);
  if (left < 90_000) await new Promise((resolve) => setTimeout(resolve, left + 1_000));

  const wa = await stubWhatsApp(page);
  for (let i = 1; i <= 5; i++) {
    await page.goto("/");
    await add(page, "Kastengel", 1);
    await toForm(page);
    await fill(page);
    await submit(page).click();
    await expect(sheet(page).getByRole("heading", { name: "Pesanan tersimpan!" })).toBeVisible();
    await expect.poll(() => wa.length).toBe(i);
  }
  await page.goto("/");
  await add(page, "Kastengel", 1);
  await toForm(page);
  await fill(page);
  await submit(page).click();
  const s = sheet(page);
  const alert = s.getByRole("alert");
  await expect(alert).toHaveText("Terlalu banyak percobaan. Coba lagi beberapa menit lagi, atau chat kami langsung di WhatsApp.");
  await expect(alert.getByRole("link", { name: "chat kami langsung di WhatsApp" })).toHaveAttribute("href", SHOP);
  // Same tab (approved 2026-11-19, BSA-M1.7-06) and visible above a scrolled form (TR-M1.7-03).
  await expect(alert.getByRole("link")).not.toHaveAttribute("target");
  await expect(alert).toBeInViewport();
  await expect(s.getByLabel("Nama", { exact: true })).toHaveValue(NAME);
  await expect(s.getByLabel("Nomor WhatsApp")).toHaveValue(PHONE);
  await expect(s.getByLabel("Tanggal diminta")).toHaveValue(LATER);
  expect(wa).toHaveLength(5);
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: at 360 px every step fits without sideways scroll and the submit is reachable (K7)`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-360", "360 px only");
    await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
    await page.goto("/");
    await add(page, "Kastengel", 1);
    await add(page, "Bolu Gulung", 2);
    const fits = async () => {
      const s = sheet(page);
      await s.evaluate((el) => Promise.allSettled(el.getAnimations().map((a) => a.finished)));
      const box = (await s.boundingBox())!;
      expect([box.x, box.width]).toEqual([0, 360]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
      expect(await s.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    };
    await cartButton(page).click();
    await fits();
    await next(page).click();
    await expect(sheet(page).getByRole("heading", { name: "Data pemesan" })).toBeVisible();
    // Diantar: the longest form.
    await sheet(page).getByRole("button", { name: /^Diantar/ }).click();
    await fits();
    await fill(page);
    await sheet(page).getByLabel("Alamat").fill("Jl. Contoh No. 1, Laweyan");
    await submit(page).scrollIntoViewIfNeeded();
    await expect(submit(page)).toBeInViewport();
    // Step 3 without writing: the action is aborted, so the not-saved layout is shown.
    await page.route("**/*", (route) => (isAction(route) ? route.abort() : route.fallback()));
    await stubWhatsApp(page);
    await submit(page).click();
    await expect(sheet(page).getByRole("heading", { name: "Pesanan belum tercatat di sistem kami" })).toBeVisible();
    await fits();
    await expect(sheet(page).getByRole("link", { name: "Kirim via WhatsApp" })).toBeInViewport();
  });
}
