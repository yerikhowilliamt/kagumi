import { expect, test } from "@playwright/test";

const WHATSAPP = "https://wa.me/6285159545168";
// The development seed (P15 plus the D7 fixtures), in sortOrder.
const SEED_NAMES = [
  "Bolu Gulung",
  "Fudgy Brownies",
  "Brownies Custom",
  "Soft Cookies",
  "Buko Mangga",
  "Donut",
  "Hampers Natal",
  "Nastar",
  "Kastengel",
];

test.beforeEach(async ({ page }) => {
  await page.goto("/");
});

test("notice bar shows the delivery text", async ({ page }) => {
  await expect(page.getByText("Pengantaran tersedia untuk area Solo & sekitarnya")).toBeVisible();
});

test("nav links point to sections that exist", async ({ page }) => {
  // Not by role: the text links are hidden at 360 px.
  const nav = page.locator('nav[aria-label="Navigasi utama"]');
  for (const [text, id] of [
    ["Menu", "menu"],
    ["Cara Pesan", "cara-pesan"],
    ["Kontak", "kontak"],
  ]) {
    await expect(nav.locator("a", { hasText: new RegExp(`^${text}$`) })).toHaveAttribute("href", `#${id}`);
    await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
});

test("one h1", async ({ page }) => {
  await expect(page.locator("h1")).toHaveCount(1);
});

test("every WhatsApp link is the plain shop link", async ({ page }) => {
  const links = page.locator('a[href*="wa.me"], a[href*="whatsapp"]');
  // Nav, hero, CTA band, footer.
  await expect(links).toHaveCount(4);
  const hrefs = await links.evaluateAll((all) => all.map((a) => a.getAttribute("href")));
  expect(hrefs).toEqual([WHATSAPP, WHATSAPP, WHATSAPP, WHATSAPP]);
  // Same tab (M1.2 decision #8).
  expect(await links.evaluateAll((all) => all.map((a) => a.getAttribute("target")))).toEqual([null, null, null, null]);
  await expect(page.getByRole("link", { name: "Pesan via WhatsApp" })).toHaveAttribute("href", WHATSAPP);
});

test("Instagram link", async ({ page }) => {
  const link = page.getByRole("link", { name: /Instagram/ });
  await expect(link).toHaveAttribute("href", "https://www.instagram.com/kagumidough/");
  await expect(link).toHaveAttribute("rel", "noopener");
  await expect(link).toHaveAttribute("target", "_blank");
});

test("three steps, footer Kontak and Lokasi", async ({ page }) => {
  await expect(page.locator("#cara-pesan").getByRole("listitem")).toHaveCount(3);
  const footer = page.locator("footer#kontak");
  // h2 in the eyebrow style (M1.2 decision #10).
  await expect(footer.getByRole("heading", { name: "Kontak", exact: true, level: 2 })).toBeVisible();
  await expect(footer.getByRole("heading", { name: "Lokasi", exact: true, level: 2 })).toBeVisible();
});

test("an anchor target lands 84px below the top, without smooth scrolling (M1.2 decision #5)", async ({ page }) => {
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).scrollBehavior)).toBe("auto");
  await page.getByRole("link", { name: "Lihat Menu" }).click();
  await expect.poll(() => page.locator("#menu").evaluate((el) => Math.round(el.getBoundingClientRect().top))).toBe(84);
});

test("the nav stays one row without horizontal scroll at every breakpoint edge (design.md §4)", async ({ page }) => {
  // 360px is the minimum width (PRD, Mobile first).
  for (const width of [360, 640, 641, 760, 960, 961, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    const layout = await page.locator("header").evaluate((header) => {
      const wrapped: string[] = [];
      const walker = document.createTreeWalker(header, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top)));
        if (lines.size > 1) wrapped.push(node.textContent!.trim());
      }
      const root = document.documentElement;
      return { wrapped, overflow: root.scrollWidth - root.clientWidth };
    });
    expect(layout, `${width}px`).toEqual({ wrapped: [], overflow: 0 });
  }
  // M1.2 decision #9.
  await page.setViewportSize({ width: 360, height: 800 });
  await expect(page.locator('nav[aria-label="Navigasi utama"]')).toHaveCSS("column-gap", "8px");
});

test("marquee lists the active product names in sortOrder, twice, and is aria-hidden", async ({ page }) => {
  const marquee = page.getByTestId("marquee");
  await expect(marquee).toHaveAttribute("aria-hidden", "true");
  expect(await marquee.locator("span").allTextContents()).toEqual([...SEED_NAMES, ...SEED_NAMES]);
});

test("marquee separators have the same colors in both copies, so the loop has no seam", async ({ page }) => {
  const colors = await page
    .getByTestId("marquee")
    .locator("span")
    .evaluateAll((spans) => spans.map((s) => getComputedStyle(s, "::after").backgroundColor));
  expect(colors.slice(SEED_NAMES.length)).toEqual(colors.slice(0, SEED_NAMES.length));
  expect(new Set(colors).size).toBe(3);
});

test("keyboard focus on the hero Primary button shows a 2px --link outline", async ({ page }) => {
  const primary = page.getByRole("link", { name: "Lihat Menu" });
  for (let i = 0; i < 15 && !(await primary.evaluate((el) => el === document.activeElement)); i++) {
    await page.keyboard.press("Tab");
  }
  await expect(primary).toBeFocused();
  const outline = await primary.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--link)";
    document.body.append(probe);
    const link = getComputedStyle(probe).color;
    probe.remove();
    const style = getComputedStyle(el);
    return { width: style.outlineWidth, style: style.outlineStyle, isLink: style.outlineColor === link };
  });
  expect(outline).toEqual({ width: "2px", style: "solid", isLink: true });
});

test("the hero Primary button has a transition, and none with reduced motion", async ({ page }) => {
  const duration = () =>
    page.getByRole("link", { name: "Lihat Menu" }).evaluate((el) => getComputedStyle(el).transitionDuration);
  expect(await duration()).not.toBe("0s");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await duration()).toBe("0s");
});

test("reduced motion stops every animation, including pseudo-elements (design.md §4 Motion)", async ({ page }) => {
  const animated = () =>
    page.evaluate(() =>
      [...document.querySelectorAll("*")].flatMap((el) =>
        [null, "::before", "::after"]
          .filter((pseudo) => getComputedStyle(el, pseudo).animationName !== "none")
          .map((pseudo) => `${el.tagName}${pseudo ?? ""}`),
      ),
    );
  expect((await animated()).length).toBeGreaterThan(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(await animated()).toEqual([]);
});

test("the 42px nav button has a 44px hit area (design.md §5)", async ({ page }) => {
  const hit = await page.getByRole("link", { name: "Pesan via WhatsApp" }).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2;
    return {
      height: r.height,
      above: document.elementFromPoint(x, r.top - 0.5) === el,
      below: document.elementFromPoint(x, r.bottom + 0.5) === el,
    };
  });
  expect(hit).toEqual({ height: 42, above: true, below: true });
});
