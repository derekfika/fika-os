import { expect, test, type Locator, type Page } from "@playwright/test";

const minuteOf = (value: string) => Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5));

async function dragTo(page: Page, source: Locator, target: { run: string; lane: "delivery" | "collection"; time: string }, grabOffset = 0) {
  await source.scrollIntoViewIfNeeded();
  const viewport = page.getByTestId("mounted-timeline-viewport");
  const viewportBox = await viewport.boundingBox();
  const row = page.locator(`[data-lane="${target.run}:${target.lane}"]`);
  const rowBox = await row.boundingBox();
  const card = await source.boundingBox();
  const currentTrack = await row.boundingBox();
  if (!card || !viewportBox || !rowBox || !currentTrack) throw new Error("Mounted fixture geometry unavailable");
  const scale = await page.getByTestId("mounted-react-timeline").evaluate((element) => Number.parseFloat(getComputedStyle(element).getPropertyValue("--timeline-quarter-hour")) / 15);
  const currentScroll = await viewport.evaluate((element) => (element as HTMLElement).scrollLeft);
  const contentTrackLeft = currentTrack.x + currentScroll;
  const desiredScroll = Math.max(0, contentTrackLeft - viewportBox.x + minuteOf(target.time) * scale - viewportBox.width * 0.55);
  const startX = card.x + Math.min(grabOffset || 6, card.width - 2);
  const startY = card.y + card.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 14, startY + 6, { steps: 2 });
  await viewport.evaluate((element, next) => { (element as HTMLElement).scrollLeft = next; }, desiredScroll);
  const scrolledTrack = await row.boundingBox();
  if (!scrolledTrack) throw new Error("Mounted fixture target track geometry unavailable after scroll");
  const targetX = scrolledTrack.x + minuteOf(target.time) * scale + grabOffset;
  await page.mouse.move(targetX, rowBox.y + rowBox.height / 2, { steps: 10 });
  const ghost = page.getByTestId("mounted-drag-ghost");
  const preview = await ghost.isVisible() ? await ghost.innerText() : "";
  await page.mouse.up();
  return preview;
}

async function resizeToEnd(page: Page, stopId: string, end: string, runId = "run-1", lane: "delivery" | "collection" = "collection", inspectLiveRail = false) {
  const viewport = page.getByTestId("mounted-timeline-viewport");
  const track = page.locator(`[data-lane="${runId}:${lane}"]`);
  const handle = page.getByTestId(`resize-${stopId}`);
  await handle.scrollIntoViewIfNeeded();
  const viewBox = await viewport.boundingBox();
  const trackBox = await track.boundingBox();
  if (!viewBox || !trackBox) throw new Error("Resize viewport geometry unavailable");
  const endMinute = minuteOf(end);
  const geometry = await page.getByTestId("mounted-react-timeline").evaluate((element) => ({
    scale: Number.parseFloat(getComputedStyle(element).getPropertyValue("--timeline-quarter-hour")) / 15,
    maxScroll: (element.querySelector('[data-testid="mounted-timeline-viewport"]') as HTMLElement).scrollWidth - (element.querySelector('[data-testid="mounted-timeline-viewport"]') as HTMLElement).clientWidth,
  }));
  const currentScroll = await viewport.evaluate((element) => (element as HTMLElement).scrollLeft);
  const desiredScroll = Math.max(0, Math.min(geometry.maxScroll, endMinute * geometry.scale - viewBox.width * 0.65));
  await viewport.evaluate((element, next) => { (element as HTMLElement).scrollLeft = next; }, desiredScroll);
  const handleBox = await handle.boundingBox();
  const scrolledTrack = await track.boundingBox();
  if (!handleBox || !scrolledTrack) throw new Error("Resize handle geometry unavailable");
  const startX = handleBox.x + handleBox.width / 2;
  const startY = handleBox.y + handleBox.height / 2;
  const targetX = scrolledTrack.x + endMinute * geometry.scale;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 9, startY + 2, { steps: 2 });
  await page.mouse.move(targetX, scrolledTrack.y + 34, { steps: 8 });
  const feedback = await page.getByTestId("mounted-resize-time").innerText();
  if (inspectLiveRail) {
    const start = (await handle.getAttribute("aria-valuetext"))?.match(/^(\d\d:\d\d) start/)?.[1];
    if (!start) throw new Error("Resize start time unavailable");
    await expect(handle).toHaveAttribute("aria-valuenow", String(endMinute));
    const liveRailWidth = await page.getByTestId(`duration-rail-${stopId}`).evaluate((element) => Number.parseFloat((element as HTMLElement).style.width));
    expect(liveRailWidth).toBe((endMinute - minuteOf(start)) * geometry.scale);
  }
  await page.mouse.up();
  return feedback;
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

