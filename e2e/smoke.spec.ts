import { expect, test } from "@playwright/test";

test("home page serves the storefront with metadata and icons", async ({ page, request }) => {
  const response = await page.goto("/");
  expect(response?.status()).toBe(200);

  await expect(page.locator("html")).toHaveAttribute("lang", "id");
  await expect(page.locator("h1")).toHaveCount(1);
  await expect(page).toHaveTitle("Kagumi Dough");

  for (const rel of ["icon", "apple-touch-icon"]) {
    const links = page.locator(`link[rel="${rel}"]`);
    await expect(links).toHaveCount(1);
    const href = await links.getAttribute("href");
    expect(href, `${rel} href`).toBeTruthy();
    const icon = await request.get(href!);
    expect(icon.status(), `${rel} status`).toBe(200);
  }
});
