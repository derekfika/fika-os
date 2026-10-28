import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";

const baseUrl = process.env.FIKA_CPU_INPUT_TEST_URL;
for (const mobile of [false, true]) test(`${mobile ? "touch phone" : "desktop"}: native input-only date picker events update the real Totals range and preserve ordinary change events`, { skip: !baseUrl }, async () => {
  const target = new URL(baseUrl!);
  assert.ok(["localhost", "127.0.0.1"].includes(target.hostname), "Use only an isolated local CPU server");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ timezoneId: "Europe/London", viewport: mobile ? { width: 390, height: 844 } : { width: 1280, height: 800 }, isMobile: mobile, hasTouch: mobile });
    await page.route("**/api/**", async route => {
      assert.equal(route.request().method(), "GET", "This test must never mutate operational state");
      const url = new URL(route.request().url());
      const week = url.searchParams.get("weekCommencing") || "2026-10-26";
      const orders = Array.from({ length: 7 }, (_, index) => {
        const date = new Date(`${week}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + index);
        const day = date.toISOString().slice(0, 10);
        return { id: `synthetic:${day}`, serviceDate: day, requiredBy: `${day}T12:00:00Z`, serviceWindow: { startTime: "12:00" }, origin: "menu_planning", sourceReference: `synthetic:${day}`, priority: "normal", status: "ready", productionScope: "delivered_in", quantities: [{ sourceLineId: `line:${day}`, name: `Synthetic ${day}`, quantity: 1, unit: "portion", dietaries: {} }], allergenReadiness: "ready", planningReadiness: "ready", attention: [], version: 1 };
      });
      await route.fulfill({ json: { cacheScope: "synthetic-isolated", lastChangeSequence: 1, projection: { serviceDate: week, weekCommencing: week, revision: 1, lastChangeSequence: 1, rebuiltAt: `${week}T12:00:00Z`, summary: { orders: 7, ready: 7, attention: 0, planned: 0, totalUnits: 7 }, orders }, package: { sourceVersion: "cpu-change-1", contentHash: "a".repeat(64) } } });
    });
    await page.goto(baseUrl!);
    await page.getByRole("button", { name: "Totals", exact: true }).last().click();
    await page.getByRole("button", { name: "Choose a custom date range", exact: true }).click();
    const setDate = async (label: string, value: string, eventName: "input" | "change") => {
      await page.getByLabel(label, { exact: true }).evaluate((element, input) => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, input.value);
        element.dispatchEvent(new Event(input.eventName, { bubbles: true }));
      }, { value, eventName });
    };
    const expectRows = async (page: Page, included: string[], excluded: string[]) => {
      await page.waitForFunction(({ included, excluded }) => {
        const text = document.querySelector(".cpu-total-list")?.textContent || "";
        return included.every(value => text.includes(value)) && excluded.every(value => !text.includes(value));
      }, { included, excluded }, { timeout: 10_000 });
    };
    await setDate("From date", "2026-10-26", "input");
    await setDate("To date", "2026-10-27", "input");
    await expectRows(page, ["Synthetic 2026-10-26", "Synthetic 2026-10-27"], ["Synthetic 2026-10-28"]);
    await setDate("From date", "2026-10-27", "change");
    await expectRows(page, ["Synthetic 2026-10-27"], ["Synthetic 2026-10-26"]);
    await setDate("From date", "2026-10-28", "input");
    await page.getByRole("alert").filter({ hasText: "on or before" }).waitFor();
    assert.equal(await page.locator(".cpu-total-list").count(), 0);
  } finally { await browser.close(); }
});
