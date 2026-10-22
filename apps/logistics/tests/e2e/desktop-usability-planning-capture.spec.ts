import { expect, test, type Locator, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { FakeLogisticsServer, installStatefulApi, ownerSeed } from "./planner-fake-server";

/** Evidence capture for interactive Run planning (LOCAL fixtures only). Set JOURNEY_SHOT_DIR=<folder>. */
const label = process.env.JOURNEY_SHOT_DIR;
test.skip(!label, "Set JOURNEY_SHOT_DIR to capture evidence");
const DATE = "2026-10-28";
const centre = async (locator: Locator) => { await locator.scrollIntoViewIfNeeded(); const box = (await locator.boundingBox())!; return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; };
const settle = (page: Page) => page.waitForTimeout(350);

for (const viewport of [{ width: 1536, height: 960 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`planning evidence ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(120_000);
    await page.setViewportSize(viewport);
    const directory = path.resolve(process.cwd(), "../../artifacts/logistics-desktop-uat", label!);
    await mkdir(directory, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(directory, `${viewport.width}x${viewport.height}-${name}.png`) });
    const seed = ownerSeed(DATE);
    seed.runs!.push({ id: `run:${DATE}:am`, vehicleId: "van1", status: "planned", dep: "08:00", ret: "11:00" }, { id: `run:${DATE}:pm`, vehicleId: "van2", status: "planned", dep: "09:00", ret: "13:00" });
    seed.jobs![0] = { ...seed.jobs![0], runId: `run:${DATE}:am`, time: "09:00" };
    seed.jobs![1] = { ...seed.jobs![1], runId: `run:${DATE}:am`, time: "08:30" };
    seed.jobs![2] = { ...seed.jobs![2], runId: `run:${DATE}:am`, time: "10:15" };
    const server = new FakeLogisticsServer(seed);
    await installStatefulApi(page, server);
    await page.goto(`/?serviceDate=${DATE}`);
    await expect(page.getByRole("region", { name: "Vehicle journey timeline" })).toBeVisible();
    await page.waitForLoadState("networkidle"); await page.waitForTimeout(500);
    await shot("01-planner");
    // Hover affordance on an empty lane position.
    await page.locator("[data-testid=mounted-timeline-viewport]").evaluate((element) => { element.scrollLeft = 6 * 120; });
    const lane = (await page.locator('[data-vehicle-track="van2"]').boundingBox())!;
    await page.mouse.move(lane.x + 15 * 120, lane.y + lane.height - 10); await settle(page);
    await shot("02-click-to-create-hover");
    // Drag a queue job over the planned run (valid highlight).
    const card = await centre(page.locator('[data-timeline-queue-id="projection-job:job:4"] .mock-queue-main'));
    const block = await centre(page.locator(`[data-journey-run-id="run:${DATE}:am"] button`));
    await page.mouse.move(card.x, card.y); await page.mouse.down(); await page.mouse.move(card.x + 60, card.y - 30, { steps: 4 }); await page.mouse.move(block.x, block.y, { steps: 10 }); await settle(page);
    await shot("03-drag-valid-drop-target");
    await page.mouse.up(); await settle(page);
    // Organise Run panel with an order/time conflict.
    await page.locator(`[data-journey-run-id="run:${DATE}:am"] button`).click(); await settle(page);
    await shot("04-organise-run");
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: /Move .* down/ }).first().click(); await settle(page);
    await shot("05-organise-run-conflict");
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Close inspector" }).click();
    // Delete confirmation on the empty draft.
    await page.locator('[data-untimed-run-id="run:2026-10-28:van-2"]').click();
    await page.getByRole("complementary", { name: "Details inspector" }).getByRole("button", { name: "Delete empty run" }).click(); await settle(page);
    await shot("06-delete-empty-run-confirm");
  });
}
