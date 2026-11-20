import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { gastroLabelsPrintHtml } from "../../app/ui/gastro-label-print";

test("DIS003 label output renders as a real one-page A4 PDF with label-size geometry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const html = gastroLabelsPrintHtml([
      { id: "dish:wrap", name: "A wrapping dish name with a longer description for the label", sortOrder: 1, quantity: 1, date: "2026-11-23" },
    ], 1);
    await page.setContent(html, { waitUntil: "load" });
    const geometry = await page.locator(".label").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    assert.ok(Math.abs(geometry.width - (95 * 96) / 25.4) < 1);
    assert.ok(Math.abs(geometry.height - (62 * 96) / 25.4) < 1);
    const pdf = await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true, scale: 1 });
    const header = Buffer.from(pdf).toString("ascii", 0, 5);
    assert.equal(header, "%PDF-");
    const pdfText = Buffer.from(pdf).toString("latin1");
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 1, "one label should occupy one A4 sheet");
  } finally {
    await browser.close();
  }
});
