import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { isAbsolute, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fixtureDate, fixtureHash, fixtureTime, itemId, sites, visualResponse } from "./fixtures.mjs";

const { values } = parseArgs({ options: {
  base: { type: "string" }, "expect-sha": { type: "string" }, output: { type: "string" },
  screens: { type: "string", default: "01,02,03,04,05,06,07" },
  viewports: { type: "string", default: "native,desktop,tablet,mobile" },
  playwright: { type: "string" }, checks: { type: "boolean", default: false },
  "shell-interactions": { type: "boolean", default: false },
  "catalogue-interactions": { type: "boolean", default: false },
  "working-tree": { type: "boolean", default: false },
} });
assert(values.base && values.output && values["expect-sha"], "Specify --base, --expect-sha and --output.");
assert(/^[0-9a-f]{40}$/.test(values["expect-sha"]), "Expected source SHA must be a full lowercase Git SHA.");
const base = new URL(values.base);
assert.equal(base.protocol, "http:");
assert(["127.0.0.1", "localhost"].includes(base.hostname) && base.port && base.pathname === "/" &&
  !base.username && !base.password && !base.search && !base.hash, "Use an isolated Studio loopback origin and explicit port.");
assert(isAbsolute(values.output), "Supply an absolute output path in the recovery archive.");
const output = resolve(values.output);

const require = createRequire(import.meta.url);
const playwrightPath = values.playwright ? resolve(values.playwright) : "playwright";
const { chromium } = require(playwrightPath);
const playwrightVersion = require(playwrightPath === "playwright" ? "playwright/package.json" : join(playwrightPath, "package.json")).version;
const dimensions = {
  desktop: { width: 1440, height: 900 }, tablet: { width: 1024, height: 768 }, mobile: { width: 390, height: 844 },
};
const scenes = {
  "01": { name: "rotating-menu-finger-food", product: "finger-food", title: "Finger Food" },
  "02": { name: "fixed-menu-breakfast-pots", product: "breakfast-pots", title: "Breakfast Pots" },
  "03": { name: "menu-builder-home" },
  "04": { name: "grouped-menu-bowl-food", product: "bowl-food", title: "Bowl Food" },
  "05": { name: "dish-picker", product: "finger-food", title: "Finger Food", dialog: true },
  "06": { name: "catalogue-management", catalogue: true },
  "07": { name: "review-and-publish", product: "finger-food", title: "Finger Food", review: true },
};
const screens = values.screens.split(",");
const viewports = values.viewports.split(",");
assert(screens.every(key => Object.hasOwn(scenes, key)), "Unknown screen ID.");
assert(viewports.every(name => name === "native" || Object.hasOwn(dimensions, name)), "Unknown viewport.");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

async function verifyBuild() {
  const response = await fetch(new URL("/api/build-info", base), { redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.equal(response.status, 200, "Studio build endpoint was unavailable.");
  const build = await response.json();
  assert.equal(build.appId, "hospitality-menu-studio");
  assert.equal(build.buildSha, values["expect-sha"], "The Studio server reported a different source SHA.");
  return build;
}

async function fixtureRoutes(context, requests, violations) {
  await context.route("**/*", async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== base.origin || request.method() !== "GET") {
      violations.push(request.method() + " " + url.origin + url.pathname);
      return route.abort();
    }
    if (!url.pathname.startsWith("/api/")) return route.continue();
    requests.push(url.pathname + url.search);
    if (!/^[a-f0-9]{64}$/.test(request.headers()["x-fika-studio-scope"] ?? "")) {
      violations.push(request.method() + " " + url.pathname + " without a Studio scope fence");
      return route.abort();
    }
    const response = visualResponse(url, request.method());
    if (response) return route.fulfill(response);
    violations.push(request.method() + " " + url.pathname);
    return route.abort();
  });
}

async function preview(page) {
  const site = page.getByLabel(/^(preview )?site$/i);
  const date = page.getByLabel(/^(preview |event )?date$/i);
  const panes = page.getByRole("group", { name: "Menu workspace panels" });
  const showPreview = panes.getByRole("button", { name: "Customer preview", exact: true });
  const switchedPane = !(await site.isVisible()) && await showPreview.isVisible();
  if (switchedPane) await showPreview.click();
  await site.selectOption(sites[0].id);
  await date.fill(fixtureDate);
  await page.getByText(/Draft · not bookable/i).waitFor();
  await page.getByText(/minimum 6/i).first().waitFor();
  if (switchedPane) await panes.getByRole("button", { name: "Editor", exact: true }).click();
}

