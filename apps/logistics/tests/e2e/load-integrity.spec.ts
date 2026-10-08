import { expect, test, type Page } from "@playwright/test";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";
import { createRequire } from "node:module";
// Actual API/domain handlers with an isolated optimistic-transaction test store.
// This proves mounted client intent parity, not Firestore emulator integration.
const { fixture } = createRequire(import.meta.url)("../helpers/authority-route-harness.cjs");

async function scenario(page: Page, collection = false, merged = false) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  const f = fixture(["van1", "van2"], ["logistics.reconcile"], true); f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith("fikaLogisticsDeliveryRunsV1/")) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  f.requirements.push({ canonicalId: "req:a", sourceDomain: "cpu-production", sourceEntityId: "order:a", sourceVersion: 1, workstream: "Hospitality", serviceDate: f.date, productionLocationId: "cpu", destinationOplocId: "site", destinationLabelSnapshot: "Batch Two Site", requiredDeliveryWindow: { startTime: "10:00", endTime: "11:00" }, status: "ready_for_planning", lines: [{ displayNameSnapshot: "Lunch", quantity: 10, unit: "portion" }] });
  await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
  f.seed("fikaLogisticsCollectionPreferencesV1", encodeURIComponent("projection-job:logistics-job:req:a"), { groupKey: "projection-job:logistics-job:req:a", serviceDate: f.date, collectionRequired: true });
  await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
  if (collection) {
    const result = await f.post({ action: "assign-job-to-load", jobId: "logistics-job:req:a", targetRunId: "r1", scheduledTime: "10:30", expectedJobVersion: 1, collectionRequired: true });
    expect(result.response.status).toBe(200);
  }
  if (merged) {
    const loadEntry = [...f.records.entries()].find(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/"))!;
    const job = f.records.get("fikaLogisticsJobsV1/logistics-job:req:a");
    const assignment = [...f.records.entries()].find(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/"))![1];
    f.seed("fikaLogisticsDeliveryLoadsV1", "legacy-merged:b", { ...loadEntry[1], id: "legacy-merged:b" });
    f.seed("fikaLogisticsJobsV1", "logistics-job:req:b", { ...job, id: "logistics-job:req:b", sourceId: "order:b", requirementId: "req:b", activeLoadId: "legacy-merged:b" });
    f.seed("fikaLogisticsAssignmentsV1", "assignment:b", { ...assignment, jobId: "logistics-job:req:b", loadId: "legacy-merged:b" });
    await f.materialisation.rebuildLogisticsProjection(f.date, "Operator");
  }
  const commands: Record<string, any>[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/logistics/drivers") return route.fulfill({ json: (await f.drivers()).body });
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); commands.push(body);
      const result = await f.post(body);
      return route.fulfill({ status: result.response.status, json: result.body });
    }
    const projection = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date)) as LogisticsDayProjection;
    if (url.searchParams.has("syncHead")) return route.fulfill({ json: { sequence: projection.lastChangeSequence } });
    if (url.searchParams.has("weekSummary")) return route.fulfill({ json: { days: [] } });
    if (url.searchParams.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "batch2" }, json: { ...projectionToDashboardData(projection), projection } });
  });
  await page.goto("/?serviceDate=" + f.date);
  return { f, commands };
}

