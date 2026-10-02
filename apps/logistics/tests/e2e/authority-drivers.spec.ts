import { test, expect, type Page } from "@playwright/test";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";

const date = "2099-01-05";
async function mockAuthority(page: Page, options: { unavailable?: boolean; restricted?: boolean; revoked?: boolean } = {}) {
  const ids = options.restricted ? ["van1" as const] : ["van1" as const, "van2" as const];
  const projection: LogisticsDayProjection = { serviceDate: date, revision: 1, lastChangeSequence: 1, state: "CURRENT", planningQueue: [], deliveryLoads: [], runs: ids.map(id => ({ canonicalId: "run:" + id, vehicleId: id, vehicleLabel: id === "van1" ? "Van 1" : "Van 2", status: "planned", serviceDate: date, orderedStopIds: [], version: 1 })), stops: [], movements: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() };
  const commands: Record<string, any>[] = [];
  const reads: URL[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") reads.push(url);
    if (url.pathname === "/api/logistics/drivers") {
      if (options.unavailable) return route.fulfill({ status: 503, json: { error: { message: "Unavailable" } } });
      return route.fulfill({ json: { permittedVehicleIds: ids, drivers: options.revoked ? [] : [{ driverId: "person:driver-a", displayName: "Driver Alpha", permittedDriverVehicleIds: ["van1"] }, ...(!options.restricted ? [{ driverId: "person:driver-b", displayName: "Driver Beta", permittedDriverVehicleIds: ["van2"] }] : [])] } });
    }
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON(); commands.push(body);
      if (body.action === "set-run-driver") { const run = projection.runs.find(run => run.canonicalId === body.runId)!; run.driverId = body.driverId; run.driverLabel = "Driver Alpha"; run.version = (run.version || 1) + 1; projection.revision++; projection.lastChangeSequence++; }
      return route.fulfill({ json: { runs: projection.runs, changed: false } });
    }
    if (url.searchParams.get("syncHead")) return route.fulfill({ headers: { "x-logistics-cache-scope": "batch1:" + ids.join(",") }, json: { sequence: projection.lastChangeSequence } });
    if (url.searchParams.get("weekSummary")) return route.fulfill({ json: { weekCommencing: date, days: [] } });
    if (url.searchParams.get("planningAttention")) return route.fulfill({ json: { attention: [] } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "batch1:" + ids.join(",") }, json: { ...projectionToDashboardData(projection), projection } });
  });
  return { projection, commands, reads };
}

test.describe("Batch 1 governed driver controls", () => {
  test("fresh New Run offers per-vehicle governed drivers and canonical IDs", async ({ page }, testInfo) => {
    const mock = await mockAuthority(page);
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: /New run/ }).click();
    const dialog = page.getByRole("dialog", { name: "Create delivery run" });
    await expect(dialog.getByRole("option", { name: "Driver Alpha" })).toHaveCount(1);
    await expect(dialog.getByRole("option", { name: "Driver Beta" })).toHaveCount(0);
    await dialog.getByLabel("Driver", { exact: true }).selectOption("person:driver-a");
    await page.screenshot({ path: testInfo.outputPath("fresh-driver-selector.png") });
    await dialog.getByLabel("Vehicle", { exact: true }).selectOption("van2");
    await expect(dialog.getByRole("option", { name: "Driver Beta" })).toHaveCount(1);
    await expect(dialog.getByRole("option", { name: "Driver Alpha" })).toHaveCount(0);
    await dialog.getByLabel("Driver", { exact: true }).selectOption("person:driver-b");
    await dialog.getByRole("button", { name: "Create run", exact: true }).click();
    await expect.poll(() => mock.commands.find(command => command.action === "create-run")?.run).toMatchObject({ vehicleId: "van2", driverId: "person:driver-b" });
  });
  test("fresh existing run inspector assigns a governed driver", async ({ page }) => {
    const mock = await mockAuthority(page, { restricted: true });
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: "Run details" }).first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("option", { name: "Driver Alpha" })).toHaveCount(1);
    await inspector.getByLabel("Driver", { exact: true }).selectOption("person:driver-a");
    await expect.poll(() => mock.commands.find(command => command.action === "set-run-driver")).toMatchObject({ runId: "run:van1", driverId: "person:driver-a" });
    await expect(inspector.getByLabel("Driver", { exact: true })).toHaveValue("person:driver-a");
  });
  test("unavailable catalogue is explicit and blocks creation", async ({ page }) => {
    await mockAuthority(page, { unavailable: true });
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: /New run/ }).click();
    const dialog = page.getByRole("dialog", { name: "Create delivery run" });
    await expect(dialog.getByRole("alert")).toContainText("Driver choices unavailable");
    await expect(dialog.getByRole("button", { name: "Create run", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /New run/ })).toBeFocused();
  });
  test("revoked driver is attention, historical snapshot remains visible", async ({ page }) => {
    const mock = await mockAuthority(page, { revoked: true, restricted: true });
    Object.assign(mock.projection.runs[0], { driverId: "person:historic", driverLabel: "Historic Driver" });
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: "Run details" }).first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByText(/historical assignment is preserved/)).toBeVisible();
    await expect(inspector.getByRole("option", { name: /Historic Driver.*no longer eligible/ })).toHaveAttribute("disabled", "");
  });
  test("loaded catalogue revocation disables mounted Mark ready", async ({ page }) => {
    const options = { restricted: true, revoked: false };
    const mock = await mockAuthority(page, options);
    Object.assign(mock.projection.runs[0], { driverId: "person:driver-a", driverLabel: "Driver Alpha", orderedStopIds: ["stop:van1"] });
    mock.projection.stops = [{ canonicalId: "stop:van1", runId: "run:van1", sequence: 1, locationOplocId: "site:test", locationLabelSnapshot: "Test site", requirementRefs: [], movementRequestIds: [], plannedArrivalTime: "10:00", status: "planned", loaded: true, version: 1, createdAt: "now", updatedAt: "now", audit: [] }];
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: "Run details" }).first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("button", { name: "Mark ready", exact: true })).toBeEnabled();
    options.revoked = true;
    await inspector.getByLabel("Driver", { exact: true }).focus();
    await expect(inspector.getByText(/historical assignment is preserved/)).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Mark ready", exact: true })).toBeDisabled();
    expect(mock.commands.filter(command => command.action === "mark-run-ready")).toHaveLength(0);
  });
  test("fixed-van mobile selection uses only authorized runs", async ({ page }) => {
    const mock = await mockAuthority(page, { restricted: true });
    Object.assign(mock.projection.runs[0], { driverId: "person:driver-a", driverLabel: "Driver Alpha" });
    await page.clock.install({ time: new Date(date + "T12:00:00Z") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mobile/van1?serviceDate=" + date);
    await expect(page.getByRole("heading", { name: "Your stops" })).toBeVisible();
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByText("Van 1", { exact: true }).first()).toBeVisible();
    await expect.poll(() => mock.reads.some(url => url.searchParams.get("projection") === "1" && url.searchParams.get("vehicle") === "van1")).toBe(true);
    await expect(page.getByText("Driver Beta", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Van 2", { exact: true })).toHaveCount(0);
  });
});
