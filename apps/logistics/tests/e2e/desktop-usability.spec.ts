import { expect, test, type Page } from "@playwright/test";
import { installFixtureApi, OWNER_SCENARIO, REALISTIC_RUNS, TIMED_RUNS, type FixtureOptions } from "./journey-fixtures";

/**
 * Desktop Journey Planner usability UAT.
 *
 * Asserts rendered GEOMETRY, clipping ancestry, scroll regions, focus and dialog
 * containment — not just document-level horizontal overflow — against clearly
 * labelled LOCAL fixtures shaped like the real /api/logistics responses.
 * It never contacts staging or production data.
 */

const DATE = "2026-10-28";
const SCENARIOS: Record<string, FixtureOptions> = {
  empty: { serviceDate: DATE, runs: [], queue: 0, loads: 0 },
  owner: { ...OWNER_SCENARIO, serviceDate: DATE },
  timedNoStops: { serviceDate: DATE, runs: TIMED_RUNS, queue: 5, loads: 0 },
  busy: { serviceDate: DATE, runs: TIMED_RUNS, loads: 36, queue: 5, mixedStop: true },
  stickyProbe: { serviceDate: DATE, runs: TIMED_RUNS, loads: 36, queue: 2, mixedStop: true },
  realistic: { serviceDate: DATE, runs: REALISTIC_RUNS, loads: 14, queue: 7, longLabels: true, mixedStop: true },
};

const BASE_VIEWPORTS = [
  { width: 1920, height: 1080 }, { width: 1536, height: 960 }, { width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 800 },
];
// Browser zoom 125% is equivalent to a CSS viewport 1.25x smaller.
const MATRIX = BASE_VIEWPORTS.flatMap((viewport) => [
  { name: `${viewport.width}x${viewport.height} @100%`, width: viewport.width, height: viewport.height },
  { name: `${viewport.width}x${viewport.height} @125%`, width: Math.round(viewport.width / 1.25), height: Math.round(viewport.height / 1.25) },
]);

import { auditLayout, expectClean, intersects, rect, trackIssues, type Issues } from "./layout-audit";

async function openPlanner(page: Page, scenarioName: keyof typeof SCENARIOS, issues: Issues) {
  const scenario = SCENARIOS[scenarioName];
  await page.unroute("**/api/**").catch(() => undefined);
  const commands = await installFixtureApi(page, (serviceDate) => ({ ...scenario, serviceDate }), issues);
  await page.goto(`/?serviceDate=${DATE}`);
  await expect(page.locator(".mock-selected-day")).toContainText("WEDNESDAY 28 OCTOBER", { ignoreCase: true });
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByLabel("Search unassigned work")).toBeVisible();
  return commands;
}

