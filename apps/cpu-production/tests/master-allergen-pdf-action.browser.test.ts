import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.FIKA_CPU_MASTER_PDF_TEST_URL;
for (const width of [820, 1280]) test(`master PDF follows the checker date without stale links at ${width}px`, { skip: !baseUrl }, async () => {
  assert.ok(["localhost", "127.0.0.1"].includes(new URL(baseUrl!).hostname), "Use an isolated local CPU server only");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, timezoneId: "America/Los_Angeles" });
    const signed = new Set(["2026-11-13", "2026-12-31", "2027-01-01", "2026-03-29", "2026-10-25"]);
    let releaseDelayed: () => void = () => {};
    let delayedStarted: () => void = () => {};
    let wrongDate = false;
    await page.route("**/api/**", async route => {
      assert.equal(route.request().method(), "GET", "Opening the checker and PDFs must not write production state");
      const url = new URL(route.request().url());
      const date = url.searchParams.get("serviceDate") || "2026-11-13";
      if (url.pathname === "/api/signed-allergen-pdf") {
        if (date === "2026-11-12") {
          delayedStarted();
          await new Promise<void>(resolve => { releaseDelayed = resolve; });
        }
        if (!signed.has(date) && date !== "2026-11-12") return route.fulfill({ status: 409, json: { error: { message: "Master requires current signatures." } } });
        const responseDate = wrongDate ? "2026-11-13" : date;
        return route.fulfill({ json: { state: "ready", serviceDate: responseDate, url: `/api/signed-allergen-pdf?document=master&serviceDate=${responseDate}&download=pdf` } });
      }
      return route.fulfill({ json: { cacheScope: "isolated-master-pdf-test", lastChangeSequence: 1, projection: { serviceDate: date, revision: 1, lastChangeSequence: 1, rebuiltAt: `${date}T12:00:00Z`, summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 }, orders: [] }, package: { packageVersion: 1, sourceVersion: "test-1", contentHash: "a".repeat(64) } } });
    });
    await page.goto(new URL("/allergens?date=2026-11-13", baseUrl!).href);
    const action = page.getByRole("link", { name: /^View \/ Print Master Allergens/ });
    const dateInput = page.getByLabel("Date", { exact: true });
    await action.waitFor();
    assert.equal(await action.innerText(), "View / Print Master Allergens — Friday, 13 November 2026");
    assert.equal(await action.getAttribute("target"), "_blank");
    assert.equal(await action.evaluate(element => element.getBoundingClientRect().height >= 44), true);
    const selectDate = async (date: string) => {
      await dateInput.waitFor({ state: "visible" });
      await page.waitForFunction(() => !(document.querySelector('input[type="date"]') as HTMLInputElement)?.disabled);
      await dateInput.fill(date);
    };
    await selectDate("2026-11-14");
    await page.getByRole("status").filter({ hasText: "Master allergens unavailable / pending for Saturday, 14 November 2026" }).waitFor();
    assert.equal(await action.count(), 0, "unsigned days must not retain a previous signed PDF");
    const delayed = new Promise<void>(resolve => { delayedStarted = resolve; });
    await selectDate("2026-11-12");
    await delayed;
    await selectDate("2026-11-13");
    await action.waitFor();
    releaseDelayed();
    for (const [date, label] of [["2026-12-31", "Thursday, 31 December 2026"], ["2027-01-01", "Friday, 1 January 2027"], ["2026-03-29", "Sunday, 29 March 2026"], ["2026-10-25", "Sunday, 25 October 2026"]]) {
      await selectDate(date);
      await page.getByRole("link", { name: `View / Print Master Allergens — ${label}`, exact: true }).waitFor();
      assert.equal(await action.getAttribute("href"), `/api/signed-allergen-pdf?document=master&serviceDate=${date}&download=pdf`);
    }
    wrongDate = true;
    await selectDate("2027-01-01");
    await page.getByRole("status").filter({ hasText: "Master allergens unavailable / pending for Friday, 1 January 2027" }).waitFor();
    assert.equal(await action.count(), 0, "a mismatched ready response must remain unavailable");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.goto(baseUrl!);
    await page.getByRole("heading", { name: "Production week", exact: true }).waitFor();
    assert.equal(await page.getByRole("link", { name: /View \/ Print Master/ }).count(), 0, "the Production Week duplicate is removed");
  } finally { await browser.close(); }
});
