import { test, expect, type Page } from "@playwright/test";
import { cleanupE2EData, E2E_DATE, E2E_PREFIX, ensureLogisticsIsRunning } from "./fixtures";

async function openStopDetails(page: Page) {
  const details = page.locator("details").filter({ hasText: "Stop timing details" });
  if (await details.getAttribute("open") === null) await details.locator("summary").click();
}

test.describe.serial("Logistics desktop planner", () => {
  test.beforeEach(async ({ page }) => {
    await cleanupE2EData();
    await ensureLogisticsIsRunning(page);
  });

  test.afterEach(async () => {
    await cleanupE2EData();
  });

  test("creates a movement and run, assigns the movement, and controls readiness", async ({
    page,
  }) => {
    await page.goto("/?ui=classic&serviceDate=" + E2E_DATE);
    await openStopDetails(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(
      page.getByRole("heading", { name: /Planning queue/ }),
    ).toBeVisible();
    await expect(
      page.locator(".mock-day-cards > button"),
    ).toHaveCount(5);
    await expect(page.getByRole("heading", { name: "Dispatch schedule" })).toBeVisible();
    await expect(page.getByText("Fulfilment", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "New movement" }).click();
    await expect(
      page.getByRole("heading", { name: "New movement" }),
    ).toBeVisible();
    const to = page.getByLabel("To OPLOC");
    await expect
      .poll(() => to.locator("option").count(), { timeout: 8_000 })
      .toBeGreaterThan(1);
    await to.selectOption({ index: 1 });
    await page.getByLabel("Item description").fill("E2E sandwich lunch");
    await page.getByLabel("Quantity").fill("4");
    await page.getByLabel("Notes").fill("E2E browser-created movement");
    await page.getByRole("button", { name: "Create movement" }).click();
    await expect(page.getByText("E2E sandwich lunch")).toBeVisible();
    await expect.poll(async () => {
      const response = await page.request.get("/api/logistics?serviceDate=" + E2E_DATE);
      const body = await response.json();
      return body.movements.some((movement: { notes?: string }) => movement.notes === "E2E browser-created movement");
    }).toBeTruthy();

    await page.getByRole("button", { name: "New run" }).click();
    await expect(page.getByRole("dialog", { name: "Create delivery run" })).toBeVisible();
    await page.getByRole("button", { name: "Create run" }).click();
    expect(
      (
        await (
          await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)
        ).json()
      ).movements.some(
        (movement: { notes?: string }) =>
          movement.notes === "E2E browser-created movement",
      ),
    ).toBeTruthy();

    const movementCard = page.locator(".mock-queue-item").filter({ hasText: "E2E sandwich lunch" });
    await movementCard.getByRole("button", { name: "Details" }).click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByRole("button", { name: "Assign to vehicle" })).toBeVisible();
    const beforeAssignment = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const targetRun = beforeAssignment.runs.find((candidate: { status: string; vehicleId?: string }) => candidate.status === "draft" && candidate.vehicleId);
    const movement = beforeAssignment.movements.find((candidate: { notes?: string }) => candidate.notes === "E2E browser-created movement");
    expect(targetRun, "the service date should have a canonical planning run").toBeTruthy();
    expect(movement, "the Movement Request should remain the canonical movement record").toBeTruthy();
    const assignmentResponse = await page.request.post("/api/logistics", { data: { action: "assign", runId: targetRun.canonicalId, expectedRunVersion: targetRun.version, movementId: movement.canonicalId, plannedArrivalTime: "08:00" } });
    expect(assignmentResponse.ok(), await assignmentResponse.text()).toBeTruthy();
    await inspector.getByRole("button", { name: "Close inspector" }).click();
    await page.getByRole("button", { name: "Refresh" }).click();

    const assignedState = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const persistedMovement = assignedState.movements.find((candidate: { notes?: string }) => candidate.notes === "E2E browser-created movement");
    expect(persistedMovement, "the Movement Request should remain the canonical movement record").toBeTruthy();
    const assignedStop = assignedState.stops.find((candidate: { movementRequestIds?: string[] }) => candidate.movementRequestIds?.includes(persistedMovement.canonicalId));
    expect(assignedStop, "the native MovementRequest stop association should persist").toBeTruthy();
    await openStopDetails(page);
    const runLane = page.locator(`[data-lane="${assignedStop.runId}:delivery"]`);
    await expect(runLane).toBeVisible();
    await runLane.locator("xpath=..").getByRole("button", { name: "Run details" }).click();
    const runInspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(runInspector.getByRole("heading", { name: "Van 1" })).toBeVisible();
    await runInspector.getByLabel("Planned CPU departure").fill("07:00");
    await runInspector.getByLabel("Planned CPU return").fill("12:00");
    await runInspector.getByRole("button", { name: "Save journey times" }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      const run = state.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === assignedStop.runId);
      return [run?.plannedCpuDepartureTime, run?.plannedCpuReturnTime];
    }).toEqual(["07:00", "12:00"]);

    await expect(
      page.getByRole("button", { name: "Mark ready" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      return state.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === assignedStop.runId)?.status;
    }).toBe("ready");
    await expect(
      page.getByRole("button", { name: "Return to planning" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to planning" }).click();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      return state.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === assignedStop.runId)?.status;
    }).toBe("planned");
    await expect(
      page.getByRole("button", { name: "Mark ready" }),
    ).toBeVisible();
  });

  test("keeps operational screens usable at desktop width without fake navigation", async ({
    page,
  }) => {
    await page.goto("/?ui=classic&serviceDate=" + E2E_DATE);
    await openStopDetails(page);
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.locator(".mock-updated")).toContainText("Last updated");
    await expect(
      page.getByRole("link", { name: /Driver view/ }).last(),
    ).toBeVisible();
    await expect(page.getByText(/Navigate/)).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBeTruthy();
  });

  test("production planner keeps canonical timing modes and renders true window duration through resize and clear", async ({ page }) => {
    await page.goto("/?ui=classic&serviceDate=" + E2E_DATE);
    await openStopDetails(page);
    await expect(page.getByTestId("mounted-react-timeline")).toBeVisible();
    const api = async () => (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    let state = await api();
    const createRun = await page.request.post("/api/logistics", { data: { action: "create-run", by: "e2e", run: { canonicalId: `${E2E_PREFIX}batch5-window-run`, serviceDate: E2E_DATE, status: "draft", vehicleId: "van1", orderedStopIds: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), returnToCpuRequired: true, audit: [] } } });
    expect(createRun.ok(), await createRun.text()).toBeTruthy();
    let run = (await createRun.json()) as { canonicalId: string; version: number };
    const timing = await page.request.post("/api/logistics", { data: { action: "update-run-timing", runId: run.canonicalId, plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "12:00", expectedRunVersion: run.version } });
    expect(timing.ok(), await timing.text()).toBeTruthy();
    run = (await timing.json()) as { canonicalId: string; version: number };
    await page.reload();
    state = await api();
    run = state.runs.find((item: { canonicalId: string }) => item.canonicalId === run.canonicalId);
    expect(run, "the canonical Run and its CPU journey times should be persisted").toMatchObject({ plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "12:00" });
    const [from, to] = state.oplocs.slice(0, 2).map((item: { id: string }) => item.id);
    const movementId = `${E2E_PREFIX}batch5-window`;
    const created = await page.request.post("/api/logistics", { data: { action: "save-movement", movement: { canonicalId: movementId, entityType: "Movement Request", serviceDate: E2E_DATE, type: "delivery", fromOplocId: from, toOplocId: to, items: [{ description: "Batch 5 true duration", quantity: 1, unit: "load" }], createdBy: "e2e", status: "open", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [] } } });
    expect(created.ok(), await created.text()).toBeTruthy();
    const assigned = await page.request.post("/api/logistics", { data: { action: "assign", runId: run.canonicalId, expectedRunVersion: run.version, movementId } });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    state = await api();
    let stop = state.stops.find((item: { movementRequestIds?: string[] }) => item.movementRequestIds?.includes(movementId));
    expect(stop).toBeTruthy();

    const scheduleWindow = async (endTime: string) => {
      const current = await api();
      const currentRun = current.runs.find((item: { canonicalId: string }) => item.canonicalId === stop.runId);
      const currentStop = current.stops.find((item: { canonicalId: string }) => item.canonicalId === stop.canonicalId);
      const response = await page.request.post("/api/logistics", { data: { action: "schedule-stop", runId: currentRun.canonicalId, stopId: currentStop.canonicalId, plannedWindow: { startTime: "10:00", endTime }, expectedRunVersion: currentRun.version, expectedStopVersion: currentStop.version } });
      expect(response.ok(), await response.text()).toBeTruthy();
      await page.reload();
      await openStopDetails(page);
      const card = page.getByTestId(`stop-${stop.canonicalId}`);
      await expect(card).toBeVisible();
      return card;
    };
    for (const [endTime, duration, width] of [["10:15", 15, 30], ["10:30", 30, 60], ["11:00", 60, 120]] as const) {
      const card = await scheduleWindow(endTime);
      expect(await card.boundingBox()).toMatchObject({ width });
      expect(await card.getAttribute("aria-label")).toContain(`${duration === 60 ? "10:00 to 11:00" : `10:00 to ${endTime}`} window end`);
    }

    let card = page.getByTestId(`stop-${stop.canonicalId}`);
    await card.click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByLabel("Window end").fill("");
    await inspector.getByRole("button", { name: "Save time and placement" }).click();
    await expect.poll(async () => {
      const current = await api();
      stop = current.stops.find((item: { canonicalId: string }) => item.canonicalId === stop.canonicalId);
      return stop?.plannedArrivalTime;
    }).toBe("10:00");
    expect(Object.hasOwn(stop, "plannedWindow")).toBe(false);
    await expect.poll(async () => (await page.getByTestId(`stop-${stop.canonicalId}`).boundingBox())?.width).toBe(14);

    await inspector.getByLabel("Window end").fill("10:30");
    await inspector.getByRole("button", { name: "Save time and placement" }).click();
    await expect.poll(async () => {
      const current = await api();
      stop = current.stops.find((item: { canonicalId: string }) => item.canonicalId === stop.canonicalId);
      return stop?.plannedWindow?.endTime;
    }).toBe("10:30");
    expect(Object.hasOwn(stop, "plannedArrivalTime")).toBe(false);
    card = page.getByTestId(`stop-${stop.canonicalId}`);
    await expect.poll(async () => (await card.boundingBox())?.width).toBe(60);
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Close inspector" }).click();

    const viewport = page.getByTestId("mounted-timeline-viewport");
    const scale = await page.getByTestId("mounted-react-timeline").evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--timeline-quarter-hour")) / 15);
    await viewport.evaluate((element) => { (element as HTMLElement).scrollLeft = 675 * 2 - (element as HTMLElement).clientWidth * 0.6; });
    const handle = page.getByTestId(`resize-${stop.canonicalId}`);
    const handleBox = await handle.boundingBox();
    expect(handleBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2 + 15 * scale, handleBox!.y + handleBox!.height / 2, { steps: 10 });
    await page.mouse.up();
    await expect.poll(async () => {
      const current = await api();
      stop = current.stops.find((item: { canonicalId: string }) => item.canonicalId === stop.canonicalId);
      return stop?.plannedWindow?.endTime;
    }).toBe("10:45");
    expect(stop.plannedWindow.startTime).toBe("10:00");

    card = page.getByTestId(`stop-${stop.canonicalId}`);
    await card.click();
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Clear time" }).click();
    await expect.poll(async () => {
      const current = await api();
      stop = current.stops.find((item: { canonicalId: string }) => item.canonicalId === stop.canonicalId);
      return stop?.plannedArrivalTime || stop?.plannedWindow?.startTime;
    }).toBeUndefined();
  });

  test("shows multiple canonically persisted Runs for one vehicle across distinct CPU journeys", async ({ page }) => {
    const runIds = [`${E2E_PREFIX}journey-one`, `${E2E_PREFIX}journey-two`];
    for (const [index, runId] of runIds.entries()) {
      const created = await page.request.post("/api/logistics", { data: { action: "create-run", by: "e2e", run: { canonicalId: runId, serviceDate: E2E_DATE, status: "draft", vehicleId: "van1", orderedStopIds: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), returnToCpuRequired: true, audit: [] } } });
      expect(created.ok(), await created.text()).toBeTruthy();
      const run = await created.json();
      const departure = index === 0 ? "07:00" : "11:00";
      const returnTime = index === 0 ? "10:00" : "15:00";
      const timed = await page.request.post("/api/logistics", { data: { action: "update-run-timing", runId, plannedCpuDepartureTime: departure, plannedCpuReturnTime: returnTime, expectedRunVersion: run.version } });
      expect(timed.ok(), await timed.text()).toBeTruthy();
    }

    await page.goto("/?ui=classic&serviceDate=" + E2E_DATE);
    const journeys = page.getByRole("region", { name: "Vehicle journey timeline" });
    for (const [index, runId] of runIds.entries()) {
      const journey = journeys.locator(`[data-journey-run-id="${runId}"]`);
      await expect(journey).toBeVisible();
      await expect(journey).toHaveAttribute("aria-label", new RegExp(index === 0 ? "07:00 to 10:00" : "11:00 to 15:00"));
      await journey.click();
      const inspector = page.getByRole("complementary", { name: "Details inspector" });
      await expect(inspector.getByLabel("Planned CPU departure")).toHaveValue(index === 0 ? "07:00" : "11:00");
      await expect(inspector.getByLabel("Planned CPU return")).toHaveValue(index === 0 ? "10:00" : "15:00");
      if (index === 0) await inspector.getByRole("button", { name: "Close inspector" }).click();
    }
    const persisted = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    expect(runIds.map((id) => persisted.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === id))).toMatchObject([
      { vehicleId: "van1", plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "10:00" },
      { vehicleId: "van1", plannedCpuDepartureTime: "11:00", plannedCpuReturnTime: "15:00" },
    ]);
  });

  test("returns an authoritative MovementRequest stop to the planning queue", async ({ page }) => {
    const initial = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const [from, to] = initial.oplocs.slice(0, 2).map((item: { id: string }) => item.id);
    const movementId = `${E2E_PREFIX}modal`;
    const response = await page.request.post("/api/logistics", { data: { action: "save-movement", by: "e2e", movement: { canonicalId: movementId, entityType: "Movement Request", serviceDate: E2E_DATE, type: "delivery", fromOplocId: from, toOplocId: to, items: [{ description: "E2E modal return", quantity: 2, unit: "portions" }], createdBy: "e2e", status: "open", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [] } } });
    expect(response.ok()).toBeTruthy();

    const createdRun = await page.request.post("/api/logistics", { data: { action: "create-run", by: "e2e", run: { canonicalId: `${E2E_PREFIX}modal-run`, serviceDate: E2E_DATE, status: "draft", vehicleId: "van1", orderedStopIds: [], version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), returnToCpuRequired: true, audit: [] } } });
    expect(createdRun.ok(), await createdRun.text()).toBeTruthy();
    const run = await createdRun.json();
    const timing = await page.request.post("/api/logistics", { data: { action: "update-run-timing", runId: run.canonicalId, plannedCpuDepartureTime: "07:00", plannedCpuReturnTime: "12:00", expectedRunVersion: run.version } });
    expect(timing.ok(), await timing.text()).toBeTruthy();
    const assigned = await page.request.post("/api/logistics", { data: { action: "assign", runId: run.canonicalId, expectedRunVersion: run.version + 1, movementId, plannedArrivalTime: "08:00" } });
    expect(assigned.ok(), await assigned.text()).toBeTruthy();
    const assignedState = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const stop = assignedState.stops.find((candidate: { movementRequestIds?: string[] }) => candidate.movementRequestIds?.includes(movementId));
    expect(stop, "the native MovementRequest stop remains authoritative").toMatchObject({ runId: run.canonicalId, plannedArrivalTime: "08:00" });
    const movement = assignedState.movements.find((candidate: { canonicalId: string }) => candidate.canonicalId === movementId);
    expect(movement).toMatchObject({ status: "planned", version: 2 });

    await page.goto("/?ui=classic&serviceDate=" + E2E_DATE);
    await openStopDetails(page);
    const timelineCard = page.getByTestId(`stop-${stop.canonicalId}`);
    await expect(timelineCard).toBeVisible();
    await timelineCard.click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await expect(inspector.getByText("E2E modal return")).toBeVisible();
    await inspector.getByRole("button", { name: "Return to planning queue" }).click();
    await expect(page.getByText("E2E modal return").first()).toBeVisible();
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      return {
        stop: state.stops.some((candidate: { canonicalId: string }) => candidate.canonicalId === stop.canonicalId),
        movement: state.movements.find((candidate: { canonicalId: string }) => candidate.canonicalId === movementId),
        run: state.runs.find((candidate: { canonicalId: string }) => candidate.canonicalId === run.canonicalId),
      };
    }).toMatchObject({ stop: false, movement: { status: "open", version: 3 }, run: { orderedStopIds: [] } });
  });
});
