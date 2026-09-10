import { defineConfig } from "@playwright/test";
export default defineConfig({
  globalSetup: "./tests/ui-setup.ts",
  testDir: "./tests",
  testMatch: "ui.spec.ts",
  workers: 1,
  timeout: 30000,
  use: {
    storageState: ".playwright/auth.json",
    extraHTTPHeaders: { Origin: "http://localhost:4310" },
    baseURL: "http://localhost:4310",
    browserName: "chromium",
    headless: true,
    viewport: { width: 1440, height: 960 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  reporter: "list",
});
