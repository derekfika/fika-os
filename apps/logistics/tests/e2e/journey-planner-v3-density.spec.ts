import { expect, test, type Page } from "@playwright/test";
import { assignedSeed, boot, centre, commandsOf, DATE, queueItem, runRow } from "./v3-helpers";

/**
 * Phase C: compact density, resizable inspector, Monday–Friday week ribbon and inspection context.
 * LOCAL FIXTURE tests (stateful fake of /api/logistics).
 */
const RUN = `run:${DATE}:a`;
const inspectorOf = (page: Page) => page.getByRole("complementary", { name: "Run inspector" });
const widthOf = async (page: Page) => Math.round((await inspectorOf(page).boundingBox())!.width);
async function openRun(page: Page) { await page.locator(`[data-run-bar="${RUN}"]`).click(); await expect(inspectorOf(page)).toBeVisible(); }

test.describe("Journey Planner V3 · Phase C · 1536x960", () => {
  test.use({ viewport: { width: 1536, height: 960 } });

  test("week ribbon: five equal Monday–Friday cards with real counts; the selected day is clear; no weekend", async ({ page }) => {
    await boot(page, assignedSeed());
    const ribbon = page.getByRole("navigation", { name: "Working week" });
    const days = ribbon.locator("[data-day]");
    await expect(days).toHaveCount(5);
    expect(await days.evaluateAll((items) => items.map((item) => item.getAttribute("data-day")))).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30"]);
    const widths = await days.evaluateAll((items) => items.map((item) => Math.round(item.getBoundingClientRect().width)));
    expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(1);
    await expect(ribbon.getByText(/Sat|Sun/)).toHaveCount(0);
    const selected = ribbon.locator("[data-day='2026-10-28']");
    await expect(selected).toHaveAttribute("aria-pressed", "true");
    await expect(selected).toContainText("2 runs");
    await expect(selected).toContainText("2 unplanned");
    // other days come from the authoritative weekly summary, not the live board
    await expect(ribbon.locator("[data-day='2026-10-27']")).toContainText("0 runs");
  });

  test("week ribbon navigation: choose a day, step to the previous/next working week; header day steps skip weekends", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    const ribbon = page.getByRole("navigation", { name: "Working week" });
    await ribbon.getByRole("button", { name: "Next working week" }).click();
    await expect(ribbon.locator("[data-day]").first()).toHaveAttribute("data-day", "2026-11-02");
    await expect(ribbon.locator("[data-day='2026-11-04']")).toHaveAttribute("aria-pressed", "true");
    await ribbon.getByRole("button", { name: "Previous working week" }).click();
    await ribbon.locator("[data-day='2026-10-30']").click();
    await expect(ribbon.locator("[data-day='2026-10-30']")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Next day" }).click(); // Friday -> Monday, never Saturday
    await expect(ribbon.locator("[data-day='2026-11-02']")).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Previous day" }).click(); // Monday -> Friday
    await expect(ribbon.locator("[data-day='2026-10-30']")).toHaveAttribute("aria-pressed", "true");
    expect(server.commands.filter((command) => !["ensure-vehicle-day-runs"].includes(String(command.action)))).toHaveLength(0);
  });

  test("inspector opens at 360px, resizes by dragging within 320–550px, persists across reload", async ({ page }) => {
    await boot(page, assignedSeed());
    await openRun(page);
    expect(await widthOf(page)).toBe(360);
    const divider = page.getByRole("separator", { name: "Resize inspector" });
    await expect(divider).toHaveAttribute("aria-valuenow", "360");
    const from = await centre(divider);
    await page.mouse.move(from.x, from.y); await page.mouse.down(); await page.mouse.move(from.x - 120, from.y, { steps: 6 }); await page.mouse.up();
    expect(await widthOf(page)).toBeGreaterThanOrEqual(470);
    expect(await widthOf(page)).toBeLessThanOrEqual(490);
    const wide = await centre(divider);
    await page.mouse.move(wide.x, wide.y); await page.mouse.down(); await page.mouse.move(wide.x - 600, wide.y, { steps: 6 }); await page.mouse.up();
    expect(await widthOf(page)).toBe(550);
    await page.mouse.move((await centre(divider)).x, (await centre(divider)).y); await page.mouse.down(); await page.mouse.move(1500, 400, { steps: 6 }); await page.mouse.up();
    expect(await widthOf(page)).toBe(320);
    await page.reload();
    await openRun(page);
    expect(await widthOf(page)).toBe(320);
    // the timeline stays usable at the widest setting
    await divider.focus(); await page.keyboard.press("End");
    expect(await widthOf(page)).toBe(550);
    expect((await page.locator("[data-testid=journey-timeline-scroller]").boundingBox())!.width).toBeGreaterThan(420);
  });

  test("inspector divider is keyboard operable and exposes separator semantics; double-click resets", async ({ page }) => {
    await boot(page, assignedSeed());
    await openRun(page);
    const divider = page.getByRole("separator", { name: "Resize inspector" });
    await divider.focus();
    await page.keyboard.press("ArrowLeft");
    expect(await widthOf(page)).toBe(376);
    await page.keyboard.press("Shift+ArrowLeft");
    expect(await widthOf(page)).toBe(424);
    await page.keyboard.press("ArrowRight");
    expect(await widthOf(page)).toBe(408);
    await page.keyboard.press("Home");
    expect(await widthOf(page)).toBe(320);
    await expect(divider).toHaveAttribute("aria-valuemin", "320");
    await divider.dblclick();
    expect(await widthOf(page)).toBe(360);
  });

  test("the collapsible queue still works with a wide inspector and the timeline never collapses", async ({ page }) => {
    await boot(page, assignedSeed());
    await openRun(page);
    await page.getByRole("separator", { name: "Resize inspector" }).focus();
    await page.keyboard.press("End");
    await page.getByRole("button", { name: "Collapse unassigned work" }).click();
    await expect(page.locator("[data-logistics-planning-queue-rail]")).toBeVisible();
    expect((await page.locator("[data-testid=journey-timeline-scroller]").boundingBox())!.width).toBeGreaterThan(520);
  });

  test("returning work to the queue keeps the Run inspector open and updates its stops; focus stays in the inspector", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Expand Studio Café" }).click();
    await inspector.getByRole("button", { name: "Return Studio Café to the queue" }).click();
    await expect.poll(() => commandsOf(server, "remove-job-from-load").length).toBe(1);
    await expect(inspector).toBeVisible();
    await expect(inspector.getByRole("heading", { name: /Run 1/ })).toBeVisible();
    await expect(inspector.getByRole("list", { name: "Stops in visiting order" }).locator(":scope > li")).toHaveCount(4);
    await expect(queueItem(page, "Studio Café")).toBeVisible();
    await expect.poll(async () => page.evaluate(() => !!document.activeElement && document.activeElement !== document.body && !!document.activeElement.closest("[aria-label='Run inspector']"))).toBe(true);
  });

  test("a selected stop's inspector follows its work to the queue item instead of closing", async ({ page }) => {
    const { server } = await boot(page, assignedSeed());
    await openRun(page);
    const inspector = inspectorOf(page);
    await inspector.getByRole("button", { name: "Expand Studio Café" }).click();
    await inspector.getByRole("button", { name: "View loads" }).click(); // legacy stop inspector
    const panel = page.getByRole("complementary", { name: "Details inspector" });
    await expect(panel).toBeVisible();
    await panel.getByRole("button", { name: "Return to planning queue" }).click();
    await expect.poll(() => commandsOf(server, "remove-job-from-load").length).toBe(1);
    await expect(panel).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Studio Café" })).toBeVisible();
    await expect(panel.getByRole("button", { name: "Assign to vehicle" })).toBeVisible();
  });

  test("compact density: key controls are at least 10% smaller than Phase B and still meet 32px targets", async ({ page }) => {
    await boot(page, assignedSeed());
    const h = async (locator: ReturnType<Page["locator"]>) => Math.round((await locator.first().boundingBox())!.height);
    expect(await h(page.getByRole("button", { name: "New Run", exact: true }))).toBeLessThanOrEqual(42);
    expect(await h(page.getByRole("button", { name: "New Run", exact: true }))).toBeGreaterThanOrEqual(36);
    expect(await h(page.locator("header").first())).toBeLessThanOrEqual(70);
    expect(await h(runRow(page, RUN))).toBeLessThanOrEqual(128);
    expect(await h(page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]"))).toBeLessThanOrEqual(92);
  });
});

test("1280px: toolbar, ribbon and inspector fit without wrapping orphans or horizontal scroll (narrow and wide inspector)", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await boot(page, assignedSeed());
  await openRun(page);
  for (const key of ["Home", "End"]) {
    await page.getByRole("separator", { name: "Resize inspector" }).focus();
    await page.keyboard.press(key);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    const ribbon = await page.getByRole("navigation", { name: "Working week" }).boundingBox();
    expect(ribbon!.x + ribbon!.width).toBeLessThanOrEqual(1280);
    await expect(page.getByRole("navigation", { name: "Working week" }).locator("[data-day]")).toHaveCount(5);
  }
});
