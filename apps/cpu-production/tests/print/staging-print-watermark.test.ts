import assert from "node:assert/strict";
import test from "node:test";
import { chromium } from "playwright";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { allergenMatrixHtml } from "../../app/ui/allergen-matrix";
import { totalsPrintHtml } from "../../app/ui/kitchen-print";
import { paginateDayProduction } from "../../app/ui/day-production-print";
import { paperRunSheetStyles } from "../../app/ui/run-sheet-paper-styles";
import { addStagingPrintWatermark, STAGING_PRINT_WARNING } from "../../lib/staging-print-watermark";
import { publishedAllergenMatrixHtml } from "../../lib/published-allergen-matrix";

const item = (id: number) => ({
  id: `menu:${id}`,
  name: `Synthetic category ${id}`,
  note: "",
  subItems: [{
    id: `sub:${id}`,
    name: `Synthetic dish ${id} with a seasonal description and dressing`,
    quantity: 1,
    allergens: {},
    evidenceStatus: "not_completed" as const,
    note: "",
  }],
});

test("staging table print watermarks use a repeated thead row and production stays unchanged", () => {
  const html = '<!doctype html><html lang="en"><head><title>Fixture</title></head><body><table><thead><tr><th>Dish</th><th>Quantity</th></tr></thead><tbody><tr><td>Fixture</td><td>1</td></tr></tbody></table></body></html>';
  const staging = addStagingPrintWatermark(html, "staging");
  assert.match(staging, /data-fika-runtime="staging"/);
  assert.match(staging, /@media print/);
  assert.match(staging, /display:table-row/);
  assert.match(staging, /<tr class="fika-staging-print-watermark-row"><th colspan="2">STAGING \/ NOT FOR OPERATIONAL USE<\/th><\/tr>/);
  assert.equal(addStagingPrintWatermark(staging, "staging"), staging, "watermark injection is idempotent");
  assert.equal(addStagingPrintWatermark(html, "production"), html);
});

test("CPU allergen and totals producers put a warning into every repeating table header", () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  try {
    process.env.FIKA_RUNTIME_MODE = "staging";
    const matrix = allergenMatrixHtml({ requiredBy: "2026-11-09T12:00:00.000Z" }, [item(1)], []);
    const published = publishedAllergenMatrixHtml({ dayName: "Monday", date: "2026-11-09", version: 1, contentHash: "fixture-hash", entries: [] });
    const totals = totalsPrintHtml([
      { category: "Sandwiches", orderCount: 1, items: [{ key: "sandwich:1", name: "Synthetic sandwich", unit: "portions", quantity: 2, progress: "not_started" }] },
      { category: "Hot mains", orderCount: 1, items: [{ key: "main:1", name: "Synthetic main", unit: "portions", quantity: 3, progress: "not_started" }] },
    ], "Monday 9 November", "Synthetic destination");

    assert.equal((matrix.match(/<tr class="fika-staging-print-watermark-row"/g) || []).length, 2, "matrix and signoff tables are both covered");
    assert.equal((published.match(/<tr class="fika-staging-print-watermark-row"/g) || []).length, 1);
    assert.equal((totals.match(/<tr class="fika-staging-print-watermark-row"/g) || []).length, 2, "each category table is covered");
    for (const html of [matrix, published, totals]) assert.ok(html.includes(STAGING_PRINT_WARNING));

    process.env.FIKA_RUNTIME_MODE = "production";
    assert.doesNotMatch(allergenMatrixHtml({ requiredBy: "2026-11-09T12:00:00.000Z" }, [item(1)], []), /fika-staging-print-watermark-row/);
    assert.doesNotMatch(publishedAllergenMatrixHtml({ dayName: "Monday", date: "2026-11-09", version: 1, contentHash: "fixture-hash", entries: [] }), /fika-staging-print-watermark-row/);
    assert.doesNotMatch(totalsPrintHtml([], "Monday 9 November", "Synthetic destination"), /fika-staging-print-watermark-row/);
  } finally {
    if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = previous;
  }
});

