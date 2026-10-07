import { expect, test, type Page } from "@playwright/test";
import { projectionToDashboardData } from "../../lib/projection-dashboard-adapter";
import type { LogisticsDayProjection } from "../../lib/types";

const MONDAY = "2099-01-05";
const TUESDAY = "2099-01-06";
const NEXT_MONDAY = "2099-01-12";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function projection(date: string): LogisticsDayProjection {
  const runId = `run:${date}`;
  const stopId = `stop:${date}`;
  return {
    serviceDate: date,
    revision: 1,
    lastChangeSequence: 1,
    state: "CURRENT",
    planningQueue: [],
    deliveryLoads: [],
    runs: [{ canonicalId: runId, vehicleId: "van1", vehicleLabel: "Van 1", driverId: "person:driver", driverLabel: "Driver", status: "planned", serviceDate: date, orderedStopIds: [stopId], version: 1 }],
    stops: [{ canonicalId: stopId, runId, sequence: 1, locationOplocId: `site:${date}`, locationLabelSnapshot: `Stop ${date}`, requirementRefs: [], movementRequestIds: [], plannedArrivalTime: "10:00", status: "planned", version: 1, createdAt: "now", updatedAt: "now", audit: [] }],
    movements: [],
    exceptions: [],
    summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 },
    rebuiltAt: new Date().toISOString(),
  };
}

async function installRoutes(page: Page, options: {
  delayMondayProjection?: Promise<void>;
  delayMondayWeek?: Promise<void>;
  delayScheduleMutation?: Promise<void>;
  mondayProjectionReached?: () => void;
  mondayWeekReached?: () => void;
  mondayWeekReturned?: () => void;
  scheduleMutationReached?: () => void;
  scheduleMutationReturned?: () => void;
} = {}) {
  const projections = new Map([MONDAY, TUESDAY, NEXT_MONDAY].map((date) => [date, projection(date)]));
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/logistics/vehicles") return route.fulfill({ json: { permittedVehicleIds: ["van1"] } });
    if (url.pathname !== "/api/logistics") return route.continue();
    if (request.method() === "POST") {
      const command = request.postDataJSON();
      if (command.action === "schedule-stop") {
        if (options.delayScheduleMutation) {
          options.scheduleMutationReached?.();
          await options.delayScheduleMutation;
        }
        const current = [...projections.values()].find((item) => (item.stops || []).some((stop) => stop.canonicalId === command.stopId));
        const currentStop = (current?.stops || []).find((stop) => stop.canonicalId === command.stopId);
        const currentRun = (current?.runs || []).find((run) => run.canonicalId === command.runId);
        if (!current || !currentStop || !currentRun) return route.fulfill({ status: 404, json: { error: { message: "Fixture stop not found" } } });
        const updatedStop = { ...currentStop, version: (currentStop.version || 0) + 1 };
        if (command.plannedWindow) {
          delete (updatedStop as { plannedArrivalTime?: string }).plannedArrivalTime;
          updatedStop.plannedWindow = command.plannedWindow;
        } else {
          delete (updatedStop as { plannedWindow?: { startTime: string; endTime?: string } }).plannedWindow;
          updatedStop.plannedArrivalTime = command.plannedArrivalTime;
        }
        current.stops = (current.stops || []).map((stop) => stop.canonicalId === command.stopId ? updatedStop : stop);
        const updatedRun = { ...currentRun, version: (currentRun.version || 0) + 1 };
        current.runs = (current.runs || []).map((run) => run.canonicalId === command.runId ? updatedRun : run);
        current.revision += 1;
        current.lastChangeSequence += 1;
        await route.fulfill({ json: { stop: updatedStop, run: updatedRun } });
        options.scheduleMutationReturned?.();
        return;
      }
      return route.fulfill({ json: { changed: false, runs: [] } });
    }
    if (url.searchParams.has("syncHead")) return route.fulfill({ headers: { "x-logistics-cache-scope": "a5-date-test" }, json: { sequence: 1 } });
    if (url.searchParams.has("planningAttention")) return route.fulfill({ json: { attention: [] } });
    if (url.searchParams.has("weekSummary")) {
      const week = url.searchParams.get("weekCommencing") || MONDAY;
      if (week === MONDAY && options.delayMondayWeek) {
        options.mondayWeekReached?.();
        await options.delayMondayWeek;
        options.mondayWeekReturned?.();
      }
      const loads = week === MONDAY ? 1 : 2;
      return route.fulfill({ json: { weekCommencing: week, days: [{ serviceDate: week, projectionState: "CURRENT", loads, runs: 1, deliveries: 1, collections: 0, transfers: 0, attention: 0 }] } });
    }
    if (url.searchParams.has("projection")) {
      const date = url.searchParams.get("serviceDate") || MONDAY;
      if (date === MONDAY && options.delayMondayProjection) {
        options.mondayProjectionReached?.();
        await options.delayMondayProjection;
      }
      const current = projections.get(date) || projection(date);
      return route.fulfill({ headers: { "x-logistics-cache-scope": "a5-date-test" }, json: { ...projectionToDashboardData(current), projection: current } });
    }
    return route.fulfill({ json: {} });
  });
}

