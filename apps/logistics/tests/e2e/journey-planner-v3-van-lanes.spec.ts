import { expect, test } from "@playwright/test";
import { assignedSeed, boot, centre, commandsOf, DATE, drag, queueItem, selectRun } from "./v3-helpers";
import { auditLayout, expectClean } from "./layout-audit";

const firstId = `run:${DATE}:a`;
const secondId = `run:${DATE}:second-van1`;
const draftId = `run:${DATE}:b`;
function multipleRuns(overlap = false) {
  const seed = assignedSeed();
  seed.runs = [...seed.runs!, { id: secondId, vehicleId: "van1", status: "planned", dep: overlap ? "10:00" : "13:00", ret: "16:00" }];
  return seed;
}

test.use({ viewport: { width: 1536, height: 960 } });

test("each inspector links to its canonical van PIN workflow with the saved run and service date", async ({ page }) => {
  await boot(page, multipleRuns());
  for (const [id, van] of [[firstId, "van1"], [draftId, "van2"]]) {
    await selectRun(page, id);
    await page.getByRole("tab", { name: "Driver view" }).click();
    await expect(page.getByRole("link", { name: /Open driver workflow/ })).toHaveAttribute("href", `/mobile/${van}?run=${encodeURIComponent(id)}&serviceDate=${DATE}`);
  }
});

test("one lane per van carries multiple runs, preserving independent selection and keyboard timing", async ({ page }, info) => {
  const { server, issues } = await boot(page, multipleRuns());
  await expect(page.locator("[data-vehicle-row]")).toHaveCount(2);
  const van1 = page.locator('[data-vehicle-row="van1"]');
  const van2 = page.locator('[data-vehicle-row="van2"]');
  await expect(van1.locator("[data-run-bar]")).toHaveCount(2);
  await expect(van2.getByRole("button", { name: /Times to set/ })).toBeVisible();
  const a = await van1.locator(`[data-run-bar="${firstId}"]`).boundingBox();
  const b = await van1.locator(`[data-run-bar="${secondId}"]`).boundingBox();
  expect(a?.y).toBe(b?.y);
  await page.getByLabel("Run on Van 1").selectOption(secondId);
  await expect(page.locator(`[data-run-id="${secondId}"]`)).toBeVisible();
  await van1.locator(`[data-run-bar="${secondId}"]`).getByRole("slider").press("ArrowRight");
  await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(1);
  expect(commandsOf(server, "update-run-timing")[0]).toMatchObject({ runId: secondId, plannedCpuDepartureTime: "13:00", plannedCpuReturnTime: "16:15" });
  expect(server.run(firstId)?.ret).toBe("12:00");
  await page.screenshot({ path: info.outputPath("van-lanes-desktop.png"), fullPage: true });
  expectClean(issues, "van lanes");
});

test("dropping work on the second run targets its stable ID, never the first run on that van", async ({ page }) => {
  const { server } = await boot(page, multipleRuns());
  const target = page.locator(`[data-run-bar="${secondId}"]`);
  await drag(page, await centre(queueItem(page, "North Kitchen")), await centre(target));
  await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
  expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ jobId: "job:4", targetRunId: secondId, scheduledTime: "13:00" });
  await page.reload();
  await expect(page.locator('[data-vehicle-row="van1"] [data-run-bar]')).toHaveCount(2);
  expect(server.state.jobs.find(job => job.id === "job:4")?.runId).toBe(secondId);
});

test("overlapping runs remain reachable and warn in text without blocking selection", async ({ page }) => {
  await boot(page, multipleRuns(true));
  const lane = page.locator('[data-vehicle-row="van1"]');
  await expect(lane.getByText("Overlapping runs", { exact: true })).toBeVisible();
  const a = lane.locator(`[data-run-bar="${firstId}"]`);
  const b = lane.locator(`[data-run-bar="${secondId}"]`);
  expect(Math.abs((await a.boundingBox())!.y - (await b.boundingBox())!.y)).toBeGreaterThan(35);
  await expect(a).toHaveAttribute("data-overlap", "true");
  await expect(b).toHaveAttribute("data-overlap", "true");
  await b.focus(); await b.press("Enter");
  await expect(page.locator(`[data-run-id="${secondId}"]`)).toBeVisible();
});

test("untimed draft placement cannot move work onto the other van", async ({ page }) => {
  const { server } = await boot(page, multipleRuns());
  await selectRun(page, draftId);
  const source = page.locator(`[data-run-id="${draftId}"] [data-draft-slot] span`);
  const wrongLane = (await page.locator('[data-vehicle-row="van1"]').boundingBox())!;
  await drag(page, await centre(source), { x: wrongLane.x + wrongLane.width / 2, y: wrongLane.y + 25 });
  expect(commandsOf(server, "update-run-timing")).toHaveLength(0);
  expect(server.run(draftId)?.dep).toBeUndefined();
});

test("van lanes and selected run controls stay inside a narrow desktop viewport", async ({ page }, info) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  const { issues } = await boot(page, multipleRuns());
  await expect(page.locator("[data-vehicle-row]")).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  await page.getByLabel("Run on Van 2").selectOption(draftId);
  await expect(page.locator(`[data-run-id="${draftId}"]`).getByRole("button", { name: "Set times", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("van-lanes-narrow.png"), fullPage: true });
  expectClean(issues, "narrow van lanes");
});

for (const width of [820, 1024]) {
  test(`tablet ${width}px: van lanes, overlapping runs and keyboard selection remain usable`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const { issues } = await boot(page, multipleRuns(true));
    expect(page.viewportSize()?.width).toBe(width);

    const lanes = page.locator("[data-vehicle-row]");
    await expect(lanes).toHaveCount(2);
    const van1 = page.locator('[data-vehicle-row="van1"]');
    const van2 = page.locator('[data-vehicle-row="van2"]');
    await expect(van1.locator("[data-run-bar]")).toHaveCount(2);
    await expect(van1.locator(`[data-run-bar="${firstId}"]`)).toBeVisible();
    const secondRun = van1.locator(`[data-run-bar="${secondId}"]`);
    await expect(secondRun).toBeVisible();
    await expect(van2.getByRole("button", { name: /Times to set/ })).toBeVisible();
    await expect(van1.getByText("Overlapping runs", { exact: true })).toBeVisible();
    await expect(secondRun).toHaveAttribute("data-overlap", "true");

    // Select the second canonical run from its keyboard-operable timeline bar.
    await secondRun.focus();
    await secondRun.press("Enter");
    await expect(page.locator(`[data-run-id="${secondId}"]`)).toBeVisible();
    await expect(page.getByLabel("Run on Van 1")).toHaveValue(secondId);

    // Exercise a core action and audit that controls remain reachable. Timeline
    // track scrolling is intentional and must stay distinct from page overflow.
    await expect(page.getByRole("button", { name: "New Run", exact: true })).toBeVisible();
    await expect(van2.getByRole("button", { name: /Times to set/ })).toBeVisible();
    await page.getByRole("button", { name: "New Run", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "New Run" })).toBeVisible();
    await page.keyboard.press("Escape");
    expect(await auditLayout(page, "[data-journey-planner]", ["[data-testid=journey-timeline-scroller]"]), `tablet ${width}px layout`).toEqual([]);
    expectClean(issues, `tablet ${width}px van lanes`);
  });
}
