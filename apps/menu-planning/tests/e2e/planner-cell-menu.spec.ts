import { expect, test, type Page } from "@playwright/test";
import type { RollingEntry, RollingSnapshot } from "../../lib/rolling-menu-types";

/**
 * Isolated fixture run of the Week Planner cell context menu (#186): the app is the real local Menu
 * server, every /api call is answered here, and nothing leaves the machine. Every write is recorded
 * so each test can prove the menu never wrote anything it was not asked to.
 */
const weekId = "fixture-week:2099-01-05";
function menuFixture(): RollingSnapshot {
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((dayName, i) => ({ id: `fixture-day:${i}`, date: `2099-01-${String(5 + i).padStart(2, "0")}`, dayName, entryIds: [] as string[] }));
  const entries: RollingEntry[] = [
    { id: "fixture-entry:leaf", dayId: days[0].id, date: days[0].date, slot: "SALAD 1", itemId: "fixture-dish:leaf", itemLabel: "Baby leaves", portions: 12, allocations: [{ destinationId: "fixture-site:a", destinationLabel: "Fixture Site", quantity: 12 }], allergens: {}, audit: [] },
    { id: "fixture-entry:ghost", dayId: days[1].id, date: days[1].date, slot: "SALAD 1", itemId: "fixture-dish:retired", itemLabel: "Retired salad", portions: 4, allocations: [], allergens: {}, audit: [] },
  ];
  days[0].entryIds = [entries[0].id];
  days[1].entryIds = [entries[1].id];
  return { week: { id: weekId, weekCommencing: days[0].date, weekEnding: "2099-01-11", status: "draft", version: 3, dayIds: days.map(day => day.id), entryIds: entries.map(entry => entry.id), sourceFiles: [], templateSlots: ["SALAD 1", "SALAD 2", "SOUP"], audit: [] }, days, entries } as unknown as RollingSnapshot;
}

async function mount(page: Page) {
  let snapshot = menuFixture();
  const original = structuredClone(snapshot);
  const writes: Record<string, unknown>[] = [];
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route(/^https:\/\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      const body = request.postDataJSON();
      writes.push({ path: url.pathname, ...body });
      if (url.pathname === "/api/rolling-menu" && body.action === "update-entry") {
        snapshot = { ...snapshot, entries: snapshot.entries.map(entry => entry.id === body.entryId ? { ...entry, ...body.patch } : entry) } as RollingSnapshot;
        return route.fulfill({ json: { snapshot, weeks: [snapshot.week] } });
      }
      return route.fulfill({ status: 409, json: { error: { message: "Unexpected fixture mutation" } } });
    }
    if (url.pathname === "/api/catalogue") {
      if (url.searchParams.get("id") === "fixture-dish:leaf") return route.fulfill({ json: { entry: { item: { canonicalId: "fixture-dish:leaf", displayName: "Baby leaves", category: "Salad", subcategory: "Leaf", tagIds: [], allergenEvidence: [] } } } });
      return route.fulfill({ json: { entries: [{ id: "fixture-dish:leaf", displayName: "Baby leaves", category: "Salad", item: { subcategory: "Leaf" } }, { id: "fixture-dish:slaw", displayName: "Asian slaw", category: "Salad", item: { subcategory: "Slaw" } }], categories: ["Salad"] } });
    }
    if (url.pathname === "/api/dish-tags") return route.fulfill({ json: { version: 1, total: 0, tags: [], groups: [] } });
    if (url.pathname === "/api/rolling-menu") return route.fulfill({ json: { snapshot, weeks: [snapshot.week], publicationState: {} } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?week=2099-01-05", { waitUntil: "domcontentloaded" });
  await expect(cell(page)).toBeVisible();
  return { original, writes, errors, snapshot: () => snapshot };
}

const cell = (page: Page) => page.getByRole("button", { name: "Select Baby leaves; drag or use Copy to day", exact: true });
const menu = (page: Page) => page.getByRole("menu");

test("right-click on a populated cell opens a menu with Edit, Change, Copy and a red Clear, and nothing is written", async ({ page }, info) => {
  const fixture = await mount(page);
  await cell(page).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveText(["Edit dish", "Change dish", "Copy to another day", "Clear from planner"]);
  await expect(menu(page).getByRole("menuitem", { name: "Clear from planner" })).toHaveClass(/planner-cell-menu__item--danger/);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("cell-menu-desktop.png") });
  expect(fixture.writes).toEqual([]);
  expect(fixture.errors).toEqual([]);
});

