import { test, expect } from "@playwright/test";
import { cleanupE2EData, E2E_DATE, E2E_PREFIX, ensureLogisticsIsRunning, seededRun, seededStop } from "./fixtures";
import { saveRun, saveStop } from "../../lib/store";

test.describe.serial("Logistics mobile driver workflow", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupE2EData();
    await ensureLogisticsIsRunning(page);
  });

  test.afterEach(async () => {
    await cleanupE2EData();
  });

  test("filters by driver, starts a ready run, and exposes large execution actions", async ({ page }) => {
    const franco = seededRun("franco", "Franco", "ready");
    const dee = seededRun("dee", "Dee", "ready");
    const stop = seededStop(franco.canonicalId, "franco-stop");
    franco.orderedStopIds = [stop.canonicalId];
    await saveRun(franco);
    await saveRun(dee);
    await saveStop(stop);

    await page.goto("/mobile?run=" + encodeURIComponent(franco.canonicalId));
    await expect(page.getByRole("heading", { name: "My runs" })).toBeVisible();
    await expect(page.getByText("E2E destination")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start run" })).toBeVisible();
    await expect(page.getByText(dee.canonicalId)).toHaveCount(0);
    await page.getByRole("button", { name: "Start run" }).click();
    await expect(page.getByText("Next stop")).toBeVisible();
    await expect(page.getByRole("button", { name: "Arrived" })).toBeVisible();
    const touchTarget = await page.getByRole("button", { name: "Arrived" }).evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).minHeight),
    );
    expect(touchTarget).toBeGreaterThanOrEqual(48);
  });

  test("does not expose another driver's run through the run query parameter", async ({ page }) => {
    const dee = seededRun("dee-only", "Dee", "dispatched");
    await saveRun(dee);
    await page.goto("/mobile?run=" + encodeURIComponent(dee.canonicalId));
    await expect(page.getByText(/belongs to another driver|No matching run/)).toBeVisible();
    await expect(page.getByText(E2E_PREFIX + "dee-only")).toHaveCount(0);
  });

  test("completes the final stop and shows a completed run", async ({ page }) => {
    const run = seededRun("complete", "Franco", "dispatched");
    const stop = seededStop(run.canonicalId, "complete-stop");
    run.orderedStopIds = [stop.canonicalId];
    await saveRun(run);
    await saveStop(stop);

    await page.goto("/mobile?run=" + encodeURIComponent(run.canonicalId));
    await page.getByRole("button", { name: "Arrived" }).click();
    await page.getByRole("button", { name: "Complete stop" }).click();
    await expect(page.getByRole("heading", { name: "Run complete" })).toBeVisible();
  });
});
