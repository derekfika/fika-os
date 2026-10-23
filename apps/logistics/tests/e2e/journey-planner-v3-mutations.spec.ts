import { expect, test } from "@playwright/test";
import { expectClean } from "./layout-audit";
import { assignedSeed, boot, centre, commandsOf, createRunViaDialog, DATE, drag, pxPerMinute, queueItem, runRow, v3Seed } from "./v3-helpers";

/**
 * Pending, confirmed, rejected, stale and uncertain states for Run timing and queue placement through the mounted V3 planner.
 * LOCAL FIXTURE tests (stateful fake of /api/logistics).
 */
test.describe("Journey Planner V3 · mutation states · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("a rejected timing change snaps the bar back to the confirmed time and says why", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    server.failNext({ action: "update-run-timing", status: 422, message: "Journey times cannot change after a run is marked ready or departs." });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const ppm = await pxPerMinute(page);
    const box = (await bar.boundingBox())!;
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60 * ppm, y: box.y + box.height / 2 });
    await expect(page.locator("[data-journey-planner] [role=alert]").filter({ hasText: "cannot change after a run is marked ready" })).toBeVisible();
    await expect(bar).toContainText("09:00 – 12:00");
    expect(server.run(run.id)!.dep).toBe("09:00");
  });

  test("a stale timing change is rejected, the latest run loads, and a retry succeeds without overwriting", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const ppm = await pxPerMinute(page);
    server.interfere(run.id);
    const box = (await bar.boundingBox())!;
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60 * ppm, y: box.y + box.height / 2 });
    const plannerConflict = page.locator("[data-journey-planner] [role=alert]").filter({ hasText: "changed elsewhere" });
    await expect(plannerConflict).toBeVisible();
    expect(server.run(run.id)!.dep).toBe("09:00");
    await expect(bar).toContainText("09:00 – 12:00");
    const retry = (await bar.boundingBox())!;
    await drag(page, { x: retry.x + retry.width / 2, y: retry.y + retry.height / 2 }, { x: retry.x + retry.width / 2 + 60 * ppm, y: retry.y + retry.height / 2 });
    await expect.poll(() => server.run(run.id)!.dep).toBe("10:00");
    await expect(bar).toContainText("10:00 – 13:00");
    await expect(plannerConflict).toHaveCount(0);
  });

  test("an uncertain timing change (connection lost) is not shown as saved; the confirmed time remains", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    server.failNext({ action: "update-run-timing", status: 0, message: "network" });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const ppm = await pxPerMinute(page);
    const box = (await bar.boundingBox())!;
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60 * ppm, y: box.y + box.height / 2 });
    const plannerAlert = page.locator("[data-journey-planner] [role=alert]");
    await expect(plannerAlert).toBeVisible();
    await expect(plannerAlert).toContainText("response could not be confirmed");
    await expect(bar).toContainText("09:00 – 12:00");
    expect(server.run(run.id)!.dep).toBe("09:00");
  });

  test("while a timing command is in flight the bar says Saving… and cannot be dragged again; then it shows the confirmed time", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    await page.route("**/api/logistics", async (route) => { if (route.request().method() === "POST" && route.request().postDataJSON()?.action === "update-run-timing") await gate; await route.fallback(); }, { times: 1 });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const ppm = await pxPerMinute(page);
    const box = (await bar.boundingBox())!;
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60 * ppm, y: box.y + box.height / 2 });
    await expect(runRow(page, run.id).getByText("Saving…").first()).toBeVisible();
    await expect(bar).toHaveAttribute("data-pending", "true");
    await expect(bar).toHaveAttribute("data-editable", "false");
    release();
    await expect(bar).toContainText("10:00 – 13:00");
    await expect(bar).not.toHaveAttribute("data-pending", "true");
  });

  test("a rejected queue placement leaves the job in the queue with the reason; a retry then succeeds", async ({ page }) => {
    const { server } = await boot(page);
    const run = server.state.runs[0];
    server.failNext({ action: "assign-job-to-load", status: 422, message: "Run is planned; return it to planning before changing assignments." });
    await drag(page, await centre(queueItem(page, "Studio Café")), await centre(runRow(page, run.id).locator("h3")));
    await expect(page.getByRole("status").filter({ hasText: "return it to planning" }).or(page.getByRole("alert").filter({ hasText: "return it to planning" })).first()).toBeVisible();
    await expect(queueItem(page, "Studio Café")).toBeVisible();
    expect(server.state.jobs.find((job) => job.id === "job:2")!.runId).toBeUndefined();
    await drag(page, await centre(queueItem(page, "Studio Café")), await centre(runRow(page, run.id).locator("h3")));
    await expect.poll(() => server.state.jobs.find((job) => job.id === "job:2")!.runId).toBe(run.id);
    await expect(runRow(page, run.id).getByRole("button", { name: /Studio Café/ })).toBeVisible();
  });

  test("an uncertain queue placement is reconciled against the server: no duplicate assignment and no lost job", async ({ page }) => {
    const { server } = await boot(page);
    const run = server.state.runs[0];
    server.failNext({ action: "assign-job-to-load", status: 0, message: "network" });
    await drag(page, await centre(queueItem(page, "Studio Café")), await centre(runRow(page, run.id).locator("h3")));
    // The request never reached the server: after reconciliation the job is still queued exactly once, and nothing is on the run.
    await expect.poll(async () => (await page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]", { hasText: "Studio Café" }).count()), { timeout: 20_000 }).toBe(1);
    expect(server.state.jobs.filter((job) => job.runId === run.id)).toHaveLength(0);
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(1);
  });

  test("a double drop of the same job sends one command and results in one assignment", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    const empty = `run:${DATE}:b`;
    const from = await centre(queueItem(page, "North Kitchen"));
    const to = await centre(runRow(page, empty).locator("h3"));
    await drag(page, from, to);
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBeGreaterThanOrEqual(1);
    await page.waitForTimeout(500);
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(1);
    expect(server.state.jobs.filter((job) => job.runId === empty)).toHaveLength(1);
    await expect(queueItem(page, "North Kitchen")).toHaveCount(0);
    expectClean({ console: [], network: [] }, "double drop");
  });

  test("zoom controls rescale the timeline without changing any saved time", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const narrow = (await bar.boundingBox())!.width;
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect.poll(async () => (await bar.boundingBox())!.width).toBeGreaterThan(narrow * 1.5);
    expect(commandsOf(server, "update-run-timing")).toHaveLength(0);
    await expect(bar).toContainText("09:00 – 12:00");
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect.poll(async () => (await bar.boundingBox())!.width).toBeLessThan(narrow);
  });

  test("vehicle filter and run search narrow the rows without touching state", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await page.getByRole("button", { name: "Van 2", exact: true }).click();
    await expect(page.locator("[data-run-row]")).toHaveCount(1);
    await page.getByRole("button", { name: "Van 1", exact: true }).click();
    await expect(page.locator("[data-run-row]")).toHaveCount(1);
    await page.getByRole("button", { name: "All runs" }).click();
    await page.getByRole("button", { name: "Search runs" }).click();
    await page.getByPlaceholder("Search runs or sites…").fill("harbour");
    await expect(page.locator("[data-run-row]")).toHaveCount(1);
    expect(server.commands.filter((command) => command.action !== "ensure-vehicle-day-runs")).toHaveLength(0);
  });

  test("seed sanity: a fresh day has two draft rows and an unassigned queue", async ({ page }) => {
    await boot(page, v3Seed());
    await expect(page.locator("[data-run-row]")).toHaveCount(2);
    await expect(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]")).toHaveCount(5);
  });
});
