import { expect, test, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";
import { selectRun } from "./v3-helpers";

/**
 * #120 UAT: the unassigned delivery (queue item) details inspector must dock on the right, stay inside the viewport,
 * scroll internally to reach its controls and show a visible keyboard focus ring at every supported width.
 * Same isolated route/domain harness as journey-planner-v3-domain.spec.ts.
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


const card = (page: Page, req: string) => page.locator(`[data-timeline-queue-id="projection-job:logistics-job:req:${req}"]`);

for (const width of [820, 1024, 1280, 1536]) {
  test(`${width}px: the unassigned MNK inspector docks right, scrolls inside the viewport to Assign to vehicle and shows focus`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize({ width, height: 800 });
    const f = await seedDay();
    await mount(page, f);
    const expand = page.getByRole("button", { name: "Expand unassigned work" });
    if (await expand.isVisible().catch(() => false)) await expand.click();
    await card(page, "mnk1").locator("button").first().click();
    const panel = page.getByRole("complementary", { name: "Details inspector" });
    await expect(panel).toBeVisible();
    await page.waitForTimeout(200);

    const geometry = await panel.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, position: style.position, overflowY: style.overflowY, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth, vw: innerWidth, vh: innerHeight };
    });
    // Docked on the right edge, never sticky at x=0 under the planner.
    expect(geometry.position === "sticky" && geometry.x < 1, "not sticky at the left edge").toBe(false);
    expect(geometry.x + geometry.width, "right edge").toBeGreaterThanOrEqual(geometry.vw - 1);
    expect(geometry.x, "left edge is not x=0").toBeGreaterThan(geometry.vw * 0.25);
    expect(geometry.y).toBeGreaterThanOrEqual(0);
    expect(geometry.y + geometry.height, "bottom inside viewport").toBeLessThanOrEqual(geometry.vh + 1);
    expect(geometry.overflowY).toMatch(/auto|scroll/);
    expect(geometry.scrollWidth, "no horizontal scroll inside the inspector").toBeLessThanOrEqual(geometry.clientWidth + 1);

    // Internal scroll reaches the action; it ends up fully inside both the inspector and the viewport.
    const assign = panel.getByRole("button", { name: "Assign to vehicle" });
    await assign.scrollIntoViewIfNeeded();
    await expect(assign).toBeVisible();
    const box = (await assign.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(geometry.vh + 1);
    expect(box.x + box.width).toBeLessThanOrEqual(geometry.vw + 1);

    // Keyboard Tab inside the inspector shows a visible focus outline.
    await panel.getByRole("button", { name: /close/i }).first().focus();
    await page.keyboard.press("Tab");
    const focus = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return undefined;
      const style = getComputedStyle(el);
      return { inInspector: Boolean(el.closest("aside.mock-inspector")), outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
    });
    expect(focus?.inInspector).toBe(true);
    expect(focus?.outlineStyle).not.toBe("none");
    expect(focus?.outlineWidth).toBeGreaterThanOrEqual(2);

    // Focusing the Assign button itself also shows the ring.
    await assign.focus();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Tab");
    expect(await assign.evaluate((element) => { const s = getComputedStyle(element); return s.outlineStyle !== "none" && parseFloat(s.outlineWidth) >= 2; })).toBe(true);

    expect(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth)).toBeLessThanOrEqual(1);
  });
}
