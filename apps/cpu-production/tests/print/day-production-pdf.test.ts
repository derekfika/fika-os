import test from "node:test";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  dayProductionPrintHtml,
  paginateDayProduction,
  runSheetProductionPrintHtml,
} from "../../app/ui/day-production-print";
import type { ProductionOrder } from "../../lib/production-types";
const day = "2026-10-23";
const collection = (id: string, rows: number, long = false) =>
  ({
    canonicalId: id,
    version: 1,
    status: "planned",
    serviceDate: day,
    requiredBy: day + "T11:00:00Z",
    serviceWindow: { startTime: "12:00" },
    destinationLabel: "Site " + id,
    sourcePublicationDayId: "publication:" + id,
    lines: Array.from({ length: rows }, (_, i) => ({
      canonicalId: id + ":line:" + i,
      itemName:
        `${id} dish ${i + 1}` +
        (long
          ? " · Roasted seasonal vegetables with heritage tomatoes, toasted seeds and a separately packed herb dressing"
          : ""),
      customerQuantity: i + 1,
      customerUnit: "portions",
    })),
  }) as ProductionOrder;
const cases = [
  { name: "single", orders: [collection("single", 3)], pages: 1 },
  {
    name: "four-small",
    orders: [1, 2, 3, 4].map((i) => collection("small" + i, 3)),
    pages: 4,
  },
  {
    name: "two-medium",
    orders: [collection("medium1", 5, true), collection("medium2", 5, true)],
    pages: 2,
  },
  { name: "one-large", orders: [collection("large", 20)], pages: 2 },
  {
    name: "oversized",
    orders: [collection("huge", 100, true)],
    pages: undefined,
  },
  {
    name: "mixed-long",
    orders: [
      collection("a", 3),
      collection("b", 9, true),
      collection("c", 20),
      collection("d", 3, true),
    ],
    pages: undefined,
  },
];
for (const scenario of cases)
  test(`Chromium A4 PDF: ${scenario.name}`, async () => {
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.emulateMedia({ media: "screen" });
      await page.setContent(dayProductionPrintHtml(scenario.orders, day));
      await page.addScriptTag({
        content:
          "const __name = (fn) => fn; (" +
          paginateDayProduction.toString() +
          ")()",
      });
      const result = await page.evaluate(() => {
        const pages = Array.from(
          document.querySelectorAll<HTMLElement>(".print-page"),
        );
        const output = document.getElementById("day-pages")!;
        const cards = Array.from(
          output.querySelectorAll<HTMLElement>(".collection"),
        );
        const overflow = cards
          .filter((card) => {
            const p = card.closest(".page-cards")!.getBoundingClientRect(),
              r = card.getBoundingClientRect();
            return r.bottom > p.bottom + 0.5 || r.right > p.right + 0.5;
          })
          .map((c) => c.dataset.collectionId);
        const overlaps = cards.some((a, i) =>
          cards.slice(i + 1).some((b) => {
            const x = a.getBoundingClientRect(),
              y = b.getBoundingClientRect();
            return (
              x.left < y.right - 0.5 &&
              x.right > y.left + 0.5 &&
              x.top < y.bottom - 0.5 &&
              x.bottom > y.top + 0.5
            );
          }),
        );
        return {
          pages: pages.length,
          starts: Array.from(
            output.querySelectorAll<HTMLElement>("[data-collection-start]"),
          ).map((e) => e.dataset.collectionId),
          lines: Array.from(
            output.querySelectorAll<HTMLElement>("tbody tr"),
          ).map((e) => e.dataset.lineId),
          overflow,
          overlaps,
          empty: pages.some((p) => !p.querySelector(".collection")),
          continuations: output.querySelectorAll(".continuation").length,
        };
      });
      assert.equal(result.empty, false);
      assert.deepEqual(result.overflow, []);
      assert.equal(result.overlaps, false);
      assert.deepEqual(
        result.starts.sort(),
        scenario.orders.map((o) => o.canonicalId).sort(),
      );
      assert.deepEqual(
        result.lines.sort(),
        scenario.orders
          .flatMap((o) => o.lines.map((l) => l.canonicalId))
          .sort(),
      );
      assert.equal(new Set(result.lines).size, result.lines.length);
      if (scenario.pages) assert.equal(result.pages, scenario.pages);
      else if (scenario.name === "oversized") {
        assert.ok(result.pages > 1);
        assert.equal(result.continuations, result.pages);
      }
      const output = path.resolve(
        process.env.CPU_PRINT_EVIDENCE_DIR || "test-results/cpu-print",
      );
      mkdirSync(output, { recursive: true });
      await page.emulateMedia({ media: "print" });
      await page.pdf({
        path: path.join(output, scenario.name + ".pdf"),
        format: "A4",
        preferCSSPageSize: true,
        printBackground: false,
      });
      await page.screenshot({
        path: path.join(output, scenario.name + ".png"),
        fullPage: true,
      });
      writeFileSync(
        path.join(output, scenario.name + ".json"),
        JSON.stringify(result, null, 2),
      );
    } finally {
      await browser.close();
    }
  });

