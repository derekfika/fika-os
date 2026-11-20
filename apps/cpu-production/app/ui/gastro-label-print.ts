import type { ProductionOrder } from "../../lib/production-types";
import { cpuDestinationLabel } from "../../lib/production-presentation";
import { eligibleRunSheetDayOrders } from "./run-sheet-printing";
import { escapePrintHtml } from "./day-production-print";

/** Planglow DIS003 Trial C measurements. Keep all page geometry here for calibration. */
export const GASTRO_LABEL_TEMPLATE = {
  sheetWidthMm: 210,
  sheetHeightMm: 297,
  columns: 2,
  rows: 4,
  labelWidthMm: 95,
  labelHeightMm: 62,
  leftMarginMm: 9,
  topMarginMm: 17,
  horizontalGapMm: 3,
  verticalGapMm: 4,
} as const;

export type GastroLabelDish = {
  id: string;
  name: string;
  sortOrder: number;
};

export type GastroLabelQuantity = GastroLabelDish & { quantity: number; date: string };
export type GastroLabelCell =
  | { kind: "label"; dish: GastroLabelDish; pageNumber: number; position: number }
  | { kind: "skipped"; pageNumber: 1; position: number }
  | { kind: "blank"; pageNumber: number; position: number };

export function gastroLabelEligible(order: ProductionOrder) {
  return order.productionCategory === "delivered_in" &&
    Boolean(order.sourcePublicationDayId && order.sourceVersion && order.sourceContentHash);
}

/**
 * Builds a stable list of published dish identities from the selected canonical day.
 * It deliberately ignores all portions, production quantities, PAX and booking counts.
 */
export function gastroLabelDishes(
  orders: readonly ProductionOrder[],
  date: string,
  selectedSiteIds: readonly string[] = [],
): GastroLabelDish[] {
  const sites = new Set(selectedSiteIds);
  const dishes = new Map<string, GastroLabelDish>();
  for (const order of eligibleRunSheetDayOrders(orders, date)) {
    if (!gastroLabelEligible(order)) continue;
    if (sites.size && (!order.destinationOplocId || !sites.has(order.destinationOplocId))) continue;
    for (const line of order.lines) {
      if (line.workstream !== "delivered_in" || !line.canonicalId || !line.itemName?.trim()) continue;
      const id = line.sourceMenuItemId?.trim() || line.canonicalId;
      const current = dishes.get(id);
      const candidate = { id, name: line.itemName.trim(), sortOrder: line.sortOrder };
      if (!current || candidate.sortOrder < current.sortOrder ||
        (candidate.sortOrder === current.sortOrder && candidate.name.localeCompare(current.name) < 0)) {
        dishes.set(id, candidate);
      }
    }
  }
  return [...dishes.values()].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

export function validGastroLabelCount(value: number) {
  return Number.isSafeInteger(value) && value >= 0;
}

export function gastroLabelCells(rows: readonly GastroLabelQuantity[], startPosition: number) {
  if (!Number.isInteger(startPosition) || startPosition < 1 || startPosition > 8) {
    throw new RangeError("Choose a start position from 1 to 8.");
  }
  if (rows.some((row) => !validGastroLabelCount(row.quantity))) {
    throw new RangeError("Label counts must be nonnegative whole numbers.");
  }
  const labels = rows.flatMap((row) => Array.from({ length: row.quantity }, () => row));
  if (!labels.length) return [] as GastroLabelCell[][];
  const cells: GastroLabelCell[][] = [];
  const skipped = startPosition - 1;
  const required = skipped + labels.length;
  const pageCount = Math.ceil(required / 8);
  let labelIndex = 0;
  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const page: GastroLabelCell[] = [];
    for (let slotIndex = 0; slotIndex < 8; slotIndex += 1) {
      const position = slotIndex + 1;
      if (pageIndex === 0 && slotIndex < skipped) {
        page.push({ kind: "skipped", pageNumber: 1, position });
      } else if (labelIndex < labels.length) {
        page.push({ kind: "label", dish: labels[labelIndex++], pageNumber: pageIndex + 1, position });
      } else {
        page.push({ kind: "blank", pageNumber: pageIndex + 1, position });
      }
    }
    cells.push(page);
  }
  return cells;
}

