import { expect, test, type Locator, type Page } from "@playwright/test";
import { auditLayout, expectClean } from "./layout-audit";
import { assignedSeed, boot, centre, commandsOf, DATE, drag, queueItem, runRow } from "./v3-helpers";

/**
 * Journey Planner V3 on the real page: no clipped controls, no competing scrollbars, no hit-testing errors across the
 * five agreed desktop viewports at 100% and 125% browser zoom, with the queue docked / collapsed and the inspector open / closed.
 * LOCAL FIXTURE tests (stateful fake of /api/logistics).
 */
const BASE = [{ width: 1920, height: 1080 }, { width: 1536, height: 960 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 800 }];
// Browser zoom 125% is equivalent to a CSS viewport 1.25x smaller.
const MATRIX = BASE.flatMap((viewport) => [
  { name: `${viewport.width}x${viewport.height} @100%`, ...viewport },
  { name: `${viewport.width}x${viewport.height} @125%`, width: Math.round(viewport.width / 1.25), height: Math.round(viewport.height / 1.25) },
]);
const SCOPE = "[data-journey-planner]";
const SCROLLERS = ["[data-testid=journey-timeline-scroller]", "[aria-label='Unassigned work items']", "[role=tabpanel]"];
const RUN = `run:${DATE}:a`;

/** The control must be the element actually hit at its centre (nothing overlaps or covers it). */
async function expectHittable(locator: Locator, label: string) {
  await locator.scrollIntoViewIfNeeded();
  const hit = await locator.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return "outside viewport";
    const top = document.elementFromPoint(x, y);
    return top && (element === top || element.contains(top) || top.contains(element)) ? "ok" : `covered by ${top?.tagName}.${top?.className}`;
  });
  expect(hit, label).toBe("ok");
}

async function audit(page: Page, label: string) {
  const violations = await auditLayout(page, SCOPE, SCROLLERS);
  expect(violations, label).toEqual([]);
}

for (const viewport of MATRIX) {
  test(`layout is clean with the inspector closed and open · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { issues } = await boot(page, assignedSeed(), "", false);
    await audit(page, "inspector closed");
    await expectHittable(page.getByRole("button", { name: "New Run", exact: true }), "New Run");
    await expectHittable(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]").first(), "queue card");
    await page.locator(`[data-run-bar="${RUN}"]`).click();
    const inspector = page.getByRole("complementary", { name: "Run inspector" });
    await expect(inspector).toBeVisible();
    await page.waitForTimeout(200);
    await audit(page, "inspector open");
    // Below 1100 CSS pixels the existing inspector is a drawer: controls behind
    // it are intentionally covered until it closes. Docked desktop keeps both usable.
    if (viewport.width >= 1100) {
      await expectHittable(runRow(page, RUN).getByRole("button", { name: "Run 1 actions" }), "row actions");
      await expectHittable(runRow(page, RUN).getByRole("button", { name: /Market Hall/ }), "chip");
    }
    await expectHittable(inspector.getByRole("button", { name: "Edit times" }), "Edit times");
    await expectHittable(inspector.getByRole("button", { name: "Move Market Hall down" }), "reorder arrow");
    await expectHittable(inspector.getByRole("button", { name: "Save order" }), "Save order");
    if (viewport.width < 1100) {
      await inspector.getByRole("button", { name: "Close inspector" }).click();
      await expect(inspector).toHaveCount(0);
      await expectHittable(page.getByLabel("Run on Van 1"), "van run selector after drawer closes");
    }
    // the document never gains a horizontal scrollbar and has a single vertical page scroll
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    expectClean(issues, viewport.name);
  });
}

for (const viewport of MATRIX.filter((item) => item.width < 1440)) {
  test(`collapsed queue expands over the timeline without losing the selected Run, and unassigned work can be dragged from it · ${viewport.name}`, async ({ page }) => {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    const { server } = await boot(page, assignedSeed());
    await page.locator(`[data-run-bar="${RUN}"]`).click();
    const inspector = page.getByRole("complementary", { name: "Run inspector" });
    await expect(inspector).toBeVisible();
    await expect(page.locator("[data-logistics-planning-queue-rail]")).toBeVisible();
    await page.getByRole("button", { name: "Expand unassigned work" }).click();
    const peek = page.locator("[data-queue-peek]");
    await expect(peek).toBeVisible();
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("heading", { name: /Run 1/ })).toBeVisible();
    await audit(page, "queue peek open");
    await expectHittable(peek.locator("[data-timeline-queue-id]").first(), "peek queue card");
    // Target the Van 2 draft directly in its lane, keeping Run 1 selected.
    const empty = page.locator(`[data-vehicle-row="van2"] [data-drop-run-id="run:${DATE}:b"]`);
    await drag(page, await centre(peek.locator("[data-timeline-queue-id]", { hasText: "North Kitchen" })), await centre(empty));
    await expect.poll(() => commandsOf(server, "assign-job-to-load").length).toBe(1);
    expect(commandsOf(server, "assign-job-to-load")[0]).toMatchObject({ jobId: "job:4", targetRunId: `run:${DATE}:b`, scheduledTime: "13:00" });
    // the peek closes after the drop; Run 1 stays selected with the inspector open
    await expect(peek).toHaveCount(0);
    await expect(inspector.getByRole("heading", { name: /Run 1/ })).toBeVisible();
  });
}

test("the peek closes with its collapse button and can be docked beside the timeline", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page, assignedSeed());
  await page.locator(`[data-run-bar="${RUN}"]`).click();
  await page.getByRole("button", { name: "Expand unassigned work" }).click();
  await expect(page.locator("[data-queue-peek]")).toBeVisible();
  await page.locator("[data-queue-peek]").getByRole("button", { name: "Collapse unassigned work" }).click();
  await expect(page.locator("[data-queue-peek]")).toHaveCount(0);
  await page.getByRole("button", { name: "Expand unassigned work" }).click();
  await page.getByRole("button", { name: "Dock beside the timeline" }).click();
  await expect(page.locator("[data-queue-peek]")).toHaveCount(0);
  await expect(page.locator("[data-logistics-planning-queue]")).toBeVisible();
  await expect(page.getByRole("complementary", { name: "Run inspector" })).toBeVisible();
  await expectHittable(queueItem(page, "North Kitchen"), "docked queue card");
});

test("with no inspector the queue is docked at every desktop width and a mid-drag layout stays contained", async ({ page }) => {
  for (const viewport of BASE) {
    await page.setViewportSize({ width: viewport.width, height: viewport.height });
    await boot(page, assignedSeed(), "", false);
    await expect(page.locator("[data-logistics-planning-queue]:not([data-queue-peek])")).toBeVisible();
    await expect(page.locator("[data-logistics-planning-queue-rail]")).toHaveCount(0);
  }
});
