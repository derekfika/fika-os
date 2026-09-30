import { expect, test, type Locator, type Page } from "@playwright/test";

const DAY_START = 6 * 60;
const SLOT_WIDTH = 38;
const minuteX = (minute: number, viewportLeft: number, offset: number) => viewportLeft + ((minute - DAY_START) / 15) * SLOT_WIDTH + offset;

async function dragTo(page: Page, source: Locator, target: { vehicle: "van-1" | "van-2"; lane: "delivery" | "collection"; minute: number }, grabAt?: number) {
  const sourceBox = await source.boundingBox();
  const viewportBox = await page.getByTestId("timeline-viewport").boundingBox();
  const rowBox = await page.locator(`[data-lane="${target.vehicle}:${target.lane}"]`).boundingBox();
  if (!sourceBox || !viewportBox || !rowBox) throw new Error("Fixture source, timeline viewport, or target row is not visible");
  const isScheduled = (await source.getAttribute("data-testid"))?.startsWith("stop-") || false;
  const offset = isScheduled ? grabAt ?? Math.floor(sourceBox.width / 2) : 0;
  const startX = sourceBox.x + (grabAt ?? Math.min(sourceBox.width - 2, 2));
  const startY = sourceBox.y + sourceBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 12, startY + 5, { steps: 2 });
  await page.mouse.move(minuteX(target.minute, viewportBox.x, offset), rowBox.y + rowBox.height / 2, { steps: 12 });
  const preview = page.getByTestId("drag-ghost");
  await expect(preview).toBeVisible();
  const previewText = await preview.innerText();
  await page.mouse.up();
  return previewText;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/mock/timeline-poc");
  await expect(page.getByRole("heading", { name: "Timeline interaction proof" })).toBeVisible();
});

test("fixture page never calls Logistics APIs", async ({ page }) => {
  const apiRequests: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith("/api/")) apiRequests.push(url.pathname);
  });
  await page.reload();
  await expect(page.getByText("No live mutations")).toBeVisible();
  expect(apiRequests).toEqual([]);
});

test("left, centre, and right of the visible scheduled card share one exact move hitbox", async ({ page }) => {
  await page.getByLabel("Command simulator").selectOption("immediate");
  const targetTimes = [8 * 60, 8 * 60 + 15, 8 * 60 + 30];
  const offsets = [2, 62, 121];
  for (let index = 0; index < targetTimes.length; index += 1) {
    if (index > 0) await page.waitForTimeout(250);
    const card = page.getByTestId("stop-stop-mnk");
    const box = await card.boundingBox();
    expect(box?.width).toBe(124);
    const hitTarget = await card.evaluate((element, offset) => {
      const rect = element.getBoundingClientRect();
      return document.elementFromPoint(rect.left + offset, rect.top + rect.height / 2)?.closest("button")?.getAttribute("data-testid");
    }, offsets[index]);
    expect(hitTarget).toBe("stop-stop-mnk");
    const preview = await dragTo(page, card, { vehicle: "van-1", lane: "delivery", minute: targetTimes[index] }, offsets[index]);
    expect(preview).toContain(index === 0 ? "08:00" : index === 1 ? "08:15" : "08:30");
    await expect(page.getByRole("button", { name: new RegExp(`Move MNK, Van 1, Delivery, ${index === 0 ? "08:00" : index === 1 ? "08:15" : "08:30"}`) })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: /Move MNK, Van 1, Delivery/ })).toHaveCount(1);
  expect(await page.getByText(/Fixture commands:/).innerText()).toContain("3");
});

