import { expect, test, type Page } from "@playwright/test";
import { expectClean } from "./layout-audit";
import { assignedSeed, boot, centre, commandsOf, DATE, drag, queueItem, runRow } from "./v3-helpers";

/**
 * Organise Run, retirement, collections and rejected / stale / uncertain mutations through the mounted V3 planner.
 * LOCAL FIXTURE tests against the stateful fake of /api/logistics; see journey-planner-v3-domain.spec.ts for the real route.
 */
const RUN = `run:${DATE}:a`;
const EMPTY = `run:${DATE}:b`;
const inspectorOf = (page: Page) => page.getByRole("complementary", { name: "Run inspector" });
const stopNames = (page: Page) => inspectorOf(page).getByRole("list", { name: "Stops in visiting order" }).locator(":scope > li").evaluateAll((items) => items.map((item) => item.querySelector("[class*=stopName]")?.textContent || ""));
const chipNames = (page: Page, runId = RUN) => runRow(page, runId).locator("ol[aria-label^='Visiting sequence'] li button").evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || "").replace(/^Stop \d+, /, "").split(":")[0]));
const stopId = (job: number) => `projection-stop:delivery:load:job:${job}`;
async function openRun(page: Page, runId = RUN) { await page.locator(`[data-run-bar="${runId}"]`).click(); await expect(inspectorOf(page)).toBeVisible(); }

