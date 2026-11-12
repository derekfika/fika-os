import type { ProductionTotalsCategory } from "../../lib/production-day";
import type { ProductionOrder } from "../../lib/production-types";
import { escapePrintHtml as escape } from "./day-production-print";
import { addStagingPrintWatermark } from "../../lib/staging-print-watermark";
import { paperRunSheetStyles } from "./run-sheet-paper-styles";
import { menuPlacementKey } from "../../lib/menu-run-sheet-order";

export { collectionOrders, collectionDate, collectionTime, collectionQuantity, collectionQuantityHeading, isCoreSaladLine } from "./run-sheet-presentation";
export { collectionPrintHtml } from "./day-production-print";

const css =
  "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:white;color:black;font:11pt/1.35 Arial,sans-serif}h1{font-size:22pt;margin:0 0 4mm}p{margin:2mm 0}article{border:1pt dashed black;padding:5mm}table{width:100%;border-collapse:collapse;margin-top:5mm;table-layout:fixed}th,td{text-align:left;padding:3mm 2mm;border-bottom:.5pt solid #999;vertical-align:top;overflow-wrap:anywhere;white-space:normal}thead{display:table-header-group}tr{break-inside:avoid}.menu-section-row th{padding-top:3mm;border-bottom:1pt solid black;font-size:9pt;font-weight:bold;letter-spacing:.04em}th.quantity,td.quantity{width:20%;text-align:right}td.quantity strong{display:block}th.check,td.check{width:18mm;white-space:nowrap}td.category{width:22%}.core-salad-label{display:inline-block;margin-left:4pt;padding:1pt 3pt;border:1pt solid black;border-radius:2pt;font-size:8pt;font-weight:bold;white-space:nowrap}tr.core-salad td,tr.core-salad th{border-top:1pt solid black;border-bottom:1pt solid black}i.box{display:inline-block;width:5mm;height:5mm;border:1pt solid black}footer{break-inside:avoid;margin-top:10mm;display:flex;gap:10mm;flex-wrap:wrap}.notes{height:13mm;border-bottom:.5pt solid #999}caption{text-align:left;font-weight:bold;margin-top:4mm}";
