import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: "e2e",
  use: { baseURL },
  projects: [
    { name: "mobile-360", use: { ...devices["Desktop Chrome"], viewport: { width: 360, height: 800 } } },
    { name: "desktop", use: { ...devices["Desktop Chrome"] } },
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
