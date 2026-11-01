import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";
import { centre, drag, selectRun } from "./v3-helpers";

/**
 * Journey Planner V3 mounted in the real planner page against the ACTUAL route/domain code on an isolated
 * optimistic-transaction store (tests/helpers/authority-route-harness.cjs). Not the Firestore emulator; the emulator
 * covers the same commands in tests/api.integration.ts. Proves Franco can build a complete Run with the new interface
 * and that every confirmed change survives a refresh.
 */
const { fixture } = createRequire(import.meta.url)("../helpers/authority-route-harness.cjs");
const requirement = (f: any, id: string, site: string, label: string) => ({ canonicalId: "req:" + id, sourceDomain: "cpu-production", sourceEntityId: "order:" + id, sourceVersion: 1, sourceContentHash: "hash:" + id, serviceDate: f.date, productionLocationId: "cpu", destinationOplocId: site, destinationLabelSnapshot: label, requiredDeliveryWindow: { startTime: "10:00", endTime: "11:00" }, lines: [{ displayNameSnapshot: "Lunch " + id, quantity: 10, unit: "portion" }], status: "ready_for_planning" });
const records = (f: any, prefix: string) => [...f.records].filter(([key]: [string, unknown]) => key.startsWith(prefix + "/")).map(([, value]: [string, any]) => value);
const loadsOf = (f: any, run = "r1") => records(f, "fikaLogisticsDeliveryLoadsV1").filter((load: any) => load.runId === run && load.destinationOplocId.startsWith("site:") && !["l1", "l2"].includes(load.id));
const nativeStops = (f: any) => records(f, "fikaLogisticsDeliveryStopsV1").filter((stop: any) => !["s1", "s2"].includes(stop.canonicalId));

async function seedDay() {
  const f = fixture(["van1", "van2"], ["logistics.reconcile"], true); f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith("fikaLogisticsDeliveryRunsV1/")) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  Object.assign(f.records.get("fikaLogisticsDeliveryRunsV1/r1"), { plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "16:00" });
  f.oplocs.push({ id: "site:mnk", label: "MNK" }, { id: "site:angel", label: "Angel Court" }, { id: "cpu", label: "CPU" });
  f.requirements.push(requirement(f, "mnk1", "site:mnk", "MNK"), requirement(f, "mnk2", "site:mnk", "MNK"), requirement(f, "angel", "site:angel", "Angel Court"));
  await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
  await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
  return f;
}

async function mount(page: Page, f: any) {
  const commands: Record<string, any>[] = [];
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    // This isolated route-ordering fixture models an already authenticated Van 1
    // session. Actual PIN/session denial and isolation have separate server tests.
    if (url.pathname === "/api/logistics/mobile/session") {
      const vehicle = url.searchParams.get("vehicle");
      return route.fulfill({ status: vehicle === "van1" ? 200 : 401, json: vehicle === "van1" ? { vehicleId: "van1" } : { error: { message: "No fixture session for this van." } } });
    }
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/locations") return route.fulfill({ json: { oplocs: f.oplocs } });
    if (url.pathname === "/api/logistics/drivers") return route.fulfill({ json: (await f.drivers()).body });
    if (route.request().method() === "POST") { const body = route.request().postDataJSON(); commands.push(body); const result = await f.post(body); return route.fulfill({ status: result.response.status, json: result.body }); }
    const projection = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date)) as LogisticsDayProjection;
    if (url.searchParams.has("syncHead")) return route.fulfill({ json: { sequence: projection.lastChangeSequence } });
    if (url.searchParams.has("weekSummary")) return route.fulfill({ json: { days: [] } });
    if (url.searchParams.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "visits" }, json: { ...projectionToDashboardData(projection), projection } });
  });
  await page.goto("/?serviceDate=" + f.date);
  await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await selectRun(page, "r1");
  return commands;
}

const row = (page: Page, runId: string) => page.locator(`[data-run-id="${runId}"]`);
const card = (page: Page, req: string) => page.locator(`[data-logistics-planning-queue] [data-timeline-queue-id="projection-job:logistics-job:req:${req}"]`);
const chips = (page: Page, runId: string) => page.locator(`[data-run-stops="${runId}"]`).locator("ol[aria-label^='Visiting sequence'] li button").evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || "").replace(/^Stop \d+, /, "").replace(/\. Open stop$/, "")));
const inspector = (page: Page) => page.getByRole("complementary", { name: "Run inspector" });
async function dropOnRun(page: Page, req: string, runId: string) { await selectRun(page, runId); await drag(page, await centre(card(page, req)), await centre(row(page, runId).locator("h3"))); }

