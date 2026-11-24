import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionLine, ProductionOrder } from "../lib/production-types";
import type { CpuDayProjection } from "../lib/cpu-projection";
import { cpuProjectionToOrders } from "../lib/cpu-dashboard-adapter";
import { loadWholeDay } from "../app/ui/whole-day-production";
import { runSheetServiceKey } from "../app/ui/run-sheet-printing";
import {
  GASTRO_LABEL_TEMPLATE,
  gastroLabelCells,
  gastroLabelDateLabel,
  gastroLabelDishes,
  gastroLabelRowsWithQuantity,
  applyGastroLabelQuantityToSelected,
  hasSelectedGastroLabelDishes,
  setGastroLabelQuantity,
  gastroLabelsPrintHtml,
  gastroLabelEligible,
  fitGastroLabelName,
  GASTRO_LABEL_FONT,
  validGastroLabelCount,
  type GastroLabelQuantity,
} from "../app/ui/gastro-label-print";

const day = "2026-11-23";
const order = (id: string, options: Partial<ProductionOrder> = {}) => ({
  canonicalId: id,
  version: 1,
  status: "planned",
  serviceDate: day,
  requiredBy: `${day}T12:00:00Z`,
  serviceWindow: { startTime: "12:00" },
  destinationOplocId: "oploc:xchange",
  destinationLabel: "FIKA Xchange",
  origin: "menu_planning",
  sourceEntityId: "menu-day:2026-11-23:optiver",
  sourcePublicationId: "publication:week-2026-11-23",
  sourcePublicationDayId: "publication-day:1",
  sourceVersion: 3,
  sourceContentHash: "a".repeat(64),
  lines: [],
  ...options,
} as unknown as ProductionOrder);
const line = (id: string, name: string, sortOrder: number, sourceMenuItemId = id, overrides: Partial<ProductionLine> = {}): ProductionLine => ({
  canonicalId: `line:${id}`,
  sourceBookingLineId: `source:${id}`,
  sourceMenuItemId,
  itemName: name,
  sortOrder,
  workstream: "delivered_in",
  customerQuantity: 38,
  customerUnit: "portions",
  productionQuantity: 91,
  productionUnit: "pieces",
  dietaries: {},
  status: "pending",
  ...overrides,
});
const quantityRows = (count: number, date = day): GastroLabelQuantity[] => [{ id: "dish:soup", name: "Tomato soup", sortOrder: 1, quantity: count, date }];

test("manual label counts paginate 0, 1, 7, 8, 9 and 12 labels without deriving counts from production", () => {
  for (const [count, expectedPages] of [[0, 0], [1, 1], [7, 1], [8, 1], [9, 2], [12, 2]] as const) {
    const pages = gastroLabelCells(quantityRows(count), 1);
    assert.equal(pages.length, expectedPages, `${count} labels`);
    assert.equal(pages.flat().filter((cell) => cell.kind === "label").length, count);
    assert.equal(pages.flat().filter((cell) => cell.kind === "blank").length, expectedPages * 8 - count);
  }
  assert.equal(validGastroLabelCount(0), true);
  assert.equal(validGastroLabelCount(1), true);
  assert.equal(validGastroLabelCount(1.5), false);
  assert.equal(validGastroLabelCount(-1), false);
  assert.equal(validGastroLabelCount(Number.NaN), false);
  const dishes = gastroLabelDishes([order("order:1", { lines: [line("soup", "Tomato soup", 1)] })], day);
  assert.equal(gastroLabelRowsWithQuantity(dishes, {}, day)[0].quantity, 0);
});