test("three actual runs render and the synthetic unassigned projection run stays hidden", async ({ page }) => {
  await expect(page.locator('[data-lane="run-3:delivery"]')).toBeVisible();
  await expect(page.getByTestId("stop-stop-overlap-6")).toBeVisible();
  await expect(page.getByTestId("stop-stop-placeholder")).toHaveCount(0);
  await expect(page.locator('[data-lane^="projection-run:"]')).toHaveCount(0);
});

test("the full visible card is one real movement hitbox at left, centre and right", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const card = page.getByTestId("stop-stop-haleon");
  for (const [offset, time] of [[4, "12:00"], [68, "12:15"], [132, "12:30"]] as const) {
    await card.scrollIntoViewIfNeeded();
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

test("projection Collection is not suppressed by its unscheduled canonical stop and hands off once", async ({ page }) => {
  const source = page.locator('[data-timeline-queue-id="projection-collection:load-1"]');
  const preview = await dragTo(page, source, { run: "run-1", lane: "collection", time: "12:15" });
  expect(preview).toContain("Projected Collection");
  const pendingCard = page.getByTestId("pending-queue-projection-collection:load-1");
  await expect(pendingCard).toBeVisible();
  await expect(page.getByTestId("stop-projection-stop:collection:load-1")).toHaveCount(0);
  await expect(pendingCard).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Move Projected Collection, Van North, Collection, 12:15/ })).toBeVisible({ timeout: 5000 });
  await expect(pendingCard).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Move Projected Collection, Van North, Collection, 12:15/ })).toHaveCount(1);
});

test("partially planned group overlay contains only the eligible work being placed", async ({ page }) => {
  const source = page.locator('[data-timeline-queue-id="group-partial-delivery"]');
  const preview = await dragTo(page, source, { run: "run-1", lane: "delivery", time: "08:00" });
  expect(preview).toContain("Partially planned delivery");
  await expect(page.getByTestId("pending-queue-group-partial-delivery")).toBeVisible();
  await expect(page.getByTestId("pending-queue-group-partial-delivery")).toBeDisabled();
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

test("existing move is optimistic on the third target vehicle in the same lane", async ({ page }) => {
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-3", lane: "delivery", time: "09:15" }, 68);
  const target = page.locator('[data-lane="run-3:delivery"]');
  await expect(target.getByRole("button", { name: /Move MNK, Van East, Delivery, 09:15/ })).toBeEnabled();
  await expect(target).toContainText("MNK");
});

test("invalid cross-lane drop has no preview target and submits no command", async ({ page }) => {
  const cases: Array<[Locator, { run: string; lane: "delivery" | "collection"; time: string }]> = [
    [page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "collection", time: "09:15" }],
    [page.getByTestId("stop-stop-riverside"), { run: "run-1", lane: "delivery", time: "09:15" }],
    [page.locator('[data-timeline-queue-id="queue-bridge"]'), { run: "run-1", lane: "collection", time: "09:15" }],
    [page.locator('[data-timeline-queue-id="projection-collection:load-1"]'), { run: "run-1", lane: "delivery", time: "09:15" }],
  ];
  for (const [source, target] of cases) expect(await dragTo(page, source, target, 8)).toBe("");
  await expect(page.locator('[data-lane="run-1:collection"].activeTrack, [data-lane="run-1:delivery"].activeTrack')).toHaveCount(0);
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 0");
});

test("rejected placement restores its confirmed position", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("reject");
  await dragTo(page, page.getByTestId("stop-stop-haleon"), { run: "run-1", lane: "delivery", time: "10:30" }, 68);
  await expect(page.getByRole("button", { name: /Move Haleon, Van South, Delivery, 08:15/ })).toBeVisible();
  await expect(page.getByTestId("fixture-message")).toContainText("confirmed placement restored");
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 11:00 window end/ })).toBeEnabled();
  await expect(page.locator('[data-lane="run-1:collection"]').getByRole("button", { name: /Move Haleon/ })).toHaveCount(0);
});

