import { expect, test } from "@playwright/test";
import type { RollingSnapshot } from "../../lib/rolling-menu-types";
import { fixtureMenuAccess, fixtureMenuScopeHeaders } from "./menu-access-fixture";

test("switches between main and independent breakfast menus and reloads the selected occurrence", async ({ page }) => {
  const date = "2026-11-23";
  const fixtureWeek = (id: string): RollingSnapshot => {
    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((dayName, i) => ({
      id: `${id}:day:${i + 1}`, date: `2026-11-${23 + i}`, dayName, entryIds: [],
    }));
    return { week: { id, weekCommencing: date, weekEnding: "2026-11-29", version: 1, status: "draft", dayIds: days.map(day => day.id), entryIds: [], templateSlots: ["SOUP"], sourceFiles: [], audit: [] }, days, entries: [] };
  };
  const main = fixtureWeek(`rolling-week:${date}`);
  const breakfast = (id: string, name: string, weekday: number) => {
    const snapshot = fixtureWeek(`${main.week.id}:menu:${id}`);
    snapshot.week.supplementaryMenu = { id, name, serviceType: "Breakfast", siteIds: [id], recurrenceWeekdays: [weekday] };
    return snapshot;
  };
  const munich = breakfast("munich-re", "Munich RE", 1);
  const extra = breakfast("extra-menu", "Another breakfast", 1);
  const wise = breakfast("wise-menu", "Wise", 5);
  const snapshots = [wise, main, munich, extra];
  const summaries = snapshots.map(value => value.week);
  const headers = fixtureMenuScopeHeaders("menu-selection-fixture");
  await page.route(/^https:\/\//, route => route.abort());
  await page.route("**/api/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/access") return route.fulfill({ json: fixtureMenuAccess("menu-selection-fixture") });
    if (url.pathname === "/api/rolling-menu") {
      if (route.request().method() === "POST") {
        expect(route.request().postDataJSON().action).toBe("ensure-recurring-menus");
        return route.fulfill({ headers, json: { weeks: summaries, weekIds: [] } });
      }
      const id = url.searchParams.get("weekId");
      const snapshot = snapshots.find(value => value.week.id === id) || main;
      if (url.searchParams.has("summariesOnly")) return route.fulfill({ headers, json: { week: snapshot.week, menuWeeks: summaries } });
      return route.fulfill({ headers, json: { snapshot, weeks: url.searchParams.has("snapshotOnly") ? [] : summaries, publicationState: {} } });
    }
    if (url.pathname === "/api/catalogue") return route.fulfill({ headers, json: { entries: [], categories: [], manifest: { schemaVersion: 1, catalogueVersion: 1, dishCount: 0 } } });
    return route.fulfill({ json: {} });
  });
  await page.goto(`/?week=${encodeURIComponent(munich.week.id)}`);
  const monday = page.getByRole("combobox", { name: "Menu for Monday" });
  await expect(monday).toHaveValue(munich.week.id);
  await expect(monday.locator("option")).toHaveText(["Main menu", "Munich RE · Breakfast", "Another breakfast · Breakfast"]);
  await monday.selectOption(main.week.id);
  await expect(monday).toHaveValue(main.week.id);
  const friday = page.getByRole("combobox", { name: "Menu for Friday" });
  await friday.selectOption(wise.week.id);
  await expect(friday).toHaveValue(wise.week.id);
  await page.reload();
  await expect(friday).toHaveValue(wise.week.id);
  await monday.selectOption(extra.week.id);
  await expect(monday).toHaveValue(extra.week.id);
  await expect(friday).toHaveValue("");
});