for (const viewport of MATRIX) {
  test.describe(`desktop usability · ${viewport.name}`, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height } });

    test("empty day and owner-observed state: runs are visible and explained, queue is intact", async ({ page }) => {
      test.setTimeout(90_000);
      const issues = trackIssues(page);
      await openPlanner(page, "empty", issues);
      await expect(page.getByText("No dispatch runs")).toBeVisible();
      expect(await auditLayout(page), "empty day layout").toEqual([]);

      await openPlanner(page, "owner", issues);
      expect(await auditLayout(page), "owner state layout").toEqual([]);
      // Counts agree with what is visibly drawn.
      await expect(page.locator(".mock-selected-day small")).toContainText("2 vans / 4 runs");
      await expect(page.locator(".mock-schedule-head strong")).toContainText("4 runs");
      const viewportBox = await rect(page, "[data-testid=mounted-timeline-viewport]");
      const chips = page.locator("[data-testid=untimed-runs] button");
      await expect(chips).toHaveCount(4);
      for (let index = 0; index < 4; index += 1) {
        const chip = await chips.nth(index).evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }; });
        expect(chip.left, `run chip ${index} left inside timeline viewport`).toBeGreaterThanOrEqual(viewportBox.left);
        expect(chip.right, `run chip ${index} right inside timeline viewport`).toBeLessThanOrEqual(viewportBox.right + 1);
      }
      await expect(page.getByText("No journey times yet").first()).toBeVisible();

      // Queue: filters have real height, every card is reachable by the single list scrollbar.
      const pill = await rect(page, ".mock-filter-pills button");
      expect(pill.height, "filter pill not collapsed").toBeGreaterThanOrEqual(28);
      const cards = page.locator("[data-logistics-planning-queue] article");
      await expect(cards).toHaveCount(5);
      await page.locator(".mock-queue-list").evaluate((element) => { element.scrollTop = element.scrollHeight; });
      const list = await rect(page, ".mock-queue-list");
      const last = await cards.last().evaluate((element) => element.getBoundingClientRect().bottom);
      expect(last).toBeLessThanOrEqual(list.bottom + 1);
      // Only one scrollbar may live inside the queue.
      const queueScrollers = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>("[data-logistics-planning-queue] *")).filter((element) => { const cs = getComputedStyle(element); return (cs.overflowY === "auto" || cs.overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1; }).map((element) => element.className));
      expect(queueScrollers.length, `queue scrollers: ${queueScrollers.join(",")}`).toBeLessThanOrEqual(1);
      expectClean(issues, viewport.name);
    });

    test("Create Run dialog is contained, focus-managed and keyboard operable", async ({ page }) => {
      test.setTimeout(90_000);
      const issues = trackIssues(page);
      const commands = await openPlanner(page, "owner", issues);
      const trigger = page.getByRole("button", { name: /New run/ });
      await trigger.focus();
      await trigger.press("Enter");
      const dialog = page.getByRole("dialog", { name: "Create delivery run" });
      await expect(dialog).toBeVisible();
      await expect(dialog).toBeFocused();
      const box = await rect(page, "[role=dialog]");
      expect(box.left).toBeGreaterThanOrEqual(0); expect(box.top).toBeGreaterThanOrEqual(0);
      expect(box.right).toBeLessThanOrEqual(viewport.width); expect(box.bottom).toBeLessThanOrEqual(viewport.height);
      // Centred in the viewport, not anchored bottom-left over the workspace.
      expect(Math.abs((box.left + box.right) / 2 - viewport.width / 2)).toBeLessThan(2);
      const backdrop = await page.locator(".run-create-backdrop").evaluate((element) => ({ position: getComputedStyle(element).position, background: getComputedStyle(element).backgroundColor }));
      expect(backdrop.position).toBe("fixed");
      expect(backdrop.background).not.toBe("rgba(0, 0, 0, 0)");
      expect(await auditLayout(page), "dialog layout").toEqual([]);
      // Focus is trapped (Tab and Shift+Tab wrap inside the dialog).
      for (let index = 0; index < 6; index += 1) { await page.keyboard.press("Tab"); expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true); }
      for (let index = 0; index < 6; index += 1) { await page.keyboard.press("Shift+Tab"); expect(await page.evaluate(() => Boolean(document.activeElement?.closest("[role=dialog]")))).toBe(true); }
      // Escape closes and returns focus to the invoking control.
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
      // Cancel and backdrop close without writing.
      await trigger.click(); await dialog.getByRole("button", { name: "Cancel" }).click(); await expect(dialog).toHaveCount(0);
      await trigger.click(); await page.locator(".run-create-backdrop").click({ position: { x: 4, y: 4 } }); await expect(dialog).toHaveCount(0);
      expect(commands.filter((command) => command.action === "create-run")).toHaveLength(0);
      // Keyboard submit writes exactly one create-run command.
      await trigger.click();
      await dialog.getByRole("button", { name: "Create run", exact: true }).press("Enter");
      await expect.poll(() => commands.filter((command) => command.action === "create-run").length).toBe(1);
      expectClean(issues, viewport.name);
    });

    test("busy Wednesday: timeline stays usable beside run, stop, load, route sheet and assignment inspectors", async ({ page }) => {
      test.setTimeout(120_000);
      const issues = trackIssues(page);
      await openPlanner(page, "busy", issues);
      expect(await auditLayout(page), "busy day layout").toEqual([]);
      const timeline = page.getByRole("region", { name: "Vehicle journey timeline" });
      await expect(timeline.locator("[data-journey-run-id]")).toHaveCount(4);
      // Fit day makes every journey block fully visible.
      await page.getByRole("button", { name: "Fit day" }).click();
      const viewportBox = await rect(page, "[data-testid=mounted-timeline-viewport]");
      for (const block of await timeline.locator("[data-journey-run-id]").all()) {
        const blockBox = await block.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right }; });
        expect(blockBox.left).toBeGreaterThanOrEqual(viewportBox.left - 1); expect(blockBox.right).toBeLessThanOrEqual(viewportBox.right + 1);
      }
      // Timeline scrollbar is reachable: viewport bottom is on screen once scrolled into view.
      await page.locator("[data-testid=mounted-timeline-viewport]").scrollIntoViewIfNeeded();
      expect((await rect(page, "[data-testid=mounted-timeline-viewport]")).bottom).toBeLessThanOrEqual(viewport.height + 1);

      // Run inspector.
      await timeline.locator("[data-journey-run-id]").first().click();
      const inspector = page.getByRole("complementary", { name: "Details inspector" });
      await expect(inspector.getByText("Run inspector")).toBeVisible();
      expect(await auditLayout(page), "run inspector layout").toEqual([]);
      const inspectorBox = await rect(page, ".mock-inspector");
      expect(inspectorBox.right).toBeLessThanOrEqual(viewport.width + 1);
      for (const selector of [".mock-schedule", ".mock-queue", ".mock-week-nav", ".mock-day-cards", ".mock-selected-day"]) {
        expect(intersects(inspectorBox, await rect(page, selector)), `inspector overlaps ${selector}`).toBe(false);
      }
      expect((await rect(page, "[data-testid=mounted-timeline-viewport]")).width, "timeline usable width beside inspector").toBeGreaterThanOrEqual(480);
      // Inspector scrolls as ONE region (no nested list scrollbar).
      const nested = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".mock-inspector *")).filter((element) => { const cs = getComputedStyle(element); return (cs.overflowY === "auto" || cs.overflowY === "scroll") && element.scrollHeight > element.clientHeight + 1; }).length);
      expect(nested).toBe(0);
      // Every inspector action is reachable by keyboard.
      const unreachable = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".mock-inspector button, .mock-inspector input, .mock-inspector select")).filter((element) => !element.hasAttribute("disabled") && element.getBoundingClientRect().width > 0 && (element.tabIndex < 0)).map((element) => element.outerHTML.slice(0, 60)));
      expect(unreachable).toEqual([]);

      // Route sheet (mixed delivery + collection stop) is a contained dialog with correct focus.
      await inspector.getByRole("button", { name: "View route" }).click();
      const routeSheet = page.locator(".route-sheet[role='dialog']");
      await expect(routeSheet).toBeVisible();
      await expect(routeSheet.getByRole("button", { name: "Close route sheet" })).toBeFocused();
      await expect(page.getByText("Delivery + Collection")).toBeVisible();
      const sheet = await rect(page, ".route-sheet");
      expect(sheet.left).toBeGreaterThanOrEqual(0); expect(sheet.right).toBeLessThanOrEqual(viewport.width); expect(sheet.top).toBeGreaterThanOrEqual(0); expect(sheet.bottom).toBeLessThanOrEqual(viewport.height);
      expect(await auditLayout(page), "route sheet layout").toEqual([]);
      await page.keyboard.press("Escape");
      await expect(routeSheet).toHaveCount(0);
      await expect(inspector).toBeVisible();
      await expect(inspector.getByRole("button", { name: "View route" })).toBeFocused();
      await inspector.getByRole("button", { name: "View route" }).click();
      await routeSheet.getByRole("button", { name: /Load .*jobs/ }).first().click();
      await expect(inspector.getByText("Load inspector")).toBeVisible();
      expect(await auditLayout(page), "load inspector layout").toEqual([]);
      // Escape closes the (non-modal) inspector from inside it.
      await inspector.getByRole("button", { name: "Close inspector" }).focus();
      await page.keyboard.press("Escape");
      await expect(inspector).toHaveCount(0);

      // Assignment form from a queue card.
      await page.locator("[data-logistics-planning-queue] article").first().getByRole("button", { name: "Assign" }).click();
      await expect(inspector.getByLabel("Target delivery run")).toBeVisible();
      expect(await auditLayout(page), "assignment form layout").toEqual([]);
      expectClean(issues, viewport.name);
    });

    test("queue filters and collapse never clip or overlap; real-response-shaped data with long labels", async ({ page }) => {
      test.setTimeout(90_000);
      const issues = trackIssues(page);
      await openPlanner(page, "realistic", issues);
      expect(await auditLayout(page), "realistic layout").toEqual([]);
      await expect(page.locator("[data-logistics-planning-queue] article")).toHaveCount(7);
      // Filter pills and the type filter.
      await page.getByRole("button", { name: /^Unassigned/ }).click();
      await page.getByLabel("Type").selectOption("collection");
      await expect(page.getByText("No work in this queue")).toBeVisible();
      expect(await auditLayout(page), "filtered empty queue").toEqual([]);
      await page.getByLabel("Type").selectOption("all");
      await page.getByLabel("Search unassigned work").fill("Glasshouse");
      expect(await auditLayout(page), "search layout").toEqual([]);
      await page.getByLabel("Search unassigned work").fill("");
      // Collapse: queue becomes a slim rail and the timeline gains the space; then expand.
      const before = await rect(page, "[data-testid=mounted-timeline-viewport]");
      const collapse = page.getByRole("button", { name: "Collapse planning queue" });
      await collapse.click();
      await expect(page.locator(".mock-workspace")).toHaveClass(/queue-collapsed/);
      expect(await auditLayout(page), "collapsed queue layout").toEqual([]);
      const collapsed = await rect(page, "[data-testid=mounted-timeline-viewport]");
      expect(collapsed.width, "timeline gains width when queue collapses").toBeGreaterThanOrEqual(before.width);
      await page.getByRole("button", { name: "Expand planning queue" }).click();
      await expect(page.locator(".mock-workspace")).not.toHaveClass(/queue-collapsed/);
      // Overlapping and draft runs are both drawn and explained.
      await expect(page.locator("[data-journey-run-id]")).toHaveCount(3);
      await expect(page.locator("[data-testid=untimed-runs] button")).toHaveCount(1);
      await expect(page.getByText("Schedule overlap")).toHaveCount(2);
      // The draft-run chip never sits on top of a timed journey block.
      const chip = await page.locator("[data-testid=untimed-runs] button").first().evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; });
      for (const block of await page.locator("[data-journey-run-id]").all()) expect(intersects(chip, await block.evaluate((element) => { const r = element.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; })), "draft chip overlaps a timed block").toBe(false);
      // Open the stop-timing details: lanes appear without breaking layout.
      await page.getByText("Stop timing details").click();
      expect(await auditLayout(page), "stop timing details layout").toEqual([]);
      expectClean(issues, viewport.name);
    });
  });
}

