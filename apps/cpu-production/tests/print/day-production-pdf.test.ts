import test from "node:test";
import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  collectionPrintHtml,
  dayProductionPrintHtml,
  paginateDayProduction,
  runSheetProductionPrintHtml,
} from "../../app/ui/day-production-print";
import { CANONICAL_MENU_SLOTS } from "../../../shared/menu-section-order";
import type { ProductionOrder } from "../../lib/production-types";
const day = "2026-10-23";
const tokens = readFileSync(new URL("../../../../shared/fika/tokens.css", import.meta.url), "utf8");

async function preparePrint(page: Page, html: string) {
  await page.route("https://run-sheet.test/**", route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/") return route.fulfill({ contentType: "text/html", body: html });
    if (url.pathname.startsWith("/fonts/")) return route.fulfill({ path: path.resolve("public", url.pathname.slice(1)) });
    return route.abort();
  });
  await page.goto("https://run-sheet.test/");
  await page.addStyleTag({ content: tokens });
  await page.evaluate(async () => { await document.fonts.ready; });
  await page.addScriptTag({ content: "const __name = (fn) => fn; (" + paginateDayProduction.toString() + ")()" });
}

const pdfOptions = { format: "A4", preferCSSPageSize: true, printBackground: true, displayHeaderFooter: true } as const;
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
const hospitality = (id: number): ProductionOrder => ({
  ...collection(`hospitality-${id}`, 2, true),
  origin: "hospitality_booking",
  sourceBookingId: `BK-100${id}`,
  destinationOplocId: "oploc:fixture",
  destinationLabel: "FIKA Xchange · Synthetic",
  clientName: `Test Client ${id}`,
  bookingNotes: `Event: Team briefing ${id}`,
  serviceType: "Working lunch",
  lines: collection(`hospitality-${id}`, 2, true).lines.map(line => ({ ...line, customerUnit: "tray" })),
});
const cases = [
  { name: "hospitality-same-site", orders: [hospitality(1), hospitality(2)], pages: 1 },
  { name: "grab-and-go", orders: [{ ...collection("grab", 2), origin: "grab_and_go" as const, serviceType: "Grab & Go", requiresDelivery: false }], pages: 1 },
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
      await preparePrint(page, dayProductionPrintHtml(scenario.orders, day));
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
            output.querySelectorAll<HTMLElement>("tbody tr[data-line-id]"),
          ).map((e) => e.dataset.lineId),
          overflow,
          overlaps,
          empty: pages.some((p) => !p.querySelector(".collection")),
          continuations: output.querySelectorAll(".continuation").length,
          handovers: output.querySelectorAll(".handover").length,
          headingsKeepRows: Array.from(output.querySelectorAll(".menu-section-row")).every(row => row.nextElementSibling?.hasAttribute("data-line-id")),
          text: output.innerText,
        };
      });
      assert.equal(result.empty, false);
      assert.equal(result.handovers, scenario.orders.length);
      assert.equal(result.headingsKeepRows, true);
      if (scenario.name === "hospitality-same-site") {
        assert.match(result.text, /Test Client 1 · Team briefing 1/);
        assert.match(result.text, /Test Client 2 · Team briefing 2/);
        assert.match(result.text, /BK-1001/);
        assert.match(result.text, /1 tray/);
      }
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
        ...pdfOptions,
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

