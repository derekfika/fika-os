import { expect, test, type Page } from "@playwright/test";
import { applyRollingEntryPatch } from "../../lib/rolling-command";
import { emptyWeek } from "../../lib/rolling-menu";
import type { RollingSnapshot } from "../../lib/rolling-menu-types";

async function fixture(page: Page) {
  const weeks = ["2098-11-03", "2098-11-10"].map(date => {
    const snapshot = emptyWeek(date, "isolated-browser");
    snapshot.entries = snapshot.days.slice(0, 2).map((day, index) => ({ id: `${day.id}:entry:synthetic`, dayId: day.id, date: day.date, slot: "SOUP", itemId: `dish:synthetic:${index}`, itemLabel: index ? "Synthetic sauce" : "Synthetic soup", portions: 7, allocations: [], allergens: {}, audit: [] }));
    snapshot.week.entryIds = snapshot.entries.map(entry => entry.id);
    snapshot.days.forEach(day => { day.entryIds = snapshot.entries.filter(entry => entry.dayId === day.id).map(entry => entry.id); });
    return snapshot;
  });
  const writes: Array<{ weekId: string; expectedWeekVersion: number; updates: Array<{ entryId: string; patch: Parameters<typeof applyRollingEntryPatch>[1] }> }> = [];
  await page.route(/^https:\/\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname !== "/api/rolling-menu") return route.fulfill({ json: {} });
    const weekId = url.searchParams.get("weekId");
    const snapshot = weeks.find(week => week.week.id === weekId || week.week.weekCommencing === weekId) || weeks[0];
    if (request.method() === "GET") return route.fulfill({ headers: { "x-fika-menu-identity": "isolated-browser-reviewer" }, json: url.searchParams.has("summariesOnly") ? { week: snapshot.week, weeks: weeks.map(week => week.week) } : { snapshot, weeks: weeks.map(week => week.week), publicationState: {} } });
    const body = request.postDataJSON();
    writes.push(body);
    const target = weeks.find(week => week.week.id === body.weekId)!;
    if (body.expectedWeekVersion !== target.week.version) return route.fulfill({ status: 409, json: { error: { message: "Another editor changed this week. Refresh before saving." } } });
    const next = structuredClone(target);
    for (const update of body.updates) applyRollingEntryPatch(next.entries.find(entry => entry.id === update.entryId)!, update.patch, { actor: "isolated-browser-reviewer", at: "2098-11-03T10:00:00Z" });
    next.week.version += 1;
    Object.assign(target, next);
    return route.fulfill({ json: { snapshot: target, weeks: weeks.map(week => week.week), publicationState: {} } });
  });
  await page.goto(`/allergens?week=${weeks[0].week.weekCommencing}&day=${weeks[0].days[0].date}`);
  await expect(page.getByRole("button", { name: /Synthetic soup, No key allergens:/ })).toBeVisible();
  return { weeks, writes };
}

test("manual No Key is exclusive, survives saved reload and never clears an untouched row", async ({ page }) => {
  const server = await fixture(page);
  const noKey = () => page.getByRole("button", { name: /Synthetic soup, No key allergens:/ });
  await expect(noKey()).toHaveAttribute("aria-label", /Not recorded$/);
  await noKey().click();
  await expect(noKey()).toHaveAttribute("aria-label", /Contains$/);
  await page.getByRole("button", { name: /Synthetic soup, Milk:/ }).click();
  await expect(noKey()).toHaveAttribute("aria-label", /Not recorded$/);
  await noKey().click();
  await expect(page.getByRole("button", { name: /Synthetic soup, Milk:/ })).toHaveAttribute("aria-label", /Not recorded$/);
  await page.getByRole("button", { name: "Mark reviewed", exact: true }).click();
  await page.getByRole("button", { name: "Save allergen changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save allergen changes", exact: true })).toBeDisabled();
  expect(server.writes).toHaveLength(1);
  expect(server.weeks[0].entries[0].noKeyDeclaration?.declaredBy).toBe("isolated-browser-reviewer");
  expect(server.weeks[0].entries[0].allergenReview?.semantics).toBe(3);
  expect(server.weeks[0].entries[1].allergens).toEqual({});
  await page.reload();
  await expect(noKey()).toHaveAttribute("aria-label", /Contains$/);
});

test("day and week navigation preserve separate drafts, and typing performs no remote mutation", async ({ page }) => {
  const server = await fixture(page);
  const input = page.getByRole("textbox", { name: "Specific allergen details for Synthetic soup", exact: true });
  await input.fill("Almond and wheat");
  expect(server.writes).toHaveLength(0);
  await page.getByRole("button", { name: /^TUE/ }).click();
  await page.getByRole("textbox", { name: "May contain notes for Synthetic sauce", exact: true }).fill("Shared sesame equipment");
  await page.getByRole("button", { name: "Next week", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "May contain notes for Synthetic sauce", exact: true })).toHaveValue("");
  await page.getByRole("textbox", { name: "May contain notes for Synthetic sauce", exact: true }).fill("Separate week note");
  await page.getByRole("button", { name: "Save allergen changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save allergen changes", exact: true })).toBeDisabled();
  expect(server.writes[0].updates.every(update => update.entryId.startsWith(server.weeks[1].week.id))).toBe(true);
  await page.getByRole("button", { name: "Previous week", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "May contain notes for Synthetic sauce", exact: true })).toHaveValue("Shared sesame equipment");
  await page.getByRole("button", { name: /^MON/ }).click();
  await expect(input).toHaveValue("Almond and wheat");
  await page.getByRole("button", { name: "Synthetic soup, Tree nuts: Not recorded", exact: true }).click();
  await page.getByRole("button", { name: "Save allergen changes", exact: true }).click();
  await expect(page.getByRole("button", { name: "Save allergen changes", exact: true })).toBeDisabled();
  expect(server.writes[1].updates).toHaveLength(2);
  expect(server.weeks[0].entries[0].allergenDetailNotes).toBe("Almond and wheat");
});

test("a competing version preserves the draft and does not silently retry", async ({ page }) => {
  const server = await fixture(page);
  await page.getByRole("button", { name: /Synthetic soup, No key allergens:/ }).click();
  server.weeks[0].week.version += 1;
  await page.getByRole("button", { name: "Save allergen changes", exact: true }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Another editor changed this week" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Synthetic soup, No key allergens:/ })).toHaveAttribute("aria-label", /Contains$/);
  expect(server.writes).toHaveLength(1);
  expect(server.weeks[0].entries[0].allergens).toEqual({});
});
