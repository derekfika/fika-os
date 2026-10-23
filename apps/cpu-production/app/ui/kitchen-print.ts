import type {
  ProductionLine,
  ProductionOrder,
} from "../../lib/production-types";
import type { ProductionTotalsCategory } from "../../lib/production-day";
import {
  cpuDestinationLabel,
  cpuServiceWindow,
  cpuSourceLabel,
} from "../../lib/production-presentation";
export function collectionQuantity(line: ProductionLine) {
  return line.productionQuantity !== undefined &&
    Number.isFinite(line.productionQuantity) &&
    line.productionQuantity >= 0 &&
    line.productionUnit?.trim()
    ? line.productionQuantity.toLocaleString("en-GB") +
        " " +
        line.productionUnit
    : line.customerQuantity.toLocaleString("en-GB") + " " + line.customerUnit;
}
export function collectionTime(order: ProductionOrder) {
  if (
    order.serviceWindow?.startTime &&
    order.serviceWindow.startTime !== "00:00"
  )
    return cpuServiceWindow(order);
  const date = new Date(order.requiredBy);
  return Number.isFinite(date.getTime()) && !order.requiredBy.includes("T00:00")
    ? new Intl.DateTimeFormat("en-GB", {
        timeZone: "Europe/London",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date)
    : "Time TBC";
}
export function collectionDate(order: ProductionOrder) {
  const date = new Date(order.requiredBy);
  return (
    order.serviceDate ||
    (Number.isFinite(date.getTime())
      ? new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(date)
      : "Date TBC")
  );
}
const escape = (s: unknown) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const css =
  "@page{size:A4;margin:12mm}*{box-sizing:border-box}body{margin:0;background:white;color:black;font:11pt/1.35 Arial,sans-serif}h1{font-size:22pt;margin:0 0 4mm}p{margin:2mm 0}article{border:1pt dashed black;padding:5mm}table{width:100%;border-collapse:collapse;margin-top:5mm}th,td{text-align:left;padding:3mm 2mm;border-bottom:.5pt solid #999;vertical-align:top;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}th.quantity,td.quantity{width:24%;text-align:right}th.check,td.check{width:16mm;white-space:nowrap}i.box{display:inline-block;width:5mm;height:5mm;border:1pt solid black}footer{break-inside:avoid;margin-top:10mm;display:flex;gap:10mm;flex-wrap:wrap}.notes{height:13mm;border-bottom:.5pt solid #999}caption{text-align:left;font-weight:bold;margin-top:4mm}";
const doc = (title: string, body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>' +
  escape(title) +
  "</title><style>" +
  css +
  "</style></head><body>" +
  body +
  "</body></html>";
export function collectionPrintHtml(order: ProductionOrder) {
  return doc(
    "Collection sheet",
    "<article><h1>" +
      escape(cpuDestinationLabel(order)) +
      "</h1><p><b>" +
      escape(collectionDate(order)) +
      " · Ready / collection " +
      escape(collectionTime(order)) +
      "</b></p><p>" +
      escape(
        [
          cpuSourceLabel(order),
          order.serviceType,
          order.sourcePublicationDayId ||
            order.sourceEntityId ||
            order.sourceBookingId,
          order.sourceVersion !== undefined ? "v" + order.sourceVersion : "",
        ]
          .filter(Boolean)
          .join(" · "),
      ) +
      '</p><table><thead><tr><th class="check">Check</th><th>Dish</th><th class="quantity">Required quantity</th></tr></thead><tbody>' +
      order.lines
        .map(
          (l) =>
            '<tr><td class="check"><i class="box"></i></td><th>' +
            escape(l.itemName) +
            '</th><td class="quantity">' +
            escape(collectionQuantity(l)) +
            "</td></tr>",
        )
        .join("") +
      "</tbody></table><footer><span>Packed by: __________________</span><span>Checked by: __________________</span><span>Date / time: ________________</span></footer></article>",
  );
}
export function totalsPrintHtml(
  categories: ProductionTotalsCategory[],
  period: string,
  filters: string,
) {
  return doc(
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
  );
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
        await frame.contentDocument?.fonts.ready;
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
    frame.srcdoc = html;
    document.body.appendChild(frame);
  });
}
