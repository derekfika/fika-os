import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";
import { dishSchema } from "../../../shared/hospitality-menu-studio-content.ts";
import { productMenuDraft } from "../../../shared/hospitality-menu-studio-product-content.ts";
import { dishes, fixtureDate, fixtureHash, fixtureTime, itemId, sites, visualResponse } from "./fixtures.mjs";

const { values } = parseArgs({ options: {
  base: { type: "string" }, "expect-sha": { type: "string" }, playwright: { type: "string" }, output: { type: "string" },
  only: { type: "string" },
} });
assert(values.base && /^[0-9a-f]{40}$/.test(values["expect-sha"] ?? ""), "Supply --base and a full --expect-sha.");
if (values.output) assert(isAbsolute(values.output), "Use an absolute --output path.");
const base = new URL(values.base);
assert(base.protocol === "http:" && ["127.0.0.1", "localhost"].includes(base.hostname) && base.port &&
  base.pathname === "/" && !base.username && !base.password && !base.search && !base.hash, "An isolated Studio loopback URL is required.");
const buildResponse = await fetch(new URL("/api/build-info", base), { redirect: "error", signal: AbortSignal.timeout(20_000) });
assert.equal(buildResponse.status, 200);
const build = await buildResponse.json();
assert.equal(build.appId, "hospitality-menu-studio");
assert.equal(build.buildSha, values["expect-sha"]);

const require = createRequire(import.meta.url);
const { chromium } = require(values.playwright ? resolve(values.playwright) : "playwright");
const menuPath = "/api/studio/product-menus";
const editorArea = page => page.getByRole("region", { name: "Menu editor" });
const previewArea = page => page.getByRole("complementary", { name: "Customer preview" });
const exactButton = (area, name) => area.getByRole("button", { name, exact: true });
const draftUrl = product => new URL(menuPath + "?" + new URLSearchParams({ itemId: itemId(product) }), base);
const dishIds = slot => slot.dishes.map(dish => dish.dishId);
const dishReferences = slot => [...slot.dishes, ...slot.groups.flatMap(group => group.dishes)];
const dishByName = regex => {
  const item = dishes.find(dish => regex.test(dish.name));
  assert(item, "Unknown fixture dish.");
  return item;
};