test.describe("Journey Planner V3 · Organise Run and rejected mutations · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("inspector shows the real Run, vehicle and CPU endpoints fixed; customer stops follow the saved sequence", async ({ page }) => {
    await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await expect(inspector.getByRole("heading", { name: /Run 1/ })).toContainText("Van 1");
    await expect(inspector).toContainText("08:00");
    await expect(inspector).toContainText("12:00");
    expect(await stopNames(page)).toEqual(["CPU", "Market Hall", "Studio Café", "Harbour House", "CPU"]);
    const items = inspector.getByRole("list", { name: "Stops in visiting order" }).locator(":scope > li");
    await expect(items.first().getByRole("button", { name: /move/i })).toHaveCount(0);
    await expect(items.first().locator("[aria-label^='Fixed endpoint']")).toBeVisible();
    await expect(items.last().locator("[aria-label^='Fixed endpoint']")).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Save order" })).toBeDisabled();
  });

  test("reorder with the arrow buttons: unsaved, then saving, then confirmed; persists across refresh; chips follow", async ({ page }) => {
    const { server, issues } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    await expect(inspector.getByTestId("order-unsaved")).toBeVisible();
    expect(await stopNames(page)).toEqual(["CPU", "Studio Café", "Market Hall", "Harbour House", "CPU"]);
    expect(commandsOf(server, "set-run-stop-order")).toHaveLength(0);
    // Chips show the CONFIRMED server order until the save is confirmed.
    expect(await chipNames(page)).toEqual(["Market Hall", "Studio Café", "Harbour House"]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => commandsOf(server, "set-run-stop-order").length).toBe(1);
    expect(commandsOf(server, "set-run-stop-order")[0]).toMatchObject({ runId: RUN, stopIds: [stopId(2), stopId(1), stopId(3)] });
    expect(server.run(RUN)!.orderedStopIds).toEqual([stopId(2), stopId(1), stopId(3)]);
    await expect.poll(() => chipNames(page)).toEqual(["Studio Café", "Market Hall", "Harbour House"]);
    await expect(inspector.getByTestId("order-unsaved")).toHaveCount(0);
    await expect(inspector.getByRole("button", { name: "Save order" })).toBeDisabled();
    await page.reload();
    await expect.poll(() => chipNames(page)).toEqual(["Studio Café", "Market Hall", "Harbour House"]);
    await openRun(page);
    expect(await stopNames(page)).toEqual(["CPU", "Studio Café", "Market Hall", "Harbour House", "CPU"]);
    expectClean(issues, "reorder arrows");
  });

  test("reorder by dragging a stop row and by the keyboard handle; Reset discards the unsaved order", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    const rows = inspector.getByRole("list", { name: "Stops in visiting order" }).locator(":scope > li");
    await rows.nth(3).dragTo(rows.nth(1));
    expect(await stopNames(page)).toEqual(["CPU", "Harbour House", "Market Hall", "Studio Café", "CPU"]);
    await inspector.getByRole("button", { name: "Reset" }).click();
    expect(await stopNames(page)).toEqual(["CPU", "Market Hall", "Studio Café", "Harbour House", "CPU"]);
    await inspector.getByRole("button", { name: /Reorder Harbour House/ }).focus();
    await page.keyboard.press("ArrowUp");
    expect(await stopNames(page)).toEqual(["CPU", "Market Hall", "Harbour House", "Studio Café", "CPU"]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => commandsOf(server, "set-run-stop-order").length).toBe(1);
    expect(commandsOf(server, "set-run-stop-order")[0].stopIds).toEqual([stopId(1), stopId(3), stopId(2)]);
  });

  test("a rejected save keeps the unsaved order visible with the reason, never claims success, and a retry succeeds", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    server.failNext({ action: "set-run-stop-order", status: 422, message: "Run is planned; return it to planning before changing its structure." });
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "return it to planning" })).toBeVisible();
    await expect(inspector.getByTestId("order-unsaved")).toBeVisible();
    expect(server.run(RUN)!.orderedStopIds).toEqual([]);
    expect(await chipNames(page)).toEqual(["Market Hall", "Studio Café", "Harbour House"]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => server.run(RUN)!.orderedStopIds.length).toBe(3);
    await expect.poll(() => chipNames(page)).toEqual(["Studio Café", "Market Hall", "Harbour House"]);
  });

  test("a stale run version is rejected without overwriting; the latest state loads and the retry uses it", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    server.interfere(RUN); // another operator changed the run: expectedRunVersion is now stale
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "changed elsewhere" })).toBeVisible();
    expect(server.run(RUN)!.orderedStopIds).toEqual([]);
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => server.run(RUN)!.orderedStopIds.length).toBe(3);
    expect(commandsOf(server, "set-run-stop-order").at(-1)!.expectedRunVersion).toBe(server.run(RUN)!.version - 1);
  });

  test("an uncertain save (connection lost) is reported, not assumed; reconciling with the server shows the truth", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    server.failNext({ action: "set-run-stop-order", status: 0, message: "network" });
    await inspector.getByRole("button", { name: "Move Market Hall down" }).click();
    await inspector.getByRole("button", { name: "Save order" }).click();
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(inspector.getByTestId("order-unsaved")).toBeVisible();
    expect(await chipNames(page)).toEqual(["Market Hall", "Studio Café", "Harbour House"]);
    expect(server.run(RUN)!.orderedStopIds).toEqual([]);
  });

  test("Delete empty run: the menu offers it only for an empty planning run; confirmation, command, removal and refresh persistence", async ({ page }) => {
    const { server, issues } = await boot(page, assignedSeed());
    await runRow(page, RUN).getByRole("button", { name: "Run 1 actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete empty run" })).toBeDisabled();
    await page.keyboard.press("Escape");
    await runRow(page, EMPTY).getByRole("button", { name: "Run 2 actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Delete empty run" })).toBeEnabled();
    await page.getByRole("menuitem", { name: "Delete empty run" }).click();
    const confirm = inspectorOf(page).getByRole("alertdialog", { name: "Delete empty run" });
    await expect(confirm).toBeVisible();
    expect(commandsOf(server, "retire-empty-run")).toHaveLength(0);
    await confirm.getByRole("button", { name: "Delete empty run" }).click();
    await expect.poll(() => commandsOf(server, "retire-empty-run").length).toBe(1);
    expect(commandsOf(server, "retire-empty-run")[0]).toMatchObject({ runId: EMPTY });
    await expect(runRow(page, EMPTY)).toHaveCount(0);
    await page.reload();
    await expect(runRow(page, EMPTY)).toHaveCount(0);
    await expect(runRow(page, RUN)).toBeVisible();
    expectClean(issues, "retire");
  });

  test("retirement eligibility is decided by the server: work arriving after the screen loaded blocks the delete and nothing is lost", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await runRow(page, EMPTY).getByRole("button", { name: "Run 2 actions" }).click();
    await page.getByRole("menuitem", { name: "Delete empty run" }).click();
    // Another operator places work on the run without the UI knowing (version unchanged).
    server.state.jobs.find((job) => job.id === "job:4")!.runId = EMPTY;
    server.state.jobs.find((job) => job.id === "job:4")!.time = "13:00";
    await inspectorOf(page).getByRole("alertdialog", { name: "Delete empty run" }).getByRole("button", { name: "Delete empty run" }).click();
    await expect(page.getByRole("alert").filter({ hasText: /still contains operational work|work/ })).toBeVisible();
    expect(server.state.runs.find((run) => run.id === EMPTY)!.retired).toBeFalsy();
    await expect(runRow(page, EMPTY)).toBeVisible();
    await expect(runRow(page, EMPTY).getByRole("button", { name: /North Kitchen/ })).toBeVisible();
  });

  test("a populated run can never be deleted from the UI", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    await expect(inspectorOf(page).getByRole("button", { name: "Delete empty run" })).toHaveCount(0);
    await inspectorOf(page).getByRole("tab", { name: "Overview" }).click();
    await expect(inspectorOf(page)).toContainText("can’t be deleted");
    expect(commandsOf(server, "retire-empty-run")).toHaveLength(0);
  });

  test("Return to queue puts the job back in the queue and removes its chip (no lost job)", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Expand Studio Café" }).click();
    await inspector.getByRole("button", { name: "Return Studio Café to the queue" }).click();
    await expect.poll(() => commandsOf(server, "remove-job-from-load").length).toBe(1);
    expect(commandsOf(server, "remove-job-from-load")[0]).toMatchObject({ jobId: "job:2" });
    await expect.poll(() => chipNames(page)).toEqual(["Market Hall", "Harbour House"]);
    await expect(queueItem(page, "Studio Café")).toBeVisible();
    expect(server.state.jobs.find((job) => job.id === "job:2")!.runId).toBeUndefined();
  });

  test("+ Add collection creates a governed collection movement at the customer and puts it on the run (quantity, unit, description)", async ({ page }) => {
    const { server, issues } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Expand Studio Café" }).click();
    await inspector.getByRole("button", { name: /Add collection/ }).click();
    const form = inspector.getByRole("form", { name: "Add a collection at Studio Café" });
    await form.getByLabel("What is being collected").fill("Empty hot boxes");
    await form.getByLabel("Quantity").fill("3");
    await form.getByLabel("Unit").fill("boxes");
    await form.getByRole("button", { name: "Add collection" }).click();
    await expect.poll(() => commandsOf(server, "save-movement").length).toBe(1);
    const movement = commandsOf(server, "save-movement")[0].movement;
    expect(movement).toMatchObject({ type: "collection", fromOplocId: "site:2", serviceDate: DATE });
    expect(movement.items).toEqual([{ description: "Empty hot boxes", quantity: 3, unit: "boxes" }]);
    await expect.poll(() => commandsOf(server, "assign").length).toBe(1);
    expect(commandsOf(server, "assign")[0]).toMatchObject({ runId: RUN, movementId: movement.canonicalId });
    expect(server.state.movements.find((item) => item.id === movement.canonicalId)!.runId).toBe(RUN);
    expectClean(issues, "add collection");
  });

  test("a collection whose assignment is refused is kept in the queue with an explanation (nothing lost, no false success)", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Expand Studio Café" }).click();
    await inspector.getByRole("button", { name: /Add collection/ }).click();
    const form = inspector.getByRole("form", { name: "Add a collection at Studio Café" });
    await form.getByLabel("What is being collected").fill("Empty hot boxes");
    server.failNext({ action: "assign", status: 422, message: "Run is not open for planning." });
    await form.getByRole("button", { name: "Add collection" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "saved but could not be added" })).toBeVisible();
    expect(server.state.movements.some((item) => item.what === "Empty hot boxes" && !item.runId)).toBe(true);
    await expect(queueItem(page, "Studio Café")).toBeVisible();
  });

  test("queue-to-run drag onto the second run while the first is selected keeps the inspector and selection", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    await drag(page, await centre(queueItem(page, "North Kitchen")), await centre(runRow(page, EMPTY).locator("h3")));
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
    expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ jobId: "job:4", targetRunId: EMPTY, scheduledTime: "13:00" });
    await expect(inspectorOf(page)).toBeVisible();
    await expect(inspectorOf(page).getByRole("heading", { name: /Run 1/ })).toBeVisible();
  });
});