test("queue external pointer placement becomes one immediate pending card, then settles once", async ({ page }) => {
  const queueCard = page.getByTestId("queue-queue-bridgepoint");
  await dragTo(page, queueCard, { vehicle: "van-1", lane: "delivery", minute: 9 * 60 + 15 }, 215);
  const placed = page.getByRole("button", { name: /Move Bridgepoint, Van 1, Delivery, 09:15/ });
  await expect(placed).toBeVisible();
  await expect(placed).toBeDisabled();
  await expect(page.getByText(/Saving fixture placement/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Planning queue (3)" })).toBeVisible();
  await expect(placed).toBeEnabled({ timeout: 5000 });
  await expect(page.getByRole("button", { name: /Move Bridgepoint, Van 1, Delivery, 09:15/ })).toHaveCount(1);
});

test("scheduled move reflects the target vehicle and time while the delayed command is pending", async ({ page }) => {
  await page.evaluate(() => window.scrollTo({ top: 180, behavior: "instant" }));
  const source = page.getByTestId("stop-stop-bridgepoint");
  await dragTo(page, source, { vehicle: "van-2", lane: "delivery", minute: 9 * 60 + 15 }, 62);
  const targetRow = page.locator('[data-lane="van-2:delivery"]');
  const pending = targetRow.getByRole("button", { name: /Move Bridgepoint, Van 2, Delivery, 09:15/ });
  await expect(pending).toBeVisible();
  await expect(pending).toBeDisabled();
  await expect(targetRow).toContainText("Bridgepoint");
  await expect(page.getByText(/Fixture placement confirmed · Van 2 · Delivery · 09:15/)).toBeVisible({ timeout: 5000 });
  await expect(targetRow.getByRole("button", { name: /Move Bridgepoint, Van 2, Delivery, 09:15/ })).toBeEnabled();
});

test("rejection restores the original card and explains recovery", async ({ page }) => {
  await page.getByLabel("Command simulator").selectOption("reject");
  await page.evaluate(() => window.scrollTo({ top: 180, behavior: "instant" }));
  await dragTo(page, page.getByTestId("stop-stop-haleon"), { vehicle: "van-2", lane: "collection", minute: 10 * 60 + 30 }, 62);
  await expect(page.getByRole("button", { name: /Move Haleon, Van 1, Delivery, 08:15/ })).toBeVisible();
  await expect(page.getByText(/Fixture rejected the move for Haleon.*confirmed card was restored.*Retry/)).toBeVisible({ timeout: 3000 });
  await expect(page.locator('[data-lane="van-2:collection"]').getByRole("button", { name: /Move Haleon/ })).toHaveCount(0);
});

test("server adjustment settles at the canonical time and announces the adjustment", async ({ page }) => {
  await page.getByLabel("Command simulator").selectOption("adjust");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { vehicle: "van-1", lane: "delivery", minute: 8 * 60 + 15 }, 62);
  await expect(page.getByRole("button", { name: /Move MNK, Van 1, Delivery, 08:30/ })).toBeVisible();
  await expect(page.getByText(/requested 08:15, confirmed 08:30/)).toBeVisible();
});

test("Escape cancels an active drag without issuing a fixture command", async ({ page }) => {
  await page.evaluate(() => window.scrollTo({ top: 180, behavior: "instant" }));
  const source = await page.getByTestId("stop-stop-mnk").boundingBox();
  const targetViewport = await page.getByTestId("timeline-viewport").boundingBox();
  const targetRow = await page.locator('[data-lane="van-2:delivery"]').boundingBox();
  if (!source || !targetViewport || !targetRow) throw new Error("Scrolled drag fixture geometry unavailable");
  await page.mouse.move(source.x + 62, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 80, source.y + source.height / 2 + 4, { steps: 2 });
  await page.mouse.move(minuteX(9 * 60, targetViewport.x, 62), targetRow.y + targetRow.height / 2, { steps: 8 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.getByText(/Escape cancelled the drag/)).toBeVisible();
  await expect(page.getByText(/Fixture commands: 0/)).toBeVisible();
  await expect(page.getByTestId("stop-stop-mnk")).toHaveAttribute("aria-label", /07:30/);
});

test("pointer cancellation keeps the original fixture state and sends no command", async ({ page }) => {
  const source = await page.getByTestId("stop-stop-mnk").boundingBox();
  const targetViewport = await page.getByTestId("timeline-viewport").boundingBox();
  const targetRow = await page.locator('[data-lane="van-2:delivery"]').boundingBox();
  if (!source || !targetViewport || !targetRow) throw new Error("Pointer-cancel fixture geometry unavailable");
  await page.mouse.move(source.x + 62, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(source.x + 80, source.y + source.height / 2 + 4, { steps: 2 });
  await page.mouse.move(minuteX(9 * 60, targetViewport.x, 62), targetRow.y + targetRow.height / 2, { steps: 8 });
  await expect(page.getByTestId("drag-ghost")).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  await expect(page.getByText(/Pointer cancelled/)).toBeVisible();
  await expect(page.getByText(/Fixture commands: 0/)).toBeVisible();
  await expect(page.getByTestId("stop-stop-mnk")).toHaveAttribute("aria-label", /07:30/);
});

test("keyboard placement selects vehicle, lane, time, and window end", async ({ page }) => {
  await page.getByLabel("Command simulator").selectOption("immediate");
  const vehicle = page.getByLabel("Vehicle");
  await vehicle.focus();
  await vehicle.press("End");
  const lane = page.getByRole("combobox", { name: "Lane", exact: true });
  await lane.focus();
  await lane.press("End");
  const time = page.getByRole("combobox", { name: "Time", exact: true });
  await time.focus();
  for (let index = 0; index < 6; index += 1) await time.press("ArrowDown");
  const end = page.getByRole("combobox", { name: "Window end (optional)", exact: true });
  await end.focus();
  await end.press("ArrowDown");
  await end.press("ArrowDown");
  const submit = page.getByRole("button", { name: "Place fixture item" });
  await submit.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: /Move Bridgepoint, Van 2, Collection, 09:45 to 10:15 window end/ })).toBeVisible();
});

test("edge dragging scrolls the timeline viewport itself", async ({ page }) => {
  await page.getByLabel("Command simulator").selectOption("immediate");
  const viewport = page.getByTestId("timeline-viewport");
  const viewBox = await viewport.boundingBox();
  const rowBox = await page.locator('[data-lane="van-1:delivery"]').boundingBox();
  const sourceBox = await page.getByTestId("queue-queue-haleon").boundingBox();
  if (!viewBox || !rowBox || !sourceBox) throw new Error("Autoscroll fixture geometry unavailable");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + 20);
  await page.mouse.down();
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 12, sourceBox.y + 25, { steps: 2 });
  await page.mouse.move(viewBox.x + viewBox.width - 4, rowBox.y + rowBox.height / 2, { steps: 6 });
  await page.waitForTimeout(250);
  expect(await viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
  await page.mouse.up();
  await expect(page.getByText(/Fixture commands: 1/)).toBeVisible();
});