test.describe("short viewport and independent scroll regions", () => {
  test.use({ viewport: { width: 1366, height: 768 } });
  test("queue stays pinned and bounded while a tall timeline scrolls past it; one queue scrollbar; timeline scrollbar reachable", async ({ page }) => {
    test.setTimeout(90_000);
    const issues = trackIssues(page);
    await openPlanner(page, "stickyProbe", issues);
    // Opening the stop-timing lanes makes the timeline column taller than the queue.
    await page.getByText("Stop timing details").click();
    const travel = (await rect(page, ".mock-schedule")).height - (await rect(page, "[data-logistics-planning-queue]")).height;
    expect(travel, "timeline taller than the queue gives the sticky queue room to travel").toBeGreaterThan(100);
    await page.locator("[data-logistics-planning-queue]").evaluate((element) => element.scrollIntoView({ block: "start" }));
    await page.mouse.wheel(0, 90);
    await page.waitForTimeout(200);
    const queue = await rect(page, "[data-logistics-planning-queue]");
    expect(queue.top, "queue pinned at the sticky gap while the page scrolls").toBeGreaterThanOrEqual(11);
    expect(queue.top).toBeLessThanOrEqual(13);
    expect(queue.bottom, "queue bottom within the viewport").toBeLessThanOrEqual(768);
    expect((await rect(page, ".mock-queue-list")).height, "queue list keeps a usable height").toBeGreaterThanOrEqual(96);
    const rootScrolls = await page.evaluate(() => { const root = document.querySelector<HTMLElement>(".real-planner")!; return getComputedStyle(root).overflowY; });
    expect(rootScrolls, "page root must not become a scroll container (breaks sticky)").toBe("visible");
    expect(await auditLayout(page), "short viewport layout").toEqual([]);
    // Timeline viewport is capped so its own scrollbar is reachable on a short screen.
    expect((await rect(page, "[data-testid=mounted-timeline-viewport]")).height).toBeLessThanOrEqual(768 - 200 + 1);
    expectClean(issues, "short viewport");
  });
});

