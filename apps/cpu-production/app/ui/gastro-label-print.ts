import type { ProductionOrder } from "../../lib/production-types";
import { cpuDestinationLabel } from "../../lib/production-presentation";
import { eligibleRunSheetDayOrders, runSheetServiceKey } from "./run-sheet-printing";
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
export type GastroLabelFontSize = number | "auto";
export type GastroLabelFit = { fontSizePt: number; lineCount: number; fits: boolean };
export type GastroLabelCell =
  | { kind: "label"; dish: GastroLabelDish; pageNumber: number; position: number }
  | { kind: "skipped"; pageNumber: 1; position: number }
  | { kind: "blank"; pageNumber: number; position: number };

export function gastroLabelEligible(order: ProductionOrder) {
  // Canonical Menu Planning handoffs are identified by their source domain.
  // Unlike Run Sheet classification, the materializer does not set the optional
  // productionCategory field for these orders.
  return order.origin === "menu_planning" &&
    runSheetServiceKey(order) === "delivered_in" &&
    Boolean(order.sourceEntityId?.trim() && order.sourcePublicationDayId?.trim() &&
      Number.isSafeInteger(order.sourceVersion) && (order.sourceVersion || 0) > 0 &&
      /^[a-f0-9]{64}$/i.test(order.sourceContentHash || ""));
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
      // A missing optional line route inherits Menu Planning's canonical
      // Delivered-In source. An explicit non-Delivered-In route still fails closed.
      if ((line.workstream !== "delivered_in" && !(order.origin === "menu_planning" && line.workstream === undefined)) || !line.canonicalId || !line.itemName?.trim()) continue;
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

export const GASTRO_LABEL_FONT = { minimumPt: 12, maximumPt: 23, widthMm: 85, nameHeightMm: 34 } as const;

/** Wrap with measured Arial Bold text metrics, matching the print face and CSS box. */
export function measureGastroLabelName(
  name: string,
  fontSizePt: number,
  measureText: (text: string) => Pick<TextMetrics, "width" | "actualBoundingBoxAscent" | "actualBoundingBoxDescent">,
): GastroLabelFit {
  const widthPx = GASTRO_LABEL_FONT.widthMm * 96 / 25.4;
  const heightPx = GASTRO_LABEL_FONT.nameHeightMm * 96 / 25.4;
  const lineHeightPx = fontSizePt * 96 / 72 * 1.08;
  const words = name.trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return { fontSizePt, lineCount: 0, fits: false };
  let measuredGlyphHeight = 0;
  const width = (text: string) => {
    const metrics = measureText(text);
    measuredGlyphHeight = Math.max(measuredGlyphHeight, metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent);
    return metrics.width;
  };
  let lineCount = 0;
  let currentLine = "";
  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (width(candidate) <= widthPx) {
      currentLine = candidate;
      continue;
    }
    if (currentLine) { lineCount += 1; currentLine = ""; }
    for (const character of Array.from(word)) {
      const next = currentLine + character;
      if (currentLine && width(next) > widthPx) { lineCount += 1; currentLine = character; }
      else currentLine = next;
    }
  }
  if (currentLine) lineCount += 1;
  const renderedLineHeightPx = Math.max(lineHeightPx, measuredGlyphHeight);
  return { fontSizePt, lineCount, fits: lineCount * renderedLineHeightPx <= heightPx };
}