test("Chromium A4 PDF: canonical 29-slot categories are boxed and ordered", async () => {
  const order = {
    canonicalId: "order:synthetic-boxed-29-slot",
    version: 1,
    status: "planned",
    serviceDate: day,
    requiredBy: day + "T11:00:00Z",
    serviceWindow: { startTime: "12:00" },
    destinationOplocId: "oploc:synthetic-only",
    destinationLabel: "SYNTHETIC - NOT FOR SERVICE",
    serviceType: "Lunch",
    origin: "menu_planning",
    sourcePublicationId: "publication:synthetic-boxed-29-slot",
    sourcePublicationDayId: "publication-day:synthetic-boxed-29-slot",
    sourceVersion: 1,
    lines: CANONICAL_MENU_SLOTS.map((slot, index) => ({
      canonicalId: `line:synthetic-${index + 1}`,
      sourceBookingLineId: `entry:synthetic-${index + 1}`,
      itemName: `Synthetic ${slot.label} dish ${index + 1}`,
      customerQuantity: 8 + (index % 6) * 4,
      customerUnit: "portions",
      productionQuantity: 8 + (index % 6) * 4,
      productionUnit: "portions",
      status: "ready",
      sortOrder: index,
      slot: slot.id,
      canonicalSlotId: slot.id,
      menuOrderVersion: "fika.menu-order.v1",
      canonicalOrderIndex: slot.order,
      ...(index === 0 ? { isCoreSalad: true } : {}),
    })),
  } as ProductionOrder & { lines: Array<ProductionOrder["lines"][number] & { isCoreSalad?: boolean }> };
  const html = collectionPrintHtml(order, new Date(day + "T12:00:00Z"));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMedia({ media: "screen" });
    await preparePrint(page, html);
    const result = await page.evaluate(() => {
      const output = document.getElementById("day-pages")!;
      const sections = Array.from(output.querySelectorAll<HTMLElement>(".menu-section-row th"));
      return {
        rows: output.querySelectorAll("tr[data-line-id]").length,
        slots: Array.from(output.querySelectorAll<HTMLElement>(".category")).map((node) => node.textContent?.trim()),
        coreSaladLabels: output.querySelectorAll(".core-salad-label").length,
        sections: sections.map((node) => {
          const style = getComputedStyle(node);
          return {
            label: node.textContent?.trim(),
            borders: [
              { width: Number.parseFloat(style.borderTopWidth), style: style.borderTopStyle },
              { width: Number.parseFloat(style.borderRightWidth), style: style.borderRightStyle },
              { width: Number.parseFloat(style.borderBottomWidth), style: style.borderBottomStyle },
              { width: Number.parseFloat(style.borderLeftWidth), style: style.borderLeftStyle },
            ],
          };
        }),
        pageCount: output.querySelectorAll(".print-page").length,
        scope: output.dataset.scope,
        siteTitle: output.querySelector(".print-page h1")?.textContent,
      };
    });
    assert.equal(result.rows, 29);
    assert.equal(result.coreSaladLabels, 1);
    const expectedSections = [
      "SALADS", "COLD PROTEINS", "HOT MAINS", "STARCH/SIDES", "GARNISHES", "SAUCES", "DESSERTS",
    ];
    assert.deepEqual([...new Set(result.sections.map((section) => section.label))], expectedSections);
    assert.equal(result.slots.length, 29);
    const labelsPerSection = new Map<string, number>();
    for (const slot of CANONICAL_MENU_SLOTS) {
      const key = `${slot.sectionId}:${slot.label}`;
      labelsPerSection.set(key, (labelsPerSection.get(key) || 0) + 1);
    }
    const expectedSlots = CANONICAL_MENU_SLOTS.map((slot) => {
      const key = `${slot.sectionId}:${slot.label}`;
      const index = slot.id.match(/(\d+)$/)?.[1];
      return labelsPerSection.get(key)! > 1 && index ? `${slot.label} ${index}` : slot.label;
    });
    assert.deepEqual(result.slots, expectedSlots);
    for (const section of result.sections) {
      assert.ok(section.borders.every((border) => border.width >= 0.5 && border.style === "solid"), `${section.label} should be visibly boxed on four sides`);
    }
    assert.match(result.scope || "", /NOT FOR SERVICE/);
    assert.match(result.siteTitle || "", /NOT FOR SERVICE/);
    assert.equal(result.pageCount, 2, "29-slot canonical menu keeps its existing two-page A4 pagination");

    const outputDir = path.resolve(process.env.CPU_PRINT_EVIDENCE_DIR || "test-results/cpu-print");
    mkdirSync(outputDir, { recursive: true });
    await page.emulateMedia({ media: "print" });
    await page.pdf({
      path: path.join(outputDir, "canonical-29-slot-boxed.pdf"),
      ...pdfOptions,
    });
    await page.screenshot({
      path: path.join(outputDir, "canonical-29-slot-boxed.png"),
      fullPage: true,
    });
    writeFileSync(path.join(outputDir, "canonical-29-slot-boxed.json"), JSON.stringify(result, null, 2));
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
    await preparePrint(page, html);
    const result = await page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>(".print-page")).map((sheet) => ({
      siteKey: sheet.dataset.siteKey,
      day: sheet.dataset.day,
      date: sheet.querySelector(".heading-date")?.textContent,
      scope: sheet.querySelector(".page-scope")?.textContent,
      warning: sheet.querySelector(".print-warning")?.textContent,
      handovers: Array.from(sheet.querySelectorAll(".handover")).map(footer => footer.textContent),
      continuation: sheet.querySelector(".continuation")?.textContent,
      cards: Array.from(sheet.querySelectorAll<HTMLElement>(".collection")).map((card) => ({ siteKey: card.dataset.siteKey, day: card.dataset.day, id: card.dataset.collectionId })),
      overflow: Array.from(sheet.querySelectorAll<HTMLElement>(".collection")).some((card) => card.getBoundingClientRect().bottom > sheet.querySelector(".page-cards")!.getBoundingClientRect().bottom + 0.5),
    })));
    assert.ok(result.length >= 4, "large Site A/date must continue on additional pages");
    assert.deepEqual(
      new Set(result.map((sheet) => JSON.stringify([sheet.siteKey, sheet.day]))),
      new Set([["oploc:oploc:a", day], ["oploc:oploc:b", day], ["oploc:oploc:a", day2]].map((entry) => JSON.stringify(entry))),
    );
    assert.ok(result.every((sheet) => sheet.cards.length > 0 && sheet.cards.every((card) => card.siteKey === sheet.siteKey && card.day === sheet.day)));
    assert.deepEqual(new Set(result.map(sheet => sheet.date)), new Set(["Friday, 23 October 2026", "Saturday, 24 October 2026"]));
    assert.ok(result.every((sheet) => sheet.scope?.includes("Printed 23 Oct 2026")));
    assert.ok(result.every((sheet) => sheet.warning?.includes("Paper-only checkboxes")));
    const handovers = result.flatMap(sheet => sheet.handovers);
    assert.equal(handovers.length, 4);
    assert.ok(handovers.every(handover => ["Packed by:", "Checked by:", "Driver / collected by:", "Departure time:", "Delivered time:", "Received by / signature:", "Notes / issues:"].every(field => handover?.includes(field))));
    assert.ok(result.every((sheet) => !sheet.overflow));
    assert.ok(result.some((sheet) => sheet.siteKey === "oploc:oploc:a" && sheet.day === day && sheet.continuation?.includes("Collection continued")));
    const artifacts = path.resolve(process.env.CPU_PRINT_EVIDENCE_DIR || "test-results/cpu-print");
    mkdirSync(artifacts, { recursive: true });
    await page.emulateMedia({ media: "print" });
    await page.pdf({ path: path.join(artifacts, "site-date-continuations.pdf"), ...pdfOptions });
    await page.screenshot({ path: path.join(artifacts, "site-date-continuations.png"), fullPage: true });
    writeFileSync(path.join(artifacts, "site-date-continuations.json"), JSON.stringify(result, null, 2));
  } finally {
    await browser.close();
  }
});
