import { test } from "@playwright/test";
import path from "node:path";
import { assignedSeed, boot, DATE } from "./v3-helpers";

/** Review screenshots of the mounted real planner (V3). Runs only when SHOT_DIR is set; not a pass/fail test. */
const out = process.env.SHOT_DIR;
const shots = [
  { name: "live-1536x960-inspector", width: 1536, height: 960, run: true },
  { name: "live-1920x1080-inspector", width: 1920, height: 1080, run: true },
  { name: "live-1280x800-inspector", width: 1280, height: 800, run: true },
  { name: "live-1280x800-queue-peek", width: 1280, height: 800, run: true, peek: true },
  { name: "live-1536x960-no-inspector", width: 1536, height: 960, run: false },
  { name: "live-1366x768-inspector", width: 1366, height: 768, run: true },
];
for (const shot of shots) {
  test(`capture ${shot.name}`, async ({ page }) => {
    test.skip(!out, "SHOT_DIR not set");
    await page.setViewportSize({ width: shot.width, height: shot.height });
    await boot(page, assignedSeed());
    if (shot.run) { await page.locator(`[data-run-bar="run:${DATE}:a"]`).click(); await page.getByRole("button", { name: "Expand Studio Café" }).click(); }
    if (shot.peek) await page.getByRole("button", { name: "Expand unassigned work" }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(out!, `${shot.name}.png`) });
  });
}
