import { test, expect, type Page } from "@playwright/test";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";

const date = "2099-01-05";
async function mockAuthority(page: Page, options: { unavailable?: boolean; restricted?: boolean } = {}) {
  const ids = options.restricted ? ["van1" as const] : ["van1" as const, "van2" as const];
  const projection: LogisticsDayProjection = { serviceDate: date, revision: 1, lastChangeSequence: 1, state: "CURRENT", planningQueue: [], deliveryLoads: [], runs: ids.map(id => ({ canonicalId: "run:" + id, vehicleId: id, vehicleLabel: id === "van1" ? "Van 1" : "Van 2", status: "planned", serviceDate: date, orderedStopIds: [], version: 1 })), stops: [], movements: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: new Date().toISOString() };
  const commands: Record<string, any>[] = [];
  const reads: URL[] = [];
  await page.route("**/api/**", async route => {
    const url = new URL(route.request().url());
    if (route.request().method() === "GET") reads.push(url);
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill(options.unavailable ? { status: 503, json: { error: { message: "Unavailable" } } } : { json: { permittedVehicleIds: ids } });
    if (url.pathname === "/api/logistics/drivers") return route.fulfill({ status: 503, json: { error: { message: "No driver login catalogue" } } });
    if (route.request().method() === "POST") { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { runs: projection.runs, changed: false } }); }
    if (url.searchParams.get("syncHead")) return route.fulfill({ headers: { "x-logistics-cache-scope": "shared-session:" + ids.join(",") }, json: { sequence: projection.lastChangeSequence } });
    if (url.searchParams.get("weekSummary")) return route.fulfill({ json: { weekCommencing: date, days: [] } });
    if (url.searchParams.get("planningAttention")) return route.fulfill({ json: { attention: [] } });
    return route.fulfill({ headers: { "x-logistics-cache-scope": "shared-session:" + ids.join(",") }, json: { ...projectionToDashboardData(projection), projection } });
  });
  return { projection, commands, reads };
}
function scheduledWork(mock: Awaited<ReturnType<typeof mockAuthority>>) {
  Object.assign(mock.projection.runs[0], { orderedStopIds: ["stop:van1"] });
  mock.projection.stops = [{ canonicalId: "stop:van1", runId: "run:van1", sequence: 1, locationOplocId: "site:test", locationLabelSnapshot: "Test site", requirementRefs: [], movementRequestIds: [], plannedArrivalTime: "10:00", status: "planned", loaded: true, version: 1, createdAt: "now", updatedAt: "now", audit: [] }];
}
test.describe("Shared Logistics session and vehicle execution", () => {
  test("New Run uses vehicle authority without driver accounts", async ({ page }) => {
    const mock = await mockAuthority(page);
    await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: /New run/ }).click();
    const dialog = page.getByRole("dialog", { name: "Create delivery run" });
    await dialog.getByLabel("Vehicle", { exact: true }).selectOption("van2");
    await expect(dialog.getByLabel("Driver", { exact: true })).toHaveCount(0);
    await dialog.getByRole("button", { name: "Create run", exact: true }).click();
    await expect.poll(() => mock.commands.find(command => command.action === "create-run")?.run.vehicleId).toBe("van2");
    expect(mock.commands.find(command => command.action === "create-run")?.run.driverId).toBeUndefined();
    expect(mock.reads.some(url => url.pathname.endsWith("/drivers"))).toBe(false);
  });
  test("vehicle authority unavailable blocks creation and preserves keyboard focus", async ({ page }) => {
    await mockAuthority(page, { unavailable: true }); await page.goto("/?serviceDate=" + date);
    await page.getByRole("button", { name: /New run/ }).click();
    const dialog = page.getByRole("dialog", { name: "Create delivery run" });
    await expect(dialog.getByRole("alert")).toContainText("Vehicle authority unavailable");
    await expect(dialog.getByRole("button", { name: "Create run", exact: true })).toBeDisabled();
    await page.keyboard.press("Escape"); await expect(dialog).toHaveCount(0);
    await expect(page.getByRole("button", { name: /New run/ })).toBeFocused();
  });
  test("scheduled work is ready without a driver login", async ({ page }) => {
    const mock = await mockAuthority(page, { restricted: true }); scheduledWork(mock);
    await page.goto("/?serviceDate=" + date); await page.getByRole("button", { name: "Run details" }).first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("button", { name: "Mark ready", exact: true })).toBeEnabled();
    await inspector.getByRole("button", { name: "Mark ready", exact: true }).click();
    await expect.poll(() => mock.commands.some(command => command.action === "mark-run-ready")).toBe(true);
  });
  test("historical driver snapshot remains visible without blocking readiness", async ({ page }) => {
    const mock = await mockAuthority(page, { restricted: true }); scheduledWork(mock);
    Object.assign(mock.projection.runs[0], { driverId: "person:historic", driverLabel: "Historic Driver" });
    await page.goto("/?serviceDate=" + date); await page.getByRole("button", { name: "Run details" }).first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("strong").filter({ hasText: "Historic Driver" })).toBeVisible();
    await expect(inspector.getByRole("button", { name: "Mark ready", exact: true })).toBeEnabled();
    await expect(inspector.getByLabel("Driver", { exact: true })).toHaveCount(0);
  });
  test("fixed vehicle mobile uses stable authorized vehicle and run identities", async ({ page }) => {
    const mock = await mockAuthority(page, { restricted: true }); scheduledWork(mock);
    await page.clock.install({ time: new Date(date + "T12:00:00Z") }); await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/mobile/van1");
    await expect(page.getByLabel("Run", { exact: true })).toHaveValue("run:van1");
    await expect(page.getByLabel("Vehicle", { exact: true })).toHaveCount(0);
    await expect.poll(() => mock.reads.some(url => url.searchParams.get("projection") === "1" && url.searchParams.get("vehicle") === "van1")).toBe(true);
    await expect(page.getByText("Van 2", { exact: true })).toHaveCount(0);
  });
  test("mobile vehicle/run selection survives reload without becoming login identity", async ({ page }) => {
    await mockAuthority(page); await page.clock.install({ time: new Date(date + "T12:00:00Z") });
    await page.goto("/mobile"); await page.getByLabel("Vehicle", { exact: true }).selectOption("van2");
    await expect(page.getByLabel("Run", { exact: true })).toHaveValue("run:van2");
    await page.reload(); await expect(page.getByLabel("Vehicle", { exact: true })).toHaveValue("van2");
    await expect(page.getByLabel("Run", { exact: true })).toHaveValue("run:van2");
    await page.getByRole("button", { name: "More", exact: true }).click();
    await expect(page.getByText("Selected vehicle", { exact: true })).toBeVisible();
    await expect(page.getByText("Signed in as", { exact: true })).toHaveCount(0);
  });
});
