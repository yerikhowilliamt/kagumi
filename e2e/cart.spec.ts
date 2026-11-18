import { expect, test, type Page } from "@playwright/test";

// M1.5 cart (FR8–FR10, design.md §6 Cart sheet, Toast, Mobile cart bar, Navigation). Seed products (P15):
// Hampers Natal is a priced pre-order (Rp35.000, deadline 2026-12-10); Soft Cookies is ready stock without a price.
const OPEN = "2026-11-20T03:00:00Z"; // 2026-11-20 10:00 WIB
const CLOSED = "2026-12-11T01:00:00Z"; // 2026-12-11 08:00 WIB

const menu = (page: Page) => page.locator("#menu");
const card = (page: Page, name: string) =>
  menu(page).getByRole("listitem").filter({ has: page.getByRole("heading", { name, exact: true }) });
const addButton = (page: Page, name: string) => card(page, name).getByRole("button", { name: /keranjang/ });
const cartButton = (page: Page) => page.getByRole("button", { name: /^Buka keranjang/ });
const sheet = (page: Page) => page.getByRole("dialog", { name: "Keranjang" });
const line = (page: Page, name: string) =>
  sheet(page).getByRole("listitem").filter({ has: page.getByText(name, { exact: true }) });
// By attribute: the steppers' <output> elements have the status role too.
const toast = (page: Page) => page.locator('[role="status"]');
const bar = (page: Page) => page.getByRole("button", { name: /^Lihat keranjang · / });

const collectPageErrors = (page: Page) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
};

async function open(page: Page, time = OPEN) {
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
}

// A click before hydration does nothing, so it is repeated only while the cart button still shows the old count.
async function addFromCard(page: Page, name: string, expectedTotal: number) {
  await expect(async () => {
    if ((await cartButton(page).getAttribute("aria-label")) !== `Buka keranjang, ${expectedTotal} item`) {
      await addButton(page, name).click();
    }
    await expect(cartButton(page)).toHaveAccessibleName(`Buka keranjang, ${expectedTotal} item`, { timeout: 500 });
  }).toPass();
}

async function openSheet(page: Page) {
  await cartButton(page).click();
  await expect(sheet(page)).toBeVisible();
  return sheet(page);
}

test.describe("adding and changing lines (K1)", () => {
  test("card adds one per click and shows the in-cart label", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Hampers Natal", 1);
    await expect(addButton(page, "Hampers Natal")).toHaveText("✓ Di keranjang (1)");
    await addButton(page, "Hampers Natal").click();
    await expect(addButton(page, "Hampers Natal")).toHaveText("✓ Di keranjang (2)");
    await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang, 2 item");
    await expect(addButton(page, "Soft Cookies")).toHaveText("+ Tambah ke keranjang");
  });

  test("detail adds the stepper's quantity and closes", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Hampers Natal", 1); // also waits for hydration
    await page.getByRole("button", { name: "Lihat detail Soft Cookies", exact: true }).click();
    const detail = page.getByRole("dialog", { name: "Soft Cookies" });
    await detail.getByRole("button", { name: "Tambah Soft Cookies" }).click();
    await detail.getByRole("button", { name: "Tambah Soft Cookies" }).click();
    await detail.getByRole("button", { name: "Tambah ke keranjang" }).click();
    await expect(detail).toBeHidden();
    await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang, 4 item");
    await expect(addButton(page, "Soft Cookies")).toHaveText("✓ Di keranjang (3)");
  });

  test("the sheet's stepper changes a quantity, 0 removes the line, and Hapus removes it", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Hampers Natal", 1);
    await addFromCard(page, "Soft Cookies", 2);
    const s = await openSheet(page);
    await s.getByRole("button", { name: "Tambah Hampers Natal" }).click();
    await expect(line(page, "Hampers Natal").locator("output")).toHaveText("2");
    await s.getByRole("button", { name: "Kurangi Hampers Natal" }).click();
    await s.getByRole("button", { name: "Kurangi Hampers Natal" }).click();
    await expect(line(page, "Hampers Natal")).toHaveCount(0);
    await s.getByRole("button", { name: "Hapus Soft Cookies" }).click();
    await expect(line(page, "Soft Cookies")).toHaveCount(0);
    await expect(s.getByText("Keranjang masih kosong")).toBeVisible();
    await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang");
  });
});