test("server-adjusted position is shown immediately and remains editable while authority converges", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("adjust");
  await page.getByLabel("Refresh mode").selectOption("delayed");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  const adjusted = page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:30/ });
  await expect(adjusted).toBeEnabled();
  await expect(adjusted).toContainText("Saved · syncing…");
  await expect(page.getByTestId("fixture-message")).toContainText("Server adjusted placement to 09:30");
  await expect(adjusted).toBeEnabled({ timeout: 5000 });
});

test("a moved card opens Details against its raw source run identity", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-3", lane: "delivery", time: "09:15" }, 68);
  await page.getByRole("button", { name: /Move MNK, Van East, Delivery, 09:15/ }).click();
  await expect(page.getByTestId("fixture-message")).toContainText("Inspector opened for source run run-3");
});

test("Fit day fits all 24 hours into the space beside the sticky run labels", async ({ page }) => {
  await page.getByRole("button", { name: "Fit day" }).click();
  const sizes = await page.getByTestId("mounted-timeline-viewport").evaluate((element) => ({ client: element.clientWidth, scroll: element.scrollWidth }));
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.client + 1);
});

test("150 percent zoom keeps grid, pointer preview, submission and horizontal scroll geometry aligned", async ({ page }) => {
  const zoomIn = page.getByRole("button", { name: "Zoom timeline in" });
  await zoomIn.click(); await zoomIn.click();
  await expect(page.getByLabel("Timeline zoom")).toHaveValue("1.5");
  const spacing = await page.locator('[data-lane="run-2:delivery"]').evaluate((element) => ({
    quarter: getComputedStyle(element).getPropertyValue("--timeline-quarter-hour").trim(),
    hour: getComputedStyle(element).getPropertyValue("--timeline-hour").trim(),
  }));
  expect(spacing).toEqual({ quarter: "45px", hour: "180px" });
  const preview = await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-2", lane: "delivery", time: "09:15" }, 68);
  expect(preview).toContain("09:15");
  const scroll = await page.getByTestId("mounted-timeline-viewport").evaluate((element) => (element as HTMLElement).scrollLeft);
  expect(scroll).toBeGreaterThan(0);
  await expect(page.getByTestId("fixture-message")).toContainText("09:15");
});

test("explicit windows keep their duration when clamped at the end of day", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const arrival = await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "23:45" }, 4);
  expect(arrival).toContain("23:45");
  const thirty = await dragTo(page, page.getByTestId("stop-stop-window-30"), { run: "run-2", lane: "delivery", time: "23:45" }, 4);
  expect(thirty).toContain("23:15–23:45");
  const sixty = await dragTo(page, page.getByTestId("stop-stop-riverside"), { run: "run-1", lane: "collection", time: "23:45" }, 4);
  expect(sixty).toContain("22:45–23:45");
  await expect(page.getByTestId("fixture-message")).toContainText("22:45–23:45");
});

