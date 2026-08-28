import { defineConfig, devices } from "@playwright/test";

// End-to-end tests run against the Vite dev server. Auth is seeded directly
// into localStorage (see e2e/helpers.js) so tests don't depend on Google OAuth.
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "list" : "html",
  use: {
    baseURL: "http://localhost:8080",
    trace: "on-first-retry",
  },
  // Use the system-installed Google Chrome (channel: "chrome") so runs don't
  // depend on Playwright's bundled Chromium download. In CI, install the browser
  // with `npx playwright install --with-deps chromium` and drop the channel.
  projects: [
    { name: "chrome", use: { ...devices["Desktop Chrome"], channel: "chrome" } },
  ],
  webServer: {
    command: "npm run dev",
    url: "http://localhost:8080",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