test.describe("functional regression at 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("create several runs per vehicle, select runs/stops, edit times, assign and reschedule loads, navigate dates", async ({ page }) => {
    test.setTimeout(120_000);
    const issues = trackIssues(page);
    const commands = await openPlanner(page, "busy", issues);
    // Multiple runs per vehicle.
    for (const vehicle of ["Van 1", "Van 1", "Van 2"]) {
      await page.getByRole("button", { name: /New run/ }).click();
      await page.getByRole("dialog", { name: "Create delivery run" }).getByLabel("Vehicle").selectOption({ label: vehicle });
      await page.getByRole("dialog", { name: "Create delivery run" }).getByRole("button", { name: "Create run", exact: true }).click();
      await page.waitForTimeout(5);
    }
    await expect.poll(() => commands.filter((command) => command.action === "create-run").length).toBe(3);
    const created = commands.filter((command) => command.action === "create-run").map((command) => (command.run as { vehicleId: string }).vehicleId);
    expect(created).toEqual(["van1", "van1", "van2"]);

    // Select a run, edit planned CPU times.
    const timeline = page.getByRole("region", { name: "Vehicle journey timeline" });
    const firstRunId = await timeline.locator("[data-journey-run-id]").first().getAttribute("data-journey-run-id");
    await timeline.locator("[data-journey-run-id]").first().click();
    const inspector = page.getByRole("complementary", { name: "Details inspector" });
    await inspector.getByLabel("Planned CPU departure").fill("06:45");
    await inspector.getByLabel("Planned CPU return").fill("09:45");
    await inspector.getByRole("button", { name: "Save journey times" }).click();
    await expect.poll(() => commands.some((command) => command.action === "update-run-timing" && command.runId === firstRunId && command.plannedCpuDepartureTime === "06:45")).toBe(true);

    // Select a stop through the route sheet, then an individual load; reschedule it.
    await timeline.locator("[data-journey-run-id]").first().click();
    await inspector.getByRole("button", { name: "View route" }).click();
    await page.locator(".route-sheet[role='dialog']").getByRole("button", { name: /Load .*jobs/ }).first().click();
    const sourceRun = await inspector.getByLabel("Load target run").inputValue();
    await inspector.getByLabel("Load target run").selectOption({ index: 2 });
    await inspector.getByLabel("delivery load time").fill("07:15");
    await inspector.getByRole("button", { name: "Save load assignment" }).click();
    await expect.poll(() => commands.some((command) => command.action === "reschedule-delivery-load" && command.targetRunId !== sourceRun && command.scheduledTime === "07:15")).toBe(true);
    await inspector.getByRole("button", { name: "Close inspector" }).click();

    // Assign an individual queue load.
    await page.locator("[data-logistics-planning-queue] article").first().getByRole("button", { name: "Assign" }).click();
    await inspector.getByLabel("Target delivery run").selectOption({ index: 1 });
    await inspector.getByLabel("Time").fill("08:15");
    await inspector.getByRole("button", { name: "Assign eligible" }).click();
    await expect.poll(() => commands.some((command) => command.action === "assign-job-to-load" && command.scheduledTime === "08:15")).toBe(true);
    await inspector.getByRole("button", { name: "Close inspector" }).click();

    // Date navigation and refresh keep the planner healthy.
    await page.getByRole("button", { name: /Thu 29 Oct/ }).click();
    await expect(page.locator(".mock-selected-day")).toContainText("THURSDAY 29 OCTOBER", { ignoreCase: true });
    await page.getByRole("button", { name: /Refresh/ }).click();
    await expect(page.getByRole("button", { name: /Refresh/ })).toBeEnabled();
    expect(await auditLayout(page), "after functional flow").toEqual([]);
    expectClean(issues, "functional");
  });
});

void TIMED_RUNS;