test("scheduled card returns to queue through Pointer Events exactly once", async ({ page }) => {
  const source = page.getByTestId("stop-stop-mnk");
  const card = await source.boundingBox();
  const queue = page.locator("[data-logistics-planning-queue]");
  const queueBox = await queue.boundingBox();
  if (!card || !queueBox) throw new Error("Queue return target geometry unavailable");
  await page.mouse.move(card.x + 68, card.y + 24); await page.mouse.down();
  await page.mouse.move(card.x + 88, card.y + 28, { steps: 2 });
  await page.mouse.move(queueBox.x + queueBox.width / 2, queueBox.y + queueBox.height / 2, { steps: 10 });
  await expect(queue).toHaveAttribute("data-return-target", "active");
  await expect(page.getByTestId("mounted-drag-ghost")).toHaveCount(0);
  await page.mouse.up();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 1");
  await expect(page.getByTestId("stop-stop-mnk")).toHaveCount(0);
  await expect(page.getByTestId("fixture-message")).toContainText("Returned MNK to the Planning queue.", { timeout: 5000 });
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 1");
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
  await expect(page.getByTestId("resize-stop-stop-mnk")).toHaveCount(0);
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-2", lane: "delivery", time: "09:45" }, 68);
  await expect(page.getByRole("button", { name: /Move MNK, Van South, Delivery, 09:45, 1 load/ })).toBeVisible();
});

test("explicit window remains editable in Details and exposes a visible end-resize control", async ({ page }) => {
  const card = page.getByTestId("stop-stop-riverside");
  await expect(card).toContainText("10:00–11:00");
  const handle = page.getByTestId("resize-stop-riverside");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveAttribute("aria-valuenow", "660");
  await expect(handle).toHaveAttribute("aria-valuetext", "10:00 start, 11:00 end, 60 minutes");
  await card.click();
  await page.getByLabel("Details window end").fill("10:45");
  await page.getByRole("button", { name: "Save window" }).click();
  await expect(page.getByTestId("fixture-message")).toContainText("10:00–10:45");
});

test("duration rail and integrated end grip align to the real window end without covering card text", async ({ page }) => {
  const card = page.getByTestId("stop-stop-riverside");
  const geometry = await page.evaluate(() => {
    const card = document.querySelector('[data-testid="stop-stop-riverside"]')!;
    const rail = document.querySelector('[data-testid="duration-rail-stop-riverside"]')!;
    const grip = document.querySelector('[data-testid="resize-stop-riverside"]')!;
    const text = card.querySelector("small")!;
    const bounds = (element: Element) => { const rect = element.getBoundingClientRect(); return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height }; };
    return { card: bounds(card), rail: bounds(rail), grip: bounds(grip), text: bounds(text), background: getComputedStyle(grip).backgroundColor };
  });
  expect(Math.abs(geometry.rail.left - geometry.card.left)).toBeLessThan(2);
  expect(Math.abs(geometry.rail.right - geometry.card.left - 120)).toBeLessThan(2);
  expect(Math.abs((geometry.grip.left + geometry.grip.width / 2) - geometry.rail.right)).toBeLessThan(2);
  expect(geometry.grip.width).toBeLessThanOrEqual(12);
  expect(geometry.grip.top).toBeGreaterThan(geometry.text.bottom - 2);
  expect(geometry.background).not.toBe("rgb(255, 255, 255)");
  await expect(card).toContainText("10:00–11:00");
});

test("explicit-window card body moves the whole window and does not resize it", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await dragTo(page, page.getByTestId("stop-stop-riverside"), { run: "run-1", lane: "collection", time: "11:00" }, 68);
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 11:00 to 12:00 window end/ })).toBeVisible();
  await expect(page.getByTestId("resize-stop-riverside")).toBeVisible();
});

test("resize handle changes only the end and shows snapped live feedback", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const feedback = await resizeToEnd(page, "stop-riverside", "11:38");
  expect(feedback).toBe("10:00 → 11:45 · 105 min");
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 11:45 window end/ })).toBeVisible();
  await expect(page.getByTestId("fixture-message")).toContainText("10:00–11:45");
});

test("the duration rail and end grip follow the live snapped resize preview", async ({ page }) => {
  const feedback = await resizeToEnd(page, "stop-riverside", "11:30", "run-1", "collection", true);
  expect(feedback).toBe("10:00 → 11:30 · 90 min");
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 11:30 window end/ })).toBeVisible();
});

test("resize enforces a 15-minute minimum duration", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const feedback = await resizeToEnd(page, "stop-riverside", "09:00");
  expect(feedback).toBe("10:00 → 10:15 · 15 min");
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 10:15 window end/ })).toBeVisible();
});