test("Chromium A4 print keeps every site/date group separate and labels continuation pages", async () => {
  const day2 = "2026-10-24";
  const withDestination = (id: string, count: number, dayValue: string, siteId: string) => ({
    ...collection(id, count, true),
    serviceDate: dayValue,
    destinationOplocId: siteId,
    destinationLabel: "Same display name",
  }) as ProductionOrder;
  const aLong = withDestination("a-long", 100, day, "oploc:a");
  const aSecond = withDestination("a-second", 3, day, "oploc:a");
  const b = withDestination("b", 12, day, "oploc:b");
  const aTomorrow = withDestination("a-tomorrow", 3, day2, "oploc:a");
  const ordersByDay = new Map([[day, [aLong, aSecond, b]], [day2, [aTomorrow]]]);
  const html = runSheetProductionPrintHtml(ordersByDay, [day, day2], ["oploc:oploc:a", "oploc:oploc:b"], new Date("2026-10-23T12:00:00Z"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "screen" });
    await page.setContent(html);
    await page.addScriptTag({ content: "const __name = (fn) => fn; (" + paginateDayProduction.toString() + ")()" });
    const result = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".print-page")).map((sheet) => ({
      siteKey: sheet.dataset.siteKey,
      day: sheet.dataset.day,
      title: sheet.querySelector("h1")?.textContent,
      scope: sheet.querySelector(".page-scope")?.textContent,
      warning: sheet.querySelector(".print-warning")?.textContent,
      handover: sheet.querySelector(".handover")?.textContent,
      cards: Array.from(sheet.querySelectorAll<HTMLElement>(".collection")).map((card) => ({ siteKey: card.dataset.siteKey, day: card.dataset.day, id: card.dataset.collectionId })),
      overflow: Array.from(sheet.querySelectorAll<HTMLElement>(".collection")).some((card) => card.getBoundingClientRect().bottom > sheet.querySelector(".page-cards")!.getBoundingClientRect().bottom + 0.5),
    })));
    assert.ok(result.length >= 4, "large Site A/date must continue on additional pages");
    assert.deepEqual(
      new Set(result.map((sheet) => JSON.stringify([sheet.siteKey, sheet.day]))),
      new Set([["oploc:oploc:a", day], ["oploc:oploc:b", day], ["oploc:oploc:a", day2]].map((entry) => JSON.stringify(entry))),
    );
    assert.ok(result.every((sheet) => sheet.cards.length > 0 && sheet.cards.every((card) => card.siteKey === sheet.siteKey && card.day === sheet.day)));
    assert.ok(result.every((sheet) => sheet.title?.includes(sheet.day!)));
    assert.ok(result.every((sheet) => sheet.scope?.includes("Printed 23 Oct 2026")));
    assert.ok(result.every((sheet) => sheet.warning?.includes("Paper-only checkboxes")));
    assert.ok(result.every((sheet) => ["Packed by:", "Checked by:", "Driver / collected by:", "Departure time:", "Delivered time:", "Received by / signature:", "Notes / issues:"].every((field) => sheet.handover?.includes(field))));
    assert.ok(result.every((sheet) => !sheet.overflow));
    assert.ok(result.some((sheet) => sheet.siteKey === "oploc:oploc:a" && sheet.day === day && sheet.scope?.includes("Continuation")));
    const artifacts = path.resolve(process.env.CPU_PRINT_EVIDENCE_DIR || "test-results/cpu-print");
    mkdirSync(artifacts, { recursive: true });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: path.join(artifacts, "site-date-continuations.pdf"), format: "A4", preferCSSPageSize: true, printBackground: false });
    await page.screenshot({ path: path.join(artifacts, "site-date-continuations.png"), fullPage: true });
    writeFileSync(path.join(artifacts, "site-date-continuations.json"), JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
});
