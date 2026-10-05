import { test, expect } from "@playwright/test";
import { cleanupE2EData, E2E_DATE, E2E_PREFIX, ensureLogisticsIsRunning } from "./fixtures";

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
    await page.goto("/?serviceDate=" + E2E_DATE);
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
    await movementCard.getByRole("button", { name: "Assign" }).click();
    await page.getByRole("complementary", { name: "Details inspector" }).locator('button:not([disabled])', { hasText: "Assign to run" }).first().click();
    await page.getByRole("complementary", { name: "Details inspector" }).getByLabel("Target delivery run").selectOption({ index: 1 });
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Assign to run" }).last().click();

    await page.locator(".mock-run-link").filter({ hasText: "PLANNED" }).first().click();
    await expect(page.getByText("Franco", { exact: true }).first()).toBeVisible();

    await expect(
      page.getByRole("button", { name: "Mark ready" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Mark ready" }).click();
    await expect(page.getByText("READY").last()).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Return to planning" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Return to planning" }).click();
    await expect(
      page.getByRole("button", { name: "Mark ready" }),
    ).toBeVisible();
  });

  test("keeps operational screens usable at desktop width without fake navigation", async ({
    page,
  }) => {
    await page.goto("/?serviceDate=" + E2E_DATE);
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
    await page.goto("/?serviceDate=" + E2E_DATE);
    await expect(page.getByTestId("mounted-react-timeline")).toBeVisible();
    const api = async () => (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    let state = await api();
    const run = state.runs.find((item: { status: string; vehicleId?: string }) => item.status === "planned" && item.vehicleId);
    expect(run, "E2E service date should have a governed planning run").toBeTruthy();
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

    const viewport = page.getByTestId("mounted-timeline-viewport");
    const track = page.locator(`[data-lane="${stop.runId}:delivery"]`);
    const scale = await page.getByTestId("mounted-react-timeline").evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--timeline-quarter-hour")) / 15);
    await viewport.evaluate((element) => { (element as HTMLElement).scrollLeft = 675 * 2 - (element as HTMLElement).clientWidth * 0.6; });
    const handle = page.getByTestId(`resize-${stop.canonicalId}`);
    const handleBox = await handle.boundingBox(); const trackBox = await track.boundingBox();
    expect(handleBox).toBeTruthy(); expect(trackBox).toBeTruthy();
    await page.mouse.move(handleBox!.x + handleBox!.width / 2, handleBox!.y + handleBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(trackBox!.x + 10 * 60 + 45 * scale, trackBox!.y + 35, { steps: 10 });
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

  test("assigns a queue load to a run and assigns plus schedules another by drop position", async ({ page }) => {
    const initial = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const [from, to] = initial.oplocs.slice(0, 2).map((item: { id: string }) => item.id);
    for (const [index, label] of ["E2E queue Franco", "E2E queue Dee"].entries()) {
      const response = await page.request.post("/api/logistics", { data: { action: "save-movement", by: "e2e", movement: { canonicalId: `${E2E_PREFIX}${index}`, entityType: "Movement Request", serviceDate: E2E_DATE, type: "delivery", fromOplocId: from, toOplocId: to, items: [{ description: label, quantity: 4, unit: "portions" }], createdBy: "e2e", status: "open", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [] } } });
      expect(response.ok()).toBeTruthy();
    }
    await page.goto("/?serviceDate=" + E2E_DATE);
    await expect(page.locator(".mock-queue-item")).toHaveCount(2);
    await page.getByRole("button", { name: "New run" }).click();
    await page.getByRole("button", { name: "Create run" }).click();
    await page.getByRole("button", { name: "New run" }).click();
    await page.getByRole("dialog", { name: "Create delivery run" }).getByLabel("Driver").selectOption("Dee");
    await page.getByRole("button", { name: "Create run" }).click();
    await expect(page.locator(".stable-group")).toHaveCount(2);
    await expect(page.locator(".stable-vehicle-row")).toHaveCount(4);
    await expect(page.locator(".delivery-ruler b").first()).toHaveText("06:00");
    await expect(page.locator(".delivery-ruler b").last()).toHaveText("12:00");
    await expect(page.locator(".collection-ruler b").first()).toHaveText("12:00");
    await expect(page.locator(".collection-ruler b").last()).toHaveText("18:00");
    const firstQueue = page.locator(".mock-queue-item").filter({ hasText: "E2E queue Franco" });
    await firstQueue.dragTo(page.locator(".stable-lane.delivery").first());
    await expect(firstQueue).toHaveCount(0);
    const secondQueue = page.locator(".mock-queue-item").filter({ hasText: "E2E queue Dee" });
    await secondQueue.dragTo(page.locator(".stable-group.delivery-group .stable-vehicle-row").nth(1).locator(".stable-lane.delivery"));
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      return state.stops.find((stop: { movementRequestIds?: string[] }) => stop.movementRequestIds?.includes(`${E2E_PREFIX}1`));
    }).toMatchObject({ plannedArrivalTime: expect.any(String) });
    const finalState = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const scheduled = finalState.stops.find((stop: { movementRequestIds?: string[] }) => stop.movementRequestIds?.includes(`${E2E_PREFIX}1`));
    expect(Number(scheduled.plannedArrivalTime.split(":")[1]) % 15).toBe(0);
    await expect(page.locator(".mock-queue-item").filter({ hasText: "E2E queue Dee" })).toHaveCount(0);
  });

  test("opens a scheduled card and returns it to the planning queue by modal or drag", async ({ page }) => {
    const initial = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
    const [from, to] = initial.oplocs.slice(0, 2).map((item: { id: string }) => item.id);
    const movementId = `${E2E_PREFIX}modal`;
    const response = await page.request.post("/api/logistics", { data: { action: "save-movement", by: "e2e", movement: { canonicalId: movementId, entityType: "Movement Request", serviceDate: E2E_DATE, type: "delivery", fromOplocId: from, toOplocId: to, items: [{ description: "E2E modal return", quantity: 2, unit: "portions" }], createdBy: "e2e", status: "open", version: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), audit: [] } } });
    expect(response.ok()).toBeTruthy();

    await page.goto("/?serviceDate=" + E2E_DATE);
    await expect(page.locator(".mock-queue-item").filter({ hasText: "E2E modal return" })).toBeVisible();
    await page.getByRole("button", { name: "New run" }).click();
    await page.getByRole("button", { name: "Create run" }).click();
    const queueItem = page.locator(".mock-queue-item").filter({ hasText: "E2E modal return" });
    await queueItem.dragTo(page.locator(".stable-lane.delivery").first());
    await expect.poll(async () => {
      const state = await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json();
      return state.stops.find((stop: { movementRequestIds?: string[] }) => stop.movementRequestIds?.includes(movementId));
    }).toMatchObject({ plannedArrivalTime: expect.any(String) });
    const scheduledId = (await (await page.request.get("/api/logistics?serviceDate=" + E2E_DATE)).json()).stops.find((stop: { movementRequestIds?: string[] }) => stop.movementRequestIds?.includes(movementId)).canonicalId;
    const scheduled = page.locator(`[data-stop-id="${scheduledId}"]`);
    await scheduled.click();
    await expect(page.getByRole("complementary", { name: "Details inspector" })).toBeVisible();
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Return to planning queue" }).click();
    await expect(page.locator(".mock-queue-item").filter({ hasText: "E2E modal return" })).toBeVisible();
    await expect(page.locator(".stable-stop.delivery")).toHaveCount(0);

    await page.locator(".mock-queue-item").filter({ hasText: "E2E modal return" }).dragTo(page.locator(".stable-lane.delivery").first());
    await page.locator(".stable-stop.delivery").first().dragTo(page.locator(".mock-queue-list"));
    await expect(page.locator(".mock-queue-item").filter({ hasText: "E2E modal return" })).toBeVisible();
    await expect(page.locator(".stable-stop.delivery")).toHaveCount(0);
  });
});