async function dropQueue(page: Page, lane: "delivery" | "collection", time: string, run = "r1", groupPrefix = lane === "delivery" ? "job" : "collection") {
  const source = page.locator(`[data-timeline-queue-id^="projection-${groupPrefix}:"]`).first();
  await source.scrollIntoViewIfNeeded();
  const card = await source.locator(".mock-queue-main").boundingBox();
  const viewport = page.getByTestId("mounted-timeline-viewport");
  const row = page.locator(`[data-lane="${run}:${lane}"]`);
  const rowBox = await row.boundingBox(); const viewBox = await viewport.boundingBox();
  if (!card || !rowBox || !viewBox) throw new Error("Timeline geometry unavailable");
  const scale = await page.getByTestId("mounted-react-timeline").evaluate(element => Number.parseFloat(getComputedStyle(element).getPropertyValue("--timeline-quarter-hour")) / 15);
  const minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  await page.mouse.move(card.x + 6, card.y + card.height / 2); await page.mouse.down(); await page.mouse.move(card.x + 20, card.y + card.height / 2 + 6);
  await viewport.evaluate((element, scroll) => { element.scrollLeft = scroll; }, Math.max(0, rowBox.x + await viewport.evaluate(element => element.scrollLeft) - viewBox.x + minute * scale - viewBox.width * .55));
  const track = await row.boundingBox(); if (!track) throw new Error("Target lane unavailable");
  await page.mouse.move(track.x + minute * scale, track.y + track.height / 2, { steps: 10 });
  const settled = await row.boundingBox(); if (!settled) throw new Error("Target lane unavailable after scrolling");
  await page.mouse.move(settled.x + minute * scale + 2, settled.y + settled.height / 2);
  await expect(page.getByTestId("mounted-drag-ghost")).toContainText(time);
  await page.mouse.up();
}

test("advisory source timing permits placement and an untimed delivery gets an editable 30-minute window", async ({ page }) => {
  const { f } = await scenario(page);
  const queue = page.locator('[data-timeline-queue-id^="projection-job:"]').first();
  await queue.getByRole("button", { name: "Details", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await expect(inspector).toContainText("Hospitality");
  await expect(inspector).toContainText("Preferred source timing");
  await expect(inspector).toContainText("10:00–11:00");
  await expect(inspector).toContainText("Advisory timing");
  await expect(inspector).toContainText("10 portion · Lunch");
  await inspector.getByRole("button", { name: "Close inspector" }).click();

  await dropQueue(page, "delivery", "12:00");
  await expect.poll(() => f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0]?.scheduledTime).toBe("12:00");
  const projectionLoad = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  expect(projectionLoad.scheduledEnd).toBe("12:30");
  expect(projectionLoad.loadIds).toHaveLength(1);
  const canonicalJob = f.records.get("fikaLogisticsJobsV1/logistics-job:req:a");
  expect(canonicalJob.requestedWindow).toEqual({ startTime: "10:00", endTime: "11:00" });

  const card = page.getByTestId(`stop-projection-stop:delivery:${projectionLoad.id}`);
  await expect(card).toBeVisible();
  await expect(card.getByTestId("timeline-card-full-time")).toHaveText("12:00–12:30");
  await card.click();
  const assignedInspector = page.getByRole("complementary", { name: "Details inspector" });
  await expect(assignedInspector).toContainText("Scheduled timing");
  await expect(assignedInspector).toContainText("Preferred source timing");
  await expect(assignedInspector).toContainText("10:00–11:00");
  await expect(assignedInspector).toContainText("Vehicle / run");
  await expect(assignedInspector).toContainText("Collection");
  const resize = page.getByTestId(`resize-projection-stop:delivery:${projectionLoad.id}`);
  await expect(resize).toBeVisible();
  await assignedInspector.getByRole("button", { name: "Close inspector" }).click();
  await page.reload();
  const reloaded = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  expect(reloaded.id).toBe(projectionLoad.id);
  expect(reloaded.scheduledTime).toBe("12:00");
  expect(reloaded.scheduledEnd).toBe("12:30");
  await page.getByTestId(`resize-projection-stop:delivery:${reloaded.id}`).focus();
  await page.keyboard.press("ArrowRight");
  await expect.poll(() => f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0]?.scheduledEnd).toBe("12:45");
  expect(f.records.get("fikaLogisticsDeliveryLoadsV1/" + projectionLoad.id).scheduledTime).toBe("12:00");
  expect(f.records.get("fikaLogisticsJobsV1/logistics-job:req:a").requestedWindow).toEqual({ startTime: "10:00", endTime: "11:00" });
});

