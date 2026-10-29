import { expect, test, type Page } from "@playwright/test";
import type { RollingSnapshot, RollingEntry } from "../../lib/rolling-menu-types";

const weekId = "fixture-week:2099-01-05";
function menuFixture(): RollingSnapshot {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((dayName, i) => ({ id: `fixture-day:${i}`, date: `2099-01-${String(5 + i).padStart(2, "0")}`, dayName, entryIds: [] as string[] }));
  const entries: RollingEntry[] = [
    { id: "fixture-entry:salad", dayId: days[0].id, date: days[0].date, slot: "SALAD 1", itemId: "fixture-dish:salad", itemLabel: "Recieve salad", portions: 12, allocations: [{ destinationId: "fixture-site:a", destinationLabel: "Fixture Site", quantity: 12 }], allergens: { gluten: "contains", sesame: "may_contain" }, audit: [] },
    { id: "fixture-entry:soup", dayId: days[0].id, date: days[0].date, slot: "SOUP", itemId: "fixture-dish:soup", itemLabel: "Tomatos soup", portions: 8, allocations: [{ destinationId: "fixture-site:a", destinationLabel: "Fixture Site", quantity: 8 }], allergens: { milk: "contains", egg: "unrecorded" }, audit: [] },
  ];
  days[0].entryIds = entries.map(entry => entry.id);
  return { week: { id: weekId, weekCommencing: days[0].date, weekEnding: "2099-01-11", status: "published", version: 7, dayIds: days.map(day => day.id), entryIds: entries.map(entry => entry.id), sourceFiles: [], templateSlots: ["SALAD 1", "SALAD 2", "SOUP"], audit: [] }, days, entries };
}

