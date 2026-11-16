import { expect, test, type Page } from "@playwright/test";

// --bg from design.md §2.2 (tests/tokens.test.ts ties these to the spec).
const BG = { light: "#faf8f3", dark: "#0b1220" } as const;
const toggleName = "Ganti tema terang/gelap";

const store = (page: Page, theme: string) =>
  page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);

const dataTheme = (page: Page) => page.locator("html").getAttribute("data-theme");
const bg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--bg").trim());

function collectPageErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

for (const [os, stored] of [
  ["light", "dark"],
  ["dark", "light"],
] as const) {
  test(`no flash: OS ${os}, stored ${stored} is applied before <body> exists`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os });
    await store(page, stored);
    // Record data-theme at the moment <body> is inserted.
    await page.addInitScript(() => {
      const w = window as unknown as { __themeAtBody?: string | null };
      new MutationObserver((_, observer) => {
        if (document.body) {
          w.__themeAtBody = document.documentElement.getAttribute("data-theme");
          observer.disconnect();
        }
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto("/");
    const atBody = await page.evaluate(() => (window as unknown as { __themeAtBody?: string | null }).__themeAtBody);
    expect(atBody).toBe(stored);
    expect(await bg(page)).toBe(BG[stored]);
  });
}

for (const os of ["light", "dark"] as const) {
  test(`nothing stored: follows OS ${os}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os });
    await page.goto("/");
    expect(await dataTheme(page)).toBeNull();
    expect(await bg(page)).toBe(BG[os]);
  });
}

test("localStorage throwing: page renders, follows OS, toggle works, no page error", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.emulateMedia({ colorScheme: "dark" });
  await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("blocked", "SecurityError");
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  expect(await dataTheme(page)).toBeNull();
  expect(await bg(page)).toBe(BG.dark);

  await page.getByRole("button", { name: toggleName }).click();
  expect(await dataTheme(page)).toBe("light");
  expect(await bg(page)).toBe(BG.light);
  expect(errors).toEqual([]);
});

test("toggle: icon, keyboard, flips, stores, survives reload", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: toggleName });
  const sun = toggle.locator('[data-icon="sun"]');
  const moon = toggle.locator('[data-icon="moon"]');
  await expect(sun).toBeVisible();
  await expect(moon).toBeHidden();

  // The toggle is the only focusable element, so one Tab reaches it.
  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await dataTheme(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("kagumi-theme"))).toBe("dark");
  await expect(moon).toBeVisible();
  await expect(sun).toBeHidden();

  await page.reload();
  expect(await dataTheme(page)).toBe("dark");
  await expect(moon).toBeVisible();
  expect(await bg(page)).toBe(BG.dark);

  await page.keyboard.press("Tab");
  await expect(toggle).toBeFocused();
  await page.keyboard.press("Space");
  expect(await dataTheme(page)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("kagumi-theme"))).toBe("light");
  await expect(sun).toBeVisible();
  expect(errors).toEqual([]);
});

test("toggle from OS dark with nothing stored switches to light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  const toggle = page.getByRole("button", { name: toggleName });
  await expect(toggle.locator('[data-icon="moon"]')).toBeVisible();
  await toggle.click();
  expect(await dataTheme(page)).toBe("light");
  expect(await bg(page)).toBe(BG.light);
});

for (const theme of ["light", "dark"] as const) {
  test(`no horizontal scroll in ${theme}`, async ({ page }) => {
    await store(page, theme);
    await page.goto("/");
    expect(await dataTheme(page)).toBe(theme);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test("fonts are self-hosted: no request to Fontshare or Google Fonts", async ({ page, baseURL }) => {
  const hosts: string[] = [];
  page.on("request", (r) => hosts.push(new URL(r.url()).hostname));
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);

  const fontOrigins = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .filter((e) => /\.woff2(\?|$)/.test(e.name))
      .map((e) => new URL(e.name).origin),
  );
  expect(fontOrigins.length).toBeGreaterThanOrEqual(2);
  expect(new Set(fontOrigins)).toEqual(new Set([new URL(baseURL!).origin]));
  expect(hosts.filter((h) => /(^|\.)(fontshare\.com|fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(h))).toEqual([]);
});