export function gastroLabelDateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Select a valid service date.");
  const value = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(value.valueOf())) throw new Error("Select a valid service date.");
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function labelMarkup(row: GastroLabelQuantity, dateLabel: string) {
  const fontSize = Math.max(12, Math.min(23, 630 / Math.max(row.name.length, 28)));
  const longClass = row.name.length > 52 ? " label--long" : "";
  return `<article class="label${longClass}" style="--dish-font-size:${fontSize}pt"><h2>${escapePrintHtml(row.name)}</h2><p class="date">${escapePrintHtml(dateLabel)}</p><p class="site"><strong>SITE:</strong> <span></span></p><small>FIKA X</small></article>`;
}

export function gastroLabelsPrintHtml(rows: readonly GastroLabelQuantity[], startPosition: number) {
  const pages = gastroLabelCells(rows, startPosition);
  if (!pages.length) throw new Error("Enter at least one label before opening the print dialog.");
  const dateLabel = gastroLabelDateLabel(rows[0]?.date ?? "");
  const pageMarkup = pages.map((page, pageIndex) => `<main class="sheet" aria-label="A4 label sheet ${pageIndex + 1}">${page.map((cell) => {
    if (cell.kind === "label") return labelMarkup(cell.dish as GastroLabelQuantity, dateLabel);
    return `<article class="empty-cell" aria-hidden="true"></article>`;
  }).join("")}</main>`).join("");
  const t = GASTRO_LABEL_TEMPLATE;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIKA X Gastro Labels · ${escapePrintHtml(dateLabel)}</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;color:#24163b;font-family:Arial,Helvetica,sans-serif}.screen-note{max-width:720px;margin:24px auto;padding:16px 20px;border:1px solid #dcd6ea;border-radius:8px;background:#fff;font-size:14px;line-height:1.45}.screen-note strong{color:#280f8c}.sheet{position:relative;width:${t.sheetWidthMm}mm;height:${t.sheetHeightMm}mm;margin:12px auto;background:#fff;overflow:hidden;break-after:page;page-break-after:always;display:grid;grid-template-columns:repeat(${t.columns},${t.labelWidthMm}mm);grid-template-rows:repeat(${t.rows},${t.labelHeightMm}mm);column-gap:${t.horizontalGapMm}mm;row-gap:${t.verticalGapMm}mm;padding:${t.topMarginMm}mm 0 0 ${t.leftMarginMm}mm}.sheet:last-of-type{break-after:auto;page-break-after:auto}.label,.empty-cell{width:${t.labelWidthMm}mm;height:${t.labelHeightMm}mm;overflow:hidden}.label{display:flex;flex-direction:column;justify-content:center;padding:4mm 5mm 3mm;border:0 solid #dcd6ea}.label h2{margin:0 0 2mm;text-align:center;font-weight:700;font-size:var(--dish-font-size);line-height:1.06;overflow-wrap:anywhere;hyphens:auto}.label--long h2{line-height:1.02}.date{margin:1mm 0 2mm;text-align:center;font-size:11pt;line-height:1.1}.site{display:flex;align-items:flex-end;gap:2mm;margin:auto 0 1mm;font-size:10pt;line-height:1.2}.site span{flex:1 1 auto;border-bottom:1px solid #24163b;height:5mm}.label small{align-self:flex-end;margin-top:1mm;font-size:7pt;font-weight:700;letter-spacing:.08em;color:#4f34c7}.screen-note + .sheet{margin-top:0}
@page{size:A4 portrait;margin:0}@media print{.screen-note{display:none}.sheet{margin:0;break-after:page;page-break-after:always}.sheet:last-of-type{break-after:auto;page-break-after:auto}}
</style></head><body><section class="screen-note"><strong>Print at Actual size / 100%.</strong> Disable fit-to-page, scaling, headers and footers in the browser/printer dialog. If the system print dialog does not open, use your browser’s menu to print this page. Printer and tray alignment still need the kitchen’s physical Trial C check.</section>${pageMarkup}</body></html>`;
}

export function gastroLabelRowsWithQuantity(dishes: readonly GastroLabelDish[], quantities: Readonly<Record<string, number>>, date: string): GastroLabelQuantity[] {
  return dishes.map((dish) => ({ ...dish, quantity: quantities[dish.id] ?? 0, date }));
}