test("quick quantities replace selected counts, keep unselected dishes and update totals and sheet counts locally", () => {
  const dishes = [
    { id: "dish:soup", name: "Tomato soup", sortOrder: 1 },
    { id: "dish:tart", name: "Leek tart", sortOrder: 2 },
    { id: "dish:salad", name: "Green salad", sortOrder: 3 },
  ];
  const starting = { "dish:soup": 2, "dish:tart": 4, "dish:salad": 0 };
  const selected = ["dish:soup", "dish:salad"];
  assert.equal(hasSelectedGastroLabelDishes(selected), true);
  assert.equal(hasSelectedGastroLabelDishes([]), false);

  for (const preset of [1, 2, 3]) {
    const presetResult = applyGastroLabelQuantityToSelected(starting, selected, preset);
    assert.deepEqual(presetResult, { "dish:soup": preset, "dish:tart": 4, "dish:salad": preset }, `${preset} each`);
  }

  const applied = applyGastroLabelQuantityToSelected(starting, selected, 3);
  assert.deepEqual(starting, { "dish:soup": 2, "dish:tart": 4, "dish:salad": 0 }, "bulk apply must not mutate the existing state object");
  assert.deepEqual(applied, { "dish:soup": 3, "dish:tart": 4, "dish:salad": 3 }, "unselected quantities must remain unchanged");

  const individualOverride = setGastroLabelQuantity(applied, "dish:soup", 5);
  assert.deepEqual(individualOverride, { "dish:soup": 5, "dish:tart": 4, "dish:salad": 3 }, "individual quantity editing remains available after bulk apply");

  const rows = gastroLabelRowsWithQuantity(dishes, applied, day);
  assert.equal(rows.reduce((sum, row) => sum + row.quantity, 0), 10);
  assert.equal(gastroLabelCells(rows, 1).length, 2, "ten labels should preview as two A4 sheets");

  const cleared = applyGastroLabelQuantityToSelected(applied, selected, 0);
  assert.deepEqual(cleared, { "dish:soup": 0, "dish:tart": 4, "dish:salad": 0 }, "clear selected must set, not subtract");
  const clearedRows = gastroLabelRowsWithQuantity(dishes, cleared, day);
  assert.equal(clearedRows.reduce((sum, row) => sum + row.quantity, 0), 4);
  assert.equal(gastroLabelCells(clearedRows, 1).length, 1);

  assert.deepEqual(applyGastroLabelQuantityToSelected(applied, [], 3), applied, "no selection must leave counts unchanged");
  assert.throws(() => setGastroLabelQuantity(applied, "dish:soup", 1.5), /nonnegative whole numbers/i);
  assert.throws(() => applyGastroLabelQuantityToSelected(applied, selected, -1), /nonnegative whole numbers/i);
  assert.throws(() => applyGastroLabelQuantityToSelected(applied, selected, Number.MAX_SAFE_INTEGER + 1), /nonnegative whole numbers/i);
});

test("first sheet start positions 1, 2 and 8 leave the exact used cells and continue full sheets", () => {
  const atOne = gastroLabelCells(quantityRows(9), 1);
  const atTwo = gastroLabelCells(quantityRows(9), 2);
  const atEight = gastroLabelCells(quantityRows(12), 8);
  assert.equal(atOne.length, 2);
  assert.equal(atOne[0].filter((cell) => cell.kind === "label").length, 8);
  assert.equal(atTwo[0][0].kind, "skipped");
  assert.equal(atTwo[0].filter((cell) => cell.kind === "label").length, 7);
  assert.equal(atTwo[1].filter((cell) => cell.kind === "label").length, 2);
  assert.equal(atEight[0].slice(0, 7).every((cell) => cell.kind === "skipped"), true);
  assert.equal(atEight[0][7].kind, "label");
  assert.equal(atEight.length, 3);
  assert.throws(() => gastroLabelCells(quantityRows(1), 0), /start position/i);
  assert.throws(() => gastroLabelCells(quantityRows(1), 9), /start position/i);
});

