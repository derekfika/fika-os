import { test, expect } from "@playwright/test";
import { cleanupE2EData, E2E_DATE, E2E_PREFIX, ensureLogisticsIsRunning, seededRun, seededStop } from "./fixtures";
import { saveRun, saveStop } from "../../lib/store";
import { rebuildLogisticsProjection } from "../../lib/logistics-materialisation";

async function materialiseDateProjection() {
  const projection = await rebuildLogisticsProjection(E2E_DATE, "e2e");
  expect(projection.serviceDate).toBe(E2E_DATE);
}

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
    await materialiseDateProjection();

    await page.goto(`/mobile?serviceDate=${E2E_DATE}&run=${encodeURIComponent(franco.canonicalId)}`);
    await expect(page.getByRole("heading", { name: "Deliveries" })).toBeVisible();
    await expect(page.getByText("E2E destination").first()).toBeVisible();
    await page.getByRole("button", { name: "Open details for E2E destination" }).click();
    const stopDetails = page.getByRole("dialog");
    await stopDetails.getByRole("button", { name: "Mark all loaded" }).click();
    await expect(page.getByRole("button", { name: "Dispatch vehicle" })).toBeVisible();
    await expect(page.getByText(dee.canonicalId)).toHaveCount(0);
    await page.getByRole("button", { name: "Dispatch vehicle" }).click();
    const stopCard = page.getByRole("button", { name: "Open details for E2E destination" });
    await stopCard.click();
    const arrivalButton = page.getByRole("dialog").getByRole("button", { name: "Mark arrived" });
    await expect(arrivalButton).toBeVisible();
    const touchTarget = await arrivalButton.evaluate((element) =>
      Number.parseFloat(getComputedStyle(element).minHeight),
    );
    expect(touchTarget).toBeGreaterThanOrEqual(48);
  });

  test("fixed vehicle cannot open another vehicle's run through the run query parameter", async ({ page }) => {
    const dee = seededRun("dee-only", "Dee", "dispatched");
    dee.vehicleId = "van2";
    await saveRun(dee);
    await materialiseDateProjection();
    await page.goto(`/mobile/van1?serviceDate=${E2E_DATE}&run=${encodeURIComponent(dee.canonicalId)}`);
    await expect(page.getByLabel("Run", { exact: true })).toHaveValue("");
    await expect(page.getByText(E2E_PREFIX + "dee-only")).toHaveCount(0);
  });

  test("completes the final stop and confirms the mandatory CPU return", async ({ page }) => {
    const run = seededRun("complete", "Franco", "dispatched");
    const stop = seededStop(run.canonicalId, "complete-stop");
    stop.loaded = true;
    run.orderedStopIds = [stop.canonicalId];
    await saveRun(run);
    await saveStop(stop);
    await materialiseDateProjection();

    await page.goto(`/mobile?serviceDate=${E2E_DATE}&run=${encodeURIComponent(run.canonicalId)}`);
    const stopRow = page.getByRole("button", { name: "Open details for E2E destination" });
    await stopRow.click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark arrived" }).click();
    const updatedStop = page.getByRole("button", { name: "Open details for E2E destination" });
    await updatedStop.click();
    await page.getByRole("dialog").getByRole("button", { name: "Mark delivered" }).click();
    await expect(page.getByText("ALL STOPS COMPLETE")).toBeVisible();
    await expect(page.getByText("Return to CPU", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Confirm returned to CPU" }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get(`/api/logistics?serviceDate=${E2E_DATE}`)).json();
      const savedStop = state.stops.find((candidate: { canonicalId: string }) => candidate.canonicalId === stop.canonicalId);
      const savedRun = state.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === run.canonicalId);
      return { stopStatus: savedStop?.status, runStatus: savedRun?.status, returnToCpuPending: savedRun?.returnToCpuPending, returnedToCpuAt: Boolean(savedRun?.returnedToCpuAt) };
    }).toEqual({ stopStatus: "completed", runStatus: "completed", returnToCpuPending: false, returnedToCpuAt: true });
  });
});
