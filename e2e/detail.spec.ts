import { expect, test, type Locator, type Page } from "@playwright/test";

// M1.4 product detail (FR6 without media, design.md §6 Product detail). Seed products (P15):
// Hampers Natal is a priced pre-order with deadline 2026-12-10; Soft Cookies is ready stock without a price.
const OPEN = "2026-11-20T03:00:00Z"; // 2026-11-20 10:00 WIB
const CLOSED = "2026-12-11T01:00:00Z"; // 2026-12-11 08:00 WIB

const menu = (page: Page) => page.locator("#menu");
const card = (page: Page, name: string) =>
  menu(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
const thumb = (page: Page, name: string) => page.getByRole("button", { name: `Lihat detail ${name}`, exact: true });
const nameButton = (page: Page, name: string) => card(page, name).getByRole("button", { name, exact: true });
const promo = (page: Page) => page.getByRole("button", { name: /Pre-order dibuka/ });
const detail = (page: Page, name: string) => page.getByRole("dialog", { name, exact: true });
const stepper = (dialog: Locator) => dialog.getByRole("group", { name: "Jumlah" });
const count = (dialog: Locator) => stepper(dialog).locator("output");

// Opens the page with the browser clock fixed, then opens a detail. The first clicks may land before hydration,
// so the click is retried until the dialog shows.
async function openDetail(page: Page, trigger: Locator, name: string, time = OPEN) {
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  await expect(async () => {
    await trigger.click();
    await expect(detail(page, name)).toBeVisible({ timeout: 500 });
  }).toPass();
  return detail(page, name);
}

// Reads the dialog's `open` state through a handle, because the role locator stops matching once it closes. `open`
// drops on close() at once, while visibility lasts through the 0.35 s exit transition. Waits for the opening
// transition first, so pointer coordinates taken afterwards stay valid.
async function openState(dialog: Locator) {
  const handle = (await dialog.elementHandle())!;
  await handle.evaluate((el) => Promise.allSettled(el.getAnimations({ subtree: true }).map((a) => a.finished)));
  return () => handle.evaluate((el) => (el as HTMLDialogElement).open);
}

const token = (page: Page, name: string, property: "color" | "backgroundColor") =>
  page.evaluate(
    ([n, p]) => {
      const probe = document.createElement("i");
      probe.style[p] = `var(${n})`;
      document.body.append(probe);
      const value = getComputedStyle(probe)[p];
      probe.remove();
      return value;
    },
    [name, property] as const,
  );

test.describe("opens as a modal dialog labelled by the product name (K1)", () => {
  test("from the thumbnail button", async ({ page }) => {
    const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  });

  test("from the product name", async ({ page }) => {
    const dialog = await openDetail(page, nameButton(page, "Soft Cookies"), "Soft Cookies");
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  });

  test("from the promo card", async ({ page }) => {
    // The promo card shows the open pre-order with the nearest deadline: Hampers Natal in the seed.
    const dialog = await openDetail(page, promo(page), "Hampers Natal");
    expect(await dialog.evaluate((el) => el.matches(":modal"))).toBe(true);
  });
});

test("shows placeholder, tag, name, price, description, deadline, facts and a stepper at 1 (K2, D9)", async ({ page }) => {
  const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
  await expect(dialog.locator("img")).toHaveCount(1); // the placeholder mark, no media yet
  await expect(dialog.getByRole("button", { name: /^Media/ })).toHaveCount(0); // no thumbnail row (D9)
  await expect(dialog.getByText("Pre-order", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { level: 2, name: "Hampers Natal" })).toBeVisible();
  await expect(dialog.getByText("Rp35.000", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Termasuk box, paper bag, kartu & hang tag edisi Natal.")).toBeVisible();
  await expect(dialog.getByText("Batas order 10 Des", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Pengambilan: ambil sendiri atau diantar (area Solo)")).toBeVisible();
  await expect(dialog.getByText("Dibuat: fresh setelah pesanan dikonfirmasi")).toBeVisible();
  await expect(count(dialog)).toHaveText("1");
  await expect(dialog.getByRole("button", { name: "Tambah ke keranjang", exact: true })).toBeVisible();

  // design.md §5: the detail pre-order tag is --butter on --on-accent.
  const tag = dialog.getByText("Pre-order", { exact: true });
  await expect(tag).toHaveCSS("background-color", await token(page, "--butter", "backgroundColor"));
  await expect(tag).toHaveCSS("color", await token(page, "--on-accent", "color"));
});

test("a product without price or deadline shows the WhatsApp price text and a ready tag (K2)", async ({ page }) => {
  const dialog = await openDetail(page, thumb(page, "Soft Cookies"), "Soft Cookies");
  await expect(dialog.getByText("Harga dikonfirmasi via WhatsApp", { exact: true })).toBeVisible();
  await expect(dialog.getByText(/^Batas order/)).toHaveCount(0);
  const tag = dialog.getByText("Ready stock", { exact: true });
  await expect(tag).toBeVisible();
  // design.md §5: the detail ready tag is --success-bg on --success.
  await expect(tag).toHaveCSS("background-color", await token(page, "--success-bg", "backgroundColor"));
  await expect(tag).toHaveCSS("color", await token(page, "--success", "color"));
});

test("the stepper does nothing below 1 and stops at 50 (K2)", async ({ page }) => {
  const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
  const minus = dialog.getByRole("button", { name: "Kurangi Hampers Natal", exact: true });
  const plus = dialog.getByRole("button", { name: "Tambah Hampers Natal", exact: true });

  await expect(minus).toHaveAttribute("aria-disabled", "true");
  // A forced click skips Playwright's stability wait, so wait for the bottom sheet to finish rising.
  await expect(stepper(dialog)).toBeInViewport({ ratio: 1 });
  // force: Playwright waits for aria-disabled controls to become enabled; the click itself must be a no-op.
  await minus.click({ force: true });
  await expect(count(dialog)).toHaveText("1");

  for (let i = 0; i < 49; i++) await plus.click();
  await expect(count(dialog)).toHaveText("50");
  await expect(plus).toHaveAttribute("aria-disabled", "true");
  await plus.click({ force: true });
  await expect(count(dialog)).toHaveText("50");
  // Focus stays on the control, not lost to the page.
  await expect(plus).toBeFocused();

  await minus.click();
  await expect(count(dialog)).toHaveText("49");
});

test("the stepper restarts at 1 on every opening, same or other product (D6)", async ({ page }) => {
  const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
  const plus = dialog.getByRole("button", { name: "Tambah Hampers Natal", exact: true });
  for (let i = 0; i < 4; i++) await plus.click();
  await expect(count(dialog)).toHaveText("5");
  await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
  await expect(dialog).toBeHidden();

  await thumb(page, "Hampers Natal").click();
  await expect(count(dialog)).toHaveText("1");
  await plus.click();
  await expect(count(dialog)).toHaveText("2");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  await nameButton(page, "Buko Mangga").click();
  await expect(count(detail(page, "Buko Mangga"))).toHaveText("1");
});

test("a closed product shows the closed note and no stepper or add button (K2)", async ({ page }) => {
  const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal", CLOSED);
  await expect(dialog.getByText("Order sudah ditutup", { exact: true })).toBeVisible();
  await expect(stepper(dialog)).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Tambah ke keranjang" })).toHaveCount(0);
});

test.describe("closes and returns focus to the control that opened it (K3)", () => {
  test("with the close button", async ({ page }) => {
    const opener = thumb(page, "Hampers Natal");
    const dialog = await openDetail(page, opener, "Hampers Natal");
    await dialog.getByRole("button", { name: "Tutup", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("with Escape", async ({ page }) => {
    const opener = nameButton(page, "Soft Cookies");
    const dialog = await openDetail(page, opener, "Soft Cookies");
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("with a click on the backdrop", async ({ page }) => {
    const opener = promo(page);
    const dialog = await openDetail(page, opener, "Hampers Natal");
    // Top-left corner: outside the centered modal on desktop and above the 92% bottom sheet at 360px.
    await page.mouse.click(4, 4);
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("a click inside the dialog does not close it", async ({ page }) => {
    const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
    const isOpen = await openState(dialog);
    await dialog.getByRole("heading", { level: 2 }).click();
    expect(await isOpen()).toBe(true);
    // A non-interactive point just inside the dialog's left edge.
    const box = (await dialog.boundingBox())!;
    await page.mouse.click(box.x + 6, box.y + box.height / 2);
    expect(await isOpen()).toBe(true);
  });

  test("a drag that starts inside and ends on the backdrop does not close it", async ({ page }) => {
    const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
    const isOpen = await openState(dialog);
    // Selecting the description and releasing over the backdrop: the click then targets the dialog itself.
    const text = (await dialog.getByText("Termasuk box, paper bag, kartu & hang tag edisi Natal.").boundingBox())!;
    await page.mouse.move(text.x + 4, text.y + text.height / 2);
    await page.mouse.down();
    await page.mouse.move(10, 10, { steps: 5 });
    await page.mouse.up();
    expect(await isOpen()).toBe(true);
  });
});

for (const theme of ["light", "dark"] as const) {
  test(`at 360 × 800 the detail is a bottom sheet with its buy row visible, ${theme} theme (K4)`, async ({ page }) => {
    test.skip(page.viewportSize()?.width !== 360, "mobile-360 project only");
    await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
    const dialog = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);

    // After the rise transition: anchored to the bottom, full width, at most 92% of 800px high.
    await expect.poll(async () => (await dialog.boundingBox())?.y).toBeGreaterThanOrEqual(800 - 736);
    await expect.poll(async () => {
      const box = (await dialog.boundingBox())!;
      return Math.round(box.y + box.height);
    }).toBe(800);
    const box = (await dialog.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(360);
    expect(box.height).toBeLessThanOrEqual(736);

    await expect(stepper(dialog)).toBeInViewport({ ratio: 1 });
    await expect(dialog.getByRole("button", { name: "Tambah ke keranjang", exact: true })).toBeInViewport({ ratio: 1 });

    const overflow = await page.evaluate(() => {
      const root = document.documentElement;
      const sheet = document.querySelector("dialog[open]")!;
      return { page: root.scrollWidth - root.clientWidth, sheet: sheet.scrollWidth - sheet.clientWidth };
    });
    expect(overflow).toEqual({ page: 0, sheet: 0 });
  });
}

test("with reduced motion the dialog opens and closes without a transition (K5)", async ({ page }) => {
  // Control: without the preference the dialog has a transition, so the check below can fail.
  const animated = await openDetail(page, thumb(page, "Hampers Natal"), "Hampers Natal");
  expect(await animated.evaluate((el) => getComputedStyle(el).transitionDuration)).not.toMatch(/^0s(, 0s)*$/);

  await page.emulateMedia({ reducedMotion: "reduce" });
  const dialog = await openDetail(page, thumb(page, "Soft Cookies"), "Soft Cookies");
  const styles = await dialog.evaluate((el) => {
    const own = getComputedStyle(el);
    const backdrop = getComputedStyle(el, "::backdrop");
    return { own: own.transitionDuration, backdrop: backdrop.transitionDuration, opacity: own.opacity, scale: own.scale };
  });
  expect(styles.own).toMatch(/^0s(, 0s)*$/);
  expect(styles.backdrop).toMatch(/^0s(, 0s)*$/);
  expect(styles.opacity).toBe("1");
  expect(["1", "none"]).toContain(styles.scale);

  // A handle, because the role locator no longer matches once the dialog is hidden.
  const handle = await dialog.elementHandle();
  await page.keyboard.press("Escape");
  // No exit transition: the closed dialog is display: none right away, not held open by allow-discrete.
  expect(await handle!.evaluate((el) => getComputedStyle(el).display)).toBe("none");
});
