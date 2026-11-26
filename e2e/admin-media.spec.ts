import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { assertDevelopmentDatabase } from "../prisma/seed.ts";
import { loginAs } from "./admin";

// M3.4 media (FR23–FR25, M3 plan D2, D3, D6, D11, D16, D18; exit criterion 2): the media panel of the edit page with
// real uploads to Cloudinary. Runs in the products-360 and products-desktop projects, after every storefront spec (D5).
// Write W4: per project one product "E2E media …", inserted hidden (so the storefront never shows it), with the
// e2e-media@kagumi.test account; one upload of images/hampers-natal.jpg (on desktop named .jpeg, claim C7) and one of
// e2e/fixtures/clip.mp4 into kagumi/dev/products; one medium row inserted directly that was never uploaded (its
// destroy answers "not found"); afterAll deletes the product through the app's delete path (D4), which destroys the
// uploads, and checks that no queue row is left (K7). The refused files never reach Cloudinary (K2).
// M3.5 (FR2, FR6, FR7, exit criterion 1): the last test shows the product through the form's switch (updateTag), checks
// the storefront card and the detail gallery, deletes the clip through the panel (one real destroy of the spec's own
// upload), and hides the product again; afterAll hides it first if a failure left it shown, so the cached storefront
// never keeps a deleted product.
if (process.env.PLAYWRIGHT_BASE_URL) {
  throw new Error("e2e/admin-media.spec.ts uploads and writes products: it runs only against the local dev server, never PLAYWRIGHT_BASE_URL");
}
process.loadEnvFile();
assertDevelopmentDatabase();
// After the guard: db.ts reads DATABASE_URL on load.
const { db } = await import("../src/lib/db.ts");
const { deleteProductRow, listMedia, processDeletions } = await import("../src/lib/products.ts");
const { destroyAsset, signParams } = await import("../src/lib/cloudinary.ts");

const runId = randomBytes(4).toString("hex");
const PHOTO = "images/hampers-natal.jpg";
const CLIP = "e2e/fixtures/clip.mp4";
const LONG = "e2e/fixtures/long.mp4";

let productId: string;
let productName: string;
const seen = new Set<string>(); // every public_id this spec saved, for K7

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({}, info) => {
  const product = await db.product.create({
    data: { name: `E2E media ${runId} ${info.project.name}`, category: "E2E", type: "READY_STOCK", isActive: false, sortOrder: 9999, description: "Produk uji e2e." },
  });
  productId = product.id;
  productName = product.name;
});

test.afterAll(async ({ browser }) => {
  if ((await db.product.findUnique({ where: { id: productId } }))?.isActive) {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    await loginAs(page, "media");
    await setShown(page, false);
    await page.context().close();
  }
  for (const m of await db.productMedia.findMany({ where: { productId }, select: { publicId: true } })) seen.add(m.publicId);
  const assets = await db.$transaction((tx) => deleteProductRow(tx, productId), { maxWait: 10_000 });
  if (assets?.length) await processDeletions(db, assets, (publicId, kind) => destroyAsset(publicId, kind));
  // K7: the real destroys succeeded (D4), so nothing is left for the cron.
  expect(await db.pendingDeletion.count({ where: { publicId: { in: [...seen] } } })).toBe(0);
});

const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) > 760;
const panel = (page: Page) => page.getByRole("region", { name: "Foto & video" });
const tiles = (page: Page) => panel(page).getByRole("listitem");
const dropZone = (page: Page) => panel(page).getByRole("button", { name: /Tambah foto atau video/ });
const fileInput = (page: Page) => panel(page).locator('input[type="file"]');
/** The tile at `index` shows the medium with this public_id (its image URL holds it). */
const showsAt = (page: Page, index: number, publicId: string) =>
  expect(tiles(page).nth(index).locator("img")).toHaveAttribute("src", new RegExp(publicId.replace(/[/-]/g, "\\$&")));

async function open(page: Page) {
  await loginAs(page, "media");
  await page.goto(`/admin/produk/${productId}`);
  await expect(panel(page)).toBeVisible();
}

/** The saved media in display order (D11), from the database. */
const saved = async () =>
  (await listMedia(db, productId)).map(({ id, publicId, kind, version, format, isMain, durationSec }) => ({ id, publicId, kind, version, format, isMain, durationSec }));

