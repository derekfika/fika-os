import { expect, type Locator, type Page } from "@playwright/test";
import { FakeLogisticsServer, installStatefulApi, ownerSeed, type FakeOptions } from "./planner-fake-server";
import { trackIssues } from "./layout-audit";

/** Shared helpers for the Journey Planner V3 browser suites (mounted real planner). */
export const DATE = "2026-10-28";

/** Seed: job 2 states a requested time (placed directly); the others need Franco to choose a time. */
export function v3Seed(): FakeOptions {
  const seed = ownerSeed(DATE);
  seed.jobs = seed.jobs!.map((job) => job.id === "job:2" ? { ...job, requestedStart: "10:00" } : job);
  return seed;
}

/** One planned Van 1 run with three placed deliveries, one empty Van 2 draft, a queue job and a collection waiting. */
export function assignedSeed(): FakeOptions {
  const runId = `run:${DATE}:a`;
  const seed = ownerSeed(DATE);
  seed.runs = [{ id: runId, vehicleId: "van1", status: "planned", dep: "08:00", ret: "12:00" }, { id: `run:${DATE}:b`, vehicleId: "van2", status: "draft" }];
  seed.jobs = [
    { id: "job:1", destination: "Market Hall", oploc: "site:1", what: "Hot lunch trays", quantity: 8, unit: "trays", runId, time: "09:00" },
    { id: "job:2", destination: "Studio Café", oploc: "site:2", what: "Sandwich platters", quantity: 9, unit: "trays", runId, time: "10:00" },
    { id: "job:3", destination: "Harbour House", oploc: "site:3", what: "Breakfast boxes", quantity: 12, unit: "boxes", runId, time: "11:00" },
    { id: "job:4", destination: "North Kitchen", oploc: "site:4", what: "Pastry boxes", quantity: 6, unit: "boxes", requestedStart: "13:00" },
  ];
  return seed;
}

export async function boot(page: Page, seed: FakeOptions = v3Seed(), query = "") {
  const issues = trackIssues(page);
  const server = new FakeLogisticsServer(seed);
  await installStatefulApi(page, server, issues);
  await page.goto(`/?serviceDate=${DATE}${query}`);
  await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(400);
  return { server, issues };
}

export const settle = (page: Page) => page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
export const centre = async (locator: Locator) => { await locator.scrollIntoViewIfNeeded(); await settle(locator.page()); const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold?: () => Promise<void>) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + (to.x - from.x) * 0.3, from.y + (to.y - from.y) * 0.3, { steps: 4 });
  await page.mouse.move(to.x, to.y, { steps: 8 });
  if (hold) await hold();
  await page.mouse.up();
}

/** Screen x of a clock minute inside the timeline track, given the live scale and scroll position. */
export async function timeToX(page: Page, minute: number) {
  return page.evaluate((target) => {
    const scroller = document.querySelector<HTMLElement>("[data-testid=journey-timeline-scroller]")!;
    const section = scroller.closest("section")!;
    const ph = parseFloat(getComputedStyle(section).getPropertyValue("--ph"));
    const label = parseFloat(getComputedStyle(section).getPropertyValue("--label-w"));
    return scroller.getBoundingClientRect().left + label - scroller.scrollLeft + (target / 60) * ph;
  }, minute);
}
export const pxPerMinute = (page: Page) => page.evaluate(() => { const section = document.querySelector("[data-testid=journey-timeline-scroller]")!.closest("section")!; return parseFloat(getComputedStyle(section).getPropertyValue("--ph")) / 60; });

export const queueItem = (page: Page, text: string) => page.locator("[data-logistics-planning-queue] [data-timeline-queue-id]", { hasText: text }).first();
export const runRow = (page: Page, runId: string) => page.locator(`[data-run-id="${runId}"]`);
export const commandsOf = (server: FakeLogisticsServer, action: string) => server.commands.filter((command) => command.action === action) as Record<string, any>[];

export async function createRunViaDialog(page: Page, server: FakeLogisticsServer, vehicle: "Van 1" | "Van 2", times?: { departure: string; return: string }) {
  const before = server.state.runs.length;
  await page.getByRole("button", { name: "New Run", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "New Run" });
  await dialog.locator("label", { hasText: vehicle }).click();
  await expect(dialog.getByRole("radio", { name: vehicle })).toBeChecked();
  if (times) { await dialog.getByLabel("Planned CPU departure").fill(times.departure); await dialog.getByLabel("Planned CPU return").fill(times.return); }
  await dialog.getByRole("button", { name: "Create Run" }).click();
  await expect.poll(() => server.state.runs.length).toBe(before + 1);
  return server.state.runs.at(-1)!;
}