function productInList(page, screen, name) {
  return screen === "03"
    ? page.getByRole("region", { name: "Hospitality products" }).getByText(name, { exact: true })
    : page.getByRole("row").filter({ hasText: name });
}

async function openScene(page, scene) {
  const address = new URL(base);
  if (scene.product) address.searchParams.set("product", itemId(scene.product));
  if (scene.catalogue) address.searchParams.set("page", "catalogue");
  await page.goto(address.href, { waitUntil: "domcontentloaded" });
  if (scene.catalogue) {
    await page.getByRole("heading", { name: /^Catalogue(?: management)?$/ }).waitFor();
    await productInList(page, "06", "Breakfast Pots").waitFor();
  } else if (scene.product) {
    await page.getByRole("heading", { name: scene.title, exact: true }).first().waitFor();
    if (scene.review) {
      await page.getByRole("button", { name: /review.*publish/i }).click();
      await page.getByRole("heading", { name: /review.*publish/i }).waitFor();
      const publish = page.getByRole("button", { name: /^(publish menu|publish to hub)$/i });
      if (await publish.count()) assert(await publish.first().isDisabled(), "The fictional review must not permit publication.");
    } else {
      await preview(page);
      if (scene.dialog) {
        await page.getByRole("button", { name: /add dishes/i }).first().click();
        const dialog = page.getByRole("dialog");
        await dialog.waitFor();
        await dialog.getByRole("checkbox", { name: /garden pea/i }).check();
        await dialog.getByRole("checkbox", { name: /tomato.*basil/i }).check();
        await dialog.getByText("2 dishes selected", { exact: true }).waitFor();
      }
    }
  } else {
    await page.getByRole("heading", { name: "Menu Builder", exact: true }).waitFor();
    await productInList(page, "03", "Breakfast Pots").waitFor();
  }
  await page.evaluate(async () => {
    await document.fonts.ready;
    window.scrollTo(0, 0);
  });
}

function assertReadShape(requests, screen) {
  const adminReads = requests.filter(path => path === "/api/catalogue").length;
  const bootstraps = requests.filter(path => path === "/api/studio/product-menus?includeCatalogueManifest=1").length;
  const gzipReads = requests.filter(path => /^\/api\/catalogue\/public-package\/[a-f0-9]{64}$/.test(path)).length;
  assert.equal(adminReads, screen === "06" ? 1 : 0, "Unexpected administrative catalogue reload.");
  assert.equal(bootstraps, screen === "06" ? 0 : 1, "Expected exactly one combined Builder bootstrap.");
  assert.equal(gzipReads, screen === "06" ? 0 : 1, "Expected only one cold gzip download.");
  assert(!requests.includes("/api/studio?list=menus"), "The ordinary screens must not eagerly fetch legacy menus.");
  if (screen !== "05") assert(!requests.includes("/api/studio?list=dishes"), "Opening a menu must not preload the Dish Library.");
  const revisionKeys = requests.flatMap(path => new URL(path, base).searchParams.get("dishRevisions")?.split(",") ?? []);
  assert.equal(revisionKeys.length, new Set(revisionKeys).size, "The screen refetched an immutable dish revision.");
}

async function assertLocalInteraction(page, screen, requests) {
  if (screen !== "03" && screen !== "06") return;
  const search = page.getByRole("searchbox").first();
  const requestCount = requests.length;
  await search.fill("Breakfast Pots");
  await productInList(page, screen, "Breakfast Pots").waitFor();
  await productInList(page, screen, "Finger Food").waitFor({ state: "hidden" });
  assert.equal(requests.length, requestCount, "Local search made an API request.");
  await search.fill("");
}

const readWidths = page => page.evaluate(() => ({
  document: document.documentElement.scrollWidth, viewport: window.innerWidth,
}));

