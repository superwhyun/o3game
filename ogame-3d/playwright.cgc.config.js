import { defineConfig } from "@playwright/test";
// Browser tests for the CGC wallet, shop, speed-up, emblems, monsters and debris.
// Needs the stack from server/scripts/e2eStack.js and `vite` on :5179 (see docs/cgc-development.md).
export default defineConfig({
  testDir: "./test",
  testMatch: ["cgc-ui.spec.js"],
  workers: 1,
  timeout: 180000,
  expect: { timeout: 20000 },
  use: {
    baseURL: process.env.CGC_UI_BASE_URL || "http://127.0.0.1:5179",
    headless: true,
    launchOptions: { executablePath: process.env.PW_CHROMIUM || undefined, args: ["--no-sandbox"] },
    screenshot: "only-on-failure",
    actionTimeout: 30000,
    viewport: { width: 1440, height: 1000 },
  },
  outputDir: "../artifacts/cgc-ui/test-results",
  reporter: "list",
});