test("the cart survives a reload and stores only id and qty (K2)", async ({ page }) => {
  await open(page);
  await addFromCard(page, "Hampers Natal", 1);
  await addFromCard(page, "Hampers Natal", 2);
  await addFromCard(page, "Soft Cookies", 3);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("kagumi-cart")!));
  expect(stored).toHaveLength(2);
  for (const entry of stored) expect(Object.keys(entry).sort()).toEqual(["id", "qty"]);
  expect(stored.map((e: { qty: number }) => e.qty)).toEqual([2, 1]);

  await page.reload();
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang, 3 item");
  await expect(addButton(page, "Hampers Natal")).toHaveText("✓ Di keranjang (2)");
  const s = await openSheet(page);
  await expect(line(page, "Hampers Natal").locator("output")).toHaveText("2");
  await expect(line(page, "Soft Cookies").locator("output")).toHaveText("1");
  await expect(s.getByRole("listitem")).toHaveCount(2);
});

test.describe("line contents, subtotal and note (K3)", () => {
  test("priced and unpriced lines", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Hampers Natal", 1);
    await addFromCard(page, "Hampers Natal", 2);
    await addFromCard(page, "Soft Cookies", 3);
    const s = await openSheet(page);
    await expect(line(page, "Hampers Natal")).toContainText("Rp35.000 · Pre-order");
    await expect(line(page, "Hampers Natal")).toContainText("Rp70.000");
    await expect(line(page, "Soft Cookies")).toContainText("Harga via WA · Ready stock");
    await expect(line(page, "Soft Cookies")).toContainText("—");
    await expect(s.getByText("Subtotal").locator("..")).toHaveText("SubtotalRp70.000");
    await expect(s.getByText("+ 1 produk tanpa harga, dikonfirmasi lewat WhatsApp")).toBeVisible();
  });

  test("nothing priced gives a dash", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Soft Cookies", 1);
    const s = await openSheet(page);
    await expect(s.getByText("Subtotal").locator("..")).toHaveText("Subtotal—");
  });

  test("only priced lines show the delivery note", async ({ page }) => {
    await open(page);
    await addFromCard(page, "Hampers Natal", 1);
    const s = await openSheet(page);
    await expect(s.getByText("Subtotal").locator("..")).toHaveText("SubtotalRp35.000");
    await expect(s.getByText("Ongkir (jika diantar) dikonfirmasi lewat WhatsApp.")).toBeVisible();
  });
});

test("the badge shows the total quantity and is hidden at 0 (K4)", async ({ page }) => {
  await open(page);
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang");
  await expect(cartButton(page).locator("span")).toHaveCount(0);
  await addFromCard(page, "Hampers Natal", 1);
  await addFromCard(page, "Hampers Natal", 2);
  await addFromCard(page, "Soft Cookies", 3);
  await expect(cartButton(page).locator("span")).toHaveText("3");
});

