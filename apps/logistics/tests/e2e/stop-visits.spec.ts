import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";

// Mounted app + the ACTUAL route/domain code on an isolated optimistic-transaction store (not the emulator).
const { fixture } = createRequire(import.meta.url)("../helpers/authority-route-harness.cjs");
const requirement = (f: any, id: string, site: string, label: string) => ({ canonicalId: "req:" + id, sourceDomain: "cpu-production", sourceEntityId: "order:" + id, sourceVersion: 1, sourceContentHash: "hash:" + id, serviceDate: f.date, productionLocationId: "cpu", destinationOplocId: site, destinationLabelSnapshot: label, requiredDeliveryWindow: { startTime: "10:00", endTime: "11:00" }, lines: [{ displayNameSnapshot: "Lunch " + id, quantity: 10, unit: "portion" }], status: "ready_for_planning" });
const records = (f: any, prefix: string) => [...f.records].filter(([key]: [string, unknown]) => key.startsWith(prefix + "/")).map(([, value]: [string, any]) => value);
const jobVersion = (f: any, id: string) => f.records.get("fikaLogisticsJobsV1/logistics-job:req:" + id).version;
const loadOfJob = (f: any, id: string) => f.records.get("fikaLogisticsDeliveryLoadsV1/" + f.records.get("fikaLogisticsJobsV1/logistics-job:req:" + id).activeLoadId);

async function seedDay() {
  const f = fixture(["van1", "van2"], ["logistics.reconcile"], true); f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith("fikaLogisticsDeliveryRunsV1/")) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  Object.assign(f.records.get("fikaLogisticsDeliveryRunsV1/r1"), { plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "16:00" });
  f.requirements.push(requirement(f, "mnk1", "site:mnk", "MNK"), requirement(f, "mnk2", "site:mnk", "MNK"), requirement(f, "angel", "site:angel", "Angel Court"));
  await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
  const assign = async (id: string, time: string, extra: Record<string, unknown> = {}) => {
    const loads = records(f, "fikaLogisticsDeliveryLoadsV1");
    const expectedLoadVersions = Object.fromEntries(loads.map((load: any) => [load.id, load.version]));
    const result = await f.post({ action: "assign-job-to-load", jobId: "logistics-job:req:" + id, targetRunId: "r1", scheduledTime: time, expectedJobVersion: jobVersion(f, id), expectedRunVersion: f.records.get("fikaLogisticsDeliveryRunsV1/r1").version, expectedLoadVersions, ...extra });
    expect(result.response.status, JSON.stringify(result.body)).toBe(200);
  };
  await assign("mnk1", "09:00"); await assign("mnk2", "09:30"); await assign("angel", "11:00");
  // MNK also has a collection on this Run: it joins the MNK visit by default => ONE mixed stop.
  const mnk = loadOfJob(f, "mnk1");
  const collection = await f.post({ action: "reschedule-delivery-load", lane: "collection", loadId: mnk.id, targetRunId: "r1", scheduledTime: "15:00", expectedLoadVersion: mnk.version });
  expect(collection.response.status, JSON.stringify(collection.body)).toBe(200);
  await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
  return { f, assign };
}

async function mount(page: Page, f: any) {
  const commands: Record<string, any>[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/drivers") return route.fulfill({ json: (await f.drivers()).body });
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); commands.push(body); const result = await f.post(body); return route.fulfill({ status: result.response.status, json: result.body }); }
    const projection = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date)) as LogisticsDayProjection;
    if (url.searchParams.has("syncHead")) return route.fulfill({ json: { sequence: projection.lastChangeSequence } });
    if (url.searchParams.has("weekSummary")) return route.fulfill({ json: { days: [] } });
    if (url.searchParams.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "visits" }, json: { ...projectionToDashboardData(projection), projection } });
  });
  await page.goto("/?ui=classic&serviceDate=" + f.date);
  await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 20_000 });
  await page.waitForLoadState("networkidle");
  return commands;
}
const rowsOf = (page: Page) => page.getByRole("complementary", { name: "Details inspector" }).getByRole("list", { name: "Stops in visiting order" }).locator(":scope > li");