test("run-sheet staging marker is carried into each explicitly generated page", async () => {
  const source = ["A", "B", "C"].map(site => `<article class="collection" data-day="2026-11-09" data-site-key="oploc:${site}" data-site-label="Synthetic ${site}"><h2>Synthetic order ${site}</h2><p>One fixture row.</p></article>`).join("");
  const html = addStagingPrintWatermark(`<!doctype html><html lang="en"><head><meta charset="utf-8"><style>${paperRunSheetStyles}</style></head><body><div id="day-pages" data-layout="full" data-printed-at="2026-11-07 12:00" data-scope="Synthetic"><div id="collection-source">${source}</div></div></body></html>`, "staging");
  assert.match(html, /data-fika-runtime="staging"/);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.addScriptTag({ content: "const __name = (fn) => fn; (" + paginateDayProduction.toString() + ")()" });
    const pages = await page.locator(".print-page").evaluateAll(nodes => nodes.map(node => node.querySelector(".staging-print-warning")?.textContent?.trim()));
    assert.equal(pages.length, 3);
    assert.deepEqual(pages, Array(3).fill(STAGING_PRINT_WARNING));
    const output = path.resolve("test-results/cpu-print/staging-run-sheets.pdf");
    mkdirSync(path.dirname(output), { recursive: true });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: output, format: "A4", printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
});

test("long staging allergen matrices repeat the warning with table continuations", async () => {
  const previous = process.env.FIKA_RUNTIME_MODE;
  process.env.FIKA_RUNTIME_MODE = "staging";
  const html = allergenMatrixHtml({ requiredBy: "2026-11-09T12:00:00.000Z", destinationLabel: "Synthetic staging fixture" }, Array.from({ length: 60 }, (_, index) => item(index)), []);
  if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE;
  else process.env.FIKA_RUNTIME_MODE = previous;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html);
    await page.emulateMedia({ media: "print" });
    const result = await page.evaluate(() => ({
      warningRows: document.querySelectorAll(".fika-staging-print-watermark-row").length,
      warningDisplay: getComputedStyle(document.querySelector(".fika-staging-print-watermark-row")!).display,
      tableHeaderDisplay: getComputedStyle(document.querySelector(".matrix thead")!).display,
    }));
    assert.equal(result.warningRows, 2);
    assert.equal(result.warningDisplay, "table-row");
    assert.equal(result.tableHeaderDisplay, "table-header-group");
    const output = path.resolve("test-results/cpu-print/staging-allergen-matrix.pdf");
    mkdirSync(path.dirname(output), { recursive: true });
    await page.pdf({ path: output, format: "A4", landscape: true, printBackground: true, preferCSSPageSize: true });
  } finally {
    await browser.close();
  }
});

test("TIA print fails closed in staging and remains available in production", async () => {
  const css = readFileSync(new URL("../../app/tia/page.css", import.meta.url), "utf8");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html data-fika-runtime="staging"><head><style>${css}</style></head><body><main class="tia-view"><h1>Operational menu content</h1><p>Fixture quantities</p></main></body></html>`);
    await page.emulateMedia({ media: "print" });
    const staging = await page.evaluate(() => ({ contentDisplay: getComputedStyle(document.querySelector(".tia-view")!).display, notice: getComputedStyle(document.body, "::before").content }));
    assert.equal(staging.contentDisplay, "none");
    assert.match(staging.notice, /STAGING \/ NOT FOR OPERATIONAL USE/);
    assert.match(staging.notice, /printing is disabled in staging/i);
    const pdf = await page.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
    assert.ok(pdf.byteLength > 1000);

    await page.setContent(`<html data-fika-runtime="production"><head><style>${css}</style></head><body><main class="tia-view"><h1>Production menu</h1></main></body></html>`);
    await page.emulateMedia({ media: "print" });
    const productionDisplay = await page.locator(".tia-view").evaluate(node => getComputedStyle(node).display);
    assert.notEqual(productionDisplay, "none");
  } finally {
    await browser.close();
  }
});

test("staging print helpers fail closed on malformed or conflicting documents", () => {
  assert.throws(() => addStagingPrintWatermark("<p>not a document</p>", "staging"), /complete HTML document/);
  assert.throws(() => addStagingPrintWatermark('<html data-fika-runtime="production"><head></head><body></body></html>', "staging"), /conflicting runtime marker/);
});
