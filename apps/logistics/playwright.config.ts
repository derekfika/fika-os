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
    { name: "batch2-load-integrity-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /load-integrity\.spec\.ts/ },
    { name: "batch1-authority-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /authority-drivers\.spec\.ts/ },
    { name: "golden-week", use: { ...devices["Desktop Chrome"] }, testMatch: /golden-week\.spec\.ts/ },
    { name: "desktop-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /desktop\.spec\.ts/ },
    { name: "timeline-poc-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /timeline-poc\.spec\.ts/ },
    { name: "mounted-timeline-chromium", use: { ...devices["Desktop Chrome"] }, testMatch: /mounted-timeline\.spec\.ts/ },
    { name: "mobile-chromium", use: { ...devices["Pixel 7"] }, testMatch: /mobile\.spec\.ts/ },
  ],
});