/** Shows or hides the product through the edit form, which expires the storefront's cache (D9). */
async function setShown(page: Page, to: boolean) {
  await page.goto(`/admin/produk/${productId}`);
  const control = page.getByRole("switch", { name: "Tampilkan di website" });
  await expect(control).toHaveAttribute("aria-checked", String(!to));
  await control.click();
  await expect(control).toHaveAttribute("aria-checked", String(to));
  await page.getByRole("button", { name: "Simpan perubahan" }).click();
  await expect(page.getByText("Tersimpan.", { exact: true })).toBeVisible();
  await expect.poll(async () => (await db.product.findUniqueOrThrow({ where: { id: productId } })).isActive).toBe(to);
}

/** A storefront visitor of its own at the project's width (M1-D26: a user agent unique to the test and run). */
async function shopper(browser: Browser, page: Page, testId: string) {
  const context = await browser.newContext({
    viewport: page.viewportSize(),
    userAgent: `${devices["Desktop Chrome"].userAgent} kagumi-e2e/${testId}-${runId}`,
  });
  await context.route("https://wa.me/**", (route) => route.fulfill({ status: 204 }));
  return context.newPage();
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");

test("K1: the photo and the clip upload with a visible percentage; the photo is main; 2 files, also after a reload", async ({ page }) => {
  await open(page);
  await expect(panel(page).getByText("0 file")).toBeVisible();
  // The first request to Cloudinary waits until the test has seen its tile's percentage.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  const uploads: string[] = [];
  const eager: (string | null)[] = []; // each upload's multipart `eager` field, null when absent (M3.6)
  await page.route("https://api.cloudinary.com/**", async (route) => {
    uploads.push(new URL(route.request().url()).pathname);
    const body = route.request().postDataBuffer()?.toString("latin1") ?? "";
    const field = (name: string) => body.match(new RegExp(`name="${name}"\\r\\n\\r\\n([^\\r]*)`))?.[1] ?? null;
    eager.push(field("eager") && `${field("eager")} async=${field("eager_async")}`);
    if (uploads.length === 1) await released;
    await route.continue();
  });
  // Playwright takes paths or buffers, not both in one call.
  await fileInput(page).setInputFiles(
    isDesktop(page)
      ? [
          { name: "hampers-natal.jpeg", mimeType: "image/jpeg", buffer: readFileSync(PHOTO) },
          { name: "clip.mp4", mimeType: "video/mp4", buffer: readFileSync(CLIP) },
        ]
      : [PHOTO, CLIP],
  );

  await expect(panel(page).getByText(/^Mengunggah \d+%$/).first()).toBeVisible();
  await expect(panel(page).getByRole("progressbar")).toHaveCount(2); // the clip waits its turn
  release();
  await expect(panel(page).getByRole("progressbar")).toHaveCount(0, { timeout: 60_000 });
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
  const cloud = process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
  expect(uploads).toEqual([`/v1_1/${cloud}/image/upload`, `/v1_1/${cloud}/video/upload`]);
  // M3.6: only the clip asks for the eager H.264 and poster; Cloudinary accepted both signatures (the tiles saved).
  expect(eager).toEqual([null, "f_mp4,vc_h264,q_auto,c_limit,h_1920,w_1920/mp4|so_0,q_auto,c_fill,w_960/jpg async=true"]);

  for (const step of ["after the uploads", "after a reload"]) {
    await expect(tiles(page), step).toHaveCount(2);
    await expect(panel(page).getByText("2 file"), step).toBeVisible();
    await expect(tiles(page).first().getByText("Utama", { exact: true }), step).toBeVisible();
    await expect(tiles(page).nth(1).getByRole("button", { name: "Hapus video" }), step).toBeAttached();
    await expect(tiles(page).nth(1).getByText("0:02"), step).toBeVisible();
    await page.reload();
  }

  const rows = await saved();
  for (const row of rows) seen.add(row.publicId);
  expect(rows.map(({ kind, format, isMain }) => ({ kind, format, isMain }))).toEqual([
    { kind: "IMAGE", format: "jpg", isMain: true }, // also for the .jpeg name (C7)
    { kind: "VIDEO", format: "mp4", isMain: false },
  ]);
  expect(rows[1].durationSec).toBeCloseTo(2, 0);
  for (const row of rows) expect(row.publicId.startsWith("kagumi/dev/products/"), row.publicId).toBe(true);
});

test("main, move and delete (D3, D11); every tile button is reached by Tab with its name (K6)", async ({ page }) => {
  // A third medium, an image never uploaded, so main and move have something to act on without more credits.
  const fake = await db.productMedia.create({
    data: { productId, publicId: `kagumi/dev/products/e2e-${randomUUID()}`, kind: "IMAGE", version: 1, format: "jpg", width: 10, height: 10, bytes: 1, sortOrder: 100 },
  });
  seen.add(fake.publicId);
  const [photo, clip] = await saved();
  await open(page);
  await expect(tiles(page)).toHaveCount(3);

  // Display order photo (main), clip, fake: Tab from the drop zone walks every tile button in that order.
  await dropZone(page).focus();
  const names: (string | null)[] = [];
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press("Tab");
    names.push(await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null));
  }
  expect(names).toEqual(["Hapus foto", "Hapus video", "Geser ke kanan", "Jadikan utama", "Hapus foto", "Geser ke kiri"]);
  await expect(tiles(page).first().getByRole("button", { name: /Geser/ })).toHaveCount(0); // the main one stays first

  await tiles(page).nth(2).getByRole("button", { name: "Geser ke kiri" }).click();
  await expect.poll(async () => (await saved()).map((m) => m.id)).toEqual([photo.id, fake.id, clip.id]);
  // The grid shows the new order (the action refreshed the page) before the next click.
  await showsAt(page, 1, fake.publicId);
  await showsAt(page, 2, clip.publicId);

  await tiles(page).nth(1).getByRole("button", { name: "Jadikan utama" }).click();
  await expect.poll(async () => (await saved()).filter((m) => m.isMain).map((m) => m.id)).toEqual([fake.id]);
  await showsAt(page, 0, fake.publicId);
  await expect(tiles(page).first().getByText("Utama", { exact: true })).toBeVisible();
  await showsAt(page, 1, photo.publicId);
  await expect(tiles(page).nth(1).getByRole("button", { name: "Jadikan utama" })).toBeVisible(); // the photo now

  // Deleting the main one makes the next image main (the photo), and the queue row is gone (destroy: not found).
  // The action's POST is held until the busy tile has been seen.
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  await page.route(`**/admin/produk/${productId}`, async (route) => {
    if (route.request().method() === "POST") await released;
    await route.continue();
  });
  await tiles(page).first().getByRole("button", { name: "Hapus foto" }).click();
  await expect(tiles(page).first()).toHaveAttribute("aria-busy", "true");
  release();
  // The delete answers after Cloudinary's destroy (D4), seconds on a slow route (IPv6 over the hotspot took 4-7 s).
  await expect(tiles(page)).toHaveCount(2, { timeout: 20_000 });
  await expect(panel(page).getByText("2 file")).toBeVisible();
  await showsAt(page, 0, photo.publicId);
  expect((await saved()).map((m) => [m.id, m.isMain])).toEqual([
    [photo.id, true],
    [clip.id, false],
  ]);
  expect(await db.pendingDeletion.count({ where: { publicId: fake.publicId } })).toBe(0);
  await expect(panel(page).getByRole("alert")).toHaveCount(0);
});