test.describe("Journey Planner V3 · real route/domain code · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("Franco builds a complete Run with the new interface and every confirmed change survives refresh", async ({ page }) => {
    test.setTimeout(150_000);
    const f = await seedDay();
    const commands = await mount(page, f);
    const done = (action: string) => commands.filter((command) => command.action === action);

    // 1. Create a Run for Van 2 with the Van selector.
    await page.getByRole("button", { name: "New Run", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "New Run" });
    await dialog.locator("label", { hasText: "Van 2" }).click();
    await dialog.getByLabel("Planned CPU departure").fill("13:00");
    await dialog.getByLabel("Planned CPU return").fill("16:00");
    await dialog.getByRole("button", { name: "Create Run" }).click();
    await expect.poll(() => records(f, "fikaLogisticsDeliveryRunsV1").filter((run: any) => run.vehicleId === "van2" && run.plannedCpuDepartureTime === "13:00").length).toBe(1);
    await expect(page.locator("[data-vehicle-row]")).toHaveCount(2);

    // 2. Drag unassigned work onto Run 1 (r1). The requested time is used; the second MNK job joins the same visit.
    await expect(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]")).toHaveCount(3);
    await dropOnRun(page, "mnk1", "r1");
    await expect.poll(() => chips(page, "r1")).toEqual(["MNK: 1 delivery, 0 collections"]);
    await expect(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]")).toHaveCount(2);
    await dropOnRun(page, "mnk2", "r1");
    await expect.poll(() => chips(page, "r1")).toEqual(["MNK: 2 deliveries, 0 collections"]);
    const visitIds = new Set(loadsOf(f).map((load: any) => load.deliveryVisitId));
    expect(visitIds.size).toBe(1);
    expect([...visitIds][0]).toBeTruthy();
    await dropOnRun(page, "angel", "r1");
    await expect.poll(() => chips(page, "r1")).toEqual(["MNK: 2 deliveries, 0 collections", "Angel Court: 1 delivery, 0 collections"]);
    await expect(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]")).toHaveCount(0);
    expect(done("assign-job-to-load")).toHaveLength(3);
    expect(new Set(done("assign-job-to-load").map((command) => command.jobId)).size).toBe(3);

    // 3. + Add collection inside the MNK stop: governed movement at the customer, joined to the visit => still ONE chip.
    await page.locator('[data-run-stops="r1"]').getByRole("button", { name: /MNK/ }).click();
    await expect(inspector(page)).toBeVisible();
    await inspector(page).getByRole("button", { name: /Add collection/ }).click();
    const form = inspector(page).getByRole("form", { name: "Add a collection at MNK" });
    await form.getByLabel("What is being collected").fill("Empty hot boxes");
    await form.getByLabel("Quantity").fill("4");
    await form.getByLabel("Unit").fill("boxes");
    await form.getByRole("button", { name: "Add collection" }).click();
    await expect.poll(() => nativeStops(f).length).toBe(1);
    const native = nativeStops(f)[0];
    expect(native.visitId).toBe([...visitIds][0]);
    expect(native.locationOplocId).toBe("site:mnk");
    const movement = records(f, "fikaMovementRequestsV1").concat(records(f, "fikaLogisticsMovementsV1")).find((item: any) => item.type === "collection") || [...f.records].map(([, value]: [string, any]) => value).find((item: any) => item?.entityType === "Movement Request");
    expect(movement.items).toEqual([{ description: "Empty hot boxes", quantity: 4, unit: "boxes" }]);
    expect(movement.fromOplocId).toBe("site:mnk");
    await expect.poll(() => chips(page, "r1")).toEqual(["MNK: 2 deliveries, 1 collection", "Angel Court: 1 delivery, 0 collections"]);
    expect(loadsOf(f).every((load: any) => load.runId === "r1" && load.destinationOplocId === "site:mnk" || load.destinationOplocId === "site:angel")).toBe(true);

    // 4. Organise: Angel Court first. Unsaved, then saved through the version-checked command.
    await inspector(page).getByRole("button", { name: "Move Angel Court up" }).click();
    await expect(inspector(page).getByTestId("order-unsaved")).toBeVisible();
    await inspector(page).getByRole("button", { name: "Save order" }).click();
    await expect.poll(() => done("set-run-stop-order").length).toBe(1);
    const saved = f.records.get("fikaLogisticsDeliveryRunsV1/r1").orderedStopIds;
    expect(saved).toHaveLength(2);
    expect(saved[1]).toMatch(/^projection-visit:visit:/);
    await expect.poll(() => chips(page, "r1")).toEqual(["Angel Court: 1 delivery, 0 collections", "MNK: 2 deliveries, 1 collection"]);

    // 5. Exact times in the inspector.
    await inspector(page).getByRole("button", { name: "Edit times" }).click();
    await inspector(page).getByLabel("CPU departure").fill("08:00");
    await inspector(page).getByLabel("CPU return").fill("15:00");
    await inspector(page).getByRole("button", { name: "Save times" }).click();
    await expect.poll(() => f.records.get("fikaLogisticsDeliveryRunsV1/r1").plannedCpuDepartureTime).toBe("08:00");

    // 6. Everything confirmed survives a refresh.
    await page.reload();
    await selectRun(page, "r1");
    await expect(row(page, "r1")).toContainText("08:00 – 15:00");
    await expect.poll(() => chips(page, "r1")).toEqual(["Angel Court: 1 delivery, 0 collections", "MNK: 2 deliveries, 1 collection"]);
    await expect(page.locator('[data-run-bar="r1"]')).toBeVisible();

    // 7. The driver app shows the SAME confirmed route order.
    await page.clock.install({ time: new Date(f.date + "T12:00:00Z") });
    await page.goto("/mobile/van1?serviceDate=" + f.date);
    await expect(page.getByRole("button", { name: /^Open details for / }).first()).toBeVisible({ timeout: 20_000 });
    const names = await page.getByRole("button", { name: /^Open details for / }).evaluateAll((buttons) => buttons.map((button) => (button.getAttribute("aria-label") || "").replace("Open details for ", "").replace(/\s+(delivery|collection)$/, "")));
    expect(names[0]).toBe("Angel Court");
    expect(names.slice(1).every((name) => name === "MNK")).toBe(true);

    // 8. The untouched Van 2 run is empty and eligible: retire it through the audited command; it stays gone after refresh.
    await page.goto("/?serviceDate=" + f.date);
    await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 20_000 });
    const emptyRuns = records(f, "fikaLogisticsDeliveryRunsV1").filter((run: any) => run.canonicalId === "r2");
    expect(emptyRuns).toHaveLength(1);
    await selectRun(page, "r2");
    await row(page, "r2").getByRole("button", { name: /actions$/ }).click();
    await page.getByRole("menuitem", { name: "Delete empty run" }).click();
    await inspector(page).getByRole("alertdialog", { name: "Delete empty run" }).getByRole("button", { name: "Delete empty run" }).click();
    await expect.poll(() => f.records.get("fikaLogisticsDeliveryRunsV1/r2").retiredAt).toBeTruthy();
    await page.reload();
    await expect(row(page, "r2")).toHaveCount(0);
    await selectRun(page, "r1");
    await expect(row(page, "r1")).toBeVisible();
    // r1 is populated: no UI path and no command may retire it
    const refused = await f.post({ action: "retire-empty-run", runId: "r1", expectedRunVersion: f.records.get("fikaLogisticsDeliveryRunsV1/r1").version });
    expect(refused.response.status).toBeGreaterThanOrEqual(400);
    expect(f.records.get("fikaLogisticsDeliveryRunsV1/r1").retiredAt).toBeUndefined();
  });

  test("assignment asks which visit only when the customer has several; Cancel changes nothing; New visit is explicit; an existing visit can be chosen", async ({ page }) => {
    test.setTimeout(120_000);
    const f = await seedDay();
    f.requirements.push(requirement(f, "mnk3", "site:mnk", "MNK"), requirement(f, "mnk4", "site:mnk", "MNK"));
    await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
    // two visits at MNK on r1: the first, and a deliberate repeat visit
    const post = async (id: string, extra: Record<string, unknown>) => {
      const jobVersion = f.records.get("fikaLogisticsJobsV1/logistics-job:req:" + id).version;
      const loads = records(f, "fikaLogisticsDeliveryLoadsV1");
      const result = await f.post({ action: "assign-job-to-load", jobId: "logistics-job:req:" + id, targetRunId: "r1", scheduledTime: "09:00", expectedJobVersion: jobVersion, expectedRunVersion: f.records.get("fikaLogisticsDeliveryRunsV1/r1").version, expectedLoadVersions: Object.fromEntries(loads.map((load: any) => [load.id, load.version])), ...extra });
      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    };
    await post("mnk1", {}); await post("mnk2", { scheduledTime: "13:00", visit: "new" });
    await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
    const commands = await mount(page, f);
    await expect.poll(() => chips(page, "r1")).toEqual(["MNK: 1 delivery, 0 collections", "MNK: 1 delivery, 0 collections"]);
    const before = JSON.stringify([...f.records]);
    await dropOnRun(page, "mnk3", "r1");
    const chooser = page.getByRole("dialog", { name: "Which visit?" });
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole("button", { name: "New visit" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(chooser).toHaveCount(0);
    expect(JSON.stringify([...f.records])).toBe(before);
    await page.waitForTimeout(300);
    await dropOnRun(page, "mnk3", "r1");
    await page.getByRole("dialog", { name: "Which visit?" }).getByRole("button", { name: "New visit" }).click();
    await expect.poll(() => new Set(loadsOf(f).map((load: any) => load.deliveryVisitId)).size).toBe(3);
    await expect.poll(() => chips(page, "r1")).toHaveLength(3);
    // choose an EXISTING visit (the first option) for the last job: no new visit is created
    await page.waitForTimeout(300);
    await dropOnRun(page, "mnk4", "r1");
    const second = page.getByRole("dialog", { name: "Which visit?" });
    await expect(second).toBeVisible();
    await second.locator("ul button").first().click();
    await expect.poll(() => loadsOf(f).length).toBe(4);
    expect(new Set(loadsOf(f).map((load: any) => load.deliveryVisitId)).size).toBe(3);
    await expect.poll(() => chips(page, "r1")).toHaveLength(3);
    expect(commands.filter((command) => command.action === "assign-job-to-load").length).toBeGreaterThanOrEqual(2);
  });

  test("work for a customer with ONE visit on the Run joins it automatically, whatever its planned time", async ({ page }) => {
    test.setTimeout(90_000);
    const f = await seedDay();
    f.requirements.push(requirement(f, "mnk3", "site:mnk", "MNK"));
    await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
    const assign = async (id: string, time: string) => {
      const loads = records(f, "fikaLogisticsDeliveryLoadsV1");
      const result = await f.post({ action: "assign-job-to-load", jobId: "logistics-job:req:" + id, targetRunId: "r1", scheduledTime: time, expectedJobVersion: f.records.get("fikaLogisticsJobsV1/logistics-job:req:" + id).version, expectedRunVersion: f.records.get("fikaLogisticsDeliveryRunsV1/r1").version, expectedLoadVersions: Object.fromEntries(loads.map((load: any) => [load.id, load.version])) });
      expect(result.response.status, JSON.stringify(result.body)).toBe(200);
    };
    await assign("mnk1", "09:00");
    await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
    const commands = await mount(page, f);
    await expect.poll(() => chips(page, "r1")).toHaveLength(1);
    const before = new Set(loadsOf(f).map((load: any) => load.deliveryVisitId));
    expect(before.size).toBe(1);
    const queued = await page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]").evaluateAll((items) => items.map((item) => item.getAttribute("data-timeline-queue-id")));
    const target = queued.find((id) => id && /mnk(2|3)/.test(id));
    expect(target).toBeTruthy();
    await drag(page, await centre(page.locator(`[data-logistics-planning-queue] [data-timeline-queue-id="${target}"]`)), await centre(row(page, "r1").locator("h3")));
    await expect.poll(() => commands.filter((command) => command.action === "assign-job-to-load").length).toBe(1);
    await expect(page.getByRole("dialog", { name: "Which visit?" })).toHaveCount(0);
    await expect.poll(() => loadsOf(f).length).toBeGreaterThanOrEqual(1);
    await expect.poll(() => new Set(loadsOf(f).map((load: any) => load.deliveryVisitId)).size).toBe(1);
    await expect.poll(() => chips(page, "r1")).toHaveLength(1);
  });

  test("non-drag assignment: open the queue item, choose the run and time; the same visit rules apply", async ({ page }) => {
    test.setTimeout(90_000);
    const f = await seedDay();
    await mount(page, f);
    await card(page, "angel").locator("button").first().click();
    const panel = page.getByRole("complementary", { name: "Details inspector" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Assign to vehicle" }).click();
    await panel.getByLabel("Target delivery run").selectOption("r1");
    await panel.getByLabel("Schedule time").fill("10:00");
    await panel.getByRole("button", { name: "Assign eligible" }).click();
    await expect.poll(() => loadsOf(f).length).toBe(1);
    await expect(panel).toHaveCount(0);
    await selectRun(page, "r1");
    await expect.poll(() => chips(page, "r1")).toEqual(["Angel Court: 1 delivery, 0 collections"]);
  });
});

void ({} as never);
