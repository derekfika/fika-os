import test from "node:test";
import assert from "node:assert/strict";
import type { ProductionLine, ProductionOrder } from "../lib/production-types";
import { loadWholeDay } from "../app/ui/whole-day-production";
import {
  GASTRO_LABEL_TEMPLATE,
  gastroLabelCells,
  gastroLabelDateLabel,
  gastroLabelDishes,
  gastroLabelRowsWithQuantity,
  gastroLabelsPrintHtml,
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
  productionCategory: "delivered_in",
  origin: "menu_planning",
  sourcePublicationDayId: "publication-day:1",
  sourceVersion: 3,
  sourceContentHash: "sha256:current",
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
  const nonDeliveredLine = order("order:line-route", { lines: [line("other", "Other workstream", 1, "other", { workstream: "hospitality" })] });
  const withdrawn = order("order:withdrawn", { workflowStatus: "cancelled", lines: [line("withdrawn", "Withdrawn dish", 1)] } as Partial<ProductionOrder>);
  const eligible = gastroLabelDishes([current, cancelled, superseded, wrongCategory, staleDay, missingLineage, nonDeliveredLine, withdrawn], day);
  assert.deepEqual(eligible.map((dish) => dish.name), ["Eligible dish"]);
});

test("DIS003 PDF HTML uses central Trial C geometry, London service date, wrapped text and no operational declarations", () => {
  assert.deepEqual(GASTRO_LABEL_TEMPLATE, {
    sheetWidthMm: 210, sheetHeightMm: 297, columns: 2, rows: 4,
    labelWidthMm: 95, labelHeightMm: 62, leftMarginMm: 9, topMarginMm: 17,
    horizontalGapMm: 3, verticalGapMm: 4,
  });
  assert.equal(gastroLabelDateLabel(day), "23 November 2026");
  const longName = "A very long dish name with safely wrapping content & a second part that stays readable";
  const html = gastroLabelsPrintHtml([{ id: "dish:long", name: longName, sortOrder: 1, quantity: 1, date: day }], 1);
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
  assert.match(html, /&amp;/);
  assert.doesNotMatch(html, /allergen|contains|may contain|use by|91 pieces|38 portions/i);
  assert.throws(() => gastroLabelsPrintHtml(quantityRows(0), 1), /at least one/i);
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
