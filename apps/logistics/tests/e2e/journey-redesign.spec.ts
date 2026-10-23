import { expect, test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const stamp = "2026-10-22T08:00:00.000Z";

function makeProjection(serviceDate: string, count: number) {
  const runs = [
    { canonicalId: `run:${serviceDate}:van1-am`, vehicleId: "van1", vehicleLabel: "Van 1", driverId: "driver:one", driverLabel: "A. Driver", plannedCpuDepartureTime: "06:30", plannedCpuReturnTime: "09:30" },
    { canonicalId: `run:${serviceDate}:van1-pm`, vehicleId: "van1", vehicleLabel: "Van 1", driverId: "driver:one", driverLabel: "A. Driver", plannedCpuDepartureTime: "10:00", plannedCpuReturnTime: "13:00" },
    { canonicalId: `run:${serviceDate}:van2-am`, vehicleId: "van2", vehicleLabel: "Van 2", driverId: "driver:two", driverLabel: "B. Driver", plannedCpuDepartureTime: "06:45", plannedCpuReturnTime: "09:45" },
    { canonicalId: `run:${serviceDate}:van2-pm`, vehicleId: "van2", vehicleLabel: "Van 2", driverId: "driver:two", driverLabel: "B. Driver", plannedCpuDepartureTime: "10:15", plannedCpuReturnTime: "13:45" },
  ].map((run, index) => ({
    ...run, serviceDate, status: "planned", version: 4 + index, returnToCpuRequired: true,
    orderedStopIds: [] as string[], createdAt: stamp, updatedAt: stamp, audit: [],
  }));
  const deliveryLoads = Array.from({ length: count }, (_, index) => {
    const loadsPerRun = Math.ceil(count / 4);
    const run = runs[Math.floor(index / loadsPerRun) % runs.length];
    const id = `load:${serviceDate}:${String(index + 1).padStart(2, "0")}`;
    const jobId = `job:${serviceDate}:${String(index + 1).padStart(2, "0")}`;
    const runLoadIndex = index % loadsPerRun;
    const minutes = 7 * 60 + runLoadIndex * 30;
    const time = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return {
      id, serviceDate, originOplocId: "cpu-main", destinationOplocId: `site:${index + 1}`,
      destinationLabelSnapshot: index === 0 ? "Riverside Centre" : ["North Kitchen", "Harbour House", "Market Hall", "Studio Café", "Garden Room"][index % 5],
      scheduledTime: time, status: "planned", vehicleId: run.vehicleId, runId: run.canonicalId,
      version: 3, loadVersions: { [id]: 3 }, loadIds: [id], jobs: [{
        id: jobId, requirementId: `fulfilment:${index + 1}`, sourceVersion: 2, version: 5,
        sourceType: "cpu-production", sourceId: `production:${index + 1}`, serviceDate,
        originOplocId: "cpu-main", destinationOplocId: `site:${index + 1}`,
        destinationLabelSnapshot: index === 0 ? "Riverside Centre" : `Site ${index + 1}`,
        productionReadiness: "ready", deliveryStatus: index === 0 ? "loaded" : "pending", collectionStatus: "awaiting",
        workstream: "CPU production", contents: [{ description: index === 0 ? "Seasonal lunch trays" : `Prepared menu ${index + 1}`, quantity: 4 + index % 5, unit: "trays" }],
        totalUnits: 4 + index % 5, assignedLoadId: id,
      }], jobCount: 1, totalUnits: 4 + index % 5, collectedCount: 0, readiness: "ready",
    };
  });
  const movementIds = [`movement:${serviceDate}:delivery`, `movement:${serviceDate}:collection`];
  const mixedStop = {
    canonicalId: `stop:${serviceDate}:mixed`, runId: runs[0].canonicalId, sequence: 1,
    locationOplocId: "site:1", locationLabelSnapshot: "Riverside Centre",
    requirementRefs: [],
    movementRequestIds: movementIds, canonicalLoadIds: [deliveryLoads[0].id], canonicalLoadVersions: { [deliveryLoads[0].id]: 3 },
    plannedArrivalTime: deliveryLoads[0].scheduledTime, movementType: "delivery", status: "planned", version: 2,
    createdAt: stamp, updatedAt: stamp, audit: [],
  };
  runs[0].orderedStopIds.push(mixedStop.canonicalId);
  const movements = ["delivery", "collection"].map((type, index) => ({
    canonicalId: movementIds[index], entityType: "Movement Request", type, serviceDate,
    fromOplocId: "cpu-main", fromLabelSnapshot: "CPU Main Kitchen", toOplocId: "site:1", toLabelSnapshot: "Riverside Centre",
    requiredTime: index ? "07:30" : "07:15", items: [{ description: index ? "Empty insulated crates" : "Additional chilled items", quantity: 2, unit: "crates" }],
    createdBy: "fixture:planner", status: "planned", version: 2, createdAt: stamp, updatedAt: stamp, audit: [],
  }));
  const planningQueue = [{
    id: `job:${serviceDate}:queue`, requirementId: `fulfilment:${serviceDate}:queue`, sourceVersion: 1, version: 1,
    sourceType: "cpu-production", sourceId: `production:${serviceDate}:queue`, serviceDate,
    originOplocId: "cpu-main", destinationOplocId: "site:queue", destinationLabelSnapshot: "The Glasshouse",
    productionReadiness: "ready", deliveryStatus: "pending", collectionStatus: "awaiting", workstream: "CPU production",
    contents: [{ description: "Unassigned breakfast boxes", quantity: 12, unit: "boxes" }], totalUnits: 12,
  }];
  return {
    serviceDate, revision: 18, lastChangeSequence: 40, state: "CURRENT",
    completeness: { fulfilment: "complete", cpu: "complete", oploc: "complete" },
    planningQueue, deliveryLoads, runs, stops: [mixedStop], movements, exceptions: [],
    summary: { queuedJobs: 1, loads: count, assignedJobs: count, collectedJobs: 0 }, rebuiltAt: stamp,
  };
}

async function installCanonicalPresentationMocks(page: Page) {
  const commands: Record<string, unknown>[] = [];
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1", "van2"] } });
    if (url.pathname === "/api/logistics/locations") return route.fulfill({ json: { oplocs: [{ id: "cpu-main", label: "CPU Main Kitchen" }, { id: "site:1", label: "Riverside Centre" }] } });
    if (url.pathname !== "/api/logistics") return route.fulfill({ status: 404, json: { error: "Unexpected endpoint in journey presentation fixture" } });
    if (request.method() === "POST") { commands.push(request.postDataJSON() as Record<string, unknown>); return route.fulfill({ status: 200, json: { ok: true, changed: false } }); }
    const params = url.searchParams;
    if (params.has("syncHead")) return route.fulfill({ json: { sequence: 40 } });
    if (params.has("projection")) {
      const serviceDate = params.get("serviceDate") || "2026-10-22";
      const count = serviceDate.endsWith("-21") ? 36 : 12;
      return route.fulfill({ json: { projection: makeProjection(serviceDate, count), projectionState: "CURRENT" } });
    }
    if (params.has("weekSummary")) {
      const monday = params.get("weekCommencing") || "2026-10-19";
      const days = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${monday}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
        const serviceDate = date.toISOString().slice(0, 10); const busy = serviceDate.endsWith("-21");
        return { serviceDate, projectionState: "CURRENT", loads: busy ? 36 : 12, scheduled: busy ? 36 : 12, queue: 1, needsTime: 0, attention: 0 };
      });
      return route.fulfill({ json: { weekCommencing: monday, days } });
    }
    if (params.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    if (params.has("changesSince")) return route.fulfill({ json: { hasMore: false, nextCursor: 40, projection: makeProjection(params.get("serviceDate") || "2026-10-22", 12) } });
    return route.fulfill({ json: { projection: makeProjection(params.get("serviceDate") || "2026-10-22", 12), projectionState: "CURRENT" } });
  });
  return commands;
}

