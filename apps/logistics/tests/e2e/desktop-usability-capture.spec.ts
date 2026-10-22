import { test, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { installFixtureApi, OWNER_SCENARIO, TIMED_RUNS, type FixtureOptions } from "./journey-fixtures";

/**
 * Evidence capture (not an assertion suite). Set JOURNEY_SHOT_DIR=before|after.
 * Uses clearly labelled LOCAL fixtures only; never contacts staging.
 */
const label = process.env.JOURNEY_SHOT_DIR;
const BUSY: FixtureOptions = { serviceDate: "2026-10-28", runs: TIMED_RUNS, loads: 36, queue: 5, mixedStop: true };

async function open(page: Page, scenario: FixtureOptions) {
  await installFixtureApi(page, (serviceDate) => ({ ...scenario, serviceDate }));
  await page.goto("/");
  await page.getByRole("button", { name: "Next week" }).click();
  await page.getByRole("button", { name: /Wed 28 Oct/ }).click();
  await page.getByRole("region", { name: "Vehicle journey timeline" }).waitFor({ timeout: 20_000 });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(400);
}

test.skip(!label, "Set JOURNEY_SHOT_DIR=before|after to capture evidence");

for (const viewport of [{ width: 1536, height: 960 }, { width: 1280, height: 800 }, { width: 1920, height: 1080 }]) {
  test(`capture ${viewport.width}x${viewport.height}`, async ({ page }) => {
    test.setTimeout(90_000);
    const directory = path.resolve(process.cwd(), "../../artifacts/logistics-desktop-uat", label!);
    await mkdir(directory, { recursive: true });
    const shot = (name: string) => page.screenshot({ path: path.join(directory, `${viewport.width}x${viewport.height}-${name}.png`) });
    await page.setViewportSize(viewport);
    await open(page, OWNER_SCENARIO);
    await shot("owner-state");
    await page.getByRole("button", { name: /New run/ }).click();
    await page.waitForTimeout(300);
    await shot("owner-create-run-open");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Details" }).first().click();
    await page.waitForTimeout(300);
    await shot("owner-queue-inspector");
    await page.evaluate(() => window.localStorage.clear());
    await open(page, BUSY);
    await shot("busy-wednesday");
    await page.locator("[data-journey-run-id]").first().click();
    await page.waitForTimeout(300);
    await shot("busy-run-inspector");
  });
}