test("dish rows deduplicate canonical menu identities and keep stable menu order, independent of quantities", () => {
  const first = order("order:1", { lines: [line("salad", "Chopped salad", 3), line("soup", "Tomato soup", 1)] });
  const second = order("order:2", { destinationOplocId: "oploc:other", lines: [line("salad-copy", "Chopped salad", 2, "salad")] });
  const dishes = gastroLabelDishes([first, second], day);
  assert.deepEqual(dishes.map((dish) => [dish.id, dish.name]), [["soup", "Tomato soup"], ["salad", "Chopped salad"]]);
  const manual = gastroLabelRowsWithQuantity(dishes, { soup: 4, salad: 2 }, day);
  assert.deepEqual(manual.map((dish) => dish.quantity), [4, 2]);
  assert.equal(first.lines[0].customerQuantity, 38);
  assert.equal(first.lines[0].productionQuantity, 91);
  assert.equal(second.lines[0].productionQuantity, 91);
  assert.deepEqual(gastroLabelDishes([first, second], day, ["oploc:xchange"]).map((dish) => dish.id), ["soup", "salad"]);
  assert.deepEqual(gastroLabelDishes([first, second], day, ["oploc:other"]).map((dish) => dish.id), ["salad"]);
});

test("withdrawn, cancelled, superseded, stale-date, non-Delivered-In and unproven source rows fail closed", () => {
  const current = order("order:current", { lines: [line("dish", "Eligible dish", 1)] });
  const cancelled = order("order:cancelled", { status: "cancelled", lines: [line("cancel", "Cancelled dish", 1)] } as Partial<ProductionOrder>);
  const superseded = order("order:superseded", { supersededBy: "order:new", lines: [line("superseded", "Superseded dish", 1)] });
  const wrongCategory = order("order:wrong-category", { productionCategory: "hospitality", lines: [line("wrong", "Wrong route", 1)] });
  const staleDay = order("order:stale-day", { serviceDate: "2026-11-22", lines: [line("stale", "Stale date", 1)] });
  const missingLineage = order("order:unproven", { sourcePublicationDayId: undefined, lines: [line("unproven", "Unproven source", 1)] });
  const missingCanonicalSource = order("order:missing-source", { sourceEntityId: undefined, lines: [line("source", "Missing source", 1)] });
  const missingHash = order("order:missing-hash", { sourceContentHash: undefined, lines: [line("hash", "Missing hash", 1)] });
  const wrongOrigin = order("order:wrong-origin", { origin: "grab_and_go", lines: [line("grab", "Grab and Go", 1)] });
  const nonDeliveredLine = order("order:line-route", { lines: [line("other", "Other workstream", 1, "other", { workstream: "hospitality" })] });
  const withdrawn = order("order:withdrawn", { workflowStatus: "cancelled", lines: [line("withdrawn", "Withdrawn dish", 1)] } as Partial<ProductionOrder>);
  const eligible = gastroLabelDishes([current, cancelled, superseded, wrongCategory, staleDay, missingLineage, missingCanonicalSource, missingHash, wrongOrigin, nonDeliveredLine, withdrawn], day);
  assert.deepEqual(eligible.map((dish) => dish.name), ["Eligible dish"]);
});

