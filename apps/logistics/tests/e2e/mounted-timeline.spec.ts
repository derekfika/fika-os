import { expect, test, type Locator, type Page } from "@playwright/test";

const minuteOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

async function dragTo(page: Page, source: Locator, target: { run: string; lane: "delivery" | "collection"; time: string }, grabOffset = 0) {
  const initialCard = await source.boundingBox();
  const viewport = page.getByTestId("mounted-timeline-viewport");
  const viewportBox = await viewport.boundingBox();
  const row = page.locator(`[data-lane="${target.run}:${target.lane}"]`);
  const rowBox = await row.boundingBox();
  if (!initialCard || !viewportBox || !rowBox) throw new Error("Mounted fixture geometry unavailable");
  await viewport.evaluate((element, targetMinute) => {
    const scroller = element as HTMLElement;
    const targetX = 150 + targetMinute * 2;
    scroller.scrollLeft = Math.max(0, targetX - scroller.clientWidth * 0.55);
  }, minuteOf(target.time));
  const card = await source.boundingBox();
  if (!card) throw new Error("Mounted fixture source moved out of the viewport");
  const scrollLeft = await viewport.evaluate((element) => (element as HTMLElement).scrollLeft);
  const startX = card.x + Math.min(grabOffset || 6, card.width - 2);
  const startY = card.y + card.height / 2;
  const targetX = viewportBox.x + 150 + minuteOf(target.time) * 2 - scrollLeft + grabOffset;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 14, startY + 6, { steps: 2 });
  await page.mouse.move(targetX, rowBox.y + rowBox.height / 2, { steps: 10 });
  await expect(page.getByTestId("mounted-drag-ghost")).toBeVisible();
  const preview = await page.getByTestId("mounted-drag-ghost").innerText();
  await page.mouse.up();
  return preview;
}

test.beforeEach(async ({ page }) => {
  await page.goto("/mock/mounted-timeline");
  await expect(page.getByRole("heading", { name: "Mounted React timeline fixture" })).toBeVisible();
});

test("safe mounted fixture makes no Logistics API request", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => { const url = new URL(request.url()); if (url.pathname.startsWith("/api/")) requests.push(url.pathname); });
  await page.reload();
  await expect(page.getByTestId("mounted-react-timeline")).toBeVisible();
  expect(requests).toEqual([]);
});

test("the full visible card is one real movement hitbox at left, centre and right", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const card = page.getByTestId("stop-stop-mnk");
  for (const [offset, time] of [[4, "08:00"], [68, "08:15"], [132, "08:30"]] as const) {
    const box = await card.boundingBox();
    expect(box?.width).toBeGreaterThanOrEqual(136);
    expect(await card.evaluate((element, x) => document.elementFromPoint(element.getBoundingClientRect().left + x, element.getBoundingClientRect().top + 20)?.closest("button") === element, offset)).toBe(true);
    const preview = await dragTo(page, card, { run: "run-1", lane: "delivery", time }, offset);
    expect(preview).toContain(time);
  }
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 3");
});

test("preview time is the exact 15-minute command target", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const preview = await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  expect(preview).toContain("09:15");
  await expect(page.getByTestId("fixture-message")).toContainText("09:15");
});

test("queue placement renders exactly one immediate pending card", async ({ page }) => {
  const preview = await dragTo(page, page.locator('[data-timeline-queue-id="queue-bridge"]'), { run: "run-1", lane: "delivery", time: "09:00" });
  expect(preview).toContain("Bridgepoint Queue");
  await expect(page.getByTestId("pending-queue-queue-bridge")).toBeVisible();
  await expect(page.getByTestId("pending-queue-queue-bridge")).toBeDisabled();
  await expect(page.locator('[data-testid="pending-queue-queue-bridge"]')).toHaveCount(1);
});

test("delayed queue command retains one pending card and hands off to canonical work", async ({ page }) => {
  const source = page.locator('[data-timeline-queue-id="queue-bridge"]');
  await dragTo(page, source, { run: "run-2", lane: "delivery", time: "09:30" });
  await expect(page.getByTestId("pending-queue-queue-bridge")).toBeVisible();
  await expect(page.getByTestId("pending-queue-queue-bridge")).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Move Bridgepoint Queue, Van South, Delivery, 09:30/ })).toBeEnabled({ timeout: 5000 });
  await expect(page.getByTestId("pending-queue-queue-bridge")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move Bridgepoint Queue, Van South, Delivery, 09:30/ })).toHaveCount(1);
});

test("existing move is optimistic on the target vehicle and lane", async ({ page }) => {
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-2", lane: "collection", time: "09:15" }, 68);
  const target = page.locator('[data-lane="run-2:collection"]');
  await expect(target.getByRole("button", { name: /Move MNK, Van South, Collection, 09:15/ })).toBeDisabled();
  await expect(target).toContainText("MNK");
});

test("rejected placement restores its confirmed position", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("reject");
  await dragTo(page, page.getByTestId("stop-stop-haleon"), { run: "run-1", lane: "collection", time: "10:30" }, 68);
  await expect(page.getByRole("button", { name: /Move Haleon, Van South, Delivery, 08:15/ })).toBeVisible();
  await expect(page.getByTestId("fixture-message")).toContainText("confirmed placement restored");
  await expect(page.locator('[data-lane="run-1:collection"]').getByRole("button", { name: /Move Haleon/ })).toHaveCount(0);
});

