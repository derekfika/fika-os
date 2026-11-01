import { expect, test } from "@playwright/test";
import { expectClean } from "./layout-audit";
import { assignedSeed, boot, centre, commandsOf, createRunViaDialog, DATE, drag, pxPerMinute, queueItem, runRow, runStops, selectRun, timeToX, v3Seed } from "./v3-helpers";

/**
 * Journey Planner V3 mounted in the REAL planner page (not the preview route), driven with real pointer input
 * against the stateful, response-shaped LOCAL fake of /api/logistics (planner-fake-server.ts).
 * LOCAL FIXTURE tests: the same commands are covered against the real route by tests/api.integration.ts (emulator)
 * and by journey-planner-v3-domain.spec.ts (the actual route/domain code on an isolated transactional store).
 */
test.describe("Journey Planner V3 · mounted real planner · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("renders the V3 planner in place of the classic timeline", async ({ page }) => {
    const { issues } = await boot(page);
    await expect(page.getByRole("heading", { level: 1, name: "Journey Planner" })).toBeVisible();
    await expect(page.locator("[data-journey-planner]")).toBeVisible();
    await expect(page.locator("[data-testid=mounted-react-timeline]")).toHaveCount(0);
    await expect(page.locator("[data-run-row]")).toHaveCount(2);
    expectClean(issues, "render");
  });

  test("classic UI remains available as a rollback aid (?ui=classic)", async ({ page }) => {
    await boot(page, v3Seed(), "&ui=classic");
    await expect(page.locator("[data-testid=mounted-react-timeline]")).toBeVisible();
    await expect(page.locator("[data-journey-planner]")).toHaveCount(0);
  });

  test("create a Run with the Van selector: it joins its van lane and is persisted", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 2", { departure: "09:00", return: "12:00" });
    expect(commandsOf(server, "create-run").at(-1)?.run).toMatchObject({ vehicleId: "van2", plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "12:00", status: "draft" });
    await expect(runRow(page, run.id)).toBeVisible();
    await expect(runRow(page, run.id)).toContainText("09:00 – 12:00");
    await expect(page.locator("[data-vehicle-row]")).toHaveCount(2);
    await page.reload();
    await selectRun(page, run.id);
    await expect(runRow(page, run.id)).toContainText("09:00 – 12:00");
    expectClean(issues, "create");
  });

  test("create validation: one time without the other is refused before any command is sent", async ({ page }) => {
    const { server } = await boot(page);
    await page.getByRole("button", { name: "New Run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New Run" });
    await dialog.getByLabel("Planned CPU departure").fill("09:00");
    await dialog.getByRole("button", { name: "Create Run" }).click();
    await expect(dialog.getByRole("alert")).toContainText("both departure and return");
    expect(commandsOf(server, "create-run")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  test("drag an unassigned job onto a Run row: the whole row highlights, the requested time is used, a chip appears, the queue shrinks", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = server.state.runs[0];
    const row = runRow(page, run.id);
    // Drop on the row's LABEL area (not the bar/track): anywhere on the row is a valid target.
    await drag(page, await centre(queueItem(page, "Studio Café")), await centre(row.locator("h3")), async () => {
      await expect(row).toHaveAttribute("data-drop", "valid");
      await expect(row.locator("[data-drop-label]")).toContainText("Drop to add to Run 1");
      await expect(page.locator("[data-queue-drag-ghost]")).toBeVisible();
    });
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
    expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ jobId: "job:2", targetRunId: run.id, scheduledTime: "10:00", lane: "delivery" });
    await expect(runStops(page, run.id).getByRole("button", { name: /Studio Café/ })).toBeVisible();
    await expect(queueItem(page, "Studio Café")).toHaveCount(0);
    await expect(row).not.toHaveAttribute("data-drop", /.+/);
    expectClean(issues, "queue drop");
  });

  test("work without a requested time asks Franco for one; the time is never guessed; Cancel changes nothing", async ({ page }) => {
    const { server } = await boot(page);
    const run = server.state.runs[0];
    await drag(page, await centre(queueItem(page, "Market Hall")), await centre(runRow(page, run.id).locator("h3")));
    const dialog = page.getByRole("dialog", { name: "Choose a delivery time" });
    await expect(dialog).toBeVisible();
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
    await dialog.getByRole("button", { name: "Add to Run 1" }).click();
    await expect(dialog.getByRole("alert")).toContainText("Choose a time");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
    await drag(page, await centre(queueItem(page, "Market Hall")), await centre(runRow(page, run.id).locator("h3")));
    await page.getByLabel("Planned delivery time").fill("11:15");
    await page.getByRole("button", { name: "Add to Run 1" }).click();
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
    expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ jobId: "job:1", targetRunId: run.id, scheduledTime: "11:15" });
    await expect(runStops(page, run.id).getByRole("button", { name: /Market Hall/ })).toBeVisible();
  });

  test("a standalone collection starts without a guessed time and needs an explicit time before it joins a Run", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await page.route("**/api/logistics/locations", (route) => route.fulfill({ json: { oplocs: [{ id: "site:1", label: "Market Hall" }] } }));
    await page.getByRole("button", { name: "+ New collection" }).click();
    const form = page.getByRole("dialog", { name: "New movement" });
    await expect(form.getByLabel("Type")).toHaveValue("collection");
    await form.getByLabel("From OPLOC").selectOption("site:1");
    await form.getByLabel("Item description").fill("Standalone collection crates");
    await form.getByLabel("Quantity").fill("2");
    await expect(form.getByLabel("Required time")).toHaveValue("");
    await expect(form.getByLabel("Window start")).toHaveValue("");
    await expect(form.getByLabel("Window end")).toHaveValue("");
    await form.getByRole("button", { name: "Create movement" }).click();
    await expect.poll(() => commandsOf(server, "save-movement").length).toBe(1);
    const movement = commandsOf(server, "save-movement")[0].movement;
    expect(movement).toMatchObject({ type: "collection", fromOplocId: "site:1", items: [{ description: "Standalone collection crates", quantity: 2 }] });
    expect(movement.requiredTime).toBeUndefined();
    expect(movement.window).toBeUndefined();
    await expect(form).toHaveCount(0);

    const queued = queueItem(page, "Standalone collection crates");
    await expect(queued).toBeVisible();
    const targetRunId = server.state.runs[1].id;
    await selectRun(page, targetRunId);
    const targetRun = runRow(page, targetRunId);
    await drag(page, await centre(queued), await centre(targetRun.locator("h3")));
    const chooseTime = page.getByRole("dialog", { name: "Choose a collection time" });
    await expect(chooseTime).toBeVisible();
    expect(commandsOf(server, "assign")).toHaveLength(0);
    await chooseTime.getByLabel("Planned collection time").fill("13:15");
    await chooseTime.getByRole("button", { name: "Add to Run 2" }).click();
    await expect.poll(() => commandsOf(server, "assign").length).toBe(1);
    expect(commandsOf(server, "assign")[0]).toMatchObject({ runId: targetRunId, movementId: movement.canonicalId, plannedArrivalTime: "13:15" });
    await expect.poll(() => server.state.movements.find((item) => item.id === movement.canonicalId)?.runId).toBe(targetRunId);
    expect(server.state.movements.filter((item) => item.id === movement.canonicalId)).toHaveLength(1);
    await page.reload();
    await selectRun(page, targetRunId);
    await expect(runStops(page, targetRunId).getByRole("button", { name: /Market Hall/ })).toBeVisible();
    expect(server.state.movements.filter((item) => item.id === movement.canonicalId)).toHaveLength(1);
  });

  test("a dispatched run is an invalid target: the row says why and nothing is sent", async ({ page }) => {
    const seed = v3Seed();
    seed.runs = [{ id: `run:${DATE}:d`, vehicleId: "van1", status: "dispatched", dep: "08:00", ret: "12:00" }, ...(seed.runs || []).slice(1)];
    const { server } = await boot(page, seed);
    const row = runRow(page, `run:${DATE}:d`);
    await drag(page, await centre(queueItem(page, "Studio Café")), await centre(row.locator("h3")), async () => {
      await expect(row).toHaveAttribute("data-drop", "invalid");
      await expect(row.locator("[data-drop-label]")).toContainText("Return it to planning");
    });
    await page.waitForTimeout(300);
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
  });

  test("Escape cancels a queue drag", async ({ page }) => {
    const { server } = await boot(page);
    const row = runRow(page, server.state.runs[0].id);
    const from = await centre(queueItem(page, "Studio Café")); const to = await centre(row.locator("h3"));
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(to.x, to.y, { steps: 8 });
    await expect(row).toHaveAttribute("data-drop", "valid");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.waitForTimeout(250);
    expect(commandsOf(server, "assign-job-to-load")).toHaveLength(0);
    await expect(queueItem(page, "Studio Café")).toBeVisible();
  });

  test("move a timed Run horizontally and resize its return; each is saved only after the server confirms, and survives refresh", async ({ page }) => {
    const { server, issues } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const ppm = await pxPerMinute(page);
    const box = (await bar.boundingBox())!;
    await drag(page, { x: box.x + box.width / 2, y: box.y + box.height / 2 }, { x: box.x + box.width / 2 + 60 * ppm, y: box.y + box.height / 2 });
    await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(1);
    expect(commandsOf(server, "update-run-timing")[0]).toMatchObject({ runId: run.id, plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:00" });
    await expect(bar).toContainText("10:00 – 13:00");
    const moved = (await bar.boundingBox())!;
    const grip = await centre(bar.locator("[data-resize-handle]"));
    await drag(page, grip, { x: grip.x + 30 * ppm, y: grip.y });
    await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(2);
    expect(commandsOf(server, "update-run-timing")[1]).toMatchObject({ plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:30" });
    await expect(bar).toContainText("10:00 – 13:30");
    expect((await bar.boundingBox())!.width).toBeGreaterThan(moved.width);
    await page.reload();
    await expect(page.locator(`[data-run-bar="${run.id}"]`)).toContainText("10:00 – 13:30");
    expectClean(issues, "move/resize");
  });

  test("dragging a Run bar past the visible edge auto-scrolls the timeline and saves the carried time", async ({ page }) => {
    const { server } = await boot(page);
    const run = await createRunViaDialog(page, server, "Van 1", { departure: "15:00", return: "17:00" });
    const bar = page.locator(`[data-run-bar="${run.id}"]`);
    const scroller = page.locator("[data-testid=journey-timeline-scroller]");
    const before = await scroller.evaluate((element) => element.scrollLeft);
    const box = (await bar.boundingBox())!; const track = (await scroller.boundingBox())!;
    const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(start.x, start.y); await page.mouse.down();
    await page.mouse.move(start.x + 40, start.y, { steps: 3 });
    await page.mouse.move(track.x + track.width - 50, start.y, { steps: 6 });
    await page.waitForTimeout(900);
    expect(await scroller.evaluate((element) => element.scrollLeft)).toBeGreaterThan(before + 40);
    await page.mouse.up();
    await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(1);
    const sent = commandsOf(server, "update-run-timing")[0];
    expect(sent.plannedCpuDepartureTime > "15:00").toBeTruthy();
    expect(sent.plannedCpuReturnTime > sent.plannedCpuDepartureTime).toBeTruthy();
  });

  test("an untimed draft Run is placed by dragging its slot onto the timeline", async ({ page }) => {
    const { server } = await boot(page);
    const run = server.state.runs[0];
    const from = await centre(runRow(page, run.id).locator("[data-draft-slot] span").first());
    const lane = (await page.locator('[data-vehicle-row="van1"]').boundingBox())!;
    await drag(page, from, { x: await timeToX(page, 9 * 60), y: lane.y + 30 });
    await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(1);
    expect(commandsOf(server, "update-run-timing")[0]).toMatchObject({ runId: run.id, plannedCpuDepartureTime: "09:00", plannedCpuReturnTime: "12:00" });
    await expect(page.locator(`[data-run-bar="${run.id}"]`)).toContainText("09:00 – 12:00");
  });

  test("exact times in the inspector: validated client-side, saved through update-run-timing, overlap is a warning not a block", async ({ page }) => {
    const { server } = await boot(page);
    const a = await createRunViaDialog(page, server, "Van 1", { departure: "09:00", return: "12:00" });
    const b = await createRunViaDialog(page, server, "Van 1", { departure: "13:00", return: "15:00" });
    await page.locator(`[data-run-bar="${b.id}"]`).click();
    const inspector = page.getByRole("complementary", { name: "Run inspector" });
    await inspector.getByRole("button", { name: "Edit times" }).click();
    await inspector.getByLabel("CPU departure").fill("11:00");
    await inspector.getByLabel("CPU return").fill("10:00");
    await inspector.getByRole("button", { name: "Save times" }).click();
    await expect(inspector.getByRole("alert")).toContainText("later than departure");
    expect(commandsOf(server, "update-run-timing")).toHaveLength(0);
    await inspector.getByLabel("CPU return").fill("14:00");
    await inspector.getByRole("button", { name: "Save times" }).click();
    await expect.poll(() => commandsOf(server, "update-run-timing").length).toBe(1);
    expect(commandsOf(server, "update-run-timing")[0]).toMatchObject({ runId: b.id, plannedCpuDepartureTime: "11:00", plannedCpuReturnTime: "14:00" });
    await expect(page.locator(`[data-run-bar="${a.id}"]`)).toHaveAttribute("data-overlap", "true");
    await expect(runRow(page, b.id).locator("[data-overlap-warning]")).toBeVisible();
    await expect(page.locator(`[data-run-bar="${b.id}"]`)).toContainText("11:00 – 14:00");
  });

  test("assigned work shows compact chips in the saved visiting order; clicking a chip opens that stop in the inspector", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    const row = runRow(page, `run:${DATE}:a`);
    const stops = runStops(page, `run:${DATE}:a`);
    const chips = stops.locator("ol[aria-label^='Visiting sequence'] li");
    await expect(chips).toHaveCount(5);
    await expect(stops.getByRole("button", { name: /Studio Café/ })).toBeVisible();
    await stops.getByRole("button", { name: /Studio Café/ }).click();
    const inspector = page.getByRole("complementary", { name: "Run inspector" });
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("tab", { name: "Stops", selected: true })).toBeVisible();
    await expect(inspector.getByText("Sandwich platters")).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Collapse Studio Café" })).toBeVisible();
    // expanding/collapsing the row does not touch scheduling state
    const before = server.commands.length;
    await row.getByRole("button", { name: /Collapse Run 1 stop sequence/ }).click();
    await expect(chips).toHaveCount(0);
    await row.getByRole("button", { name: /Expand Run 1 stop sequence/ }).click();
    await expect(chips).toHaveCount(5);
    expect(server.commands.filter((command) => !["ensure-vehicle-day-runs"].includes(String(command.action))).length).toBe(before - server.commands.slice(0, before).filter((command) => command.action === "ensure-vehicle-day-runs").length);
    expect(commandsOf(server, "update-run-timing")).toHaveLength(0);
  });
});