test("production-shaped Optiver Menu Planning orders follow Run Sheet classification when optional category and line workstream are absent", () => {
  const optiver = order("production-order:v1:menu-planning:optiver", {
    destinationLabel: "Optiver",
    origin: "menu_planning",
    productionCategory: undefined,
    sourceEntityId: "menu-day:2026-11-23:optiver",
    sourcePublicationId: "menu-publication:2026-w48",
    sourcePublicationDayId: "menu-publication:2026-w48:v6:day:0",
    sourceVersion: 6,
    sourceContentHash: "b".repeat(64),
    lines: [
      line("optiver-soup", "Roasted tomato soup", 1, "dish:soup", { workstream: undefined }),
      line("optiver-tart", "Leek, goat's cheese & thyme tart", 2, "dish:tart", { workstream: undefined }),
    ],
  });
  assert.equal(runSheetServiceKey(optiver), "delivered_in");
  assert.deepEqual(gastroLabelDishes([optiver], day).map(({ id, name }) => [id, name]), [
    ["dish:soup", "Roasted tomato soup"],
    ["dish:tart", "Leek, goat's cheese & thyme tart"],
  ]);
  assert.equal(gastroLabelEligible({ ...optiver, sourceEntityId: undefined } as ProductionOrder), false);

  const projection = {
    serviceDate: day,
    revision: 12,
    lastChangeSequence: 78,
    rebuiltAt: `${day}T08:00:00.000Z`,
    summary: { orders: 1, ready: 1, attention: 0, planned: 1, totalUnits: 62 },
    orders: [{
      id: optiver.canonicalId,
      serviceDate: day,
      requiredBy: `${day}T12:00:00.000Z`,
      serviceWindow: { startTime: "12:00" },
      origin: "menu_planning",
      menuMetadataComplete: true,
      sourceReference: optiver.sourceBookingId,
      sourceEntityId: optiver.sourceEntityId,
      sourcePublicationId: optiver.sourcePublicationId,
      sourcePublicationDayId: optiver.sourcePublicationDayId,
      sourceVersion: optiver.sourceVersion,
      sourceContentHash: optiver.sourceContentHash,
      destinationOplocId: "oploc:optiver",
      destinationLabel: "Optiver",
      priority: "normal",
      status: "menu_available",
      workflowStatus: "planned",
      productionScope: "delivered_in,delivered_in",
      quantities: [
        { sourceLineId: "line:optiver-soup", sourceMenuItemId: "dish:soup", name: "Roasted tomato soup", quantity: 38, unit: "portions", dietaries: {} },
        { sourceLineId: "line:optiver-tart", sourceMenuItemId: "dish:tart", name: "Leek, goat's cheese & thyme tart", quantity: 24, unit: "portions", dietaries: {} },
      ],
      allergenReadiness: "ready",
      planningReadiness: "planned",
      attention: [],
      version: 6,
    }],
  } as unknown as CpuDayProjection;
  const projectedOrder = cpuProjectionToOrders(projection)[0];
  assert.equal(projectedOrder.productionCategory, undefined);
  assert.deepEqual(gastroLabelDishes([projectedOrder], day).map(({ id, name }) => [id, name]), [
    ["dish:soup", "Roasted tomato soup"],
    ["dish:tart", "Leek, goat's cheese & thyme tart"],
  ]);
  assert.deepEqual(gastroLabelRowsWithQuantity(gastroLabelDishes([projectedOrder], day), {}, day).map(({ quantity }) => quantity), [0, 0]);
});

test("DIS003 PDF HTML uses central Trial C geometry, London service date, wrapped text and no operational declarations", () => {
  assert.deepEqual(GASTRO_LABEL_TEMPLATE, {
    sheetWidthMm: 210, sheetHeightMm: 297, columns: 2, rows: 4,
    labelWidthMm: 95, labelHeightMm: 62, leftMarginMm: 9, topMarginMm: 17,
    horizontalGapMm: 3, verticalGapMm: 4,
  });
  assert.equal(gastroLabelDateLabel(day), "23 November 2026");
  const longName = "A very long dish name with safely wrapping content & a second part that stays readable";
  const html = gastroLabelsPrintHtml([{ id: "dish:long", name: longName, sortOrder: 1, quantity: 1, date: day }], 1, { "dish:long": { fontSizePt: 18, lineCount: 2, fits: true } });
  assert.match(html, /@page\{size:A4 portrait;margin:0\}/);
  assert.match(html, /grid-template-columns:repeat\(2,95mm\)/);
  assert.match(html, /grid-template-rows:repeat\(4,62mm\)/);
  assert.match(html, /padding:17mm 0 0 9mm/);
  assert.match(html, /column-gap:3mm;row-gap:4mm/);
  assert.match(html, /wrap|anywhere/);
  assert.match(html, /Actual size \/ 100%/);
  assert.match(html, /SITE:/);
  assert.match(html, /23 November 2026/);
  assert.match(html, /FIKA X/);
  assert.match(html, /--dish-font-size:18pt/);
  assert.match(html, /&amp;/);
  assert.doesNotMatch(html, /allergen|contains|may contain|use by|91 pieces|38 portions/i);
  assert.throws(() => gastroLabelsPrintHtml(quantityRows(0), 1, {}), /at least one/i);
  assert.throws(() => gastroLabelsPrintHtml(quantityRows(1), 1, {}), /minimum readable size/i);
});

