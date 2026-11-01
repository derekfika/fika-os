import { expect, test, type Page } from "@playwright/test";

/**
 * Phase A: the Journey Planner V3 design preview (/mock/journey-planner-v2) renders the real
 * presentation components from fictional fixtures. No Hub admission, API or Firestore is involved.
 */
const url = (scenario: string, extra = "") => `/mock/journey-planner-v2?scenario=${scenario}&chrome=0${extra}`;
const viewports = [{ width: 1536, height: 960 }, { width: 1920, height: 1080 }, { width: 1280, height: 800 }, { width: 1366, height: 768 }];

async function open(page: Page, scenario: string, extra = "") {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  await page.goto(url(scenario, extra), { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  return errors;
}

for (const viewport of viewports) {
  test(`full day fits the desktop viewport without page overflow or clipped controls (${viewport.width}x${viewport.height})`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const errors = await open(page, "full-day", "&run=fx-run-1");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    const clipped = await page.evaluate(() => {
      const bad: string[] = [];
      for (const control of document.querySelectorAll<HTMLElement>("[data-journey-planner] button, [data-journey-planner] input")) {
        const rect = control.getBoundingClientRect();
        if (!rect.width || !rect.height || !control.checkVisibility()) continue;
        if (control.closest("[data-testid=journey-timeline-scroller]")) continue; // timeline controls are checked separately
        if (rect.right > innerWidth + 1 || rect.left < -1) bad.push(`${control.getAttribute("aria-label") || control.textContent?.trim()} ${Math.round(rect.left)}-${Math.round(rect.right)}`);
      }
      return bad;
    });
    expect(clipped).toEqual([]);
    await expect(page.getByRole("heading", { level: 1, name: "Journey Planner" })).toBeVisible();
    expect(errors).toEqual([]);
  });
}

test("inspector is docked at ~398px beside the workspace at 1536 and 1920", async ({ page }) => {
  for (const viewport of [{ width: 1536, height: 960 }, { width: 1920, height: 1080 }]) {
    await page.setViewportSize(viewport);
    await open(page, "full-day", "&run=fx-run-1");
    const box = await page.getByRole("complementary", { name: "Run inspector" }).boundingBox();
    expect(box?.width).toBeGreaterThan(390);
    expect(box?.width).toBeLessThan(406);
    expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBeGreaterThanOrEqual(viewport.width - 1);
  }
});

test("queue collapses to a rail below 1440px only while the inspector is open", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await open(page, "full-day", "&run=fx-run-1");
  await expect(page.locator("[data-logistics-planning-queue-rail]")).toBeVisible();
  await open(page, "full-day");
  await expect(page.locator("[data-logistics-planning-queue]")).toBeVisible();
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "full-day", "&run=fx-run-1");
  await expect(page.locator("[data-logistics-planning-queue]")).toBeVisible();
});

test("timeline: one scroll owner, both van lanes retain every run and selected chips keep visiting order", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "full-day", "&run=fx-run-1");
  const rows = page.locator("[data-run-row]");
  await expect(rows).toHaveCount(2);
  await expect(page.locator("[data-run-bar]")).toHaveCount(4);
  const scrollers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-journey-planner] *")).filter((el) => { const o = getComputedStyle(el).overflowX; return (o === "auto" || o === "scroll") && el.scrollWidth > el.clientWidth + 1; }).map((el) => el.getAttribute("data-testid") || el.className));
  expect(scrollers).toEqual(["journey-timeline-scroller"]);
  // Each run's stops render directly beneath its own bar in its van row (#120), not in the selected-run details.
  const selected = page.locator('[data-run-stops="fx-run-1"]');
  const labels = await selected.locator("ol[aria-label^='Visiting sequence'] li").allInnerTexts();
  expect(labels[0]).toContain("CPU");
  expect(labels[labels.length - 1]).toContain("CPU");
  expect(labels.join(" ")).toMatch(/Harbourside[\s\S]*Quay Street[\s\S]*Millbrook/);
  // CPU chips are fixed endpoints, not interactive stops; visit chips are.
  await expect(selected.locator("ol li button")).toHaveCount(3);
});

