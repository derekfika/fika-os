import { expect, test } from "@playwright/test";

test("Week Planner Enter creates an unknown dish and selects exact dishes without duplicates", async ({ page }) => {
  const day = { id: "fixture-day:1", date: "2099-01-05", dayName: "Monday", entryIds: [] as string[] };
  const week = { id: "rolling-week:2099-01-05", weekCommencing: day.date, weekEnding: "2099-01-11", status: "draft", version: 1, dayIds: [day.id], entryIds: [] as string[], templateSlots: ["SALAD 1", "SALAD 2", "SOUP"], sourceFiles: [], audit: [] };
  const catalogue = [
    { id: "dish:soup", canonicalId: "dish:soup", displayName: "Tomato soup", name: "Tomato soup", category: "Soup", status: "approved", usage: [], tagIds: [], item: { tagIds: [] } },
    { id: "dish:salad", canonicalId: "dish:salad", displayName: "Carrot salad", name: "Carrot salad", category: "Salad", status: "approved", usage: [], tagIds: [], item: { subcategory: "Slaw", tagIds: [] } },
  ];
  const entries: Array<Record<string, unknown>> = [];
  const writes: Array<{ path: string; body: Record<string, unknown> }> = [];
  let createdDishCount = 0;

  const responseSnapshot = () => ({ snapshot: { week, days: [day], entries: [...entries] }, weeks: [{ ...week }], publicationState: {} });
  await page.route(/^https:\/\//, route => route.abort());
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      const body = request.postDataJSON() as Record<string, unknown>;
      writes.push({ path: url.pathname, body });
      if (url.pathname === "/api/catalogue" && body.action === "create-dish") {
        const name = String(body.displayName);
        const exact = catalogue.find(item => item.displayName.toLocaleLowerCase("en-GB") === name.toLocaleLowerCase("en-GB"));
        const item = exact || { id: `dish:new:${++createdDishCount}`, canonicalId: `dish:new:${createdDishCount}`, displayName: name, name, category: String(body.category), status: "approved", usage: [], tagIds: [], item: { tagIds: [] } };
        if (!exact) catalogue.push(item);
        return route.fulfill({ json: { outcome: exact ? "matched_active" : "created_new", item } });
      }
      if (url.pathname === "/api/rolling-menu" && body.action === "create-entry") {
        const entry = { id: `${week.id}:entry:${day.id}:${String(body.slot).toLowerCase().replace(/[^a-z0-9]+/g, "-")}:fixture`, dayId: day.id, date: day.date, slot: body.slot, itemId: body.itemId, itemLabel: body.itemLabel, portions: 0, allocations: [], allergens: {}, audit: [] };
        entries.push(entry);
        day.entryIds = [...day.entryIds, String(entry.id)];
        week.entryIds = [...week.entryIds, String(entry.id)];
        week.version += 1;
        return route.fulfill({ json: responseSnapshot() });
      }
      return route.fulfill({ status: 400, json: { error: { message: "Unexpected fixture write." } } });
    }
    if (url.pathname === "/api/rolling-menu") {
      if (url.searchParams.has("summariesOnly")) return route.fulfill({ json: { week: { id: week.id, version: week.version }, weeks: [{ ...week }] } });
      return route.fulfill({ headers: { "x-fika-menu-identity": "dish-create-fixture" }, json: { ...responseSnapshot(), identity: "dish-create-fixture" } });
    }
    if (url.pathname === "/api/catalogue") {
      return route.fulfill({ headers: { "x-fika-menu-identity": "dish-create-fixture" }, json: url.searchParams.has("manifest") ? { schemaVersion: 1, catalogueVersion: catalogue.length, dishCount: catalogue.length } : { entries: catalogue, categories: ["Salad", "Soup"], identity: "dish-create-fixture", manifest: { schemaVersion: 1, catalogueVersion: catalogue.length, dishCount: catalogue.length } } });
    }
    if (url.pathname === "/api/dish-tags") return route.fulfill({ json: { schemaVersion: 1, version: 1, total: 0, tags: [] } });
    return route.fulfill({ json: {} });
  });

  await page.goto("/?week=2099-01-05", { waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Select dish for Monday, Leaf Salad" }).click();
  const saladSearch = page.getByRole("textbox", { name: /Search .* dishes/ });
  await saladSearch.fill("Harissa carrots");
  await saladSearch.press("Enter");
  const createDialog = page.getByRole("dialog", { name: "Create dish" });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByLabel("Dish name")).toHaveValue("Harissa carrots");
  await createDialog.getByRole("button", { name: "Create and add to planner" }).click();
  await expect(page.getByRole("button", { name: /Select Harissa carrots;/ })).toBeVisible();
  expect(writes.filter(write => write.path === "/api/catalogue")).toHaveLength(1);
  expect(writes.find(write => write.path === "/api/rolling-menu")?.body).toMatchObject({ action: "create-entry", itemId: "dish:new:1", itemLabel: "Harissa carrots", slot: "SALAD 1" });

  await page.getByRole("button", { name: "Select dish for Monday, Soup" }).click();
  const soupSearch = page.getByRole("textbox", { name: /Search .* dishes/ });
  await soupSearch.fill("Tomato soup");
  await soupSearch.press("Enter");
  await expect(page.getByRole("dialog", { name: "Create dish" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Select Tomato soup;/ })).toBeVisible();
  expect(writes.filter(write => write.path === "/api/catalogue")).toHaveLength(1);
  expect(writes.at(-1)?.body).toMatchObject({ action: "create-entry", itemId: "dish:soup", itemLabel: "Tomato soup", slot: "SOUP" });

  await page.getByRole("button", { name: "Select dish for Monday, Slaw" }).click();
  const saladTwoSearch = page.getByRole("textbox", { name: /Search .* dishes/ });
  await saladTwoSearch.fill("Carrot salad");
  await page.getByRole("button", { name: /Carrot salad/ }).click();
  await expect(page.getByRole("button", { name: /Select Carrot salad;/ })).toBeVisible();
  expect(writes.at(-1)?.body).toMatchObject({ action: "create-entry", itemId: "dish:salad", itemLabel: "Carrot salad", slot: "SALAD 2" });
});