test.describe("Batch 5 production date isolation", () => {
  test("late Monday projection cannot replace Tuesday after the selected day changes", async ({ page }) => {
    const mondayGate = deferred();
    const mondayStarted = deferred();
    await installRoutes(page, { delayMondayProjection: mondayGate.promise, mondayProjectionReached: () => mondayStarted.resolve() });
    await page.goto(`/?serviceDate=${MONDAY}`);
    await mondayStarted.promise;

    const week = page.getByRole("region", { name: "Operational week" });
    await expect(week.getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
    await week.getByRole("button").nth(1).click();
    const tuesdayCard = page.getByTestId(`stop-stop:${TUESDAY}`);
    await expect(tuesdayCard).toBeVisible();
    await expect(week.getByRole("button").nth(1)).toHaveAttribute("aria-pressed", "true");
    mondayGate.resolve();
    await expect(tuesdayCard).toBeVisible();
    await expect(week.getByRole("button").nth(1)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`stop-stop:${MONDAY}`)).toHaveCount(0);

    await week.getByRole("button").nth(0).click();
    const mondayCard = page.getByTestId(`stop-stop:${MONDAY}`);
    await expect(mondayCard).toBeVisible();
    await week.getByRole("button").nth(1).click();
    await week.getByRole("button").nth(0).click();
    await expect(mondayCard).toBeVisible();
    await expect(week.getByRole("button").nth(0)).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByTestId(`stop-stop:${TUESDAY}`)).toHaveCount(0);
  });

  test("late Monday week summary cannot replace the newly selected week", async ({ page }) => {
    const mondayGate = deferred();
    const mondayStarted = deferred();
    const mondayReturned = deferred();
    await installRoutes(page, {
      delayMondayWeek: mondayGate.promise,
      mondayWeekReached: () => mondayStarted.resolve(),
      mondayWeekReturned: () => mondayReturned.resolve(),
    });
    await page.goto(`/?serviceDate=${MONDAY}`);
    await mondayStarted.promise;

    await page.getByRole("button", { name: "Next week" }).click();
    const firstDay = page.getByRole("region", { name: "Operational week" }).getByRole("button").first();
    await expect(firstDay).toContainText("2 loads");
    mondayGate.resolve();
    await mondayReturned.promise;
    await expect(firstDay).toContainText("2 loads");
  });

  test("changing service date closes the prior day's Inspector selection", async ({ page }) => {
    await installRoutes(page);
    await page.goto(`/?serviceDate=${MONDAY}`);
    const mondayCard = page.getByTestId(`stop-stop:${MONDAY}`);
    await expect(mondayCard).toBeVisible();
    await mondayCard.click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector).toBeVisible();

    await page.getByRole("region", { name: "Operational week" }).getByRole("button").nth(1).click();
    await expect(page.getByTestId(`stop-stop:${TUESDAY}`)).toBeVisible();
    await expect(inspector).toHaveCount(0);
  });

  test("late Monday placement success is reconciled only in Monday context", async ({ page }) => {
    const mutationGate = deferred();
    const mutationStarted = deferred();
    const mutationReturned = deferred();
    await installRoutes(page, {
      delayScheduleMutation: mutationGate.promise,
      scheduleMutationReached: () => mutationStarted.resolve(),
      scheduleMutationReturned: () => mutationReturned.resolve(),
    });
    await page.goto(`/?serviceDate=${MONDAY}`);
    const mondayCard = page.getByTestId(`stop-stop:${MONDAY}`);
    await expect(mondayCard).toBeVisible();
    await mondayCard.click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByLabel("Start / arrival").fill("10:15");
    await inspector.getByRole("button", { name: "Save time and placement" }).click();
    await mutationStarted.promise;

    await page.getByRole("region", { name: "Operational week" }).getByRole("button").nth(1).click();
    const tuesdayCard = page.getByTestId(`stop-stop:${TUESDAY}`);
    await expect(tuesdayCard).toBeVisible();
    mutationGate.resolve();
    await mutationReturned.promise;
    await expect(tuesdayCard).toBeVisible();
    await expect(page.getByTestId(`stop-stop:${MONDAY}`)).toHaveCount(0);
  });

  test("mobile date switch hides old stops while its delayed response completes", async ({ page }) => {
    await page.clock.install({ time: new Date(`${MONDAY}T12:00:00Z`) });
    const mondayGate = deferred();
    const mondayStarted = deferred();
    await installRoutes(page, { delayMondayProjection: mondayGate.promise, mondayProjectionReached: () => mondayStarted.resolve() });
    await page.goto("/mobile");
    await mondayStarted.promise;

    await page.getByLabel("Service date").selectOption(TUESDAY);
    await expect(page.getByText(`Stop ${TUESDAY}`, { exact: true })).toBeVisible();
    mondayGate.resolve();
    await expect(page.getByText(`Stop ${TUESDAY}`, { exact: true })).toBeVisible();
    await expect(page.getByText(`Stop ${MONDAY}`, { exact: true })).toHaveCount(0);
  });
});