test("measured fitting selects the largest fitting size, wraps punctuation and long words, and blocks overflow", () => {
  const context = {
    font: "",
    measureText: (text: string) => {
      const size = Number(context.font.match(/([0-9.]+)pt/)?.[1] ?? 12);
      return {
        width: Array.from(text).length * size * 0.12,
        actualBoundingBoxAscent: size * 96 / 72 * 0.75,
        actualBoundingBoxDescent: size * 96 / 72 * 0.18,
      };
    },
  } as unknown as CanvasRenderingContext2D;
  const short = fitGastroLabelName("Soup", "auto", context);
  assert.equal(short.fontSizePt, GASTRO_LABEL_FONT.maximumPt);
  assert.equal(short.fits, true);
  const punctuation = fitGastroLabelName("Chef's special: lemon, herbs & pepper! ".repeat(6), "auto", context);
  assert.equal(punctuation.fits, true);
  assert.ok(punctuation.lineCount > 1);
  const longWord = fitGastroLabelName("Antidisestablishmentarianism".repeat(60), "auto", context);
  assert.equal(longWord.fits, false);
  const manual = fitGastroLabelName("A moderately long dish name", 12, context);
  assert.equal(manual.fontSizePt, 12);
  assert.equal(manual.fits, true);
  assert.equal(fitGastroLabelName("A moderately long dish name", 23, context).fits, true);
});

test("fresh whole-day read rejects access failures, stale dates and incomplete projections", async () => {
  let requested = "";
  const unauthorized = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requested = String(input);
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    return new Response("Not authorised", { status: 401 });
  }) as typeof fetch;
  await assert.rejects(loadWholeDay(day, unauthorized), /complete production day could not be verified/i);
  assert.match(requested, new RegExp(`serviceDate=${day}`));
  assert.match(requested, /scope=all/);

  const partial = (async () => Response.json({
    projection: { serviceDate: day, summary: { orders: 2 }, orders: [{ serviceDate: day, quantities: [] }] },
  })) as typeof fetch;
  await assert.rejects(loadWholeDay(day, partial), /incomplete|another day/i);

  const wrongDate = (async () => Response.json({
    projection: { serviceDate: "2026-11-22", summary: { orders: 0 }, orders: [] },
  })) as typeof fetch;
  await assert.rejects(loadWholeDay(day, wrongDate), /incomplete|another day/i);
});

test("Gastro labels keep the same dish separate by supplementary menu and print the menu name", () => {
  const breakfast = order("order:breakfast", { sourceMenuId: "menu:breakfast", menuName: "Munich Re Breakfast", lines: [line("breakfast-salad", "Chopped salad", 1, "dish:salad")] });
  const main = order("order:main", { lines: [line("main-salad", "Chopped salad", 1, "dish:salad")] });
  const dishes = gastroLabelDishes([breakfast, main], day);
  assert.equal(dishes.length, 2);
  assert.deepEqual(dishes.map(({ menuName }) => menuName), [undefined, "Munich Re Breakfast"]);
  const rows = gastroLabelRowsWithQuantity(dishes, Object.fromEntries(dishes.map(dish => [dish.id, 1])), day);
  const fits = Object.fromEntries(dishes.map(dish => [dish.id, { fontSizePt: 16, lineCount: 1, fits: true }]));
  const html = gastroLabelsPrintHtml(rows, 1, fits);
  assert.match(html, /Munich Re Breakfast/);
});