test("server-adjusted position settles at the returned canonical time", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("adjust");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:30/ })).toBeVisible();
  await expect(page.getByTestId("fixture-message")).toContainText("Server adjusted placement to 09:30");
});

test("Escape cancels without a placement command", async ({ page }) => {
  const card = await page.getByTestId("stop-stop-mnk").boundingBox();
  const row = await page.locator('[data-lane="run-2:delivery"]').boundingBox();
  if (!card || !row) throw new Error("Escape fixture geometry unavailable");
  await page.mouse.move(card.x + 68, card.y + 20); await page.mouse.down();
  await page.mouse.move(card.x + 86, card.y + 25); await page.mouse.move(card.x + 200, row.y + 30);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 0");
});

test("pointercancel cancels without a placement command", async ({ page }) => {
  const card = await page.getByTestId("stop-stop-mnk").boundingBox();
  if (!card) throw new Error("Pointer cancellation fixture geometry unavailable");
  await page.mouse.move(card.x + 60, card.y + 20); await page.mouse.down(); await page.mouse.move(card.x + 80, card.y + 25);
  await page.evaluate(() => window.dispatchEvent(new PointerEvent("pointercancel", { pointerId: 1, bubbles: true })));
  await page.mouse.up();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 0");
});

test("horizontal edge autoscroll keeps the preview on a quarter-hour", async ({ page }) => {
  const viewport = page.getByTestId("mounted-timeline-viewport");
  await viewport.evaluate((element) => { (element as HTMLElement).scrollLeft = 200; });
  const before = await viewport.evaluate((element) => (element as HTMLElement).scrollLeft);
  const box = await page.getByTestId("stop-stop-mnk").boundingBox();
  const row = await page.locator('[data-lane="run-1:delivery"]').boundingBox();
  const view = await viewport.boundingBox();
  if (!box || !row || !view) throw new Error("Autoscroll geometry unavailable");
  await page.mouse.move(box.x + 70, box.y + 20); await page.mouse.down(); await page.mouse.move(box.x + 90, box.y + 24);
  await page.mouse.move(view.x + view.width - 4, row.y + 35, { steps: 8 });
  await page.waitForTimeout(300);
  const after = await viewport.evaluate((element) => (element as HTMLElement).scrollLeft);
  expect(after).toBeGreaterThan(before);
  const ghostTime = await page.getByTestId("mounted-drag-ghost").locator("time").innerText();
  expect(ghostTime).toMatch(/^\d\d:\d\d$/);
  await page.keyboard.press("Escape"); await page.mouse.up();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 0");
});

test("arrival-only move never manufactures an end time", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-2", lane: "delivery", time: "09:45" }, 68);
  await expect(page.getByRole("button", { name: /Move MNK, Van South, Delivery, 09:45, 1 load/ })).toBeVisible();
});

test("explicit window remains visible and editable in Details, without a resize handle", async ({ page }) => {
  const card = page.getByTestId("stop-stop-riverside");
  await expect(card).toContainText("10:00–11:00");
  await expect(card.locator(".resize-handle")).toHaveCount(0);
  await card.click();
  await page.getByLabel("Details window end").fill("10:45");
  await page.getByRole("button", { name: "Save window" }).click();
  await expect(page.getByTestId("fixture-message")).toContainText("10:00–10:45");
});

test("Collection queue drag uses the Collection lane operation", async ({ page }) => {
  await dragTo(page, page.locator('[data-timeline-queue-id="queue-collection"]'), { run: "run-2", lane: "collection", time: "12:15" });
  await expect(page.getByTestId("fixture-message")).toContainText("Collection movement");
  await expect(page.getByTestId("pending-queue-queue-collection")).toBeVisible();
});

test("keyboard Details workflow remains available for explicit-window placement", async ({ page }) => {
  await page.getByTestId("stop-stop-riverside").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByLabel("Details window end")).toBeVisible();
  await page.getByLabel("Details window end").fill("10:30");
  await page.getByRole("button", { name: "Save window" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("fixture-message")).toContainText("10:00–10:30");
});

test("Collection stop remains in Collection lane when the same Collection command is submitted", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await dragTo(page, page.getByTestId("stop-stop-riverside"), { run: "run-2", lane: "collection", time: "12:00" }, 68);
  await expect(page.locator('[data-lane="run-2:collection"]').getByRole("button", { name: /Move Riverside, Van South, Collection, 12:00/ })).toBeVisible();
});

test("visual subrows preserve canonical 08:00 and 08:15 anchors", async ({ page }) => {
  const row = page.locator('[data-lane="run-1:delivery"]');
  const first = row.getByTestId("stop-stop-bridgepoint");
  const second = page.getByTestId("stop-stop-mnk");
  await expect(first).toContainText("08:00");
  await expect(second).toContainText("07:30");
  const a = await first.boundingBox(); const b = await page.getByTestId("stop-stop-haleon").boundingBox();
  if (!a || !b) throw new Error("Subrow card geometry unavailable");
  expect(Math.abs(a.y - b.y)).toBeGreaterThan(0);
  await expect(first).toContainText("08:00");
  await expect(page.getByTestId("stop-stop-haleon")).toContainText("08:15");
});
