import type { ProductionTotalsCategory } from "../../lib/production-day";
import { escapePrintHtml as escape } from "./day-production-print";
import { addStagingPrintWatermark } from "../../lib/staging-print-watermark";

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
) {
  return addStagingPrintWatermark(doc(
    "Production totals",
    "<h1>Production totals</h1><p><b>" +
      escape(period) +
      "</b></p><p>" +
      escape(filters) +
      "</p><p>Customer ordered quantities · units kept separate</p>" +
      categories
        .map(
          (c) =>
            "<table><caption>" +
            escape(c.category) +
            '</caption><thead><tr><th>Production item</th><th class="quantity">Quantity</th><th>Unit</th><th>Prep / order notes</th></tr></thead><tbody>' +
            c.items
              .map(
                (t) =>
                  "<tr><th>" +
                  escape(t.name) +
                  (t.culinaryCategory ? '<br><small>' + escape(t.culinaryCategory) + '</small>' : "") +
                  '</th><td class="quantity">' +
                  escape(t.quantity.toLocaleString("en-GB")) +
                  "</td><td>" +
                  escape(t.unit) +
                  '</td><td class="notes"></td></tr>',
              )
              .join("") +
            "</tbody></table>",
        )
        .join("") +
      "<footer>Prepared / checked by: __________________ &nbsp; Date: ______________</footer>",
  ), process.env.FIKA_RUNTIME_MODE);
}
export function printKitchenDocument(
  html: string,
  prepare?: (doc: Document) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement("iframe");
    frame.title = "Printable kitchen sheet";
    frame.setAttribute("aria-hidden", "true");
    frame.setAttribute("sandbox", "allow-same-origin allow-modals");
    frame.style.cssText =
      "position:fixed;left:-10000px;top:0;width:210mm;height:297mm;border:0";
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
