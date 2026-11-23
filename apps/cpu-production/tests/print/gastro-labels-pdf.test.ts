import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { gastroLabelsPrintHtml } from "../../app/ui/gastro-label-print";

test("DIS003 label output renders as a real one-page A4 PDF with label-size geometry", async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const name = "A wrapping dish name with a longer description for the label";
    const html = gastroLabelsPrintHtml([
      { id: "dish:wrap", name, sortOrder: 1, quantity: 1, date: "2026-11-23" },
    ], 1, { "dish:wrap": { fontSizePt: 18, lineCount: 2, fits: true } });
    await page.setContent(html, { waitUntil: "load" });
    const geometry = await page.locator(".label").evaluate((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    });
    assert.ok(Math.abs(geometry.width - (95 * 96) / 25.4) < 1);
    assert.ok(Math.abs(geometry.height - (62 * 96) / 25.4) < 1);
    const titleLayout = await page.locator(".label h2").evaluate((element) => {
      const title = element as HTMLElement;
      return { clientHeight: title.clientHeight, scrollHeight: title.scrollHeight, text: title.textContent };
    });
    assert.equal(titleLayout.text, name);
    assert.ok(titleLayout.scrollHeight <= titleLayout.clientHeight, "dish name should fit without clipping");
    assert.match(html, /SITE:<\/strong> <span><\/span>/);
    assert.match(html, /23 November 2026/);
    const pdf = await page.pdf({ format: "A4", printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true, scale: 1 });
    const header = Buffer.from(pdf).toString("ascii", 0, 5);
    assert.equal(header, "%PDF-");
    const pdfText = Buffer.from(pdf).toString("latin1");
    assert.equal((pdfText.match(/\/Type\s*\/Page\b/g) || []).length, 1, "one label should occupy one A4 sheet");
  } finally {
    await browser.close();
  }
});
