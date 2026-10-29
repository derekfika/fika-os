import { defineConfig } from "@playwright/test";

const baseURL = process.env.MENU_E2E_BASE_URL;
if (!baseURL || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(baseURL).hostname)) throw Error("MENU_E2E_BASE_URL must point to the isolated local Menu server.");

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.MENU_E2E_OUTPUT_DIR || ".next/playwright",
  workers: 1,
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL, viewport: { width: 1536, height: 960 }, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