async function assertFocus(page, locator) {
  const control = await locator.elementHandle();
  await page.waitForFunction(element => document.activeElement === element, control);
}

async function testShellInteractions(page, requests, viewportName) {
  const result = {};
  const initialRequests = requests.length;
  const filters = page.getByRole("group", { name: "Menu status" });
  const drafts = filters.getByRole("button", { name: "Draft", exact: true });
  await drafts.focus();
  await page.keyboard.press("Space");
  await productInList(page, "03", "Breakfast Pots").waitFor();
  await productInList(page, "03", "Afternoon Tea").waitFor({ state: "hidden" });
  const notConfigured = filters.getByRole("button", { name: "Not configured", exact: true });
  await notConfigured.focus();
  await page.keyboard.press("Enter");
  await productInList(page, "03", "Afternoon Tea").waitFor();
  await productInList(page, "03", "Breakfast Pots").waitFor({ state: "hidden" });
  await filters.getByRole("button", { name: /^All(?: products)?$/ }).click();
  await productInList(page, "03", "Breakfast Pots").waitFor();
  assert.equal(requests.length, initialRequests, "Status filters must stay local.");
  result.localStatusFilters = true;

  const region = page.getByRole("region", { name: "Hospitality products" });
  const create = region.locator("li, tr").filter({ has: page.getByText("Afternoon Tea", { exact: true }) })
    .getByRole("button", { name: "Create menu", exact: true });
  await create.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Create a menu" });
  await dialog.waitFor();
  await page.waitForFunction(element => element.contains(document.activeElement), await dialog.elementHandle());
  await dialog.getByRole("button", { name: "Cancel", exact: true }).focus();
  await page.keyboard.press("Enter");
  await dialog.waitFor({ state: "hidden" });
  await assertFocus(page, create);
  assert.equal(requests.length, initialRequests, "Opening and cancelling the create dialog must stay local.");
  result.keyboardCreateCancelWithFocusReturn = true;

  if (viewportName === "mobile" || viewportName === "tablet") {
    const toggle = page.getByRole("button", { name: /^(open|close) navigation$/i });
    await toggle.focus();
    await page.keyboard.press("Enter");
    const nav = page.getByRole("navigation", { name: "Studio navigation" });
    await nav.waitFor();
    await nav.getByRole("link", { name: "Menu Builder", exact: true }).focus();
    await page.keyboard.press("Escape");
    await nav.waitFor({ state: "hidden" });
    await assertFocus(page, toggle);
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    result.navigationEscapeAndFocusReturn = true;
    result.responsiveWidths = await readWidths(page);
    assert.equal(result.responsiveWidths.document, result.responsiveWidths.viewport, "The shell overflows the viewport.");
  }

  const open = region.locator("li, tr").filter({ has: page.getByText("Finger Food", { exact: true }) })
    .getByRole("button", { name: /^Open menu/ });
  await open.focus();
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Finger Food", exact: true }).first().waitFor();
  assert.equal(new URL(page.url()).searchParams.get("product"), itemId("finger-food"));
  const opening = requests.slice(initialRequests);
  assert.equal(opening.filter(path => new URL(path, base).searchParams.get("itemId") === itemId("finger-food")).length, 1);
  assert(!opening.includes("/api/catalogue") && !opening.includes("/api/studio?list=dishes"), "Opening a draft loaded extra catalogue or dish-library data.");
  result.keyboardOpensDraft = true;
  result.openRequests = opening;
  return result;
}