async function fixtureRoutes(context, evidence, controls) {
  const keys = ["finger-food", "breakfast-pots", "bowl-food"];
  const heads = new Map(keys.map(key => [itemId(key), productMenuDraft.parse(visualResponse(draftUrl(key), "GET").json.item)]));
  const dishHeads = new Map(dishes.map(dish => [dish.id, dish]));
  const dishRevisions = new Map(dishes.map(dish => [`${dish.id}@${dish.version}`, dish]));
  let scope;
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    try {
      assert.equal(url.origin, base.origin, "Cross-origin request");
      if (!url.pathname.startsWith("/api/")) {
        assert.equal(method, "GET");
        assert(url.pathname === "/" || url.pathname.startsWith("/_next/") || url.pathname.startsWith("/fonts/") ||
          ["/fika-logo.png", "/favicon.ico"].includes(url.pathname), "Unexpected document or asset");
        return route.continue();
      }
      const headers = request.headers();
      assert(/^[a-f0-9]{64}$/.test(headers["x-fika-studio-scope"] ?? ""), "No Studio scope fence");
      scope ??= headers["x-fika-studio-scope"];
      assert.equal(headers["x-fika-studio-scope"], scope, "Browser authority changed during fixture run");
      if (method === "POST") {
        assert(url.pathname === menuPath || url.pathname === "/api/studio", "Only an explicit fictional draft save may be intercepted");
        assert.equal(url.search, "");
        assert.match(headers["content-type"] ?? "", /^application\/json(?:;|$)/i);
        const body = request.postDataJSON();
        assert.deepEqual(Object.keys(body).sort(), ["action", "item"]);
        if (url.pathname === "/api/studio") {
          assert(controls.allowDishEdit && body.action === "save-dish", "Dish writes are closed in this fixture");
          const snapshot = dishSchema.parse(body.item);
          const previous = dishHeads.get(snapshot.id);
          assert(previous, "A fixture cannot mutate an unknown dish");
          assert.equal(snapshot.version, previous.version);
          const item = dishSchema.parse({ ...snapshot, version: snapshot.version + 1, updatedAt: fixtureTime });
          dishHeads.set(item.id, item);
          dishRevisions.set(`${item.id}@${item.version}`, item);
          evidence.interceptedDishEdits.push({ dishId: item.id, expectedVersion: snapshot.version, acknowledgedVersion: item.version });
          return route.fulfill({ json: { item } });
        }
        assert.equal(body.action, "save");
        const snapshot = productMenuDraft.parse(body.item);
        const previous = heads.get(snapshot.itemId);
        assert(previous, "A fixture cannot save an unknown product");
        const configuration = snapshot.configuration;
        const slots = configuration.schedule.kind === "fixed" ? [configuration.schedule.choices] : configuration.schedule.weeks;
        for (const slot of slots) {
          for (const dish of dishReferences(slot)) assert(dishRevisions.has(`${dish.dishId}@${dish.revision}`), "Unverified fictional dish revision");
        }
        assert.equal(snapshot.version, previous.version, "Save did not use the last acknowledged version");
        if (controls.holdSave) {
          const pending = controls.holdSave;
          controls.holdSave = undefined;
          await pending.promise;
        }
        if (controls.failNextSave) {
          controls.failNextSave = false;
          evidence.interceptedFailures.push({ expectedVersion: snapshot.version, status: 503 });
          return route.fulfill({ status: 503, json: { error: "Fictional save response unavailable." } });
        }
        const item = productMenuDraft.parse({ ...snapshot, version: previous.version + 1, updatedAt: fixtureTime });
        heads.set(item.itemId, item);
        evidence.interceptedSaves.push({ itemId: snapshot.itemId, expectedVersion: snapshot.version, acknowledgedVersion: item.version });
        return route.fulfill({ json: { item } });
      }
      assert.equal(method, "GET");
      evidence.reads.push(url.pathname + url.search);
      if (controls.allowDishEdit) {
        if (url.pathname === "/api/studio" && url.searchParams.get("list") === "dishes")
          return route.fulfill({ json: { items: [...dishHeads.values()], nextCursor: null } });
        if (url.pathname === "/api/studio" && url.searchParams.get("list") === "assigned-dishes") {
          const ids = url.searchParams.get("ids").split(",");
          return route.fulfill({ json: { items: ids.flatMap(id => dishHeads.has(id) ? [dishHeads.get(id)] : []) } });
        }
        if (url.pathname === menuPath && url.searchParams.has("dishRevisions")) {
          const keys = url.searchParams.get("dishRevisions").split(",");
          return route.fulfill({ json: { items: keys.flatMap(key => {
            const dish = dishRevisions.get(key);
            return dish ? [{ id: dish.id, version: dish.version, category: dish.category, name: dish.name, customerDescription: dish.customerDescription }] : [];
          }) } });
        }
      }
      const item = url.pathname === menuPath && heads.get(url.searchParams.get("itemId"));
      const response = item ? { json: { item } } : visualResponse(url, method);
      assert(response, "Unknown API read");
      return route.fulfill(response);
    } catch (failure) {
      evidence.blockedRequests.push({ method, path: url.pathname, reason: failure.message });
      return route.abort();
    }
  });
}

async function openEditor(page, key, title) {
  const url = new URL(base);
  url.searchParams.set("product", itemId(key));
  await page.goto(url.href, { waitUntil: "domcontentloaded" });
  await page.getByText("Local preview", { exact: true }).waitFor({ state: "attached" });
  await editorArea(page).getByRole("heading", { name: title, exact: true }).waitFor();
  await waitForSaved(page);
}

