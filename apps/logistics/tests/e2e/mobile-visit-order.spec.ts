import { expect, test } from "@playwright/test";
import { FakeLogisticsServer, installStatefulApi, ownerSeed } from "./planner-fake-server";

/**
 * The driver follows the dispatcher's saved visiting order (Run.orderedStopIds), not a client-side
 * re-sort by time. LOCAL fixture; the stored order deliberately contradicts the planned times.
 */
const DATE = "2026-10-28";
test("driver view lists stops in the saved visiting order, not by planned time", async ({ page }) => {
  const runId = `run:${DATE}:driver`;
  const seed = ownerSeed(DATE);
  seed.runs = [{ id: runId, vehicleId: "van1", status: "planned", dep: "07:00", ret: "13:00", orderedStopIds: [] }];
  seed.jobs = [
    { id: "job:a", destination: "Alpha Site", oploc: "site:a", what: "Lunch", quantity: 2, unit: "trays", runId, time: "09:00" },
    { id: "job:b", destination: "Bravo Site", oploc: "site:b", what: "Lunch", quantity: 2, unit: "trays", runId, time: "10:00" },
    { id: "job:c", destination: "Charlie Site", oploc: "site:c", what: "Lunch", quantity: 2, unit: "trays", runId, time: "11:00" },
  ];
  seed.movements = [];
  const server = new FakeLogisticsServer(seed);
  await installStatefulApi(page, server);
  const names = async () => (await page.getByRole("button", { name: /^Open details for / }).allTextContents()).length
    ? page.getByRole("button", { name: /^Open details for / }).evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || "").replace("Open details for ", "")))
    : [];
  await page.goto(`/mobile/van1?serviceDate=${DATE}`);
  await expect.poll(names).toEqual(["Alpha Site", "Bravo Site", "Charlie Site"]);
  // Franco saves Charlie first: the driver must see Charlie first even though it is the latest planned time.
  const run = server.run(runId)!;
  const ids = ["Charlie", "Alpha", "Bravo"].map((name) => `projection-stop:delivery:load:job:${name[0].toLowerCase()}`);
  server.apply({ action: "set-run-stop-order", runId, expectedRunVersion: run.version, stopIds: ids });
  await page.reload();
  await expect.poll(names).toEqual(["Charlie Site", "Alpha Site", "Bravo Site"]);
});
