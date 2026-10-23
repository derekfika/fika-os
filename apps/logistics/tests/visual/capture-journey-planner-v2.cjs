// Renders the Journey Planner V3 preview route with Playwright for visual review. Not a pass/fail test.
const { chromium } = require("@playwright/test");
const path = require("node:path");
const fs = require("node:fs");
const base = process.env.PREVIEW_BASE || "http://localhost:3900";
const out = process.env.SHOT_DIR || path.join(__dirname, "..", "..", "test-results", "jp-v2");
fs.mkdirSync(out, { recursive: true });
const shots = [
  ["full-1536", 1536, 960, "full-day", "fx-run-1"],
  ["full-1920", 1920, 1080, "full-day", "fx-run-1"],
  ["full-1280-inspector", 1280, 800, "full-day", "fx-run-1"],
  ["full-1440", 1440, 900, "full-day", "fx-run-1"],
  ["full-1366", 1366, 768, "full-day", "fx-run-2"],
  ["queue7", 1536, 960, "queue-7"],
  ["two-vans", 1536, 960, "two-vans"],
  ["mixed-stop", 1536, 960, "mixed-stop", "fx-run-1", "fx-visit-2"],
  ["expanded-chips", 1920, 1080, "full-day", "fx-run-2", "fx-visit-2"],
  ["standalone-collection", 1536, 960, "standalone-collection"],
  ["draft", 1536, 960, "draft-run", "fx-run-1"],
  ["long-name", 1536, 960, "long-name", "fx-run-1"],
  ["busy", 1536, 960, "busy"],
  ["empty", 1536, 960, "empty"],
  ["loading", 1536, 960, "loading"],
  ["error", 1536, 960, "error"],
];
(async () => {
  const browser = await chromium.launch();
  for (const [name, w, h, scenario, run, expand] of shots) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.goto(`${base}/mock/journey-planner-v2?scenario=${scenario}&chrome=0${run ? `&run=${run}` : ""}${expand ? `&expand=${expand}` : ""}`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    await page.screenshot({ path: path.join(out, `${name}.png`) });
    await page.close();
  }
  await browser.close();
  console.log("captured to", out);
})();