test("K2: an 11 MB photo, a 31-second video and a GIF are refused in the browser; nothing reaches Cloudinary", async ({ page }) => {
  await open(page);
  const requests: string[] = [];
  await page.route("https://api.cloudinary.com/**", (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  await fileInput(page).setInputFiles([
    { name: "besar.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(11 * 1024 * 1024) },
    { name: "long.mp4", mimeType: "video/mp4", buffer: readFileSync(LONG) },
    { name: "animasi.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") },
  ]);
  const alerts = panel(page).getByRole("alert");
  await expect(alerts).toHaveText(["Foto lebih dari 10 MB.", "Video lebih dari 30 detik.", "Format file tidak didukung."]);
  await expect(panel(page).getByText("besar.jpg")).toBeVisible();
  await expect(panel(page).getByText("2 file")).toBeVisible();
  expect(requests).toEqual([]);
  expect(await saved()).toHaveLength(2);
  // A new pick clears the old messages.
  await fileInput(page).setInputFiles([{ name: "lagi.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") }]);
  await expect(alerts).toHaveText(["Format file tidak didukung."]);
  expect(requests).toEqual([]);
});

test("a failed upload shows its message and the queue goes on; a server refusal shows on its tile (BSA-M3.4-05)", async ({ page }) => {
  await open(page);
  // The first upload fails at Cloudinary; the second gets a response signed as Cloudinary signs it (C4), for an asset
  // that doesn't exist, 31 s long: the browser read 2 s, so only the server refuses it (D16 step 5), and its destroy
  // answers "not found". Nothing reaches Cloudinary.
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!secret) throw new Error("CLOUDINARY_API_SECRET is not set");
  const fake = { public_id: `kagumi/dev/products/e2e-${randomUUID()}`, version: 1, resource_type: "video", format: "mp4", bytes: 1000, width: 160, height: 200, duration: 31 };
  const signed = { ...fake, signature: signParams({ public_id: fake.public_id, version: fake.version }, secret) };
  seen.add(fake.public_id);
  let calls = 0;
  await page.route("https://api.cloudinary.com/**", (route) =>
    ++calls === 1 ? route.abort() : route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(signed) }),
  );
  await fileInput(page).setInputFiles([
    { name: "gagal.jpg", mimeType: "image/jpeg", buffer: readFileSync(PHOTO) },
    { name: "panjang.mp4", mimeType: "video/mp4", buffer: readFileSync(CLIP) },
  ]);
  await expect(panel(page).getByRole("alert")).toHaveText(["Upload gagal. Coba lagi.", "Video lebih dari 30 detik."], { timeout: 20_000 });
  await expect(panel(page).getByRole("progressbar")).toHaveCount(0);
  expect(calls).toBe(2);
  await expect(panel(page).getByText("2 file")).toBeVisible();
  expect(await saved()).toHaveLength(2);
  expect(await db.productMedia.count({ where: { publicId: fake.public_id } })).toBe(0);
  await expect.poll(() => db.pendingDeletion.count({ where: { publicId: fake.public_id } })).toBe(0);
});