test("resize end can also be adjusted from the keyboard", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  const handle = page.getByRole("slider", { name: "Resize Riverside window end" });
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 11:15 window end/ })).toBeVisible();
});

test("resize at end of day clamps the window end and preserves its start", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await dragTo(page, page.getByTestId("stop-stop-window-30"), { run: "run-2", lane: "delivery", time: "23:15" }, 4);
  const feedback = await resizeToEnd(page, "stop-window-30", "23:59", "run-2", "delivery");
  expect(feedback).toBe("23:15 → 23:45 · 30 min");
  await expect(page.getByRole("button", { name: /Move Thirty minute window, Van South, Delivery, 23:15 to 23:45 window end/ })).toBeVisible();
});

test("resize shows its own Saving state while remaining available for a serialized follow-up edit", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("delayed");
  await resizeToEnd(page, "stop-riverside", "11:30");
  const card = page.getByRole("button", { name: /Move Riverside, Van North, Collection, 10:00 to 11:30 window end/ });
  await expect(card).toBeEnabled();
  await expect(card).toContainText("Saving…");
  await expect(page.getByTestId("resize-stop-riverside")).toBeEnabled();
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 1");
});

test("a different card can move while an explicit-window resize is still saving", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("delayed");
  await resizeToEnd(page, "stop-riverside", "11:30");
  await expect(page.getByTestId("stop-stop-riverside")).toBeEnabled();
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:15/ })).toBeEnabled();
  await expect(page.getByTestId("stop-stop-riverside")).toBeEnabled();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 2");
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 2");
});

test("timeline zoom and horizontal scroll remain usable during a pending save", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("delayed");
  await resizeToEnd(page, "stop-riverside", "11:30");
  const zoom = page.getByLabel("Timeline zoom");
  await zoom.fill("1.25");
  await expect(zoom).toHaveValue("1.25");
  const viewport = page.getByTestId("mounted-timeline-viewport");
  await viewport.evaluate((element) => { (element as HTMLElement).scrollLeft += 120; });
  expect(await viewport.evaluate((element) => (element as HTMLElement).scrollLeft)).toBeGreaterThan(0);
  await expect(page.getByTestId("stop-stop-riverside")).toBeEnabled();
});

test("successful POST shows Saved syncing without a global refresh banner; same card remains editable", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await page.getByLabel("Refresh mode").selectOption("delayed");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  const settled = page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:15/ });
  await expect(settled).toBeEnabled();
  await expect(settled).toContainText("Saved · syncing…");
  await expect(page.getByTestId("fixture-refresh-status")).toHaveText("Authoritative refresh pending.");
  await expect(page.getByTestId("fixture-versions")).toContainText("Cached stop/run versions 1/1 · saved stop/run versions 2/2");
  await expect(page.getByTestId("fixture-global-refresh")).toHaveText("Idle");
  await dragTo(page, settled, { run: "run-1", lane: "delivery", time: "09:45" }, 68);
  const second = page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:45/ });
  await expect(second).toBeEnabled();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 2");
  await expect(page.getByTestId("fixture-command-tokens")).toHaveText("stop 1 · run 1 → stop 2 · run 2");
  await expect(page.getByTestId("stop-stop-haleon")).toBeEnabled();
  await dragTo(page, page.getByTestId("stop-stop-haleon"), { run: "run-2", lane: "delivery", time: "08:30" }, 68);
  await expect(page.getByRole("button", { name: /Move Haleon, Van South, Delivery, 08:30/ })).toBeEnabled();
  await expect(second).toBeEnabled();
  await page.getByLabel("Timeline zoom").fill("1.25");
  const viewport = page.getByTestId("mounted-timeline-viewport");
  await viewport.evaluate((element) => { (element as HTMLElement).scrollLeft += 120; });
  expect(await viewport.evaluate((element) => (element as HTMLElement).scrollLeft)).toBeGreaterThan(0);
  await expect(second).toBeEnabled({ timeout: 5000 });
  await expect(page.getByTestId("fixture-versions")).toContainText("Cached stop/run versions 4/4 · saved stop/run versions 4/4");
});

