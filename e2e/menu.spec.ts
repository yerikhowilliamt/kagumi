import { expect, test, type Page } from "@playwright/test";

// The development seed (P15), in sortOrder: name, category, tag, price text.
const SEED = [
  ["Bolu Gulung", "Kue", "Pre-order", "Harga via WA"],
  ["Fudgy Brownies", "Brownies", "Pre-order", "Harga via WA"],
  ["Brownies Custom", "Brownies", "Pre-order", "Harga via WA"],
  ["Soft Cookies", "Cookies", "Ready stock", "Harga via WA"],
  ["Buko Mangga", "Dessert", "Ready stock", "Harga via WA"],
  ["Donut", "Donut", "Ready stock", "Harga via WA"],
  ["Hampers Natal", "Hampers", "Pre-order", "Rp35.000"],
] as const;
const NAMES = SEED.map(([name]) => name);
const PRE_ORDERS = ["Bolu Gulung", "Fudgy Brownies", "Brownies Custom", "Hampers Natal"];
const READY = ["Soft Cookies", "Buko Mangga", "Donut"];

// Hampers Natal's deadline is 2026-12-10 (inclusive, WIB = UTC+7).
const OPEN = "2026-11-20T03:00:00Z"; // 10:00 WIB
const LAST_MINUTE = "2026-12-10T16:59:00Z"; // 2026-12-10 23:59 WIB
const AFTER_MIDNIGHT = "2026-12-10T17:30:00Z"; // 2026-12-11 00:30 WIB
const CLOSED = "2026-12-11T01:00:00Z"; // 2026-12-11 08:00 WIB

const cards = (page: Page) => page.locator("#menu").getByRole("listitem");
const titles = (page: Page) => cards(page).getByRole("heading", { level: 3 });
const card = (page: Page, name: string) =>
  cards(page).filter({ has: page.getByRole("heading", { name, exact: true }) });
const chip = (page: Page, name: string) =>
  page.getByRole("group", { name: "Filter menu" }).getByRole("button", { name, exact: true });
const thumb = (page: Page, name: string) => page.getByRole("button", { name: `Lihat detail ${name}`, exact: true });
const promo = (page: Page) => page.getByRole("button", { name: /Pre-order dibuka/ });
const notice = (page: Page) => page.locator("p", { hasText: "Pengantaran tersedia" });
const exactly = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

// Opens the page with the browser clock fixed, and waits until React runs with the browser's date:
// a chip only answers a click after hydration.
async function openAt(page: Page, time: string | Date) {
  await page.clock.setFixedTime(new Date(time));
  await page.goto("/");
  await expect(async () => {
    await chip(page, "Pre-order").click();
    await expect(chip(page, "Pre-order")).toHaveAttribute("aria-pressed", "true", { timeout: 500 });
  }).toPass();
  await chip(page, "Semua").click();
  await expect(titles(page)).toHaveCount(NAMES.length);
}

