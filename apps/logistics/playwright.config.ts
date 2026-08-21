import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: process.env.CI ? "line" : "list",
  use: {
    baseURL: process.env.LOGISTICS_E2E_BASE_URL || "http://localhost:3900",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "golden-week", use: { ...devices["Desktop Chrome"] }, testMatch: /golden-week\.spec\.ts/ },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /desktop\.spec\.ts/ },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
