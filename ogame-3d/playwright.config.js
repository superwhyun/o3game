import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./test",
  testMatch: ["fleet-ui.spec.js", "scout-ui.spec.js"],
  workers: 1,
  timeout: 90000,
  use: {
    baseURL: process.env.FLEET_UI_BASE_URL || "http://localhost:5179",
    channel: "chrome",
    headless: true,
    screenshot: "only-on-failure",
    actionTimeout: 15000,
    viewport: { width: 1440, height: 1000 },
  },
  outputDir: "../artifacts/fleet-ui/test-results",
  reporter: "list",
});