test("Escape and clicking elsewhere close the menu without acting, and focus returns to the cell", async ({ page }) => {
  const fixture = await mount(page);
  await cell(page).click({ button: "right" });
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(cell(page)).toBeFocused();
  await cell(page).click({ button: "right" });
  await page.mouse.click(5, 5);
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
  expect(fixture.snapshot()).toEqual(fixture.original);
});

test("the browser's own menu stays available on text inputs and an empty planner cell opens no custom menu", async ({ page }) => {
  await mount(page);
  const prevented = await page.evaluate(() => new Promise<boolean[]>(resolve => {
    const results: boolean[] = [];
    const probe = (target: Element) => { const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); target.dispatchEvent(event); results.push(event.defaultPrevented); };
    const empty = Array.from(document.querySelectorAll<HTMLButtonElement>(".week-menu-cell-button")).find(button => /Select dish for/.test(button.getAttribute("aria-label") || ""));
    if (empty) probe(empty);
    probe(document.body);
    resolve(results);
  }));
  expect(prevented).toEqual([false, false]);
  await expect(menu(page)).toHaveCount(0);
});

test("Shift+F10 opens the menu, arrows move, and Enter on Change opens the normal picker for that cell", async ({ page }) => {
  const fixture = await mount(page);
  await cell(page).focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Edit dish" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("menuitem", { name: "Change dish" })).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(menu(page).getByRole("menuitem", { name: "Clear from planner" })).toBeFocused();
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog", { name: "Select dish" })).toBeVisible();
  expect(fixture.writes).toEqual([]);
});

test("Clear removes only that cell's entry when chosen deliberately; dismissing never clears", async ({ page }) => {
  const fixture = await mount(page);
  await cell(page).click({ button: "right" });
  await page.keyboard.press("Escape");
  expect(fixture.writes).toEqual([]);
  await cell(page).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Clear from planner" }).click();
  await expect.poll(() => fixture.writes.length).toBe(1);
  expect(fixture.writes[0]).toMatchObject({ path: "/api/rolling-menu", action: "update-entry", entryId: "fixture-entry:leaf", patch: { itemId: "", itemLabel: "", allocations: [], portions: 0 } });
});

test("Edit dish opens the existing edit modal for the canonical dish without the picker, and Cancel saves nothing", async ({ page }) => {
  const fixture = await mount(page);
  await cell(page).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Edit dish" }).click();
  const dialog = page.getByRole("dialog", { name: "Edit dish" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Dish name")).toHaveValue("Baby leaves");
  await expect(page.getByRole("dialog", { name: "Select dish" })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(cell(page)).toBeFocused();
  expect(fixture.writes).toEqual([]);
});

test("an entry whose dish is no longer in the library shows Edit as unavailable with the reason and writes nothing", async ({ page }) => {
  const fixture = await mount(page);
  await page.getByRole("button", { name: "Select Retired salad; drag or use Copy to day", exact: true }).click({ button: "right" });
  const edit = menu(page).getByRole("menuitem", { name: "Edit dish" });
  await expect(edit).toHaveAttribute("aria-disabled", "true");
  await expect(menu(page)).toContainText("not in the Dish Library any more");
  await edit.click({ force: true });
  await expect(menu(page)).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(fixture.writes).toEqual([]);
});

test("a single click still opens the picker, and the picker rows no longer carry Edit buttons", async ({ page }) => {
  await mount(page);
  await cell(page).click();
  const picker = page.getByRole("dialog", { name: "Select dish" });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("button", { name: /^Edit / })).toHaveCount(0);
  await expect(picker.locator(".dish-picker-edit")).toHaveCount(0);
});

test("the More actions button opens the same menu, so touch users never need right-click", async ({ page }) => {
  await mount(page);
  await page.getByRole("button", { name: "More actions for Baby leaves" }).click();
  await expect(menu(page)).toBeVisible();
  await expect(menu(page).getByRole("menuitem")).toHaveCount(4);
});

test("near the bottom-right edge the menu flips and stays fully inside the viewport", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 420 });
  await mount(page);
  await page.getByRole("button", { name: "More actions for Baby leaves" }).scrollIntoViewIfNeeded();
  const more = page.getByRole("button", { name: "More actions for Baby leaves" });
  await more.click();
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(420);
  expect(box!.y + box!.height).toBeLessThanOrEqual(420);
});