async function testCatalogueInteractions(page, requests, viewportName) {
  const initialRequests = requests.length;
  const table = page.getByRole("table");
  const original = await table.getByRole("rowheader").first().innerText();
  await table.getByRole("button", { name: "Product name", exact: true }).press("Enter");
  assert.notEqual(await table.getByRole("rowheader").first().innerText(), original, "The sort order did not change.");
  if (viewportName === "mobile") {
    const toggle = page.getByRole("button", { name: /^Filters/ });
    assert.equal(await toggle.getAttribute("aria-expanded"), "false");
    await toggle.press("Enter");
    assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  }
  await page.getByLabel("Category", { exact: true }).selectOption("Breakfast");
  await productInList(page, "06", "Finger Food").waitFor({ state: "hidden" });
  await productInList(page, "06", "Breakfast Pots").waitFor();
  await page.getByRole("button", { name: "Reset", exact: true }).press("Enter");
  await productInList(page, "06", "Finger Food").waitFor();
  assert.equal(requests.length, initialRequests, "Local filters and sort made API calls: " + JSON.stringify(requests));
  await table.getByRole("button", { name: "View Breakfast Pots details", exact: true }).click();
  await page.getByRole("region", { name: "Product details", exact: true }).getByRole("heading", { name: "Breakfast Pots", exact: true }).waitFor();
  await table.getByRole("button", { name: "Edit Breakfast Pots", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Breakfast Pots", exact: true });
  await editor.waitFor();
  await page.keyboard.press("Escape");
  await editor.waitFor({ state: "hidden" });
  const responsiveWidths = await readWidths(page);
  assert.equal(responsiveWidths.document, responsiveWidths.viewport, "The Catalogue overflows the viewport.");
  assert.equal(requests.length, initialRequests, "Contextual product editing made unexpected API calls: " + JSON.stringify(requests));
  const linkedSections = page.getByText(/^Linked sections in loaded menus/);
  await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === "/api/studio" && new URL(response.url()).searchParams.get("list") === "menus"),
    linkedSections.click(),
  ]);
  assert.deepEqual(requests.slice(initialRequests), ["/api/studio?list=menus"], "Legacy links should load only when opened.");
  return { localSort: true, localFilterAndReset: true, contextualDetailsAndEdit: true, legacyLinksLoadedOnDemand: true, responsiveWidths };
}

async function capture(browser, screen, viewportName, build) {
  const scene = scenes[screen];
  const viewport = viewportName === "native" ? { width: screen === "01" ? 1672 : 1671, height: 941 } : dimensions[viewportName];
  const context = await browser.newContext({ viewport, locale: "en-GB", timezoneId: "Europe/London",
    deviceScaleFactor: 1, colorScheme: "light", reducedMotion: "reduce", serviceWorkers: "block", hasTouch: viewportName === "mobile" });
  const requests = [];
  const violations = [];
  try {
    await fixtureRoutes(context, requests, violations);
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    await page.clock.setFixedTime(new Date(fixtureTime));
    await openScene(page, scene);
    const currentUrl = page.url();
    assert.equal(new URL(currentUrl).origin, base.origin);
    assert.deepEqual(violations, [], "The fixture page attempted an unrecognised API request or mutation.");
    if (values.checks) assertReadShape(requests, screen);
    const png = await page.screenshot({ animations: "disabled", caret: "hide" });
    const file = `${screen}-${scene.name}-${viewportName}`;
    const snapshotRequests = [...requests];
    const widths = await readWidths(page);
    if (values.checks) await assertLocalInteraction(page, screen, requests);
    let interactions;
    if (values["shell-interactions"] && screen === "03") interactions = await testShellInteractions(page, requests, viewportName);
    if (values["catalogue-interactions"] && screen === "06") interactions = await testCatalogueInteractions(page, requests, viewportName);
    assert.deepEqual(violations, [], "The fixture page attempted an unrecognised API request or mutation.");
    const metadata = { app: build, playwrightVersion, chromiumVersion: browser.version(), fixtureHash, viewportName, viewport,
      screen, url: currentUrl, imageSha256: digest(png), requests: snapshotRequests, widths, horizontalOverflow: widths.document > widths.viewport,
      ...(interactions && { interactions }),
      captureMode: "loopback-fictional", uncommittedCandidate: values["working-tree"],
      fixedTime: fixtureTime, timezone: "Europe/London", locale: "en-GB" };
    await writeFile(join(output, file + ".png"), png, { flag: "wx" });
    await writeFile(join(output, file + ".json"), JSON.stringify(metadata, null, 2) + "\n", { flag: "wx" });
    console.info(`${file}: ${metadata.imageSha256} (${snapshotRequests.length} fixture API requests)`);
  } finally {
    await context.close();
  }
}

const build = await verifyBuild();
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  for (const screen of screens) {
    for (const viewport of viewports) await capture(browser, screen, viewport, build);
  }
} finally {
  await browser.close();
}