for (const viewport of [{ width: 1536, height: 960 }, { width: 1280, height: 800 }]) {
  test(`Organise Run shows a mixed visit and an intentional repeat visit as separate physical stops · ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const { f, assign } = await seedDay();
    // Franco starts a deliberate repeat visit to MNK later in the day.
    f.requirements.push(requirement(f, "mnk3", "site:mnk", "MNK")); await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
    await assign("mnk3", "13:00", { visit: "new" });
    await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
    await mount(page, f);
    await page.locator("[data-journey-run-id='r1'] button").click();
    const rows = rowsOf(page);
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText("MNK");
    await expect(rows.nth(0)).toContainText("Delivery + Collection");
    await expect(rows.nth(0)).toContainText("2 deliveries · 1 collection");
    await expect(rows.nth(1)).toContainText("Angel Court");
    await expect(rows.nth(2)).toContainText("MNK");
    await expect(rows.nth(2)).toContainText("1 delivery");
    await rows.nth(0).getByText("3 pieces of work in this stop").click();
    await expect(rows.nth(0).locator("li")).toHaveCount(3);
    await rows.nth(0).scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    const directory = path.resolve(process.cwd(), "../../artifacts/logistics-desktop-uat/visits");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${viewport.width}x${viewport.height}-organise-run-mixed-and-repeat-visit.png`) });
  });
}

test("reordering whole visits persists, survives refresh and the driver view follows it (real route, mounted app)", async ({ page }) => {
  test.setTimeout(90_000);
  const { f } = await seedDay();
  const commands = await mount(page, f);
  await page.locator("[data-journey-run-id='r1'] button").click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  const rows = rowsOf(page);
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(0)).toContainText("MNK");
  await inspector.getByRole("button", { name: "Move MNK down" }).click();
  await inspector.getByRole("button", { name: "Save order" }).click();
  await expect.poll(() => commands.filter((command) => command.action === "set-run-stop-order").length).toBe(1);
  const sent = commands.find((command) => command.action === "set-run-stop-order")!;
  expect(sent.stopIds).toHaveLength(2);
  expect(sent.stopIds[1]).toMatch(/^projection-visit:visit:/);
  expect(f.records.get("fikaLogisticsDeliveryRunsV1/r1").orderedStopIds).toEqual(sent.stopIds);
  await page.reload();
  await page.locator("[data-journey-run-id='r1'] button").click();
  await expect(rowsOf(page).nth(0)).toContainText("Angel Court");
  await expect(rowsOf(page).nth(1)).toContainText("MNK");
  // The driver app reads the same projection: Angel Court is now first, MNK's delivery and collection stay adjacent.
  await page.clock.install({ time: new Date(f.date + "T12:00:00Z") });
  await page.goto("/mobile/van1?serviceDate=" + f.date);
  await expect(page.getByRole("button", { name: /^Open details for / }).first()).toBeVisible({ timeout: 20_000 });
  const names = await page.getByRole("button", { name: /^Open details for / }).evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || "").replace("Open details for ", "")));
  expect(names[0]).toBe("Angel Court");
});

test("assignment asks which visit only when the customer has several on the Run; New visit is explicit; Cancel changes nothing", async ({ page }) => {
  test.setTimeout(90_000);
  const { f, assign } = await seedDay();
  f.requirements.push(requirement(f, "mnk3", "site:mnk", "MNK"), requirement(f, "mnk4", "site:mnk", "MNK")); await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
  await assign("mnk3", "13:00", { visit: "new" }); // MNK now has two visits on r1
  await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
  await mount(page, f);
  const before = JSON.stringify([...f.records]);
  // Drop MNK work on the run: the planner must ask, because it would otherwise have to guess.
  const card = page.locator('[data-timeline-queue-id="projection-job:logistics-job:req:mnk4"] .mock-queue-main');
  const block = page.locator("[data-journey-run-id='r1'] button");
  await card.scrollIntoViewIfNeeded();
  const from = (await card.boundingBox())!; const to = (await block.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2); await page.mouse.down();
  await page.mouse.move(from.x + 80, from.y - 20, { steps: 4 }); await page.mouse.move(to.x + 200, to.y + to.height / 2, { steps: 10 }); await page.mouse.up();
  const dialog = page.getByRole("dialog", { name: "Which visit?" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toBeFocused();
  await expect(dialog.getByRole("button", { name: "New visit" })).toBeVisible();
  const box = (await dialog.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(JSON.stringify([...f.records])).toBe(before);
  // Choose New visit (re-measure: the page may have shifted).
  await page.waitForTimeout(300);
  await card.scrollIntoViewIfNeeded();
  const again = (await card.boundingBox())!; const target = (await block.boundingBox())!;
  await page.mouse.move(again.x + again.width / 2, again.y + again.height / 2); await page.mouse.down();
  await page.mouse.move(again.x + 80, again.y - 20, { steps: 4 }); await page.mouse.move(target.x + 200, target.y + target.height / 2, { steps: 10 }); await page.mouse.up();
  await page.getByRole("dialog", { name: "Which visit?" }).getByRole("button", { name: "New visit" }).click();
  await expect.poll(() => new Set(records(f, "fikaLogisticsDeliveryLoadsV1").filter((load: any) => load.destinationOplocId === "site:mnk" && load.runId === "r1").map((load: any) => load.deliveryVisitId)).size).toBe(3);
});