test("Delete empty run is only offered where the run is eligible", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "full-day", "&run=fx-run-1");
  await expect(page.getByRole("button", { name: "Delete empty run" })).toHaveCount(0);
  await page.getByRole("button", { name: "Run 1 actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete empty run" })).toBeDisabled();
  await page.keyboard.press("Escape");
  await page.locator('select[aria-label="Run on Van 2"]').selectOption("fx-run-4");
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  await page.getByRole("button", { name: "Run 4 actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Delete empty run" })).toBeEnabled();
  await page.keyboard.press("Escape");
  await open(page, "full-day", "&run=fx-run-4");
  await expect(page.getByRole("button", { name: "Delete empty run" })).toBeVisible();
});

test("CPU endpoints are fixed in the inspector and customer stops are reorderable", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "full-day", "&run=fx-run-1");
  const items = page.getByRole("list", { name: "Stops in visiting order" }).locator("> li");
  await expect(items).toHaveCount(5);
  await expect(items.first()).toContainText("CPU");
  await expect(items.first()).toContainText("Departure");
  await expect(items.last()).toContainText("Return");
  await expect(items.first().getByRole("button", { name: /move/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Save order" })).toBeDisabled();
});

test("expanding a mixed stop shows its delivery and collection pieces with Add collection", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "mixed-stop", "&run=fx-run-1&expand=fx-visit-2");
  await expect(page.getByText("Lunch boxes", { exact: true })).toBeVisible();
  await expect(page.getByText("Empty crates", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Add collection/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "View loads" })).toBeVisible();
});

test("draft run shows an untimed slot, never an invented time", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "draft-run", "&run=fx-run-1");
  await expect(page.locator("[data-draft-slot]")).toBeVisible();
  await expect(page.locator("[data-run-id='fx-run-1']")).toContainText("Times to set");
  await expect(page.locator("[data-run-bar='fx-run-1']")).toHaveCount(0);
});

test("queue filters count and filter work by kind", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "queue-7");
  const queue = page.locator("[data-logistics-planning-queue]");
  await expect(queue.getByRole("heading", { name: "Unassigned work" })).toBeVisible();
  await expect(queue.locator("[data-timeline-queue-id]")).toHaveCount(7);
  await queue.getByRole("button", { name: /^Collections/ }).click();
  await expect(queue.locator("[data-timeline-queue-id]")).toHaveCount(2);
  await queue.getByRole("button", { name: /^Deliveries/ }).click();
  await expect(queue.locator("[data-timeline-queue-id]")).toHaveCount(5);
});

for (const [scenario, text] of [["empty", "No runs for this day yet"], ["error", "Runs could not be loaded"]] as const) {
  test(`${scenario} state is explicit`, async ({ page }) => {
    await page.setViewportSize({ width: 1536, height: 960 });
    await open(page, scenario);
    await expect(page.getByText(text).first()).toBeVisible();
  });
}

test("loading state shows skeletons and no run rows", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "loading");
  await expect(page.locator("[aria-busy=true]").first()).toBeVisible();
  await expect(page.locator("[data-run-row]")).toHaveCount(0);
});

test("busy day (9 runs) retains every run on two van lanes without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "busy");
  await expect(page.locator("[data-run-row]")).toHaveCount(2);
  await expect(page.locator("[data-run-bar]")).toHaveCount(9);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
});

test("preview route performs no API calls", async ({ page }) => {
  const calls: string[] = [];
  page.on("request", (request) => { if (/\/api\//.test(request.url())) calls.push(request.url()); });
  await page.setViewportSize({ width: 1536, height: 960 });
  await open(page, "full-day", "&run=fx-run-1");
  await page.getByRole("button", { name: "New Run", exact: true }).click();
  expect(calls).toEqual([]);
});