for (const merged of [false, true]) for (const entry of ["set-time", "drag"] as const) test(`${merged ? "merged" : "single"} cleared assigned delivery reloads into Needs time and ${entry} schedules the same canonical loads`, async ({ page }) => {
  const { f, commands } = await scenario(page, true, merged);
  const initial = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  const originalAssignments = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/"));
  const originalJobs = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsJobsV1/"));
  await page.getByTestId(`stop-projection-stop:delivery:${initial.id}`).click();
  await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Clear time", exact: true }).click();
  await expect.poll(() => f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0].scheduledTime).toBeUndefined();
  await page.reload();
  const cleared = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0]);
  const queue = page.locator(`[data-timeline-queue-id="projection-delivery:${cleared.id}"]`);
  await expect(queue).toBeVisible();
  await expect(queue).toContainText("Time not confirmed");
  await expect(page.locator(`[data-timeline-queue-id="projection-collection:${cleared.id}"]`)).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Planning queue", exact: true }).getByRole("button", { name: /^Needs time/ })).toHaveText("Needs time 2");
  if (entry === "drag") await dropQueue(page, "delivery", "10:45", "r1", "delivery");
  else {
    await queue.getByRole("button", { name: "Set time", exact: true }).click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByRole("button", { name: "Set delivery time", exact: true }).click();
    await expect(inspector.getByLabel("Target delivery run", { exact: true })).toHaveValue("r1");
    await inspector.getByLabel("Schedule time", { exact: true }).fill("10:45");
    await inspector.getByLabel("Schedule window end", { exact: true }).fill("11:15");
    await inspector.getByRole("button", { name: "Set time", exact: true }).click();
  }
  await expect.poll(() => commands.filter(command => command.action === "reschedule-delivery-loads").length).toBe(1);
  const command = commands.find(command => command.action === "reschedule-delivery-loads")!;
  expect(command.loadIds).toEqual(cleared.loadIds);
  expect(command.expectedLoadVersions).toEqual(cleared.loadVersions);
  expect(command.lane).toBe("delivery"); expect(command.targetRunId).toBe("r1");
  await expect.poll(() => f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0].scheduledTime).toBe("10:45");
  const after = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  expect(after.id).toBe(initial.id); expect(after.loadIds).toEqual(initial.loadIds);
  expect(after.scheduledEnd).toBe("11:15");
  expect(new Set(Object.keys(after.loadVersions))).toEqual(new Set(initial.loadIds));
  for (const id of initial.loadIds) {
    const load = f.records.get("fikaLogisticsDeliveryLoadsV1/" + id);
    expect(load.version).toBe(cleared.loadVersions[id] + 1); expect(load.runId).toBe("r1");
    expect(load.collectionRequired).toBe(true); expect(load.collectionScheduledTime).toBeUndefined();
  }
  expect([...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/"))).toEqual(originalAssignments);
  expect([...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsJobsV1/"))).toEqual(originalJobs);
  expect([...f.records.keys()].filter((key: string) => key.startsWith("fikaLogisticsDeliveryLoadsV1/"))).toHaveLength(initial.loadIds.length);
  await page.reload();
  await expect(page.getByTestId(`stop-projection-stop:delivery:${after.id}`)).toBeVisible();
  await expect(page.getByTestId(`stop-projection-stop:delivery:${after.id}`)).toHaveCSS("cursor", "move");
  await expect(page.getByTestId(`resize-projection-stop:delivery:${after.id}`)).toHaveCSS("cursor", "ew-resize");
  await expect(page.locator(`[data-timeline-queue-id="projection-delivery:${after.id}"]`)).toHaveCount(0);
  await expect(page.locator(`[data-timeline-queue-id="projection-collection:${after.id}"]`)).toBeVisible();
});

test("stale assigned untimed delivery queue cannot overwrite a newer canonical placement", async ({ page }) => {
  const { f, commands } = await scenario(page, true, true);
  let group = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  await f.post({ action: "clear-delivery-load-schedule", loadIds: group.loadIds, expectedLoadVersions: group.loadVersions });
  await page.reload();
  group = structuredClone(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0]);
  await page.locator(`[data-timeline-queue-id="projection-delivery:${group.id}"]`).getByRole("button", { name: "Set time", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await inspector.getByRole("button", { name: "Set delivery time", exact: true }).click();
  await inspector.getByLabel("Schedule time", { exact: true }).fill("11:00");
  const newer = await f.post({ action: "reschedule-delivery-loads", loadIds: group.loadIds, expectedLoadVersions: group.loadVersions, targetRunId: "r1", lane: "delivery", scheduledTime: "10:45" });
  expect(newer.response.status).toBe(200);
  const confirmed = structuredClone([...f.records.entries()].filter(([key]: [string, any]) => /fikaLogistics(DeliveryLoads|Jobs|Assignments)V1\//.test(key)));
  await inspector.getByRole("button", { name: "Set time", exact: true }).click();
  await expect.poll(() => commands.filter(command => command.action === "reschedule-delivery-loads").length).toBe(1);
  expect(commands.find(command => command.action === "reschedule-delivery-loads")!.expectedLoadVersions).toEqual(group.loadVersions);
  await expect(page.getByTestId(`stop-projection-stop:delivery:${group.id}`)).toBeVisible();
  await expect(page.getByRole("button", { name: /Move .*10:45/ })).toBeVisible();
  expect([...f.records.entries()].filter(([key]: [string, any]) => /fikaLogistics(DeliveryLoads|Jobs|Assignments)V1\//.test(key))).toEqual(confirmed);
});

test("collision-adjusted cleared delivery placement preserves the chosen window duration", async ({ page }) => {
  const { f, commands } = await scenario(page, true);
  const original = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads[0];
  await f.post({ action: "clear-delivery-load-schedule", loadIds: original.loadIds, expectedLoadVersions: original.loadVersions });
  f.requirements.push({ ...f.requirements[0], canonicalId: "req:obstacle", sourceEntityId: "order:obstacle", destinationOplocId: "site:other", destinationLabelSnapshot: "Other destination" });
  await f.materialisation.reconcileLogisticsDay(f.date, "Operator");
  const assigned = await f.post({ action: "assign-job-to-load", jobId: "logistics-job:req:obstacle", expectedJobVersion: 1, targetRunId: "r1", scheduledTime: "10:45", scheduledEnd: "11:00" });
  expect(assigned.response.status).toBe(200);
  await page.reload();
  await page.locator(`[data-timeline-queue-id="projection-delivery:${original.id}"]`).getByRole("button", { name: "Set time", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await inspector.getByRole("button", { name: "Set delivery time", exact: true }).click();
  await inspector.getByLabel("Schedule time", { exact: true }).fill("10:45");
  await inspector.getByLabel("Schedule window end", { exact: true }).fill("11:15");
  await inspector.getByRole("button", { name: "Set time", exact: true }).click();
  await expect.poll(() => commands.filter(command => command.action === "reschedule-delivery-loads").length).toBe(1);
  const command = commands.find(command => command.action === "reschedule-delivery-loads")!;
  expect(command.scheduledTime).toBe("11:00"); expect(command.scheduledEnd).toBe("11:30");
  await expect.poll(() => f.records.get("fikaLogisticsDeliveryLoadsV1/" + original.id).scheduledEnd).toBe("11:30");
  expect(f.records.get("fikaLogisticsDeliveryLoadsV1/" + original.id).runId).toBe("r1");
});

for (const entry of ["queue", "inspector", "timeline"] as const) for (const collection of [false, true]) {
  test(`${entry} ${collection ? "collection" : "delivery"} produces canonical ownership, timing and versions`, async ({ page }) => {
    const { f, commands } = await scenario(page, collection);
    const queue = page.locator(`[data-timeline-queue-id^="projection-${collection ? "collection" : "job"}:"]`).first();
    await expect(queue).toBeVisible();
    if (entry === "timeline") await dropQueue(page, collection ? "collection" : "delivery", collection ? "14:00" : "10:30", collection ? "r2" : "r1");
    else {
      if (entry === "inspector" || collection) {
        await queue.getByRole("button", { name: "Details", exact: true }).click();
        const inspector = page.getByRole("complementary", { name: "Details inspector" });
        await inspector.getByRole("button", { name: collection ? "Schedule collection" : "Assign to vehicle", exact: true }).click();
        await inspector.getByLabel("Target delivery run").selectOption(collection ? "r2" : "r1");
        await inspector.getByLabel("Schedule time", { exact: true }).fill(collection ? "14:00" : "10:30");
        await inspector.getByRole("button", { name: collection ? "Schedule collection" : "Assign eligible", exact: true }).last().click();
      } else {
        await queue.getByRole("button", { name: "Assign", exact: true }).click();
        await queue.getByLabel("Target delivery run").selectOption("r1");
        await queue.getByLabel("Schedule time", { exact: true }).fill("10:30");
        await queue.getByRole("button", { name: "Assign all", exact: true }).click();
      }
    }
    const action = collection ? "reschedule-delivery-loads" : "assign-job-to-load";
    await expect.poll(() => commands.filter(command => command.action !== "ensure-vehicle-day-runs").map(command => command.action)).toEqual([action]);
    await expect.poll(() => [...f.records.values()].find((value: any) => value.id?.startsWith("load:v2:"))?.[collection ? "collectionScheduledTime" : "scheduledTime"]).toBe(collection ? "14:00" : "10:30");
    const load: any = [...f.records.values()].find((value: any) => value.id?.startsWith("load:v2:"));
    expect(load).toMatchObject({ runId: "r1", vehicleId: "van1", scheduledTime: "10:30", collectionRequired: true, version: collection ? 2 : 1 });
    expect(load.scheduledEnd).toBe("11:00");
    if (collection) expect(load.collectionRunId).toBe("r2");
    const job = f.records.get("fikaLogisticsJobsV1/logistics-job:req:a");
    expect(job.requestedWindow).toEqual({ startTime: "10:00", endTime: "11:00" });
    expect([...f.records.keys()].filter((key: string) => key.startsWith("fikaLogisticsAssignmentsV1/"))).toHaveLength(1);
    const command = commands.find(command => command.action === action)!;
    if (collection) expect(command.expectedLoadVersions[load.id]).toBe(1); else expect(command.expectedJobVersion).toBe(1);
  });
}

test("one merged collection placement sends one bulk intent and commits both loads", async ({ page }) => {
  const { f, commands } = await scenario(page, true, true);
  const queue = page.locator('[data-timeline-queue-id^="projection-collection:"]').first();
  await queue.getByRole("button", { name: "Details", exact: true }).click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await inspector.getByRole("button", { name: "Schedule collection", exact: true }).click();
  await inspector.getByLabel("Target delivery run").selectOption("r2");
  await inspector.getByLabel("Schedule time", { exact: true }).fill("14:00");
  await inspector.getByRole("button", { name: "Schedule collection", exact: true }).last().click();
  await expect.poll(() => commands.filter(command => command.action !== "ensure-vehicle-day-runs").map(command => command.action)).toEqual(["reschedule-delivery-loads"]);
  const command = commands.find(command => command.action === "reschedule-delivery-loads")!;
  expect(command.loadIds).toHaveLength(2);
  expect(commands.filter(command => command.action === "reschedule-delivery-load")).toHaveLength(0);
  await expect.poll(() => [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).every(([, load]: [string, any]) => load.collectionScheduledTime === "14:00" && load.version === 2)).toBe(true);
  expect(f.records.get("fikaLogisticsDayProjectionsV1/" + f.date).deliveryLoads).toHaveLength(1);
});

test("projected merged delivery Clear sends every canonical load and preserves assignment and collection state", async ({ page }) => {
  const { f, commands } = await scenario(page, true, true);
  const projection = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date);
  const group = projection.deliveryLoads[0];
  expect(group.loadIds).toHaveLength(2);
  const beforeLoads = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).map(([, load]: [string, any]) => structuredClone(load));
  const beforeAssignments = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/")).map(([, assignment]: [string, any]) => structuredClone(assignment));

  const card = page.getByTestId(`stop-projection-stop:delivery:${group.id}`);
  await expect(card).toBeVisible();
  await card.click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await inspector.getByRole("button", { name: "Clear time", exact: true }).click();

  await expect.poll(() => commands.filter(command => command.action.startsWith("clear-")).map(command => command.action)).toEqual(["clear-delivery-load-schedule"]);
  const command = commands.find(command => command.action === "clear-delivery-load-schedule")!;
  expect(new Set(command.loadIds)).toEqual(new Set(group.loadIds));
  expect(command.expectedLoadVersions).toEqual(group.loadVersions);
  await expect.poll(() => [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).every(([, load]: [string, any]) => !load.scheduledTime && !load.scheduledEnd)).toBe(true);

  const afterLoads = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).map(([, load]: [string, any]) => load);
  for (const load of afterLoads) {
    const before = beforeLoads.find((item: any) => item.id === load.id);
    expect(load.version).toBe(before.version + 1);
    expect(load.runId).toBe(before.runId);
    expect(load.collectionRequired).toBe(before.collectionRequired);
    expect(load.collectionRunId).toBe(before.collectionRunId);
    expect(load.collectionScheduledTime).toBe(before.collectionScheduledTime);
    expect(load.collectionScheduledEnd).toBe(before.collectionScheduledEnd);
  }
  expect([...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/")).map(([, assignment]: [string, any]) => assignment)).toEqual(beforeAssignments);
  const rebuilt = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date);
  expect(rebuilt.deliveryLoads).toHaveLength(1);
  expect(new Set(rebuilt.deliveryLoads[0].loadIds)).toEqual(new Set(group.loadIds));
  expect(rebuilt.deliveryLoads[0].scheduledTime).toBeUndefined();
});

test("projected merged collection Clear sends every canonical load and preserves delivery state", async ({ page }) => {
  const { f, commands } = await scenario(page, true, true);
  let projection = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date);
  const initialGroup = projection.deliveryLoads[0];
  const scheduled = await f.post({
    action: "reschedule-delivery-loads",
    loadIds: initialGroup.loadIds,
    expectedLoadVersions: initialGroup.loadVersions,
    lane: "collection",
    targetRunId: "r2",
    scheduledTime: "14:00",
    scheduledEnd: "15:00",
  });
  expect(scheduled.response.status).toBe(200);
  await page.reload();

  projection = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date);
  const group = projection.deliveryLoads[0];
  expect(group.loadIds).toHaveLength(2);
  const beforeLoads = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).map(([, load]: [string, any]) => structuredClone(load));
  const beforeAssignments = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/")).map(([, assignment]: [string, any]) => structuredClone(assignment));

  const card = page.getByTestId(`stop-projection-stop:collection:${group.id}`);
  await expect(card).toBeVisible();
  await card.click();
  const inspector = page.getByRole("complementary", { name: "Details inspector" });
  await inspector.getByRole("button", { name: "Clear time", exact: true }).click();

  await expect.poll(() => commands.filter(command => command.action.startsWith("clear-")).map(command => command.action)).toEqual(["clear-collection-load-schedule"]);
  const command = commands.find(command => command.action === "clear-collection-load-schedule")!;
  expect(new Set(command.loadIds)).toEqual(new Set(group.loadIds));
  expect(command.expectedLoadVersions).toEqual(group.loadVersions);
  await expect.poll(() => [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).every(([, load]: [string, any]) => !load.collectionScheduledTime && !load.collectionScheduledEnd)).toBe(true);

  const afterLoads = [...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsDeliveryLoadsV1/")).map(([, load]: [string, any]) => load);
  for (const load of afterLoads) {
    const before = beforeLoads.find((item: any) => item.id === load.id);
    expect(load.version).toBe(before.version + 1);
    expect(load.collectionRequired).toBe(true);
    expect(load.collectionRunId).toBe("r2");
    expect(load.scheduledTime).toBe(before.scheduledTime);
    expect(load.scheduledEnd).toBe(before.scheduledEnd);
    expect(load.runId).toBe(before.runId);
  }
  expect([...f.records.entries()].filter(([key]: [string, any]) => key.startsWith("fikaLogisticsAssignmentsV1/")).map(([, assignment]: [string, any]) => assignment)).toEqual(beforeAssignments);
  const rebuilt = f.records.get("fikaLogisticsDayProjectionsV1/" + f.date);
  expect(rebuilt.deliveryLoads).toHaveLength(1);
  expect(new Set(rebuilt.deliveryLoads[0].loadIds)).toEqual(new Set(group.loadIds));
  expect(rebuilt.deliveryLoads[0].collectionScheduledTime).toBeUndefined();
  expect(rebuilt.deliveryLoads[0].collectionRunId).toBe("r2");
});
