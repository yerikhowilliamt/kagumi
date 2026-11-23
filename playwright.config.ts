import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const PRODUCT_SPECS = ["**/admin-products.spec.ts", "**/admin-media.spec.ts"];
const mobile = { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } };
const desktop = { ...devices["Desktop Chrome"] };

export default defineConfig({
  testDir: "e2e",
  // M2 plan D14: resets the e2e admin accounts; does nothing when PLAYWRIGHT_BASE_URL is set.
  globalSetup: "./e2e/global-setup.ts",
  use: { baseURL },
  // M3 plan D5, D24: the product specs create visible products, while the storefront specs expect exactly the seed.
  // So they run in their own projects, which start only after both existing projects have finished.
  projects: [
    { name: "mobile-360", testIgnore: PRODUCT_SPECS, use: mobile },
    { name: "desktop", testIgnore: PRODUCT_SPECS, use: desktop },
    { name: "products-360", testMatch: PRODUCT_SPECS, dependencies: ["mobile-360", "desktop"], use: mobile },
    { name: "products-desktop", testMatch: PRODUCT_SPECS, dependencies: ["mobile-360", "desktop"], use: desktop },
  ],
  // No local server when testing a deployed URL.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        // Poll a static route, so an error on the page under test fails its test instead of the startup.
        url: `${baseURL}/icon.png`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