const doc = (title: string, body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' +
  escape(title) +
  "</title><style>" +
  css +
  "</style></head><body>" +
  body +
  "</body></html>";
export function totalsPrintHtml(
  categories: ProductionTotalsCategory[],
  period: string,
  filters: string,
  layout: "compact" | "full" = "compact",
  orders: ProductionOrder[] = [],
) {
  const coreKeys = new Set<string>();
  for (const order of orders) for (const line of order.lines) {
    if (order.origin !== "menu_planning" || line.isCoreSalad !== true) continue;
    const placement = menuPlacementKey(line) || "legacy";
    // Match the existing aggregation identity exactly: category, canonical dish name, customer unit and menu slot.
    for (const category of categories) {
      const key = `${category.category}:${line.itemName} · ${line.customerUnit} · ${placement}`;
      if (category.items.some((item) => item.key === key)) coreKeys.add(key);
    }
  }
  const source = categories.map((category) => `<section class="totals-category" data-category="${escape(category.category)}">
    <h2>${escape(category.category)}</h2>
    <table><thead><tr><th scope="col" class="totals-dish">Dish name</th><th scope="col" class="totals-subcategory">Subcategory</th><th scope="col" class="totals-quantity">Quantity</th><th scope="col" class="totals-unit">Unit</th><th scope="col" class="totals-notes-heading">Prep / notes</th></tr></thead>
    <tbody>${category.items.map((item) => `<tr data-total-key="${escape(item.key)}"><th scope="row" class="totals-dish">${escape(item.name)}${coreKeys.has(item.key) ? ' <small class="core-salad-label" aria-label="Core Salad">CORE SALAD</small>' : ""}</th><td class="totals-subcategory">${escape(item.culinaryCategory || "—")}</td><td class="totals-quantity"><strong>${escape(item.quantity.toLocaleString("en-GB"))}</strong></td><td class="totals-unit">${escape(item.unit)}</td><td class="totals-notes"></td></tr>`).join("")}</tbody></table>
  </section>`).join("");
  const printCss = `${paperRunSheetStyles}
    @page{size:A4 ${layout === "full" ? "landscape" : "portrait"};margin:0}
    .totals-page{width:${layout === "full" ? "296.8mm" : "210mm"};height:${layout === "full" ? "209mm" : "296.8mm"};padding:${layout === "full" ? "6mm 8mm" : "8mm 10mm"};display:flex;flex-direction:column;break-after:page}
    .totals-page:last-child{break-after:auto}.totals-page .day-heading{margin-bottom:2mm}.totals-page .page-scope{font-size:8pt;margin-top:1.5mm}.totals-page .page-cards{display:block;flex:1;min-height:0;overflow:hidden}
    .totals-category{margin:0 0 2.4mm;break-inside:avoid}.totals-category h2{margin:0;padding:1.4mm 2mm;border:.7pt solid var(--fika-action-secondary,currentColor);background:var(--fika-status-info-surface,transparent);color:var(--fika-action-secondary,currentColor);font:700 9pt/1.15 "FIKA Gilroy",Arial,sans-serif;letter-spacing:.035em;text-transform:uppercase;break-after:avoid}
    .totals-category table{width:100%;margin:0;border-collapse:collapse;table-layout:fixed;border:.6pt solid var(--fika-text-secondary,currentColor)}.totals-category th,.totals-category td{text-align:left;vertical-align:middle;padding:${layout === "full" ? "1.6mm 2mm" : "1mm 1.5mm"};border-bottom:.5pt solid var(--fika-border-default,currentColor);font-size:${layout === "full" ? "9.5pt" : "8.5pt"};line-height:1.2;white-space:normal;overflow-wrap:normal;word-break:normal;hyphens:auto}.totals-category thead{display:table-header-group}.totals-category thead th{border-top:1pt solid var(--fika-action-primary,currentColor);border-bottom:1pt solid currentColor;color:var(--fika-action-secondary,currentColor);font-size:8pt;font-weight:700;letter-spacing:.025em}.totals-category tr{break-inside:avoid}.totals-dish{width:${layout === "full" ? "39%" : "35%"};font-weight:700}.totals-subcategory{width:${layout === "full" ? "23%" : "24%"};color:var(--fika-text-secondary,currentColor)}.totals-quantity{width:${layout === "full" ? "15%" : "16%"};text-align:right!important;font-variant-numeric:tabular-nums}.totals-quantity strong{font-size:1.14em;font-weight:900}.totals-unit{width:9%;white-space:nowrap!important}.totals-notes-heading,.totals-notes{width:${layout === "full" ? "14%" : "16%"}}.totals-notes{height:7mm}.totals-page .core-salad-label{display:inline-block;margin-left:1mm;padding:0 .8mm;border:.6pt solid var(--fika-status-success,currentColor);border-radius:1mm;color:var(--fika-status-success,currentColor);font-size:6.5pt;font-weight:700;white-space:nowrap}.totals-page .handover{margin-top:auto;padding-top:1.3mm;font-size:8pt}.totals-page .page-number{flex:none;text-align:right;font-size:7.5pt;margin:1mm 0 0}
    .totals-source{position:absolute;left:-10000px;top:0;width:${layout === "full" ? "280mm" : "190mm"};visibility:hidden}.totals-page .page-cards{overflow:visible}
    @media print{.totals-source{display:none!important}.totals-page{margin:0}.totals-category h2{break-after:avoid}}
  `;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FIKA CPU production totals</title><style>${printCss}</style></head><body><div id="totals-pages" data-layout="${layout}" data-title="PRODUCTION TOTALS" data-period="${escape(period)}" data-filters="${escape(filters)}" data-printed-at="${escape(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short" }).format(new Date()))}"></div><div id="totals-source" class="totals-source">${source}</div></body></html>`;
  return addStagingPrintWatermark(html, process.env.FIKA_RUNTIME_MODE);
}
export function printKitchenDocument(
  html: string,
  prepare?: (doc: Document) => void,
  orientation: "portrait" | "landscape" = "portrait",
): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Printable kitchen sheet";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText =
      `position:fixed;left:-10000px;top:0;width:${orientation === "landscape" ? "297mm" : "210mm"};height:${orientation === "landscape" ? "210mm" : "297mm"};border:0`;
    frame.onload = async () => {
      try {
        if (frame.contentDocument) {
          const printRoot = frame.contentDocument.documentElement;
          const tokens = getComputedStyle(document.documentElement);
          for (const name of ["text-primary", "text-secondary", "action-primary", "action-secondary", "border-default", "surface-subtle", "status-info-surface", "status-success", "status-success-surface"]) {
            const token = "--fika-" + name;
            printRoot.style.setProperty(token, tokens.getPropertyValue(token));
          }
          if (prepare) {
            await Promise.all([
              frame.contentDocument.fonts.load('900 22pt "FIKA Vim"'),
              frame.contentDocument.fonts.load('400 10pt "FIKA Gilroy"'),
              frame.contentDocument.fonts.load('700 10pt "FIKA Gilroy"'),
            ].map(font => font.catch(() => [])));
          }
          await frame.contentDocument.fonts.ready;
        }
        if (prepare && frame.contentDocument) prepare(frame.contentDocument);
        const win = frame.contentWindow;
        if (!win) return;
        win.onafterprint = () => frame.remove();
        win.focus();
        win.print();
        resolve();
      } catch (error) {
        frame.remove();
        reject(error);
      }
    };
    frame.srcdoc = addStagingPrintWatermark(html, document.documentElement.dataset.fikaRuntime);
    document.body.appendChild(frame);
  });
}