test.describe("toast (K5)", () => {
  // The timer runs on the page clock: install it, then pause, so only runFor moves it.
  async function withClock(page: Page) {
    await page.clock.install({ time: new Date(OPEN) });
    await page.goto("/");
    await page.clock.pauseAt(new Date(Date.parse(OPEN) + 60_000));
  }

  test("appears on add, hides after 2.6 s, and its button opens the sheet", async ({ page }) => {
    await withClock(page);
    await addFromCard(page, "Hampers Natal", 1);
    await expect(toast(page)).toHaveText("Hampers Natal ditambahkanLihat keranjang");
    await page.clock.runFor(2500);
    await expect(toast(page)).toContainText("ditambahkan");
    await page.clock.runFor(200);
    await expect(toast(page)).toHaveText("");

    await addButton(page, "Hampers Natal").click();
    await toast(page).getByRole("button", { name: "Lihat keranjang" }).click();
    await expect(sheet(page)).toBeVisible();
    await expect(toast(page)).toHaveText("");
  });

  test("stays while hovered or focused", async ({ page }) => {
    await withClock(page);
    await addFromCard(page, "Hampers Natal", 1);
    await toast(page).hover();
    await page.clock.runFor(5000);
    await expect(toast(page)).toContainText("ditambahkan");
    await page.mouse.move(0, 0);
    await page.clock.runFor(2700);
    await expect(toast(page)).toHaveText("");

    await addButton(page, "Hampers Natal").click();
    await toast(page).getByRole("button", { name: "Lihat keranjang" }).focus();
    await page.clock.runFor(5000);
    await expect(toast(page)).toContainText("ditambahkan");
  });

  // BSA-M1.5-01: the button unmounts while focused or hovered, so its blur and pointerleave never reach the toast.
  for (const how of ["keyboard", "click"]) {
    test(`a later toast still hides after its button was used (${how})`, async ({ page }) => {
      await withClock(page);
      await addFromCard(page, "Hampers Natal", 1);
      const action = toast(page).getByRole("button", { name: "Lihat keranjang" });
      if (how === "keyboard") {
        await action.focus();
        await page.keyboard.press("Enter");
      } else {
        await action.click();
      }
      await expect(sheet(page)).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(sheet(page)).toBeHidden();

      await addButton(page, "Soft Cookies").click();
      await expect(toast(page)).toContainText("Soft Cookies ditambahkan");
      await page.clock.runFor(2700);
      await expect(toast(page)).toHaveText("");
    });
  }

  test("hides when a dialog opens", async ({ page }) => {
    await withClock(page);
    await addFromCard(page, "Hampers Natal", 1);
    await expect(toast(page)).toContainText("ditambahkan");
    await page.getByRole("button", { name: "Lihat detail Soft Cookies", exact: true }).click();
    await expect(toast(page)).toHaveText("");
    await page.keyboard.press("Escape");

    await addButton(page, "Hampers Natal").click();
    await expect(toast(page)).toContainText("ditambahkan");
    await cartButton(page).click();
    await expect(toast(page)).toHaveText("");
  });
});

test("cart bar: only at 360 px and only with items, opens the sheet (K6)", async ({ page }, info) => {
  await open(page);
  await expect(bar(page)).toHaveCount(0);
  await addFromCard(page, "Hampers Natal", 1);
  await addFromCard(page, "Soft Cookies", 2);
  if (info.project.name !== "mobile-360") {
    await expect(bar(page)).toBeHidden();
    return;
  }
  await expect(bar(page)).toBeVisible();
  await expect(bar(page)).toHaveAccessibleName("Lihat keranjang · 2 item Rp35.000+");
  await bar(page).click();
  await expect(sheet(page)).toBeVisible();
});

test("the empty sheet and Lihat menu (K7)", async ({ page }) => {
  await open(page);
  await expect(async () => {
    await cartButton(page).click();
    await expect(sheet(page)).toBeVisible({ timeout: 500 });
  }).toPass();
  await expect(sheet(page).getByText("Keranjang masih kosong")).toBeVisible();
  await expect(sheet(page).getByText("Pilih menu favoritmu dulu, ya.")).toBeVisible();
  expect(await sheet(page).locator('[aria-hidden="true"]').last().evaluate((el) => getComputedStyle(el).clipPath)).toContain(
    "polygon",
  );
  await sheet(page).getByRole("button", { name: "Lihat menu" }).click();
  await expect(sheet(page)).toBeHidden();
});