async function waitForSaved(page) {
  const review = exactButton(page, "Review & publish");
  await page.waitForFunction(button => !button.disabled, await review.elementHandle());
}

function weekButton(page, week) {
  return page.getByRole("group", { name: "Rotation weeks" }).getByRole("button", { name: new RegExp(`^Week ${week}\\b`) });
}

async function autosave(page, expectedVersion, edit) {
  const received = page.waitForResponse(response => {
    if (new URL(response.url()).pathname !== menuPath || response.request().method() !== "POST") return false;
    return response.request().postDataJSON().item.version === expectedVersion;
  });
  const [response] = await Promise.all([received, Promise.resolve().then(edit)]);
  assert.equal(response.status(), 200);
  const { item } = await response.json();
  assert.equal(item.version, expectedVersion + 1);
  await waitForSaved(page);
  return item.configuration;
}

async function choosePreview(page) {
  const preview = previewArea(page);
  const narrow = page.getByRole("group", { name: "Menu workspace panels" }).getByRole("button", { name: "Customer preview" });
  if (!(await preview.isVisible()) && await narrow.isVisible()) await narrow.click();
  await preview.getByLabel("Site", { exact: true }).selectOption(sites[0].id);
  await preview.getByLabel("Event date", { exact: true }).fill(fixtureDate);
  await preview.getByText(/draft.*not bookable/i).waitFor();
  return preview;
}

const browser = await chromium.launch({ headless: true });
const results = [];
async function scenario(name, key, title, actions, viewport = { width: 1440, height: 900 }) {
  if (values.only && !name.includes(values.only)) return;
  const context = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London",
    serviceWorkers: "block", hasTouch: viewport.width === 390, reducedMotion: "reduce" });
  const evidence = { name, viewport, reads: [], interceptedSaves: [], interceptedDishEdits: [], interceptedFailures: [], blockedRequests: [], reloads: 0, status: "pass" };
  const controls = { gates: [], readBoundaries: [0] };
  results.push(evidence);
  try {
    await fixtureRoutes(context, evidence, controls);
    const page = await context.newPage();
    page.setDefaultTimeout(8_000);
    await page.clock.setFixedTime(new Date(fixtureTime));
    await openEditor(page, key, title);
    await actions(page, evidence, controls);
    assert.deepEqual(evidence.blockedRequests, []);
    assert.equal(evidence.reads.filter(path => path === menuPath + "?includeCatalogueManifest=1").length, 1 + evidence.reloads);
    assert.equal(evidence.reads.filter(path => /^\/api\/catalogue\/public-package\/[a-f0-9]{64}$/.test(path)).length, 1);
    assert(!evidence.reads.includes("/api/catalogue") && !evidence.reads.includes("/api/studio?list=menus"));
    for (const [index, start] of controls.readBoundaries.entries()) {
      const revisions = evidence.reads.slice(start, controls.readBoundaries[index + 1])
        .flatMap(path => new URL(path, base).searchParams.get("dishRevisions")?.split(",") ?? []);
      assert.equal(revisions.length, new Set(revisions).size, "A fixture dish revision was downloaded more than once per editor session.");
    }
  } catch (failure) {
    evidence.status = "fail";
    evidence.error = failure instanceof Error ? failure.message : String(failure);
    process.exitCode = 1;
  } finally {
    for (const gate of controls.gates) gate.resolve();
    console.info(`${evidence.status.toUpperCase()} ${name} (${evidence.reads.length} reads, ${evidence.interceptedSaves.length} menu saves, ${evidence.interceptedDishEdits.length} dish edits)`);
    if (evidence.error) console.error(evidence.error);
    await context.close();
  }
}

