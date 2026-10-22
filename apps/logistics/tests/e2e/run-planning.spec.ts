import { expect, test, type Locator, type Page } from "@playwright/test";
import { FakeLogisticsServer, installStatefulApi, ownerSeed, type FakeOptions } from "./planner-fake-server";
import { auditLayout, expectClean, rect, trackIssues } from "./layout-audit";

/**
 * Interactive Run planning UAT: create / move / resize Runs on the timeline, drag work in from
 * the queue, organise stop order, move/return work, retire an empty Run, refresh persistence and
 * rejected/stale/failed mutations — all through the mounted app with real pointer input against
 * a stateful, response-shaped LOCAL fake of /api/logistics (see planner-fake-server.ts).
 */
const DATE = "2026-10-28";
const PX = 2; // pixels per minute at 100% timeline zoom

async function boot(page: Page, seed: FakeOptions = ownerSeed(DATE)) {
  const issues = trackIssues(page);
  const server = new FakeLogisticsServer(seed);
  await installStatefulApi(page, server, issues);
  await page.goto(`/?serviceDate=${DATE}`);
  await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel("Search unassigned work")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  return { server, issues };
}

async function trackPoint(page: Page, vehicle: "van1" | "van2", minute: number) {
  await page.locator("[data-testid=mounted-timeline-viewport]").evaluate((element, target) => { element.scrollLeft = Math.max(0, target * 2 - element.clientWidth * 0.4); }, minute);
  const box = (await page.locator(`[data-vehicle-track="${vehicle}"]`).boundingBox())!;
  return { x: box.x + minute * PX, y: box.y + box.height - 10 };
}
const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
const centre = async (locator: Locator) => { await locator.scrollIntoViewIfNeeded(); await settle(locator.page()); const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.3, from.y + (to.y - from.y) * 0.3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  await page.mouse.up();
}
const runBlock = (page: Page, runId: string) => page.locator(`[data-journey-run-id="${runId}"]`);
const queueCard = (page: Page, jobNumber: number) => page.locator(`[data-timeline-queue-id="projection-job:job:${jobNumber}"] .mock-queue-main`);
const commandsOf = (server: FakeLogisticsServer, action: string) => server.commands.filter((command) => command.action === action) as Record<string, any>[];
const queueCount = (page: Page) => page.locator("[data-logistics-planning-queue] article");

async function createRunAt(page: Page, server: FakeLogisticsServer, vehicle: "van1" | "van2", minute: number) {
  const before = server.state.runs.length;
  const point = await trackPoint(page, vehicle, minute);
  await page.mouse.click(point.x, point.y);
  await expect.poll(() => server.state.runs.length).toBe(before + 1);
  return server.state.runs.at(-1)!;
}

