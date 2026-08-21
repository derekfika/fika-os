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