export function fitGastroLabelName(name: string, fontSize: GastroLabelFontSize, context: Pick<CanvasRenderingContext2D, "font" | "measureText">): GastroLabelFit {
  const sizes = fontSize === "auto"
    ? Array.from({ length: GASTRO_LABEL_FONT.maximumPt - GASTRO_LABEL_FONT.minimumPt + 1 }, (_, index) => GASTRO_LABEL_FONT.maximumPt - index)
    : [fontSize];
  for (const size of sizes) {
    if (!Number.isInteger(size) || size < GASTRO_LABEL_FONT.minimumPt || size > GASTRO_LABEL_FONT.maximumPt) {
      return { fontSizePt: Number.isFinite(size) ? size : GASTRO_LABEL_FONT.minimumPt, lineCount: 0, fits: false };
    }
    context.font = `700 ${size}pt Arial`;
    const fit = measureGastroLabelName(name, size, (text) => context.measureText(text));
    if (fit.fits || fontSize !== "auto") return fit;
  }
  context.font = `700 ${GASTRO_LABEL_FONT.minimumPt}pt Arial`;
  return measureGastroLabelName(name, GASTRO_LABEL_FONT.minimumPt, (text) => context.measureText(text));
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

function labelMarkup(row: GastroLabelQuantity, dateLabel: string, fit: GastroLabelFit) {
  if (!fit.fits) throw new Error(`“${row.name}” cannot fit at the minimum readable size of ${GASTRO_LABEL_FONT.minimumPt} pt. Reduce the label quantity or review the dish name before printing.`);
  return `<article class="label" style="--dish-font-size:${fit.fontSizePt}pt"><h2>${escapePrintHtml(row.name)}</h2><p class="date">${escapePrintHtml(dateLabel)}</p><p class="site"><strong>SITE:</strong> <span></span></p><small>FIKA X</small></article>`;
}

export function gastroLabelsPrintHtml(rows: readonly GastroLabelQuantity[], startPosition: number, fittedNames: Readonly<Record<string, GastroLabelFit>>) {
  const pages = gastroLabelCells(rows, startPosition);
  if (!pages.length) throw new Error("Enter at least one label before opening the print dialog.");
  const dateLabel = gastroLabelDateLabel(rows[0]?.date ?? "");
  const pageMarkup = pages.map((page, pageIndex) => `<main class="sheet" aria-label="A4 label sheet ${pageIndex + 1}">${page.map((cell) => {
    if (cell.kind === "label") return labelMarkup(cell.dish as GastroLabelQuantity, dateLabel, fittedNames[cell.dish.id] ?? { fontSizePt: GASTRO_LABEL_FONT.minimumPt, lineCount: 0, fits: false });
    return `<article class="empty-cell" aria-hidden="true"></article>`;
  }).join("")}</main>`).join("");
  const t = GASTRO_LABEL_TEMPLATE;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FIKA X Gastro Labels · ${escapePrintHtml(dateLabel)}</title><style>
*{box-sizing:border-box}html,body{margin:0;padding:0;color:#24163b;font-family:Arial,Helvetica,sans-serif}.screen-note{max-width:720px;margin:24px auto;padding:16px 20px;border:1px solid #dcd6ea;border-radius:8px;background:#fff;font-size:14px;line-height:1.45}.screen-note strong{color:#280f8c}.sheet{position:relative;width:${t.sheetWidthMm}mm;height:${t.sheetHeightMm}mm;margin:12px auto;background:#fff;overflow:hidden;break-after:page;page-break-after:always;display:grid;grid-template-columns:repeat(${t.columns},${t.labelWidthMm}mm);grid-template-rows:repeat(${t.rows},${t.labelHeightMm}mm);column-gap:${t.horizontalGapMm}mm;row-gap:${t.verticalGapMm}mm;padding:${t.topMarginMm}mm 0 0 ${t.leftMarginMm}mm}.sheet:last-of-type{break-after:auto;page-break-after:auto}.label,.empty-cell{width:${t.labelWidthMm}mm;height:${t.labelHeightMm}mm;overflow:hidden}.label{display:flex;flex-direction:column;justify-content:center;padding:4mm 5mm 3mm;border:0 solid #dcd6ea}.label h2{flex:1 1 auto;min-height:0;margin:0 0 2mm;display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:var(--dish-font-size);line-height:1.08;overflow-wrap:anywhere;hyphens:auto}.date{flex:0 0 auto;margin:1mm 0 2mm;text-align:center;font-size:11pt;line-height:1.1}.site{flex:0 0 auto;display:flex;align-items:flex-end;gap:2mm;margin:auto 0 1mm;font-size:10pt;line-height:1.2}.site span{flex:1 1 auto;border-bottom:1px solid #24163b;height:5mm}.label small{flex:0 0 auto;align-self:flex-end;margin-top:1mm;font-size:7pt;font-weight:700;letter-spacing:.08em;color:#4f34c7}.screen-note + .sheet{margin-top:0}
@page{size:A4 portrait;margin:0}@media print{.screen-note{display:none}.sheet{margin:0;break-after:page;page-break-after:always}.sheet:last-of-type{break-after:auto;page-break-after:auto}}
</style></head><body><section class="screen-note"><strong>Print at Actual size / 100%.</strong> Disable fit-to-page, scaling, headers and footers in the browser/printer dialog. If the system print dialog does not open, use your browser’s menu to print this page. Printer and tray alignment still need the kitchen’s physical Trial C check.</section>${pageMarkup}</body></html>`;
}

export function gastroLabelRowsWithQuantity(dishes: readonly GastroLabelDish[], quantities: Readonly<Record<string, number>>, date: string): GastroLabelQuantity[] {
  return dishes.map((dish) => ({ ...dish, quantity: quantities[dish.id] ?? 0, date }));
}
