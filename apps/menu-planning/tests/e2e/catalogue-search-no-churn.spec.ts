import { expect, test } from "@playwright/test";

const catalogue = Array.from({ length: 500 }, (_, index) => {
  const name = index < 80 ? `Chicken Salad ${index}` : `Garden Salad ${index}`;
  return {
    id: `fixture-canonical:${index}`,
    name,
    displayName: name,
    category: index % 2 === 0 ? "Salad" : "Soup",
    status: "approved",
    usage: ["hospitality"],
    description: `Synthetic fixture dish ${index}`,
    sourceLabel: "Local E2E fixture",
    recipeAvailable: false,
    allergenCount: 0,
  };
});

test("Dish Library filters a loaded 500-item catalogue locally without loader or request churn", async ({ page }) => {
  const apiGets: Array<{ path: string; search: string }> = [];
  const nonGetRequests: Array<{ method: string; path: string }> = [];
  const externalRequests: string[] = [];
  const pageErrors: string[] = [];
  page.on("pageerror", error => pageErrors.push(error.message));

  await page.addInitScript(() => {
    const state = window as typeof window & { __catalogueSearchPhase?: boolean; __catalogueLoadingDuringSearch?: number; __menuCacheOpens?: number };
    state.__catalogueLoadingDuringSearch = 0;
    state.__menuCacheOpens = 0;
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (...args: Parameters<typeof open>) {
      if (args[0] === "fika-menu-planning") state.__menuCacheOpens = (state.__menuCacheOpens || 0) + 1;
      return open.apply(this, args);
    };
    new MutationObserver(() => {
      if (state.__catalogueSearchPhase && document.body.innerText.includes("Loading the dish library…")) {
        state.__catalogueLoadingDuringSearch = (state.__catalogueLoadingDuringSearch || 0) + 1;
      }
    }).observe(document, { childList: true, characterData: true, subtree: true });
  });

  await page.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      externalRequests.push(url.origin);
      return route.abort();
    }

    if (request.method() !== "GET") {
      nonGetRequests.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ status: 409, json: { error: { message: "E2E fixture rejects all writes." } } });
    }

    if (url.pathname.startsWith("/api/")) {
      apiGets.push({ path: url.pathname, search: url.search });
      if (url.pathname === "/api/catalogue") {
        if (url.searchParams.has("manifest")) {
          return route.fulfill({
            headers: { "x-fika-menu-identity": "local-catalogue-search-fixture" },
            json: { schemaVersion: 1, catalogueVersion: 1, dishCount: catalogue.length },
          });
        }
        return route.fulfill({
          headers: { "x-fika-menu-identity": "local-catalogue-search-fixture" },
          json: { entries: catalogue, categories: ["Salad", "Soup"], identity: "local-catalogue-search-fixture", manifest: { schemaVersion: 1, catalogueVersion: 1, dishCount: catalogue.length } },
        });
      }
      return route.fulfill({ status: 404, json: { error: { message: "No fixture route for this API." } } });
    }

    return route.continue();
  });

  await page.goto("/catalogue", { waitUntil: "domcontentloaded" });
  const search = page.getByRole("textbox", { name: "Search dishes" });
  await expect(search).toBeVisible();
  await expect(page.locator(".catalogue-stats strong")).toHaveText("500");
  await expect(page.locator(".catalogue-card")).toHaveCount(500);

  const initialCatalogueGets = apiGets.filter(request => request.path === "/api/catalogue").length;
  const initialCacheOpens = await page.evaluate(() => (window as typeof window & { __menuCacheOpens?: number }).__menuCacheOpens || 0);
  expect(initialCatalogueGets).toBe(1);
  expect(initialCacheOpens).toBeGreaterThan(0);
  await page.evaluate(() => { (window as typeof window & { __catalogueSearchPhase?: boolean }).__catalogueSearchPhase = true; });

  await search.pressSequentially("Chicken", { delay: 20 });
  await expect(page.locator(".catalogue-stats strong")).toHaveText("80");
  await expect(page.locator(".catalogue-stats span")).toHaveText("of 500 canonical items shown");
  await expect(page.locator(".catalogue-card")).toHaveCount(80);
  await expect(page.getByRole("heading", { name: "Chicken Salad 0" })).toBeVisible();

  await search.fill("Garden Salad 499");
  await expect(page.locator(".catalogue-stats strong")).toHaveText("1");
  await expect(page.locator(".catalogue-card")).toHaveCount(1);
  await expect(page.getByRole("heading", { name: "Garden Salad 499" })).toBeVisible();

  const finalCacheOpens = await page.evaluate(() => (window as typeof window & { __menuCacheOpens?: number }).__menuCacheOpens || 0);
  const loadingDuringSearch = await page.evaluate(() => (window as typeof window & { __catalogueLoadingDuringSearch?: number }).__catalogueLoadingDuringSearch || 0);
  expect(apiGets.filter(request => request.path === "/api/catalogue")).toHaveLength(initialCatalogueGets);
  expect(apiGets.filter(request => request.path === "/api/catalogue" && request.search.includes("manifest"))).toHaveLength(0);
  expect(finalCacheOpens).toBe(initialCacheOpens);
  expect(loadingDuringSearch).toBe(0);
  expect(nonGetRequests).toEqual([]);
  expect(externalRequests.every(origin => origin === "https://bloom-coffee.org")).toBe(true);
  expect(pageErrors).toEqual([]);
});
