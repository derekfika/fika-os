import { expect, test, type Page } from "@playwright/test";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";
import { createRequire } from "node:module";
// Actual API/domain handlers with an isolated optimistic-transaction test store.
// This proves mounted client intent parity, not Firestore emulator integration.
const { fixture } = createRequire(import.meta.url)("../helpers/authority-route-harness.cjs");

async function scenario(page: Page, collection = false, merged = false) {
  await page.setViewportSize({ width: 1600, height: 1200 });
  const f = fixture(["van1", "van2"], ["logistics.reconcile"], true);
  for (const key of [...f.records.keys()]) if (!key.startsWith("fikaLogisticsDeliveryRunsV1/")) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  f.requirements.push({ canonicalId: "req:a", sourceDomain: "cpu-production", sourceEntityId: "order:a", sourceVersion: 1, serviceDate: f.date, productionLocationId: "cpu", destinationOplocId: "site", destinationLabelSnapshot: "Batch Two Site", requiredDeliveryWindow: { startTime: "10:00", endTime: "11:00" }, status: "ready_for_planning", lines: [{ displayNameSnapshot: "Lunch", quantity: 10, unit: "portion" }] });
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

async function dropQueue(page: Page, lane: "delivery" | "collection", time: string, run = "r1") {
  const source = page.locator(`[data-timeline-queue-id^="projection-${lane === "delivery" ? "job" : "collection"}:"]`).first();
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
    expect(load.scheduledEnd).toBeUndefined();
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