// The computed value of a color token, to compare with an element's computed color.
const token = (page: Page, name: string) =>
  page.evaluate((n) => {
    const probe = document.createElement("i");
    probe.style.color = `var(${n})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, name);

test("every active product is a card with category, name, price, tag and deadline (FR2, FR3)", async ({ page }) => {
  await openAt(page, OPEN);
  await expect(titles(page)).toHaveText(NAMES);
  for (const [name, category, tag, price] of SEED) {
    const item = card(page, name);
    await expect(item.locator("p").filter({ hasText: exactly(category) }), `${name} category`).toHaveCount(1);
    await expect(item.locator("p").filter({ hasText: exactly(price) }), `${name} price`).toHaveCount(1);
    await expect(item.getByText(tag, { exact: true }), `${name} tag`).toBeVisible();
  }
  await expect(card(page, "Bolu Gulung").getByText("Lembut dengan filling nanas, strawberry, atau blueberry.")).toBeVisible();
  await expect(card(page, "Hampers Natal").getByText("Batas order 10 Des", { exact: true })).toBeVisible();
  await expect(card(page, "Donut").getByText(/Batas order/)).toHaveCount(0);
});

test("the category is a muted 13px line above the product name (D24)", async ({ page }) => {
  await openAt(page, OPEN);
  const category = card(page, "Hampers Natal").locator("p").filter({ hasText: exactly("Hampers") });
  await expect(category).toHaveCSS("font-size", "13px");
  await expect(category).toHaveCSS("color", await token(page, "--muted"));
  const before = await category.evaluate(
    (el) => !!(el.compareDocumentPosition(el.closest("li")!.querySelector("h3")!) & Node.DOCUMENT_POSITION_FOLLOWING),
  );
  expect(before).toBe(true);
});

test("tags use the storefront thumbnail tokens (design.md §5)", async ({ page }) => {
  await openAt(page, OPEN);
  const po = card(page, "Hampers Natal").getByText("Pre-order", { exact: true });
  await expect(po).toHaveCSS("background-color", await token(page, "--tag-po-bg"));
  await expect(po).toHaveCSS("color", await token(page, "--tag-po-fg"));
  const ready = card(page, "Donut").getByText("Ready stock", { exact: true });
  await expect(ready).toHaveCSS("background-color", await token(page, "--tag-bg"));
  await expect(ready).toHaveCSS("color", await token(page, "--success"));
});

test("the filter shows all, only ready stock, or only pre-order products (FR4)", async ({ page }) => {
  await openAt(page, OPEN);
  const pressed = () =>
    Promise.all(["Semua", "Ready stock", "Pre-order"].map((name) => chip(page, name).getAttribute("aria-pressed")));
  expect(await pressed()).toEqual(["true", "false", "false"]);

  await chip(page, "Ready stock").click();
  await expect(titles(page)).toHaveText(READY);
  expect(await pressed()).toEqual(["false", "true", "false"]);

  await chip(page, "Pre-order").click();
  await expect(titles(page)).toHaveText(PRE_ORDERS);
  expect(await pressed()).toEqual(["false", "false", "true"]);

  await chip(page, "Semua").click();
  await expect(titles(page)).toHaveText(NAMES);
  expect(await pressed()).toEqual(["true", "false", "false"]);
});

test("a closed product stays listed under its type, last (FR4, FR5)", async ({ page }) => {
  await openAt(page, CLOSED);
  await chip(page, "Pre-order").click();
  await expect(titles(page)).toHaveText(PRE_ORDERS);
  await expect(card(page, "Hampers Natal").getByText("Order sudah ditutup", { exact: true })).toBeVisible();
  await chip(page, "Ready stock").click();
  await expect(titles(page)).toHaveText(READY);
});

test("after its deadline a product is closed: text, 50% thumbnail, last card, no add button (FR5)", async ({ page }) => {
  await openAt(page, CLOSED);
  await expect(titles(page).last()).toHaveText("Hampers Natal");
  const closed = card(page, "Hampers Natal");
  await expect(closed.getByText("Order sudah ditutup", { exact: true })).toBeVisible();
  await expect(thumb(page, "Hampers Natal")).toHaveCSS("opacity", "0.5");
  // The thumbnail is the only button left: the closed note is text.
  await expect(closed.getByRole("button")).toHaveCount(1);
  await expect(closed.getByText("+ Tambah ke keranjang")).toHaveCount(0);

  const open = card(page, "Bolu Gulung");
  await expect(open.getByRole("button", { name: "+ Tambah ke keranjang", exact: true })).toBeVisible();
  await expect(open.getByText("Order sudah ditutup")).toHaveCount(0);
  await expect(thumb(page, "Bolu Gulung")).toHaveCSS("opacity", "1");
});

test("on the deadline day at 23:59 WIB the product is still open (FR5, inclusive)", async ({ page }) => {
  await openAt(page, LAST_MINUTE);
  const item = card(page, "Hampers Natal");
  await expect(item.getByRole("button", { name: "+ Tambah ke keranjang", exact: true })).toBeVisible();
  await expect(item.getByText("Order sudah ditutup")).toHaveCount(0);
  await expect(thumb(page, "Hampers Natal")).toHaveCSS("opacity", "1");
});

test("a page left open past the deadline closes the product when the tab is visible again (BSA-M1.3-02)", async ({ page }) => {
  await openAt(page, LAST_MINUTE);
  const item = card(page, "Hampers Natal");
  await expect(item.getByRole("button", { name: "+ Tambah ke keranjang", exact: true })).toBeVisible();
  await expect(promo(page)).toContainText("Hampers Natal");

  // No reload: the clock passes WIB midnight and the visitor comes back to the tab.
  await page.clock.setFixedTime(new Date(AFTER_MIDNIGHT));
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(item.getByText("Order sudah ditutup", { exact: true })).toBeVisible();
  await expect(item.getByText("+ Tambah ke keranjang")).toHaveCount(0);
  await expect(titles(page).last()).toHaveText("Hampers Natal");
  await expect(promo(page)).toContainText("Bolu Gulung");
});

test.describe("a device in another time zone", () => {
  // 00:30 WIB on the 11th is 12:30 on the 10th in New York, and 17:30 on the 10th in UTC.
  test.use({ timezoneId: "America/New_York" });

  test("the date is the WIB date: closed at 00:30 WIB after the deadline, open at 23:59 WIB", async ({ page }) => {
    await openAt(page, AFTER_MIDNIGHT);
    await expect(card(page, "Hampers Natal").getByText("Order sudah ditutup", { exact: true })).toBeVisible();
    await openAt(page, LAST_MINUTE);
    await expect(card(page, "Hampers Natal").getByRole("button", { name: "+ Tambah ke keranjang", exact: true })).toBeVisible();
  });
});

test("with an open pre-order: the notice bar phrase, and the promo card with the nearest deadline (FR1)", async ({ page }) => {
  await openAt(page, OPEN);
  await expect(notice(page)).toHaveText("Open pre-order · Pengantaran tersedia untuk area Solo & sekitarnya");
  const phrase = notice(page).locator("strong");
  await expect(phrase).toHaveText("Open pre-order");
  await expect(phrase).toHaveCSS("color", await token(page, "--butter"));
  await expect(phrase).toHaveCSS("font-weight", "600");
  await expect(promo(page)).toBeVisible();
  await expect(promo(page)).toContainText("Hampers Natal");
});

test("after that deadline the promo card names the first open pre-order without a deadline", async ({ page }) => {
  await openAt(page, CLOSED);
  await expect(promo(page)).toContainText("Bolu Gulung");
  await expect(promo(page)).not.toContainText("Hampers Natal");
  await expect(notice(page).locator("strong")).toHaveText("Open pre-order");
});

test("the promo card overlaps the hero card, floats, and holds a 52px thumbnail (design.md §6 Hero)", async ({ page }) => {
  await openAt(page, OPEN);
  await expect(promo(page)).toHaveCSS("position", "absolute");
  await expect(promo(page)).toHaveCSS("box-shadow", /rgba\(14, 26, 51, 0\.35\)/);
  const box = await promo(page).locator("img").locator("..").boundingBox();
  expect([box!.width, box!.height]).toEqual([52, 52]);
  await expect(promo(page).locator("img")).toHaveAttribute("aria-hidden", "true");
});

// Server and browser dates differ in both runs; in one of them (whatever the real date) the rendered menu differs too.
for (const [label, time] of [
  ["30 days after the build date", () => new Date(Date.now() + 30 * 86_400_000)],
  ["2026-11-20", () => new Date(OPEN)],
] as const) {
  test(`no page error and no hydration warning with the browser date at ${label} (D22)`, async ({ page }) => {
    const problems: string[] = [];
    page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() === "error" || m.type() === "warning") problems.push(`${m.type()}: ${m.text()}`);
    });
    await openAt(page, time());
    await expect(titles(page)).toHaveCount(NAMES.length);
    expect(problems).toEqual([]);
  });
}

test("placeholder tones follow butter, pink, sky, mint by position; the mark is 40% wide and aria-hidden", async ({ page }) => {
  await openAt(page, OPEN);
  const thumbs = await page.evaluate(() => {
    const probe = document.createElement("i");
    document.body.append(probe);
    const tones = new Map(
      ["butter", "pink", "sky", "mint"].map((tone) => {
        probe.style.background = `var(--${tone})`;
        return [getComputedStyle(probe).backgroundColor, tone];
      }),
    );
    probe.remove();
    return [...document.querySelectorAll('#menu button[aria-label^="Lihat detail"]')].map((button) => {
      const fill = button.firstElementChild!;
      const mark = fill.querySelector("img")!;
      return {
        tone: tones.get(getComputedStyle(fill).backgroundColor),
        markHidden: mark.getAttribute("aria-hidden"),
        markAlt: mark.getAttribute("alt"),
        markShare: Math.round((mark.getBoundingClientRect().width / button.getBoundingClientRect().width) * 100),
        ratio: Math.round((button.getBoundingClientRect().width / button.getBoundingClientRect().height) * 100),
      };
    });
  });
  expect(thumbs.map((t) => t.tone)).toEqual(["butter", "pink", "sky", "mint", "butter", "pink", "sky"]);
  for (const t of thumbs) {
    expect(t).toMatchObject({ markHidden: "true", markAlt: "", markShare: 40, ratio: 80 });
  }
});

test("every thumbnail button is named Lihat detail {name}", async ({ page }) => {
  await openAt(page, OPEN);
  for (const name of NAMES) await expect(thumb(page, name)).toHaveCount(1);
  await expect(page.locator("#menu").getByRole("button", { name: /^Lihat detail / })).toHaveCount(NAMES.length);
});

test("the grid has 3, 2 and 1 columns, and nothing scrolls sideways (design.md §4)", async ({ page }) => {
  await openAt(page, OPEN);
  for (const [width, columns] of [
    [1280, 3],
    [961, 3],
    [960, 2],
    [641, 2],
    [640, 1],
    [360, 1],
  ]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator("#menu ul").evaluate((grid) => {
      const style = getComputedStyle(grid);
      const root = document.documentElement;
      return {
        columns: style.gridTemplateColumns.split(" ").length,
        gap: `${style.rowGap} ${style.columnGap}`,
        overflow: root.scrollWidth - root.clientWidth,
      };
    });
    expect(layout, `${width}px`).toEqual({ columns, gap: "40px 28px", overflow: 0 });
  }
});

test("chips are 38px with a 44px hit area; the add button is 40px with a 44px hit area (design.md §5, §6)", async ({ page }) => {
  await openAt(page, OPEN);
  const hit = (el: Element) => {
    // Centered, so the sticky nav never covers the probe points.
    el.scrollIntoView({ block: "center" });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    return {
      height: r.height,
      above: document.elementFromPoint(x, r.top - 1.5) === el,
      below: document.elementFromPoint(x, r.bottom + 1.5) === el,
    };
  };
  expect(await chip(page, "Ready stock").evaluate(hit)).toEqual({ height: 38, above: true, below: true });
  const add = card(page, "Bolu Gulung").getByRole("button", { name: "+ Tambah ke keranjang", exact: true });
  expect(await add.evaluate(hit)).toEqual({ height: 40, above: true, below: true });
});