async function mount(page: Page, options: { corruptDictionary?: () => boolean; blockedStorage?: boolean } = {}) {
  let snapshot = menuFixture();
  const original = structuredClone(snapshot);
  const published = structuredClone(snapshot);
  const writes: Record<string, unknown>[] = [];
  const errors: string[] = [];
  let dictionaries = 0;
  page.on("pageerror", error => errors.push(error.message));
  // Isolated fixture: no external fonts/services; the app and dictionary use localhost.
  await page.route(/^https:\/\//, route => route.abort());
  if (options.blockedStorage) await page.addInitScript(() => {
    Object.defineProperty(window, "localStorage", { value: { getItem() { throw Error("fixture blocked storage"); }, setItem() { throw Error("fixture blocked storage"); } } });
  });
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.pathname === "/api/spellcheck/dictionary") {
      dictionaries++;
      if (options.corruptDictionary?.()) return route.fulfill({ status: 200, contentType: "application/octet-stream", body: Buffer.from([1, 2, 3]) });
      return route.continue(); // Real local route, committed gzip and real browser verification.
    }
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push(body);
      if (url.pathname !== "/api/rolling-menu" || body.action !== "create-entry") return route.fulfill({ status: 409, json: { error: { message: "Unexpected fixture mutation" } } });
      const day = snapshot.days.find(day => day.id === body.dayId)!;
      const entry: RollingEntry = { id: `fixture-entry:copy-${writes.length}`, dayId: day.id, date: day.date, slot: body.slot, itemId: body.itemId, itemLabel: body.itemLabel, portions: 0, allocations: [], allergens: {}, audit: [] };
      snapshot = { ...snapshot, week: { ...snapshot.week, version: snapshot.week.version + 1, entryIds: [...snapshot.week.entryIds, entry.id] }, entries: [...snapshot.entries, entry] };
      return route.fulfill({ json: { snapshot, weeks: [snapshot.week] } });
    }
    if (url.pathname === "/api/catalogue") return route.fulfill({ json: { entries: original.entries.map(entry => ({ id: entry.itemId, displayName: entry.itemLabel, category: entry.slot === "SOUP" ? "Soup" : "Salads" })), categories: ["Salads", "Soup"] } });
    if (url.pathname === "/api/rolling-menu") return route.fulfill({ json: { snapshot, weeks: [snapshot.week], publicationState: {} } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?week=2099-01-05", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("button", { name: /Check spelling/ })).toBeVisible();
  return { original, published, writes, errors, snapshot: () => snapshot, dictionaries: () => dictionaries };
}

const open = async (page: Page) => {
  await page.getByRole("button", { name: /Check spelling/ }).click();
  return page.getByRole("dialog", { name: "Spelling suggestions", exact: true });
};
const salad = (page: Page) => page.getByRole("button", { name: "Select Recieve salad; drag or use Copy to day", exact: true }).first();

test("loads the full UK dictionary once and keeps modal focus, Escape and canonical published evidence intact", async ({ page }, info) => {
  const fixture = await mount(page);
  await expect(salad(page).locator(".spell-flag")).toHaveText("Recieve");
  const dialog = await open(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog.getByRole("button", { name: "Close spelling suggestions" })).toBeFocused();
  await expect(dialog.getByText("Receive", { exact: true })).toBeVisible();
  await expect(dialog.getByText("Tomatoes", { exact: true })).toBeVisible();
  const last = dialog.getByRole("button", { name: /Add Tomatos/ });
  await last.focus(); await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close spelling suggestions" })).toBeFocused();
  await page.screenshot({ path: info.outputPath("spellcheck-desktop.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Check spelling/ })).toBeFocused();
  expect(fixture.dictionaries()).toBe(1);
  expect(fixture.writes).toEqual([]);
  expect(fixture.snapshot()).toEqual(fixture.original);
  expect(fixture.published).toEqual(fixture.original);
  expect(fixture.errors).toEqual([]);
});

test("Ignore and Add persist in this browser without renaming dishes, changing portions/allergens or making writes", async ({ page }) => {
  const fixture = await mount(page);
  await expect(salad(page).locator(".spell-flag")).toHaveText("Recieve");
  const dialog = await open(page);
  await dialog.getByRole("button", { name: /Ignore Recieve/ }).click();
  await expect(dialog.getByRole("button", { name: "Close spelling suggestions" })).toBeFocused();
  await dialog.getByRole("button", { name: /Add Tomatos/ }).click();
  await expect(dialog).toContainText("No spelling suggestions for this week.");
  await page.keyboard.press("Escape");
  await page.reload({ waitUntil: "domcontentloaded" });
  await expect(salad(page)).toBeVisible();
  const reopened = await open(page);
  await expect(reopened).toContainText("No spelling suggestions for this week.");
  expect(fixture.writes).toEqual([]);
  expect(fixture.snapshot()).toEqual(fixture.original);
  expect(fixture.published).toEqual(fixture.original);
});

test("corrupt downloads show limited checks explicitly; retry restores full spelling without any mutation", async ({ page }) => {
  let corrupt = true;
  const fixture = await mount(page, { corruptDictionary: () => corrupt });
  const dialog = await open(page);
  await expect(dialog.getByRole("alert")).toContainText("Only common corrections are checked");
  await expect(salad(page).locator(".spell-flag")).toHaveCount(0);
  corrupt = false;
  await dialog.getByRole("button", { name: "Retry dictionary" }).click();
  await expect(dialog.getByText("Receive", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  expect(fixture.dictionaries()).toBe(2);
  expect(fixture.writes).toEqual([]);
});

test("blocked browser storage still permits advisory Ignore for this view", async ({ page }) => {
  const fixture = await mount(page, { blockedStorage: true });
  await expect(salad(page).locator(".spell-flag")).toHaveText("Recieve");
  const dialog = await open(page);
  await dialog.getByRole("button", { name: /Ignore Recieve/ }).click();
  await expect(dialog.getByRole("button", { name: /Ignore Recieve/ })).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("the accessible copy control still sends one canonical copy and leaves source quantities, allergens and publication untouched", async ({ page }) => {
  const fixture = await mount(page);
  const copy = page.getByRole("button", { name: "Copy Recieve salad to another day", exact: true });
  await expect(copy).toBeEnabled();
  await copy.focus(); await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Copy dish to day", exact: true });
  await dialog.getByLabel("Target day and menu category").selectOption({ index: 1 });
  await dialog.getByRole("button", { name: "Copy dish", exact: true }).press("Enter");
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({ action: "create-entry", itemId: "fixture-dish:salad", itemLabel: "Recieve salad", dayId: "fixture-day:1", slot: "SALAD 1", expectedWeekVersion: 7 });
  expect(fixture.snapshot().entries[0]).toEqual(fixture.original.entries[0]);
  expect(fixture.snapshot().entries.at(-1)).toMatchObject({ portions: 0, allocations: [], allergens: {} });
  expect(fixture.published).toEqual(fixture.original);
});

test("native dish drag/drop still targets an empty compatible cell using its canonical ID", async ({ page }) => {
  const fixture = await mount(page);
  const target = page.getByRole("button", { name: "Select dish for Tuesday, Salad", exact: true }).first();
  await salad(page).dragTo(target);
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({ action: "create-entry", itemId: "fixture-dish:salad", dayId: "fixture-day:1", slot: "SALAD 1" });
  expect(fixture.snapshot().entries[0]).toEqual(fixture.original.entries[0]);
  expect(fixture.published).toEqual(fixture.original);
});

test("spelling suggestions fit a narrow viewport and retain a visible close path", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mount(page);
  await expect(salad(page).locator(".spell-flag")).toHaveText("Recieve");
  const dialog = await open(page);
  const bounds = (await dialog.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(15);
  expect(bounds.width).toBeLessThanOrEqual(360);
  expect(bounds.y).toBeGreaterThanOrEqual(15);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(829);
  await expect(dialog.getByRole("button", { name: "Close spelling suggestions" })).toBeVisible();
  await page.screenshot({ path: info.outputPath("spellcheck-narrow.png"), fullPage: true });
});