try {
  await scenario("rotation validation and explicit loss confirmation", "finger-food", "Finger Food", async (page, evidence) => {
    const editor = editorArea(page);
    await editor.getByLabel("Cycle start Monday").fill("2026-12-01");
    await exactButton(editor, "Apply schedule").click();
    await editor.getByRole("alert").filter({ hasText: /choose a Monday/i }).waitFor();
    assert.equal(evidence.interceptedSaves.length, 0);
    await editor.getByLabel("Cycle start Monday").fill(fixtureDate);
    await weekButton(page, 2).click();
    await editor.getByLabel("Rotation length").fill("3");
    await exactButton(editor, "Apply schedule").click();
    const warning = page.getByRole("dialog", { name: "Confirm schedule change" });
    await warning.getByText("Week 6: 6 dishes").waitFor();
    await exactButton(warning, "Cancel").click();
    await weekButton(page, 6).waitFor();
    assert.equal(evidence.interceptedSaves.length, 0);
    await exactButton(editor, "Apply schedule").click();
    const shortened = await autosave(page, 2, () => exactButton(warning, "Confirm change").click());
    assert.equal(shortened.schedule.weeks.length, 3);
    assert.equal(await weekButton(page, 2).getAttribute("aria-pressed"), "true");
    await exactButton(editor.getByRole("group", { name: "Menu type" }), "Fixed menu").click();
    await exactButton(editor, "Apply schedule").click();
    await warning.getByText("Week 1: 6 dishes").waitFor();
    assert.equal(await warning.getByText("Week 2: 6 dishes").count(), 0);
    const fixed = await autosave(page, 3, () => exactButton(warning, "Confirm change").click());
    assert.equal(fixed.schedule.kind, "fixed");
    assert.deepEqual(fixed.schedule.choices, shortened.schedule.weeks[1]);
    await exactButton(editor.getByRole("group", { name: "Menu type" }), "Rotating menu").click();
    await editor.getByLabel("Rotation length").fill("52");
    const expanded = await autosave(page, 4, () => exactButton(editor, "Apply schedule").click());
    assert.equal(expanded.schedule.weeks.length, 52);
    assert.deepEqual(expanded.schedule.weeks[0], fixed.schedule.choices);
    assert(expanded.schedule.weeks.slice(1).every(slot => !dishReferences(slot).length));
  });

  await scenario("append, replace, and retain a keyboard picker selection", "finger-food", "Finger Food", async (page, evidence) => {
    const editor = editorArea(page);
    const original = visualResponse(draftUrl("finger-food"), "GET").json.item.configuration.schedule.weeks;
    const openCopy = exactButton(editor, "Copy to weeks");
    const copy = page.getByRole("dialog", { name: "Copy week 1" });
    await openCopy.click();
    await copy.getByRole("checkbox", { name: /^Week 2\b/ }).check();
    await copy.getByRole("checkbox", { name: /^Week 3\b/ }).check();
    const appended = await autosave(page, 2, () => exactButton(copy, "Copy dishes").click());
    for (const index of [1, 2]) {
      const expected = [...new Set([...dishIds(original[index]), ...dishIds(original[0])])];
      assert.deepEqual(dishIds(appended.schedule.weeks[index]), expected);
    }
    await openCopy.click();
    await copy.getByRole("checkbox", { name: /^Week 3\b/ }).check();
    await copy.getByLabel("Copy behaviour").selectOption("replace");
    await exactButton(copy, "Copy dishes").click();
    await copy.getByRole("alert").filter({ hasText: /replacing will remove/i }).waitFor();
    assert.equal(evidence.interceptedSaves.length, 1);
    const replaced = await autosave(page, 3, () => exactButton(copy, "Confirm replacement").click());
    assert.deepEqual(replaced.schedule.weeks[2], original[0]);
    assert.deepEqual(replaced.schedule.weeks[1], appended.schedule.weeks[1]);

    const add = exactButton(editor, "Add dishes");
    await add.focus();
    await page.keyboard.press("Enter");
    const picker = page.getByRole("dialog", { name: "Add dishes" });
    await picker.waitFor();
    await page.waitForFunction(element => element.contains(document.activeElement), await picker.elementHandle());
    const pea = picker.getByRole("checkbox", { name: /garden pea/i });
    const tomato = picker.getByRole("checkbox", { name: /tomato.*basil/i });
    await pea.waitFor();
    const readCount = evidence.reads.length;
    await pea.focus();
    await page.keyboard.press("Space");
    assert.equal(await pea.isChecked(), true);
    await picker.getByLabel("Search dishes").fill("Tomato");
    await pea.waitFor({ state: "hidden" });
    await tomato.check();
    await picker.getByText("2 dishes selected", { exact: true }).waitFor();
    await exactButton(picker.getByRole("group", { name: "Filter dishes by category" }), "vegan").click();
    await tomato.waitFor({ state: "hidden" });
    await picker.getByText("2 dishes selected", { exact: true }).waitFor();
    assert.equal(evidence.reads.length, readCount);
    await picker.getByRole("checkbox", { name: "Week 2", exact: true }).check();
    const assigned = await autosave(page, 4, () => exactButton(picker, "Add selected dishes").click());
    assert.deepEqual(assigned.schedule.weeks[0].dishes,
      [...original[0].dishes, ...[/garden pea/i, /tomato.*basil/i].map(match => {
        const chosen = dishByName(match);
        return { dishId: chosen.id, revision: chosen.version };
      })]);
    assert.deepEqual(assigned.schedule.weeks[1], appended.schedule.weeks[1]);
    await add.focus();
    await page.keyboard.press("Enter");
    await picker.waitFor();
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "hidden" });
    await page.waitForFunction(element => element === document.activeElement, await add.elementHandle());
    assert.equal(evidence.reads.filter(path => path === "/api/studio?list=dishes").length, 1);
  });

  await scenario("group and dish order, shared customer controls, and blocked publish", "bowl-food", "Bowl Food", async (page, evidence) => {
    const editor = editorArea(page);
    const reordered = await autosave(page, 2, async () => {
      await exactButton(editor, "Move group Hot bowls down").focus();
      await page.keyboard.press("Enter");
    });
    assert.deepEqual(reordered.groups.map(group => group.id), ["visual-cold", "visual-hot"]);
    const reversed = await autosave(page, 3, async () => {
      await exactButton(editor, "Move Lemon & herb quinoa down").focus();
      await page.keyboard.press("Enter");
    });
    const cold = reversed.schedule.choices.groups.find(group => group.groupId === "visual-cold");
    assert.deepEqual(cold.dishes.map(item => item.dishId), [/soy noodle/i, /lemon.*quinoa/i].map(name => dishByName(name).id));
    const moved = await autosave(page, 4, () => editor.getByLabel("Move Ginger chicken & sesame rice to another group").selectOption("visual-cold"));
    const movedDish = dishByName(/ginger chicken/i);
    assert.deepEqual(moved.schedule.choices.groups.find(group => group.groupId === "visual-cold").dishes.at(-1),
      { dishId: movedDish.id, revision: movedDish.version });
    const preview = await choosePreview(page);
    const coldGroup = preview.getByRole("group", { name: "Cold bowls" });
    const soy = coldGroup.getByRole("spinbutton", { name: "Soy noodle & edamame salad quantity" });
    const chicken = coldGroup.getByRole("spinbutton", { name: "Ginger chicken & sesame rice quantity" });
    await soy.fill("2");
    await chicken.fill("4");
    await preview.getByLabel("Guests", { exact: true }).fill("4");
    await preview.getByText("Selection meets the preview minimums.").waitFor();
    await preview.getByText(/estimated menu total.*£53\.70 before VAT/i).waitFor();
    const beforeViewports = evidence.reads.length;
    const viewportModes = preview.getByRole("group", { name: "Preview viewport" });
    for (const mode of ["Mobile", "Tablet", "Desktop"]) {
      const button = exactButton(viewportModes, mode);
      await button.click();
      assert.equal(await button.getAttribute("aria-pressed"), "true");
      assert.equal(await soy.inputValue(), "2");
    }
    assert.equal(evidence.reads.length, beforeViewports);
    await exactButton(page, "Review & publish").click();
    await page.getByRole("heading", { name: "Review & publish", exact: true }).waitFor();
    const publish = exactButton(page, "Publish menu");
    await publish.waitFor();
    assert.equal(await publish.isDisabled(), true);
    await page.getByText("Publication authority is unavailable for this account and scope.", { exact: true }).waitFor();
    assert.equal(evidence.interceptedSaves.length, 3);
  });

  await scenario("mobile preview pane uses the shared dropdown and quantity controls", "breakfast-pots", "Breakfast Pots", async (page, evidence) => {
    const preview = await choosePreview(page);
    const choices = preview.getByRole("group", { name: "Dishes", exact: true });
    const dropdown = choices.getByRole("combobox");
    const quantity = choices.getByRole("spinbutton");
    await dropdown.waitFor();
    assert.equal(await quantity.isDisabled(), true);
    await dropdown.selectOption(dishByName(/apple.*overnight oats/i).id);
    assert.equal(await quantity.isDisabled(), false);
    await quantity.fill("6");
    await preview.getByLabel("Guests", { exact: true }).fill("4");
    await preview.getByText("Selection meets the preview minimums.").waitFor();
    const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
    assert.deepEqual(widths, { document: 390, viewport: 390 });
    assert.equal(evidence.interceptedSaves.length, 0);
    evidence.previewWidths = widths;
  }, { width: 390, height: 844 });

  await scenario("pending save navigation guard and explicit recovery after reload", "finger-food", "Finger Food", async (page, evidence, controls) => {
    const editor = editorArea(page);
    const selection = editor.getByRole("group", { name: "Customer selection" });
    const held = Promise.withResolvers();
    controls.gates.push(held);
    controls.holdSave = held;
    const started = page.waitForRequest(request => new URL(request.url()).pathname === menuPath && request.method() === "POST");
    await exactButton(selection, "Dropdown").click();
    const snapshot = (await started).postDataJSON().item;
    assert.equal(snapshot.version, 2);
    assert.equal(snapshot.configuration.presentation, "dropdown");
    await exactButton(page, "Menu Builder").click();
    const discard = page.getByRole("dialog", { name: "Discard unsaved changes?" });
    await exactButton(discard, "Discard changes").click();
    await discard.getByText("A save is in progress. Wait for it to finish before leaving.").waitFor();
    assert.equal(new URL(page.url()).searchParams.get("product"), itemId("finger-food"));
    const finish = page.waitForResponse(response => new URL(response.url()).pathname === menuPath && response.request().method() === "POST");
    held.resolve();
    assert.equal((await finish).status(), 200);
    await exactButton(discard, "Keep editing").click();
    await waitForSaved(page);

    controls.failNextSave = true;
    const failure = page.waitForResponse(response => new URL(response.url()).pathname === menuPath && response.request().method() === "POST");
    await exactButton(selection, "Checkboxes").click();
    assert.equal((await failure).status(), 503);
    await exactButton(page, "Retry save").waitFor();
    controls.readBoundaries.push(evidence.reads.length);
    evidence.reloads++;
    page.once("dialog", dialog => dialog.accept());
    await page.reload({ waitUntil: "domcontentloaded" });
    const resume = exactButton(page, "Resume retained draft");
    await resume.waitFor();
    assert.equal(await exactButton(selection, "Dropdown").getAttribute("aria-pressed"), "true");
    assert.equal(evidence.interceptedSaves.length, 1);
    const acknowledged = await autosave(page, 3, () => resume.click());
    assert.equal(acknowledged.presentation, "checkboxes");
    assert.deepEqual(evidence.interceptedSaves.map(save => save.expectedVersion), [2, 3]);
    assert.deepEqual(evidence.interceptedFailures, [{ expectedVersion: 3, status: 503 }]);
  });

  await scenario("contextual dish edit validates assortment and keeps assigned revision until reselection", "bowl-food", "Bowl Food", async (page, evidence, controls) => {
    controls.allowDishEdit = true;
    const editor = editorArea(page);
    const original = dishByName(/lemon.*quinoa/i);
    const revisedName = original.name + " — fictional revision";
    const edit = exactButton(editor, `Edit ${original.name}`);
    await edit.click();
    const dialog = page.getByRole("dialog").filter({ has: page.getByLabel("Dish name", { exact: true }) });
    await dialog.getByLabel("Dish name", { exact: true }).fill(revisedName);
    await page.keyboard.press("Escape");
    const discardDish = page.getByRole("dialog", { name: "Discard dish edits?" });
    await discardDish.waitFor();
    assert.equal(evidence.interceptedDishEdits.length, 0);
    await exactButton(discardDish, "Keep editing").click();
    assert.equal(await dialog.getByLabel("Dish name", { exact: true }).inputValue(), revisedName);
    await dialog.locator("summary").filter({ hasText: "Fixed assortment" }).click();
    await exactButton(dialog, "Add assortment").click();
    await dialog.getByText("Assortment needs attention", { exact: true }).waitFor();
    await dialog.getByLabel("Expected total per box", { exact: true }).fill("6");
    await dialog.getByLabel("Unit", { exact: true }).fill("portions");
    await exactButton(dialog, "Add component").click();
    await dialog.getByLabel("Component 1", { exact: true }).fill("Fictional portion");
    await dialog.getByLabel("Quantity for component 1", { exact: true }).fill("6");
    await dialog.getByText("Assortment totals match", { exact: true }).waitFor();
    const dishSave = page.waitForResponse(response => new URL(response.url()).pathname === "/api/studio" && response.request().method() === "POST");
    await exactButton(dialog, "Save dish draft").click();
    const response = await dishSave;
    assert.equal(response.status(), 200);
    const { item: revised } = await response.json();
    assert.equal(revised.id, original.id);
    assert.equal(revised.version, original.version + 1);
    await exactButton(dialog, "Back to menu").click();
    await dialog.waitFor({ state: "hidden" });
    await exactButton(editor, `Edit ${original.name}`).waitFor();
    assert.equal(await exactButton(editor, `Edit ${revisedName}`).count(), 0);
    assert.equal(evidence.interceptedSaves.length, 0);
    const removed = await autosave(page, 2, () => exactButton(editor, `Remove ${original.name}`).click());
    assert(!dishReferences(removed.schedule.choices).some(dish => dish.dishId === original.id));
    await exactButton(editor, "Add to Cold bowls").click();
    const picker = page.getByRole("dialog", { name: "Add dishes" });
    await picker.getByRole("checkbox", { name: /lemon.*quinoa.*fictional revision/i }).check();
    const reselected = await autosave(page, 3, () => exactButton(picker, "Add selected dishes").click());
    assert.deepEqual(dishReferences(reselected.schedule.choices).find(dish => dish.dishId === original.id),
      { dishId: original.id, revision: revised.version });
    const latestDishReads = evidence.reads.filter(path => new URL(path, base).searchParams.get("list") === "assigned-dishes");
    assert.equal(latestDishReads.length, 1);
    assert.equal(new URL(latestDishReads[0], base).searchParams.get("ids"), original.id);
    assert(!evidence.reads.some(path => /reviewVersion|safety/.test(path)), "Contextual edit fetched safety evidence eagerly.");
  });
} finally {
  const report = {
    app: build, browser: browser.version(), fixtureHash, localhost: base.origin, workingTree: true,
    serverMutationRequestsForwarded: 0, results,
  };
  await browser.close();
  assert(results.length, "No interaction scenario matched.");
  if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
}