async function settlePlanner(page: Page) {
  await page.goto("/?ui=classic");
  await expect(page.getByRole("heading", { name: "Logistics" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel("Search unassigned work")).toBeVisible();
}

test("actual journey planner is readable at all target viewport sizes with loaded FIKA fonts", async ({ page }) => {
  test.setTimeout(120_000);
  const commands = await installCanonicalPresentationMocks(page);
  const screenshotDirectory = path.resolve(process.cwd(), "../../artifacts/desktop-review");
  await mkdir(screenshotDirectory, { recursive: true });
  for (const viewport of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    await page.setViewportSize(viewport);
    await settlePlanner(page);
    await page.keyboard.press("Tab");
    const focusIsVisible = await page.evaluate(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement)) return false;
      const style = getComputedStyle(active);
      return style.outlineStyle !== "none" && style.outlineWidth !== "0px";
    });
    expect(focusIsVisible).toBe(true);
    const result = await page.evaluate(() => ({
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      bodyFont: getComputedStyle(document.body).fontFamily,
      gilroyLoaded: document.fonts.check('14px "FIKA Gilroy"'),
      titleVisible: Boolean(document.querySelector("h1")?.getBoundingClientRect().width),
    }));
    expect(result.horizontalOverflow, `horizontal overflow at ${viewport.width}`).toBe(false);
    expect(result.gilroyLoaded).toBe(true);
    expect(result.bodyFont).toContain("FIKA Gilroy");
    expect(result.titleVisible).toBe(true);
    const screenshot = (filename: string) => page.screenshot({ path: path.join(screenshotDirectory, filename), fullPage: false });
    const filename = `logistics-journey-${viewport.width}x${viewport.height}-default.png`;
    await screenshot(filename);
    if (viewport.width === 1920 || viewport.width === 1440) {
      const prefix = `logistics-journey-${viewport.width}x${viewport.height}`;
      await page.getByRole("button", { name: /Wed 21 Oct/ }).click();
      await expect(page.locator(".mock-selected-day small")).toContainText("36 loads · 2 movements · 2 vans / 4 runs");
      await expect(page.locator(".mock-summary strong").first()).toHaveText("2");
      await screenshot(`${prefix}-busy-wednesday-36-loads.png`);
      const timeline = page.getByRole("region", { name: "Vehicle journey timeline" });
      await expect(timeline.locator("[data-journey-run-id]")).toHaveCount(4);
      await expect(timeline.locator("[data-journey-run-id]").first()).toContainText("Van 1 · Run 1");
      await expect(timeline.locator("[data-journey-run-id]").first()).toContainText("9 stops · 9 loads");
      await timeline.locator("[data-journey-run-id]").first().click();
      const runDialog = page.getByRole("complementary", { name: "Details inspector" });
      await expect(runDialog.getByText("Run inspector")).toBeVisible();
      await expect(runDialog.getByRole("heading", { name: "Van 1 · Run 1" })).toBeVisible();
      const canvasBounds = await page.locator(".mock-canvas").boundingBox();
      const inspectorBounds = await runDialog.boundingBox();
      expect(canvasBounds).not.toBeNull();
      expect(inspectorBounds).not.toBeNull();
      expect(inspectorBounds!.x, "inspector docks beside, never over, the planner canvas").toBeGreaterThanOrEqual(canvasBounds!.x + canvasBounds!.width - 0.5);
      await screenshot(`${prefix}-selected-run.png`);
      await expect(runDialog.getByLabel("Planned CPU departure")).toHaveValue("06:30");
      await expect(runDialog.getByLabel("Planned CPU return")).toHaveValue("09:30");
      const departureRunId = await timeline.locator("[data-journey-run-id]").first().getAttribute("data-journey-run-id");
      await runDialog.getByRole("button", { name: "View route" }).click();
      const routeSheet = page.locator(".route-sheet[role='dialog']");
      await expect(routeSheet).toBeVisible();
      await expect(routeSheet.getByRole("button", { name: "Close route sheet" })).toBeFocused();
      await expect(routeSheet.getByText("Delivery + Collection").first()).toBeVisible();
      await screenshot(`${prefix}-mixed-delivery-collection-stop.png`);
      await routeSheet.getByRole("button", { name: /Load .*jobs/ }).first().click();
      await expect(runDialog.getByText("Load inspector")).toBeVisible();
      await screenshot(`${prefix}-individual-load.png`);
      await runDialog.getByRole("button", { name: "Close inspector" }).click();
      const queue = page.locator("[data-logistics-planning-queue]");
      await queue.locator("article").first().getByRole("button", { name: "Assign" }).click();
      const inspector = page.getByRole("complementary", { name: "Details inspector" });
      const targetRun = inspector.getByLabel("Target delivery run");
      await expect(targetRun).toBeVisible();
      await expect(inspector.getByRole("button", { name: "Assign to vehicle" })).toHaveCount(0);
      await targetRun.selectOption({ index: 1 });
      await inspector.getByLabel("Time").fill("08:15");
      await expect(inspector.getByRole("button", { name: "Assign eligible" })).toBeEnabled();
      await expect(queue.locator(".run-chooser")).toHaveCount(0);
      const chooser = inspector.locator(".run-chooser");
      await expect(chooser).toHaveCSS("display", "grid");
      const chooserBounds = await chooser.evaluate((element) => ({ width: element.clientWidth, children: Array.from(element.children).map((child) => (child as HTMLElement).getBoundingClientRect().right - element.getBoundingClientRect().left) }));
      expect(chooserBounds.children.every((right) => right <= chooserBounds.width + 1)).toBe(true);
      await screenshot(`${prefix}-queue-to-run-placement.png`);
      if (viewport.width === 1920) {
        await inspector.getByRole("button", { name: "Assign eligible" }).click();
        await expect.poll(() => commands.some((command) => command.action === "assign-job-to-load" && String(command.jobId).endsWith(":queue") && command.targetRunId && command.scheduledTime === "08:15" && command.expectedJobVersion === 1 && Object.keys(command.expectedLoadVersions as object || {}).length === 36)).toBe(true);
        await timeline.locator("[data-journey-run-id]").first().click();
        const timingInspector = page.getByRole("complementary", { name: "Details inspector" });
        await timingInspector.getByLabel("Planned CPU departure").fill("06:45");
        await timingInspector.getByLabel("Planned CPU return").fill("09:45");
        await timingInspector.getByRole("button", { name: "Save journey times" }).click();
        await expect.poll(() => commands.some((command) => command.action === "update-run-timing" && command.runId === departureRunId && command.plannedCpuDepartureTime === "06:45" && command.plannedCpuReturnTime === "09:45" && command.expectedRunVersion === 4)).toBe(true);
        await timeline.locator("[data-journey-run-id]").first().click();
        const runInspector = page.getByRole("complementary", { name: "Details inspector" });
        await runInspector.getByRole("button", { name: "View route" }).click();
        await page.locator(".route-sheet[role='dialog']").getByRole("button", { name: /Load .*jobs/ }).first().click();
        const loadInspector = page.getByRole("complementary", { name: "Details inspector" });
        const sourceRunId = await loadInspector.getByLabel("Load target run").inputValue();
        await loadInspector.getByLabel("Load target run").selectOption({ index: 2 });
        await loadInspector.getByLabel("delivery load time").fill("07:15");
        await loadInspector.getByRole("button", { name: "Save load assignment" }).click();
        await expect.poll(() => commands.some((command) => command.action === "reschedule-delivery-load" && command.loadId && command.targetRunId !== sourceRunId && command.scheduledTime === "07:15" && command.expectedLoadVersion === 3)).toBe(true);
      }
    }
  }
});