test("storage throwing: adding and opening the cart still work, no page error (K9)", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await open(page);
  await addFromCard(page, "Hampers Natal", 1);
  await openSheet(page);
  await expect(line(page, "Hampers Natal")).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("a closed product can't be added from its card or its detail (K10)", async ({ page }) => {
  await open(page, CLOSED);
  await expect(card(page, "Hampers Natal").getByText("Order sudah ditutup")).toBeVisible();
  await expect(addButton(page, "Hampers Natal")).toHaveCount(0);
  await expect(async () => {
    await page.getByRole("button", { name: "Lihat detail Hampers Natal", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Hampers Natal" })).toBeVisible({ timeout: 500 });
  }).toPass();
  const detail = page.getByRole("dialog", { name: "Hampers Natal" });
  await expect(detail.getByText("Order sudah ditutup")).toBeVisible();
  await expect(detail.getByRole("button", { name: "Tambah ke keranjang" })).toHaveCount(0);
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang");
});

test("a closed product already in the cart can't be added from its card (K10, BSA-M1.5-06)", async ({ page }) => {
  await open(page);
  await addFromCard(page, "Hampers Natal", 1);
  await page.clock.setFixedTime(new Date(CLOSED));
  await page.reload();
  await expect(cartButton(page)).toHaveAccessibleName("Buka keranjang, 1 item");
  await expect(card(page, "Hampers Natal").getByText("Order sudah ditutup")).toBeVisible();
  await expect(addButton(page, "Hampers Natal")).toHaveCount(0);
});

test("at 700 px the sheet is full width (design.md §4 ≤ 760px, BSA-M1.5-03)", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one viewport change is enough");
  await page.setViewportSize({ width: 700, height: 800 });
  await open(page);
  await addFromCard(page, "Hampers Natal", 1);
  const s = await openSheet(page);
  await s.evaluate((el) => Promise.allSettled(el.getAnimations().map((a) => a.finished)));
  const box = (await s.boundingBox())!;
  expect(box.x).toBe(0);
  expect(box.width).toBe(700);
});

for (const theme of ["light", "dark"]) {
  test(`${theme}: at 360 px the sheet is full width and the page does not scroll sideways (K11)`, async ({ page }, info) => {
    test.skip(info.project.name !== "mobile-360", "360 px only");
    await page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);
    await open(page);
    await addFromCard(page, "Hampers Natal", 1);
    await addFromCard(page, "Soft Cookies", 2);
    const s = await openSheet(page);
    await s.evaluate((el) => Promise.allSettled(el.getAnimations().map((a) => a.finished)));
    const box = (await s.boundingBox())!;
    expect(box.x).toBe(0);
    expect(box.width).toBe(360);
    const sideways = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    expect(sideways).toBe(false);
  });
}

test("at 360 px the nav row fits its content box with the cart button (note 5, TR-M1.2-01)", async ({ page }, info) => {
  test.skip(info.project.name !== "mobile-360", "360 px only");
  await open(page);
  const m = await page.evaluate(() => {
    const inner = document.querySelector("header")!.firstElementChild as HTMLElement;
    const cs = getComputedStyle(inner);
    const r = inner.getBoundingClientRect();
    const left = r.left + parseFloat(cs.paddingLeft);
    const right = r.right - parseFloat(cs.paddingRight);
    const kids = [...inner.querySelectorAll("a, button")]
      .map((el) => el.getBoundingClientRect())
      .filter((b) => b.width > 0);
    return { left, right, minLeft: Math.min(...kids.map((b) => b.left)), maxRight: Math.max(...kids.map((b) => b.right)) };
  });
  console.log(`nav content box ${m.left}–${m.right}, controls ${m.minLeft}–${m.maxRight}`);
  expect(m.minLeft).toBeGreaterThanOrEqual(m.left);
  expect(m.maxRight).toBeLessThanOrEqual(m.right);
});