test.describe("interactive Run planning · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("1 · create an empty Run directly on the timeline, shown as a draft block at the clicked time", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = await createRunAt(page, server, "van1", 9 * 60);
    expect(commandsOf(server, "create-run").at(-1)?.run).toMatchObject({ vehicleId: "van1", plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "12:00", status: "draft" });
    const block = runBlock(page, run.id);
    await expect(block).toBeVisible();
    await expect(block).toContainText("Draft");
    await expect(block).toContainText("09:00–12:00");
    await expect(page.locator(".mock-selected-day small")).toContainText("2 vans / 3 runs");
    expectClean(issues, "create");
  });

  test("1b · a vehicle's + New run affordance creates an untimed draft that stays visible", async ({ page }) => {
    const { server } = await boot(page);
    await page.getByRole("button", { name: "Add run to Van 2" }).click();
    await expect.poll(() => server.state.runs.filter((run) => run.vehicleId === "van2").length).toBe(2);
    expect(commandsOf(server, "create-run").at(-1)?.run.plannedCpuDepartureTime).toBeUndefined();
    await expect(page.locator("[data-testid=untimed-runs] button")).toHaveCount(3);
    await expect(page.locator(".mock-selected-day small")).toContainText("3 runs");
  });

  test("2+3 · move a Run (duration preserved) then resize it; saved only after server confirmation", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = await createRunAt(page, server, "van1", 9 * 60);
    const block = runBlock(page, run.id);
    await expect(block).toContainText("09:00–12:00");
    // Move +60 minutes (120px).
    const from = await centre(block.locator("button"));
    await drag(page, from, { x: from.x + 120, y: from.y });
    await expect(block).toContainText("10:00–13:00");
    expect(commandsOf(server, "update-run-timing").at(-1)).toMatchObject({ runId: run.id, plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:00", expectedRunVersion: 1 });
    expect(server.run(run.id)).toMatchObject({ dep: "10:00", ret: "13:00", version: 2 });
    // Resize: drag the right edge +30 minutes.
    const handle = page.getByTestId(`run-resize-${run.id}`);
    const edge = await centre(handle);
    await drag(page, edge, { x: edge.x + 60, y: edge.y });
    await expect(block).toContainText("10:00–13:30");
    expect(commandsOf(server, "update-run-timing").at(-1)).toMatchObject({ plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:30", expectedRunVersion: 2 });
    // Keyboard resize on the slider.
    await page.getByTestId(`run-resize-${run.id}`).focus();
    await page.keyboard.press("ArrowRight");
    await expect(block).toContainText("10:00–13:45");
    expectClean(issues, "move/resize");
  });

  test("overlapping Runs warn clearly and never modify the other Run", async ({ page }) => {
    const { server } = await boot(page);
    const first = await createRunAt(page, server, "van1", 9 * 60);
    const second = await createRunAt(page, server, "van1", 11 * 60);
    await expect(runBlock(page, first.id)).toContainText("Schedule overlap");
    await expect(runBlock(page, second.id)).toContainText("Schedule overlap");
    expect(server.run(first.id)).toMatchObject({ dep: "09:00", ret: "12:00", version: 1 });
  });

  test("a timed Run cannot be dragged onto the other vehicle's lane (no silent vehicle change)", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunAt(page, server, "van1", 9 * 60);
    const from = await centre(runBlock(page, run.id).locator("button"));
    const other = await trackPoint(page, "van2", 9 * 60);
    await drag(page, from, { x: from.x, y: other.y });
    expect(server.run(run.id)).toMatchObject({ vehicleId: "van1", dep: "09:00" });
    expect(commandsOf(server, "update-run-timing")).toHaveLength(0);
  });

  test("an untimed draft Run can be dragged onto its own vehicle's timeline to position it", async ({ page }) => {
    const { server } = await boot(page);
    const chip = page.locator('[data-untimed-run-id="run:2026-10-28:van-1"]');
    const from = await centre(chip);
    const target = await trackPoint(page, "van1", 8 * 60);
    await drag(page, from, target);
    await expect.poll(() => server.run("run:2026-10-28:van-1")?.dep).toBe("08:00");
    expect(server.run("run:2026-10-28:van-1")?.ret).toBe("11:00");
    await expect(runBlock(page, "run:2026-10-28:van-1")).toContainText("08:00–11:00");
  });

  test("4+5 · drag deliveries and a collection from the queue into a Run; counts follow", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = await createRunAt(page, server, "van1", 9 * 60);
    const block = runBlock(page, run.id);
    await expect(queueCount(page)).toHaveCount(5);
    for (const [n, expected] of [[1, 4], [2, 3]] as const) {
      await page.locator("[data-testid=mounted-timeline-viewport]").evaluate((element) => { element.scrollLeft = 9 * 60 * 2 - 300; });
      const from = await centre(queueCard(page, n));
      const target = await centre(block.locator("button"));
      await drag(page, from, { x: target.x + 30 * n, y: target.y });
      await expect(queueCount(page)).toHaveCount(expected);
    }
    const assigns = commandsOf(server, "assign-job-to-load");
    expect(assigns).toHaveLength(2);
    expect(assigns.every((command) => command.targetRunId === run.id && /^\d\d:(00|15|30|45)$/.test(command.scheduledTime))).toBe(true);
    // A collection (native movement stop) goes in through the same drag.
    const from = await centre(page.locator('[data-timeline-queue-id="movement:1"] .mock-queue-main'));
    const target = await centre(block.locator("button"));
    await drag(page, from, { x: target.x + 20, y: target.y });
    await expect(queueCount(page)).toHaveCount(2);
    expect(commandsOf(server, "assign")).toHaveLength(1);
    await expect(block).toContainText("3 stops");
    expectClean(issues, "queue drag");
  });

  test("drop target highlights as valid, and an ineligible (dispatched) Run shows why it cannot accept work", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:dispatched`, vehicleId: "van2", status: "dispatched", dep: "06:00", ret: "09:00" }, { id: `run:${DATE}:open`, vehicleId: "van1", status: "planned", dep: "10:00", ret: "13:00" });
    const { server } = await boot(page, seed);
    const open = runBlock(page, `run:${DATE}:open`).locator("button");
    const card = await centre(queueCard(page, 1));
    await page.mouse.move(card.x, card.y); await page.mouse.down();
    await page.locator("[data-testid=mounted-timeline-viewport]").evaluate((element) => { element.scrollLeft = 6 * 60 * 2; });
    const valid = await centre(open);
    await page.mouse.move(card.x + 30, card.y + 30, { steps: 3 }); await page.mouse.move(valid.x, valid.y, { steps: 8 });
    await expect(runBlock(page, `run:${DATE}:open`)).toContainText("Drop to assign");
    const invalid = await centre(runBlock(page, `run:${DATE}:dispatched`).locator("button"));
    await page.mouse.move(invalid.x, invalid.y, { steps: 8 });
    await expect(runBlock(page, `run:${DATE}:dispatched`)).toContainText("Run is dispatched");
    await page.mouse.up();
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
    await expect(queueCount(page)).toHaveCount(5);
  });

  test("6+7+11 · reorder stops by drag and by arrows; saved order persists across refresh and is stored on the Run", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:work`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "13:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:work`, time: "08:00" };
    seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:work`, time: "09:00" };
    seed.jobs![2] = { ...seed.jobs![2], runId: `run:${DATE}:work`, time: "10:00" };
    const { server, issues } = await boot(page, seed);
    await runBlock(page, `run:${DATE}:work`).locator("button").click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    const list = inspector.getByRole("list", { name: "Stops in visiting order" });
    await expect(list.getByRole("listitem")).toHaveCount(3);
    const labels = () => list.locator("li strong").allTextContents();
    expect(await labels()).toEqual(["Market Hall", "Studio Café", "Harbour House"]);
    // Drag the third stop to the top.
    await list.locator('li[data-stop-id="projection-stop:delivery:load:job:3"]').dragTo(list.locator('li[data-stop-id="projection-stop:delivery:load:job:1"]'));
    expect(await labels()).toEqual(["Harbour House", "Market Hall", "Studio Café"]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => commandsOf(server, "set-run-stop-order").length).toBe(1);
    expect(commandsOf(server, "set-run-stop-order")[0]).toMatchObject({ runId: `run:${DATE}:work`, expectedRunVersion: 1, stopIds: ["projection-stop:delivery:load:job:3", "projection-stop:delivery:load:job:1", "projection-stop:delivery:load:job:2"] });
    // Arrow controls: move Studio Café up.
    await expect.poll(labels).toEqual(["Harbour House", "Market Hall", "Studio Café"]);
    await inspector.getByRole("button", { name: "Move Studio Café up" }).click();
    expect(await labels()).toEqual(["Harbour House", "Studio Café", "Market Hall"]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => commandsOf(server, "set-run-stop-order").length).toBe(2);
    expect(server.run(`run:${DATE}:work`)!.orderedStopIds).toEqual(["projection-stop:delivery:load:job:3", "projection-stop:delivery:load:job:2", "projection-stop:delivery:load:job:1"]);
    // Refresh: the stored canonical order is what comes back, not a client-side sort.
    await page.reload();
    await runBlock(page, `run:${DATE}:work`).locator("button").click();
    await expect(page.getByRole("complementary", { name: "Details inspector" }).getByRole("list", { name: "Stops in visiting order" }).locator("li strong")).toHaveText(["Harbour House", "Studio Café", "Market Hall"]);
    expect(await auditLayout(page), "organise run layout").toEqual([]);
    expectClean(issues, "reorder");
  });

  test("an order that contradicts planned times is surfaced as a conflict; times are never invented or changed", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:work`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "13:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:work`, time: "08:00" };
    seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:work`, time: "09:00" };
    const { server } = await boot(page, seed);
    await runBlock(page, `run:${DATE}:work`).locator("button").click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByText("Order conflicts with planned times")).toHaveCount(0);
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    await expect(inspector.getByText("Order conflicts with planned times")).toBeVisible();
    await expect(inspector.getByText("Times were not changed.")).toBeVisible();
    expect(server.state.jobs.map((job) => job.time).filter(Boolean)).toEqual(["08:00", "09:00"]);
  });

  test("8+9 · move one load to another Run, and return work to the queue from the organiser", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:a`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "10:00" }, { id: `run:${DATE}:b`, vehicleId: "van1", status: "planned", dep: "11:00", ret: "14:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:a`, time: "08:00" };
    seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:a`, time: "09:00" };
    const { server } = await boot(page, seed);
    await runBlock(page, `run:${DATE}:a`).locator("button").click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByRole("button", { name: "View route" }).click();
    await page.locator(".route-sheet[role='dialog']").getByRole("button", { name: /Load .*jobs/ }).first().click();
    await inspector.getByLabel("Load target run").selectOption(`run:${DATE}:b`);
    await inspector.getByLabel("delivery load time").fill("12:00");
    await inspector.getByRole("button", { name: "Save load assignment" }).click();
    await expect.poll(() => server.state.jobs.find((job) => job.id === "job:1")?.runId).toBe(`run:${DATE}:b`);
    expect(commandsOf(server, "reschedule-delivery-load").at(-1)).toMatchObject({ targetRunId: `run:${DATE}:b`, scheduledTime: "12:00" });
    // Return the remaining work in run A to the queue.
    await runBlock(page, `run:${DATE}:a`).locator("button").click();
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Return Studio Café to queue" }).click();
    await expect.poll(() => server.state.jobs.find((job) => job.id === "job:2")?.runId).toBeUndefined();
    await expect(queueCount(page)).toHaveCount(4);
  });

  test("10+11 · delete an empty draft Run with confirmation; it stays gone after refresh and is protected when it has work", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:busy`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "10:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:busy`, time: "08:00" };
    const { server, issues } = await boot(page, seed);
    // A run with work offers no delete.
    await runBlock(page, `run:${DATE}:busy`).locator("button").click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("button", { name: "Delete empty run" })).toHaveCount(0);
    await expect(inspector.getByText("A run with work can’t be deleted")).toBeVisible();
    await inspector.getByRole("button", { name: "Close inspector" }).click();
    // Empty draft: open via its chip, confirm.
    await page.locator('[data-untimed-run-id="run:2026-10-28:van-2"]').click();
    await inspector.getByRole("button", { name: "Delete empty run" }).click();
    const confirm = inspector.getByRole("alertdialog", { name: "Delete empty run" });
    await expect(confirm).toBeVisible();
    await expect(confirm.getByRole("button", { name: "Cancel" })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(confirm).toHaveCount(0);
    expect(commandsOf(server, "retire-empty-run")).toHaveLength(0);
    await inspector.getByRole("button", { name: "Delete empty run" }).click();
    await confirm.getByRole("button", { name: "Delete empty run" }).click();
    await expect.poll(() => commandsOf(server, "retire-empty-run").length).toBe(1);
    await expect(page.locator('[data-untimed-run-id="run:2026-10-28:van-2"]')).toHaveCount(0);
    await expect(page.locator(".mock-selected-day small")).toContainText("1 vans / 2 runs");
    await page.reload();
    await expect(page.locator('[data-untimed-run-id="run:2026-10-28:van-2"]')).toHaveCount(0);
    await expect(page.locator(".mock-selected-day small")).toContainText("2 runs");
    expectClean(issues, "retire");
  });

  test("12 · failed, rejected, stale and conflicting mutations never replace confirmed state", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunAt(page, server, "van1", 9 * 60);
    const block = runBlock(page, run.id);
    // (a) Server failure on a move: block returns to the confirmed position and the error is visible.
    server.failNext({ action: "update-run-timing", status: 503, message: "Logistics store unavailable." });
    let from = await centre(block.locator("button"));
    await drag(page, from, { x: from.x + 120, y: from.y });
    await expect(page.locator(".alert")).toContainText("Logistics store unavailable.");
    await expect(block).toContainText("09:00–12:00");
    await expect(block).not.toContainText("Saving");
    // (b) Stale version (another operator changed the run): 409 → reconcile to server truth, no silent overwrite.
    server.interfere(run.id);
    from = await centre(block.locator("button"));
    await drag(page, from, { x: from.x + 120, y: from.y });
    await expect(page.locator(".alert")).toContainText("changed elsewhere");
    await expect(block).toContainText("09:00–12:00");
    expect(server.run(run.id)).toMatchObject({ dep: "09:00", ret: "12:00" });
    // The refreshed block now carries the current version, so the same move succeeds.
    from = await centre(block.locator("button"));
    await drag(page, from, { x: from.x + 120, y: from.y });
    await expect(block).toContainText("10:00–13:00");
  });

  test("12b · a rejected stop-order save keeps the confirmed order and tells the user why", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:work`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "13:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:work`, time: "08:00" };
    seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:work`, time: "09:00" };
    const { server } = await boot(page, seed);
    await runBlock(page, `run:${DATE}:work`).locator("button").click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    server.failNext({ action: "set-run-stop-order", status: 409, message: "This run changed elsewhere. Refresh before saving the stop order." });
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect(page.locator(".alert")).toContainText("changed elsewhere");
    expect(server.run(`run:${DATE}:work`)!.orderedStopIds).toEqual([]);
    // The unsaved draft stays visible and savable; nothing unconfirmed was written. Cancel returns to the confirmed order.
    await expect(inspector.getByRole("button", { name: "Save order" })).toBeEnabled();
    await inspector.getByRole("button", { name: "Cancel" }).click();
    await expect(inspector.getByRole("list", { name: "Stops in visiting order" }).locator("li strong")).toHaveText(["Market Hall", "Studio Café"]);
    expect(server.run(`run:${DATE}:work`)!.orderedStopIds).toEqual([]);
  });

  test("a queue item with no requested time dropped on an untimed Run opens the assignment form for that Run", async ({ page }) => {
    const { server } = await boot(page);
    const chip = page.locator('[data-untimed-run-id="run:2026-10-28:van-1"]');
    await drag(page, await centre(queueCard(page, 3)), await centre(chip));
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByLabel("Target delivery run")).toHaveValue("run:2026-10-28:van-1");
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
  });

  test("a queue item WITH a requested time drops onto an untimed Run with no form", async ({ page }) => {
    const seed = ownerSeed(DATE);
    seed.jobs![0] = { ...seed.jobs![0], requestedStart: "10:30" };
    const { server } = await boot(page, seed);
    const chip = page.locator('[data-untimed-run-id="run:2026-10-28:van-1"]');
    await drag(page, await centre(queueCard(page, 1)), await centre(chip));
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
    expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ targetRunId: "run:2026-10-28:van-1", scheduledTime: "10:30" });
  });
});

for (const viewport of [{ width: 1920, height: 1080 }, { width: 1536, height: 960 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 800 }]) {
  test.describe(`run planning geometry · ${viewport.width}x${viewport.height}`, () => {
    test.use({ viewport });
    test("timeline, queue, Organise Run panel and delete confirmation stay unclipped and usable", async ({ page }) => {
      test.setTimeout(90_000);
      const seed = ownerSeed(DATE);
      seed.runs!.push({ id: `run:${DATE}:work`, vehicleId: "van1", status: "planned", dep: "07:00", ret: "13:00" }, { id: `run:${DATE}:empty`, vehicleId: "van2", status: "planned", dep: "07:00", ret: "10:00" });
      seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:work`, time: "08:00" };
      seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:work`, time: "09:00" };
      seed.jobs![2] = { ...seed.jobs![2], runId: `run:${DATE}:work`, time: "10:00" };
      const { issues } = await boot(page, seed);
      expect(await auditLayout(page), "planner with runs").toEqual([]);
      await runBlock(page, `run:${DATE}:work`).locator("button").click();
      const inspector = page.getByRole("complementary", { name: "Details inspector" });
      await expect(inspector.getByRole("list", { name: "Stops in visiting order" })).toBeVisible();
      expect(await auditLayout(page), "organise run").toEqual([]);
      // Queue and timeline remain reachable beside the panel (no overlap with the docked inspector).
      const panel = await rect(page, ".mock-inspector");
      for (const selector of [".mock-schedule", ".mock-queue"]) { const box = await rect(page, selector); expect(box.right <= panel.left + 1 || box.left >= panel.right - 1 || box.bottom <= panel.top + 1, `${selector} must not sit under the panel`).toBe(true); }
      expect((await rect(page, "[data-testid=mounted-timeline-viewport]")).width).toBeGreaterThanOrEqual(480);
      // The selected Run stays on screen with its panel open.
      const selected = await rect(page, `[data-journey-run-id="run:${DATE}:work"]`);
      expect(selected.right).toBeGreaterThan(0);
      await expect(runBlock(page, `run:${DATE}:work`).locator("button")).toHaveAttribute("aria-current", "true");
      await inspector.getByRole("button", { name: "Close inspector" }).click();
      await runBlock(page, `run:${DATE}:empty`).locator("button").click();
      await inspector.getByRole("button", { name: "Delete empty run" }).click();
      expect(await auditLayout(page), "delete confirmation").toEqual([]);
      expectClean(issues, `${viewport.width}x${viewport.height}`);
    });
  });
}
