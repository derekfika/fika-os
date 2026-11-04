import { expect, test, type Page } from "@playwright/test";
import type { RollingSnapshot } from "../../lib/rolling-menu-types";

function backend() {
  const slots = ["GARNISH 1", "GARNISH 2", "SOUP", ...Array.from({ length: 22 }, (_, index) => `SAUCE ${index + 1}`)];
  const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"].map((dayName, index) => ({ id: `rolling-week:2099-01-05:day:${index + 1}`, date: `2099-01-${String(index + 5).padStart(2, "0")}`, dayName, entryIds: [] as string[] }));
  const week = { id: "rolling-week:2099-01-05", weekCommencing: "2099-01-05", weekEnding: "2099-01-11", version: 96, status: "draft" as const, dayIds: days.map(day => day.id), entryIds: [] as string[], templateSlots: slots, sourceFiles: [], audit: [] };
  let snapshot: RollingSnapshot = { week, days, entries: [] };
  const dishes: Array<{ id: string; displayName: string; category: string; item: { sourceAliases?: string[]; tagIds?: string[] } }> = [
    { id: "dish:almonds", displayName: "Toasted Almonds", category: "", item: {} },
    { id: "dish:beetroot", displayName: "Roasted Beetroot with Yoghurt & Pickled Shallots", category: "Salad", item: { sourceAliases: ["Pickled Shallot"] } },
    { id: "dish:garnish", displayName: "Fresh herbs", category: "Garnish", item: {} },
    { id: "dish:soup", displayName: "Tomato soup", category: "Soup", item: {} },
    ...Array.from({ length: 500 }, (_, index) => ({ id: `dish:fixture:${index}`, displayName: `Fixture sauce ${index}`, category: "Sauce", item: {} })),
  ];
  // A realistic occupied grid; new edits still have dedicated empty cells.
  for (const day of days) for (const slot of slots.filter(slot => slot.startsWith("SAUCE"))) {
    const entry = { id: `${week.id}:entry:${day.dayName}:${slot}`, dayId: day.id, date: day.date, slot, itemId: "dish:fixture:1", itemLabel: "Fixture sauce 1", portions: 0, allocations: [], allergens: {}, audit: [] };
    snapshot.entries.push(entry); day.entryIds.push(entry.id); week.entryIds.push(entry.id);
  }
  let releaseSave: (() => void) | undefined;
  const receipts = new Map<string, string>();
  let interruptNextSave = false;
  const reads: string[] = [], writes: Array<{ path: string; body: any }> = [];
  const attach = async (page: Page) => {
    await page.route(/^https:\/\//, route => route.abort());
    await page.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url());
      if (request.method() !== "GET") {
        const body = request.postDataJSON(); writes.push({ path: url.pathname, body });
        if (url.pathname === "/api/rolling-menu" && body.action === "save-week") {
          if (releaseSave) await new Promise<void>(resolve => { releaseSave = resolve; });
          const { action: _, ...save } = body;
          try {
            const hash = JSON.stringify(save);
            if (receipts.has(save.requestId)) {
              if (receipts.get(save.requestId) !== hash) throw Object.assign(Error("Changed retry"), { status: 409 });
              return route.fulfill({ json: { snapshot, replayed: true } });
            }
            if (save.expectedWeekVersion !== snapshot.week.version) throw Object.assign(Error("This week changed on the server. Your draft is retained."), { status: 409 });
            const next = structuredClone(snapshot);
            for (const update of save.changes.updates) Object.assign(next.entries.find(entry => entry.id === update.entryId)!, update.patch);
            for (const created of save.changes.creates) { const day = next.days.find(day => day.id === created.dayId)!; next.entries.push({ ...created, date: day.date, portions: 0, allocations: [], allergens: {}, audit: [] }); day.entryIds.push(created.id); next.week.entryIds.push(created.id); }
            next.week.version++; snapshot = next; receipts.set(save.requestId, hash);
            if (interruptNextSave) { interruptNextSave = false; return route.abort(); }
            return route.fulfill({ json: { snapshot, replayed: false } });
          }
          catch (cause) { return route.fulfill({ status: (cause as { status?: number }).status || 500, json: { error: { message: String((cause as Error).message) } } }); }
        }
        if (url.pathname === "/api/catalogue" && body.action === "add-use-classification") { const dish = dishes.find(dish => dish.id === body.id)!; dish.item.tagIds = [...(dish.item.tagIds || []), "dish-tag:type:menu-use-garnish"]; return route.fulfill({ json: { item: dish, tag: { id: "dish-tag:type:menu-use-garnish" } } }); }
        if (url.pathname === "/api/catalogue" && body.action === "create-dish") { const exact = dishes.find(dish => dish.displayName.toLowerCase() === body.displayName.toLowerCase()); const dish = exact || { id: `dish:new:${dishes.length}`, displayName: body.displayName, category: body.category, item: {} }; if (!exact) dishes.push(dish); return route.fulfill({ json: { outcome: exact ? "matched_active" : "created_new", item: { ...dish, canonicalId: dish.id } } }); }
        return route.fulfill({ status: 400, json: { error: { message: "Unexpected fixture mutation" } } });
      }
      reads.push(url.pathname);
      if (url.pathname === "/api/rolling-menu") {
        if (url.searchParams.has("summariesOnly")) return route.fulfill({ json: { week: snapshot.week, weeks: [snapshot.week] } });
        return route.fulfill({ headers: { "x-fika-menu-identity": "person:fixture" }, json: { snapshot, weeks: [snapshot.week], publicationState: {} } });
      }
      if (url.pathname === "/api/catalogue") return route.fulfill({ headers: { "x-fika-menu-identity": "person:fixture" }, json: url.searchParams.has("manifest") ? { schemaVersion: 1, catalogueVersion: dishes.length, dishCount: dishes.length } : { entries: dishes, categories: ["Garnish", "Salad", "Soup", "Sauce"], manifest: { schemaVersion: 1, catalogueVersion: dishes.length, dishCount: dishes.length } } });
      if (url.pathname === "/api/dish-tags") return route.fulfill({ json: { version: 1, tags: [], total: 0 } });
      return route.fulfill({ json: {} });
    });
    await page.goto("/?week=2099-01-05", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("button", { name: "Save Week", exact: true })).toBeVisible();
  };
  const place = async (page: Page, name: string, row = "Garnish", day = "Monday") => {
    const existing = page.getByRole("button", { name: new RegExp(`^Select ${name};`) });
    if (await existing.count()) await existing.first().click();
    else await page.getByRole("button", { name: `Select dish for ${day}, ${row}`, exact: true }).first().click();
    const search = page.getByRole("combobox", { name: "Search all dishes" }); await search.fill(name); await search.press("Enter");
    if (await page.getByRole("dialog", { name: "Use existing dish" }).count()) await page.getByRole("button", { name: "Use in this slot", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Select dish", exact: true })).toHaveCount(0);
  };
  return { attach, place, reads, writes, dishes, get snapshot() { return snapshot; }, lock: () => { snapshot = structuredClone(snapshot); snapshot.week.status = "published"; }, interrupt: () => { interruptNextSave = true; }, externalEdit: () => { snapshot = structuredClone(snapshot); snapshot.week.version++; snapshot.entries[0].itemLabel = "Changed by another editor"; }, holdSave: () => { releaseSave = () => {}; }, releaseSave: () => { const release = releaseSave; releaseSave = undefined; release?.(); } };
}

test("twenty local edits cause zero mutations, one Save Week persists, repeated saves keep current versions", async ({ page }) => {
  test.setTimeout(90_000); const server = backend(); await server.attach(page);
  for (let index = 0; index < 20; index++) { await page.getByRole("button", { name: /^Select Fixture sauce 1;/ }).first().click(); await page.getByRole("combobox").fill(`Fixture sauce ${index + 2}`); await page.getByRole("combobox").press("Enter"); }
  expect(server.writes).toHaveLength(0); await expect(page.getByText("Unsaved Changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(server.writes).toHaveLength(1); expect(server.snapshot.week.version).toBe(97);
  await server.place(page, "Fresh herbs"); await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(server.snapshot.week.version).toBe(98); await page.reload(); await expect(page.getByRole("button", { name: /^Select Fresh herbs;/ })).toBeVisible();
});
test("uncategorised almonds and Shallot aliases are discoverable, classification is additive, and Enter creates only new names", async ({ page }) => {
  const server = backend(); await server.attach(page);
  await page.getByRole("button", { name: "Select dish for Monday, Garnish", exact: true }).first().click();
  const search = page.getByRole("combobox", { name: "Search all dishes" }); const reads = server.reads.length;
  await search.fill("Toasted Almonds"); await expect(page.getByRole("option", { name: /Toasted Almonds/ })).toBeVisible(); expect(server.reads.length).toBe(reads);
  await search.press("Enter"); await page.getByRole("button", { name: "Add classification and use" }).click(); await expect(page.getByRole("button", { name: /^Select Toasted Almonds;/ })).toBeVisible();
  expect(server.dishes.find(dish => dish.id === "dish:almonds")?.category).toBe(""); expect(server.writes.filter(write => write.path === "/api/rolling-menu")).toHaveLength(0);
  await page.getByRole("button", { name: "Select dish for Monday, Garnish", exact: true }).click(); await page.getByRole("combobox").fill("Roasted Beetroot with Yoghurt & Pickled Shallots"); await expect(page.getByRole("option", { name: /Roasted Beetroot/ })).toBeVisible(); await expect(page.getByRole("button", { name: /Create .*as a new dish/ })).toHaveCount(0);
  await page.getByRole("combobox").fill("Pickled Shallot"); await page.getByRole("combobox").press("Enter"); await page.getByRole("button", { name: "Use in this slot", exact: true }).click();
  await page.getByRole("button", { name: "Select dish for Monday, Soup", exact: true }).click(); await page.getByRole("combobox").fill("Brand new fixture soup 337"); await page.getByRole("combobox").press("Enter");
  const modal = page.getByRole("dialog", { name: "Create dish" }); await expect(modal.getByLabel("Dish name")).toHaveValue("Brand new fixture soup 337"); await modal.getByRole("button", { name: "Create and add to planner" }).click();
  await expect(page.getByRole("button", { name: /^Select Brand new fixture soup 337;/ })).toBeVisible(); expect(server.writes.filter(write => write.body.action === "create-dish")).toHaveLength(1); expect(server.writes.filter(write => write.path === "/api/rolling-menu")).toHaveLength(0);
});
test("refresh restores the full draft and internal navigation requires an explicit choice", async ({ page }) => {
  const server = backend(); await server.attach(page); await server.place(page, "Fresh herbs");
  await page.getByRole("link", { name: /Portion Planner/ }).click(); await expect(page.getByRole("dialog", { name: "Unsaved week changes" })).toBeVisible(); await page.getByRole("button", { name: "Stay and edit" }).click();
  page.on("dialog", dialog => dialog.accept()); await page.reload(); await expect(page.getByRole("button", { name: "Restore Draft", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Restore Draft", exact: true }).click(); await expect(page.getByRole("button", { name: /^Select Fresh herbs;/ })).toBeVisible(); expect(server.writes).toHaveLength(0);
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
});
test("409 retains local work and reviews against latest authority before a new explicit save", async ({ page, browser }) => {
  const server = backend(); await server.attach(page); await server.place(page, "Fresh herbs");
  const other = await browser.newContext(); const otherPage = await other.newPage(); await server.attach(otherPage); await server.place(otherPage, "Tomato soup", "Soup"); await otherPage.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(otherPage.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Conflict · draft retained", { exact: true })).toBeVisible(); await expect(page.getByRole("button", { name: /^Select Fresh herbs;/ })).toBeVisible();
  await page.getByRole("button", { name: "Review latest week" }).click(); await page.getByRole("button", { name: "Apply reviewed draft" }).click(); await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  expect(server.snapshot.entries.some(entry => entry.itemLabel === "Fresh herbs")).toBe(true); expect(server.snapshot.entries.some(entry => entry.itemLabel === "Tomato soup")).toBe(true); expect(server.snapshot.week.version).toBe(98); await other.close();
});
test("overlapping saves are blocked and edits made during saving remain dirty after success", async ({ page }) => {
  const server = backend(); await server.attach(page); await server.place(page, "Fresh herbs"); server.holdSave(); await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByRole("button", { name: "Saving…", exact: true })).toBeDisabled();
  await server.place(page, "Tomato soup", "Soup"); expect(server.writes.filter(write => write.body.action === "save-week")).toHaveLength(1); server.releaseSave(); await expect(page.getByText("Unsaved Changes", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible(); expect(server.snapshot.week.version).toBe(98);
});
test("an interrupted response survives refresh and retries the original request without a second mutation", async ({ page }) => {
  const server = backend(); await server.attach(page); await server.place(page, "Fresh herbs"); server.interrupt();
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByRole("button", { name: "Retry Save Week" })).toBeVisible(); expect(server.snapshot.week.version).toBe(97);
  page.on("dialog", dialog => dialog.accept()); await page.reload(); await page.getByRole("button", { name: "Restore Draft", exact: true }).click(); await page.getByRole("button", { name: "Retry Save Week" }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  const saves = server.writes.filter(write => write.body.action === "save-week"); expect(saves).toHaveLength(2); expect(saves[0].body.requestId).toBe(saves[1].body.requestId); expect(server.snapshot.week.version).toBe(97);
});
test("two editors choosing different values for the same row must resolve each field explicitly", async ({ page, browser }) => {
  const server = backend(); await server.attach(page); const other = await browser.newContext(); const otherPage = await other.newPage(); await server.attach(otherPage);
  for (const [editor, value] of [[page, "Fixture sauce 2"], [otherPage, "Fixture sauce 3"]] as const) { await editor.getByRole("button", { name: /^Select Fixture sauce 1;/ }).first().click(); await editor.getByRole("combobox").fill(value); await editor.getByRole("combobox").press("Enter"); }
  await otherPage.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(otherPage.getByText("Saved", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save Week", exact: true }).click(); await page.getByRole("button", { name: "Review latest week" }).click();
  await expect(page.getByRole("button", { name: "Apply reviewed draft" })).toBeDisabled();
  while (await page.getByRole("button", { name: "Keep my value", exact: true }).count()) await page.getByRole("button", { name: "Keep my value", exact: true }).first().click();
  expect(server.snapshot.entries[0].itemLabel).toBe("Fixture sauce 3"); await page.getByRole("button", { name: "Apply reviewed draft" }).click(); await page.getByRole("button", { name: "Save Week", exact: true }).click(); await expect(page.getByText("Saved", { exact: true })).toBeVisible(); expect(server.snapshot.entries[0].itemLabel).toBe("Fixture sauce 2"); await other.close();
});
test("500-dish occupied-week typing stays local and responsive with four-times CPU throttling", async ({ page }, info) => {
  const server = backend(); await server.attach(page); const cdp = await page.context().newCDPSession(page); await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.getByRole("button", { name: /^Select Fixture sauce 1;/ }).first().click(); const input = page.getByRole("combobox", { name: "Search all dishes" }); await expect(input).toBeVisible();
  await page.evaluate(() => { (window as any).__draftPaint = []; document.addEventListener("input", event => { if ((event.target as Element).id !== "week-dish-search") return; const start = performance.now(); requestAnimationFrame(() => requestAnimationFrame(() => (window as any).__draftPaint.push(performance.now() - start))); }); });
  const before = server.reads.length; await input.pressSequentially("fixture sauce", { delay: 60 }); await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(server.reads.length).toBe(before); expect(server.writes).toHaveLength(0);
  const paints = await page.evaluate(() => (window as any).__draftPaint as number[]); const sorted = [...paints].sort((a, b) => a - b); const metrics = { dishes: server.dishes.length, entries: server.snapshot.entries.length, throttle: 4, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: Math.max(...paints), inputCount: paints.length };
  console.log("MENU_DRAFT_PERFORMANCE", JSON.stringify(metrics)); await info.attach("draft-performance.json", { body: JSON.stringify(metrics), contentType: "application/json" }); expect(metrics.inputCount).toBe(13); expect(metrics.medianMs).toBeLessThan(100); expect(metrics.maxMs).toBeLessThan(350);
  await page.screenshot({ path: info.outputPath("draft-picker-desktop.png") });
  await page.getByRole("button", { name: "Close dish picker" }).click(); await page.setViewportSize({ width: 768, height: 1024 }); await page.screenshot({ path: info.outputPath("draft-tablet.png") }); await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: info.outputPath("draft-mobile.png") });
});