test("K6: the drop zone opens the file picker with Enter and with Space", async ({ page }) => {
  await open(page);
  for (const key of ["Enter", "Space"]) {
    await dropZone(page).focus();
    const chooser = page.waitForEvent("filechooser");
    await page.keyboard.press(key);
    expect((await chooser).isMultiple(), key).toBe(true);
  }
});

for (const theme of ["light", "dark"] as const) {
  test(`K6 at 360 px in ${theme}: the remove buttons show without hover, and the page has no horizontal scroll`, async ({ page }) => {
    test.skip(isDesktop(page), "products-360 only");
    await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
    await open(page);
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(tiles(page)).toHaveCount(2);
    for (const name of ["Hapus foto", "Hapus video"]) await expect(panel(page).getByRole("button", { name })).toHaveCSS("opacity", "1");
    expect(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)).toBe(false);
  });
}

test("M3.5: the list thumb; the storefront card and the detail gallery through Cloudinary (exit criterion 1); one medium, no row", async ({ page, browser }, info) => {
  const [photo, clip] = await saved();
  expect([photo.kind, clip.kind]).toEqual(["IMAGE", "VIDEO"]);
  const cloud = escape(process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME ?? "");
  const imageSrc = (m: typeof photo) => new RegExp(`^https://res\\.cloudinary\\.com/${cloud}/image/upload/f_auto,q_auto,c_fill,w_\\d+/v${m.version}/${escape(m.publicId)}$`);
  await loginAs(page, "media");

  // K6: the list shows the main photo as the thumb, and on desktop the counts (the 360 px cards show no counts).
  await page.goto("/admin/produk?filter=HIDDEN");
  const entry = page.locator(isDesktop(page) ? "tr" : "li").filter({ hasText: productName });
  await expect(entry.locator("img")).toHaveAttribute("src", imageSrc(photo));
  if (isDesktop(page)) await expect(entry.getByText("1 foto, 1 video")).toBeVisible();

  // Shown through the form: the storefront's next request has the card with the photo (K1, D9).
  await setShown(page, true);
  const shop = await shopper(browser, page, info.testId);
  await shop.goto("/");
  const card = shop.locator("#menu").getByRole("listitem").filter({ has: shop.getByRole("heading", { name: productName, exact: true }) });
  const open = card.getByRole("button", { name: `Lihat detail ${productName}` });
  await expect(open.locator("img")).toHaveAttribute("src", imageSrc(photo));
  await expect(open.locator("img")).toHaveAttribute("alt", "");
  expect(await open.locator("img").getAttribute("srcset")).toMatch(new RegExp(`/f_auto,q_auto,c_fill,w_\\d+/v${photo.version}/${escape(photo.publicId)} \\d+w`));

  // The detail: the photo in the main slot named by the product, two thumbnails, the first selected (K1, K3).
  const dialog = shop.locator("dialog[open]");
  const openDetail = () =>
    expect(async () => {
      if (!(await dialog.isVisible())) await open.click();
      await expect(dialog).toBeVisible({ timeout: 500 });
    }).toPass(); // a click before hydration does nothing
  await openDetail();
  const picks = dialog.getByRole("listitem").getByRole("button");
  await expect(picks).toHaveCount(2);
  expect(await picks.evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")))).toEqual(["Foto 1", "Video 2"]);
  await expect(picks.first()).toHaveAttribute("aria-pressed", "true");
  await expect(picks.nth(1)).toHaveAttribute("aria-pressed", "false");
  await expect(dialog.getByRole("img", { name: productName })).toHaveAttribute("src", imageSrc(photo));
  await expect(dialog.locator("video")).toHaveCount(0);
  // The selected thumbnail has the 2 px --ink border.
  const ink = await shop.evaluate(() => {
    const probe = document.body.appendChild(document.createElement("i"));
    probe.style.color = "var(--ink)";
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  });
  await expect(picks.first()).toHaveCSS("border-top-color", ink);
  await expect(picks.first()).toHaveCSS("border-top-width", "2px");

  // The clip is 4:5 like the slot; its main poster is replaced by a portrait 9:16 one, the shape of a phone video, which
  // made the video taller than the slot and clipped its controls on desktop (M3.6 S8).
  const mainPoster = `**/video/upload/so_0,q_auto,c_fill,w_960/v${clip.version}/${clip.publicId}.jpg`;
  await shop.route(mainPoster, (route) =>
    route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="90" height="160"><rect width="90" height="160"/></svg>' }),
  );
  const posterServed = shop.waitForResponse((r) => r.url().includes("/so_0,q_auto,c_fill,w_960/"));

  // Tab reaches the video's thumbnail; Enter selects it: the video, never autoplaying or preloading (K3).
  await picks.first().focus();
  await shop.keyboard.press("Tab");
  await expect(picks.nth(1)).toBeFocused();
  await shop.keyboard.press("Enter");
  await expect(picks.nth(1)).toHaveAttribute("aria-pressed", "true");
  await expect(picks.first()).toHaveAttribute("aria-pressed", "false");
  const video = dialog.locator("video");
  await expect(video).toHaveAttribute("src", `https://res.cloudinary.com/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/video/upload/f_mp4,vc_h264,q_auto,c_limit,h_1920,w_1920/v${clip.version}/${clip.publicId}.mp4`);
  // The main slot's poster is the one derived at upload (M3.6): width 960.
  await expect(video).toHaveAttribute("poster", new RegExp(`/video/upload/so_0,q_auto,c_fill,w_960/v${clip.version}/${escape(clip.publicId)}\\.jpg$`));
  // The video fits the 4:5 slot, so its control bar (play) stays inside the clipped box.
  await posterServed;
  await expect(video).toHaveCSS("min-height", "0px");
  await expect
    .poll(() => video.evaluate((v) => Math.round(v.getBoundingClientRect().height - v.parentElement!.getBoundingClientRect().height)))
    .toBeLessThanOrEqual(0);
  await expect(video).toHaveAttribute("preload", "none");
  await expect(video).toHaveAttribute("controls", "");
  await expect(video).not.toHaveAttribute("autoplay");
  expect(await video.evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  await expect(video).toHaveAccessibleName(productName);

  // Closing removes the video, so a started one stops (TR-M3-01); each opening starts at the first medium.
  await shop.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(shop.locator("video")).toHaveCount(0);
  await openDetail();
  await expect(picks.first()).toHaveAttribute("aria-pressed", "true");
  await expect(dialog.locator("video")).toHaveCount(0);

  // The clip deleted through the panel (D9 refreshes the storefront): one medium, so no thumbnail row (D17, K2).
  await page.goto(`/admin/produk/${productId}`);
  await panel(page).getByRole("button", { name: "Hapus video" }).click();
  await expect(tiles(page)).toHaveCount(1, { timeout: 20_000 }); // waits for the real destroy (D4)
  await shop.goto("/");
  await openDetail();
  await expect(dialog.getByRole("img", { name: productName })).toHaveAttribute("src", imageSrc(photo));
  await expect(dialog.getByRole("button", { name: /^(Foto|Video) \d$/ })).toHaveCount(0);
  await expect(dialog.locator("video")).toHaveCount(0);

  // Hidden again before the spec ends; the next storefront request lacks it.
  await setShown(page, false);
  await shop.goto("/");
  await expect(shop.locator("#menu").getByRole("heading").first()).toBeVisible();
  await expect(card).toHaveCount(0);
  await shop.context().close();
});
