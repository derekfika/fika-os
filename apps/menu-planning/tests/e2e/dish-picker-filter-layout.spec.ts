import { expect, test } from "@playwright/test";

/** Read-only browser fixture: all API traffic is answered locally. */
test("filter toggle keeps the dish picker centered and usable at common desktop widths", async ({ page }, info) => {
  const writes: string[] = [];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((dayName, i) => ({ id: `fixture-day:${i}`, date: `2099-01-${String(5 + i).padStart(2, "0")}`, dayName, entryIds: [] as string[] }));
  const snapshot = { week: { id: "fixture-week:2099-01-05", weekCommencing: days[0].date, weekEnding: "2099-01-11", status: "draft", version: 1, dayIds: days.map(day => day.id), entryIds: [], sourceFiles: [], templateSlots: ["SALAD 1", "SALAD 2", "SOUP"], audit: [] }, days, entries: [] };
  const tags = Array.from({ length: 20 }, (_, index) => ({ id: `dish-tag:style:fixture-${index}`, label: `Fixture tag ${String(index).padStart(2, "0")} with a longer descriptive label`, group: "style", synonyms: [], createdAt: "2099-01-01T00:00:00.000Z", createdBy: "fixture" }));
  await page.route(/^https:\/\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      writes.push(`${request.method()} ${url.pathname}`);
      return route.fulfill({ status: 409, json: { error: { message: "Unexpected fixture write" } } });
    }
    if (url.pathname === "/api/rolling-menu") return route.fulfill({ json: { weeks: [snapshot.week], snapshot, publicationState: {} } });
    if (url.pathname === "/api/catalogue") return route.fulfill({ json: { entries: [
      { id: "fixture-dish:one", displayName: "Fixture salad", category: "Salad", tagIds: tags.map(tag => tag.id), item: { subcategory: "Leaf", tagIds: tags.map(tag => tag.id) } },
    ], categories: ["Salad"] } });
    if (url.pathname === "/api/dish-tags") return route.fulfill({ json: { schemaVersion: 1, version: 1, total: tags.length, tags } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/?week=2099-01-05", { waitUntil: "domcontentloaded" });
  const openCell = page.getByRole("button", { name: /Select dish for Monday/ }).first();
  await expect(openCell).toBeVisible();
  const dialog = page.getByRole("dialog", { name: "Select dish" });
  const measurements: Array<{ width: number; closed: { x: number; width: number }; open: { x: number; width: number; y: number; height: number } }> = [];

  for (const width of [820, 1024, 1280, 1536]) {
    await page.setViewportSize({ width, height: 760 });
    if (await dialog.count() === 0) await openCell.click();
    await expect(dialog).toBeVisible();
    const closed = await dialog.boundingBox();
    expect(closed).not.toBeNull();
    await page.screenshot({ path: info.outputPath(`dish-picker-closed-${width}.png`) });
    const toggle = dialog.getByRole("button", { name: /Filters/ });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const open = await dialog.boundingBox();
    expect(open).not.toBeNull();
    measurements.push({ width, closed: { x: closed!.x, width: closed!.width }, open: { x: open!.x, width: open!.width, y: open!.y, height: open!.height } });
    expect(Math.abs(open!.x - closed!.x), `horizontal shift at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(open!.width - closed!.width), `width change at ${width}px`).toBeLessThanOrEqual(1);
    expect(open!.x).toBeGreaterThanOrEqual(0);
    expect(open!.x + open!.width).toBeLessThanOrEqual(width);
    expect(open!.y).toBeGreaterThanOrEqual(0);
    expect(open!.y + open!.height).toBeLessThanOrEqual(760);
    const firstCheck = dialog.getByRole("checkbox").first();
    await expect(firstCheck).toBeVisible();
    expect(await dialog.getByRole("checkbox").count()).toBeGreaterThan(10);
    const filterPanel = dialog.locator(".picker-filters__panel");
    const panelMetrics = await filterPanel.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(panelMetrics.scrollHeight).toBe(panelMetrics.clientHeight);
    const picker = dialog.locator(".dish-picker");
    const pickerMetrics = await picker.evaluate(element => ({ scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }));
    expect(pickerMetrics.scrollHeight).toBeGreaterThan(pickerMetrics.clientHeight);
    await firstCheck.focus();
    await expect(firstCheck).toBeFocused();
    await page.screenshot({ path: info.outputPath(`dish-picker-filters-open-${width}.png`) });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const closedAgain = await dialog.boundingBox();
    expect(Math.abs(closedAgain!.x - closed!.x), `position after closing filters at ${width}px`).toBeLessThanOrEqual(1);
    expect(Math.abs(closedAgain!.width - closed!.width), `width after closing filters at ${width}px`).toBeLessThanOrEqual(1);
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  }
  await page.screenshot({ path: info.outputPath("dish-picker-filter-layout.png"), fullPage: false });
  expect(writes).toEqual([]);
  console.log(`Dish picker filter geometry: ${JSON.stringify(measurements)}`);
});
