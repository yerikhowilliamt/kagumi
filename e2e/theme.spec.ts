import { expect, test, type Page } from "@playwright/test";

// --bg from design.md §2.2 (tests/tokens.test.ts ties these to the spec).
const BG = { light: "#faf8f3", dark: "#0b1220" } as const;
const toggleName = "Ganti tema terang/gelap";

const store = (page: Page, theme: string) =>
  page.addInitScript((t) => window.localStorage.setItem("kagumi-theme", t), theme);

// exact: Playwright's default name match is a case-insensitive substring.
const toggle = (page: Page) => page.getByRole("button", { name: toggleName, exact: true });

// The icon of `theme` is visible and the other one hidden.
async function expectIcon(page: Page, theme: "light" | "dark") {
  const [shown, hidden] = theme === "light" ? ["sun", "moon"] : ["moon", "sun"];
  await expect(toggle(page).locator(`[data-icon="${shown}"]`)).toBeVisible();
  await expect(toggle(page).locator(`[data-icon="${hidden}"]`)).toBeHidden();
}

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
    await expectIcon(page, stored);
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

// Task note 5: data-theme is set only for "light" or "dark".
for (const value of ["blue", "DARK"]) {
  test(`stored "${value}" is ignored: follows OS dark`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await store(page, value);
    await page.goto("/");
    expect(await dataTheme(page)).toBeNull();
    expect(await bg(page)).toBe(BG.dark);
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

  await toggle(page).click();
  expect(await dataTheme(page)).toBe("light");
  expect(await bg(page)).toBe(BG.light);
  expect(errors).toEqual([]);
});

test("toggle: icon, label, keyboard, flips, stores, survives reload", async ({ page }) => {
  const errors = collectPageErrors(page);
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  await expect(toggle(page)).toHaveAttribute("aria-label", toggleName);
  await expectIcon(page, "light");

  // The toggle is the only focusable element, so one Tab reaches it.
  await page.keyboard.press("Tab");
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Enter");
  expect(await dataTheme(page)).toBe("dark");
  expect(await page.evaluate(() => localStorage.getItem("kagumi-theme"))).toBe("dark");
  await expectIcon(page, "dark");

  await page.reload();
  expect(await dataTheme(page)).toBe("dark");
  await expectIcon(page, "dark");
  expect(await bg(page)).toBe(BG.dark);

  await page.keyboard.press("Tab");
  await expect(toggle(page)).toBeFocused();
  await page.keyboard.press("Space");
  expect(await dataTheme(page)).toBe("light");
  expect(await page.evaluate(() => localStorage.getItem("kagumi-theme"))).toBe("light");
  await expectIcon(page, "light");
  expect(errors).toEqual([]);
});

test("toggle from OS dark with nothing stored switches to light", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/");
  await expectIcon(page, "dark");
  await toggle(page).click();
  expect(await dataTheme(page)).toBe("light");
  expect(await bg(page)).toBe(BG.light);
  await expectIcon(page, "light");
});

test("reduced motion: the toggle has no transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  expect(await toggle(page).evaluate((el) => getComputedStyle(el).transitionDuration)).toBe("0s");
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

test("fonts: weights, display swap and system-ui fallback (task note 4)", async ({ page }) => {
  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() =>
    ["--head", "--body"].map((variable) => {
      const stack = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
      const family = stack.split(",")[0].replace(/"/g, "");
      const faces = [...document.fonts].filter((f) => f.family.replace(/"/g, "") === family);
      return {
        stack,
        weights: [...new Set(faces.map((f) => f.weight))].sort(),
        displays: [...new Set(faces.map((f) => f.display))],
      };
    }),
  );
  const [head, body] = fonts;
  expect(head.weights).toEqual(["500", "600"]);
  expect(body.weights).toEqual(["400", "500", "600"]);
  for (const font of fonts) {
    expect(font.stack).toMatch(/, system-ui, sans-serif$/);
    expect(font.displays).toEqual(["swap"]);
  }
});