test("failed refresh preserves saved placement and stays per-stop; manual refresh settles authority", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("success");
  await page.getByLabel("Refresh mode").selectOption("failed");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-1", lane: "delivery", time: "09:15" }, 68);
  const settled = page.getByRole("button", { name: /Move MNK, Van North, Delivery, 09:15/ });
  await expect(settled).toBeEnabled();
  await expect(settled).toContainText("Saved; waiting for refresh");
  await expect(page.getByTestId("fixture-refresh-status")).toHaveText("Authoritative refresh failed; saved placement remains visible.");
  await expect(page.getByTestId("fixture-message")).toContainText("Refresh failed; saved placement retained.");
  await expect(page.getByTestId("stop-stop-haleon")).toBeEnabled();
  await page.getByRole("button", { name: "Refresh authority" }).click();
  await expect(settled).toBeEnabled();
  await expect(page.getByTestId("fixture-versions")).toContainText("Cached stop/run versions 2/2 · saved stop/run versions 2/2");
});

test("same-stop edits coalesce while one save is in flight and chain with returned versions", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("delayed");
  await page.getByLabel("Refresh mode").selectOption("delayed");
  await page.getByLabel("Command latency milliseconds").fill("6000");
  const stop = page.getByTestId("stop-stop-mnk");
  await dragTo(page, stop, { run: "run-1", lane: "delivery", time: "10:00" }, 68);
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 1");
  await dragTo(page, stop, { run: "run-1", lane: "delivery", time: "10:30" }, 68);
  await dragTo(page, stop, { run: "run-1", lane: "delivery", time: "10:45" }, 68);
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 10:45/ })).toBeEnabled();
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 1");
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 1");
  await expect(page.getByTestId("fixture-message")).toContainText("Commands: 2", { timeout: 10000 });
  await expect(page.getByTestId("fixture-command-tokens")).toHaveText("stop 1 · run 1 → stop 2 · run 2");
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 1");
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 10:45/ })).toContainText("Saving…");
  await expect(page.getByTestId("fixture-in-flight")).toHaveText("Requests in flight for this stop: 0", { timeout: 10000 });
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 10:45/ })).toContainText("Saved · syncing…");
});

test("409 conflict enters scoped checking state and manual refresh restores retryable canonical placement", async ({ page }) => {
  await page.getByLabel("Command mode").selectOption("conflict");
  await dragTo(page, page.getByTestId("stop-stop-mnk"), { run: "run-2", lane: "delivery", time: "09:45" }, 68);
  const stop = page.getByTestId("stop-stop-mnk");
  await expect(stop).toBeDisabled();
  await expect(stop).toContainText("Checking save…");
  await expect(page.getByTestId("fixture-message")).toContainText("409 version conflict");
  await expect(page.getByTestId("stop-stop-haleon")).toBeEnabled();
  await expect(page.getByTestId("fixture-global-refresh")).toHaveText("Idle");
  await page.getByRole("button", { name: "Refresh authority" }).click();
  await expect(page.getByRole("button", { name: /Move MNK, Van North, Delivery, 07:30/ })).toBeEnabled();
  await expect(page.getByTestId("fixture-versions")).toContainText("Cached stop/run versions 1/1 · saved stop/run versions 1/1");
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

test("six dense cards grow their lane instead of overlapping the following lane", async ({ page }) => {
  const lane = page.locator('[data-lane="run-3:delivery"]');
  const next = page.locator('[data-lane="run-3:collection"]');
  const laneBox = await lane.boundingBox();
  const nextBox = await next.boundingBox();
  const sixth = await page.getByTestId("stop-stop-overlap-6").boundingBox();
  if (!laneBox || !nextBox || !sixth) throw new Error("Dense subrow geometry unavailable");
  expect(laneBox.height).toBeGreaterThanOrEqual(390);
  expect(sixth.y + sixth.height).toBeLessThanOrEqual(nextBox.y);
  expect(nextBox.y).toBeGreaterThanOrEqual(laneBox.y + laneBox.height);
});
