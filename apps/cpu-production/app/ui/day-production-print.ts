import type { ProductionOrder } from "../../lib/production-types";
import {
  collectionDate,
  collectionTime,
  collectionQuantity,
} from "./kitchen-print";
import {
  cpuDestinationLabel,
  cpuSourceLabel,
} from "../../lib/production-presentation";
import {
  eligibleRunSheetDayOrders,
  runSheetDestinationKey,
  runSheetPrintSiteOptions,
  selectedRunSheetPrintOrders,
} from "./run-sheet-printing";
const escape = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function dayCollections(orders: ProductionOrder[], day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw Error("Select a production date before printing.");
  return eligibleRunSheetDayOrders(orders, day);
}
const londonPrintTimestamp = (date: Date) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
}).format(date);

export function runSheetProductionPrintHtml(
  ordersByDay: ReadonlyMap<string, readonly ProductionOrder[]>,
  days: readonly string[],
  selectedSiteKeys: readonly string[],
  printedAt = new Date(),
  selectionLabel = "Selected sites",
) {
  const selectedByDay = selectedRunSheetPrintOrders(ordersByDay, days, selectedSiteKeys);
  const allSelected = [...selectedByDay.values()].flat();
  if (!allSelected.length) throw Error("No eligible collections were found for the selected site and dates.");
  const sites = runSheetPrintSiteOptions(ordersByDay, days);
  const labels = new Map(sites.map((site) => [site.key, site.displayLabel]));
  const requestedCount = allSelected.length;
  const source = days.flatMap((day) => (selectedByDay.get(day) || []).map((order) => {
    const siteKey = runSheetDestinationKey(order);
    const siteLabel = labels.get(siteKey) || cpuDestinationLabel(order);
    return `<article class="collection" data-collection-id="${escape(order.canonicalId)}" data-collection-start="true" data-site-key="${escape(siteKey)}" data-site-label="${escape(siteLabel)}" data-day="${escape(day)}"><header><h2>${escape(cpuDestinationLabel(order))}</h2><p><b>${escape(collectionDate(order))} · ${escape(order.serviceType || "Service")} · Ready / collection ${escape(collectionTime(order))}</b></p><p class="source">Order ${escape(order.canonicalId)} · ${escape([cpuSourceLabel(order), order.sourcePublicationDayId || order.sourcePublicationId || order.sourceEntityId || order.sourceBookingId, order.sourceVersion === undefined ? "" : "v" + order.sourceVersion].filter(Boolean).join(" · "))}</p></header><table><thead><tr><th class="check">Packed</th><th>Dish</th><th class="quantity">Ordered quantity</th></tr></thead><tbody>${order.lines.map((line) => `<tr data-line-id="${escape(line.canonicalId)}"><td class="check"><i class="box"></i></td><td>${escape(line.itemName)}</td><td class="quantity">${escape(collectionQuantity(line))}</td></tr>`).join("")}</tbody></table></article>`;
  })).join("");
  const rangeLabel = days.length === 1 ? days[0] : `${days[0]} – ${days[days.length - 1]}`;
  const printedLabel = londonPrintTimestamp(printedAt);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FIKA production run sheets ${escape(rangeLabel)}</title><style>
@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:white;color:#111;font:10pt/1.25 Arial,sans-serif}
.print-page{width:190mm;height:277mm;break-after:page;page-break-after:always;display:flex;flex-direction:column}.print-page:last-child{break-after:auto;page-break-after:auto}
.day-heading{height:20mm;flex:none;border-bottom:.5pt solid #111;margin-bottom:3mm}.brand{font-size:7pt;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;color:#4F34C7}.day-heading h1{font-size:15pt;margin:0 0 1mm}.day-heading p{font-size:7.5pt;margin:0}.print-warning{font-weight:bold}
.page-cards{height:210mm;display:flex;flex-direction:column;gap:3mm;flex:none}.print-row{display:grid;gap:3mm;align-items:start;flex:none;min-width:0}
.collection{border:1pt dashed #555;padding:3mm;break-inside:avoid;overflow-wrap:anywhere;min-width:0}.collection h2{font-size:14pt;line-height:1.1;margin:0 0 2mm}.collection p{font-size:9pt;margin:1mm 0}.collection .source{font-size:7.5pt;overflow-wrap:anywhere}.collection table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:2mm}.collection th,.collection td{text-align:left;vertical-align:top;padding:1.4mm .7mm;border-bottom:.4pt solid #999;font-size:9pt;font-weight:normal;overflow-wrap:anywhere}.collection thead th{font-size:8pt;font-weight:bold}.collection thead{display:table-header-group}.collection tr{break-inside:avoid}.collection .check{width:18mm}.collection .quantity{width:25%;text-align:right}.collection .quantity strong{display:block}.box{display:block;width:7mm;height:7mm;border:1.25pt solid #111}.handover{height:34mm;flex:none;border-top:.5pt solid #555;padding-top:2mm;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));grid-template-rows:repeat(2,1fr);gap:2mm 4mm;font-size:8pt}.handover span{border-bottom:.5pt solid #777;padding-bottom:1mm}.handover .signature{grid-column:span 2}.page-number{height:5mm;margin:1mm 0 0;font-size:8pt;text-align:right;flex:none}.continuation{font-weight:bold}
#collection-source,#measure-card{position:absolute;left:-10000px;top:0;width:190mm;visibility:hidden}
@media screen{body{background:#eee}.print-page{background:white;margin:0 auto 5mm;box-shadow:0 0 2px #777}}
@media print{#collection-source,#measure-card{display:none!important}.print-page{margin:0;box-shadow:none}}
</style></head><body><div id="day-pages" data-count="${requestedCount}" data-range="${escape(rangeLabel)}" data-printed-at="${escape(printedLabel)}" data-scope="${escape(selectionLabel)}"></div><div id="collection-source">${source}</div></body></html>`;
}

export function dayProductionPrintHtml(orders: ProductionOrder[], day: string, siteFilterLabel = "All sites") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw Error("Select a production date before printing.");
  const dayOrders = dayCollections(orders, day);
  if (!dayOrders.length) throw Error("No eligible collections were found for this production day.");
  const map = new Map([[day, dayOrders]]);
  const keys = runSheetPrintSiteOptions(map, [day]).map((site) => site.key);
  return runSheetProductionPrintHtml(map, [day], keys, new Date(), siteFilterLabel);
}

/** Runs in the print document after fonts settle. No estimated character/row limits:
 * each complete card is measured at both widths before assigning A4 space. */
export function paginateDayProduction(doc: Document = document) {
  const source = doc.getElementById("collection-source")!;
  const output = doc.getElementById("day-pages")!;
  output.replaceChildren();
  const grouped = new Map<string, { day: string; siteKey: string; siteLabel: string; cards: HTMLElement[] }>();
  for (const card of Array.from(source.children) as HTMLElement[]) {
    const day = card.dataset.day || output.dataset.day || "";
    const siteKey = card.dataset.siteKey || "order:" + (card.dataset.collectionId || "");
    const siteLabel = card.dataset.siteLabel || card.querySelector("h2")?.textContent || "Unspecified destination";
    const key = JSON.stringify([day, siteKey]);
    const group = grouped.get(key) || { day, siteKey, siteLabel, cards: [] };
    group.cards.push(card);
    grouped.set(key, group);
  }
  const measure = doc.createElement("div");
  measure.id = "measure-card";
  doc.body.append(measure);
  const pages: HTMLElement[] = [];
  const printedAt = output.dataset.printedAt || "";
  try {
    for (const group of grouped.values()) {
      const groupPageStart = pages.length;
      let grid: HTMLElement;
      const newPage = () => {
        const page = doc.createElement("section");
        page.className = "print-page";
        page.dataset.siteKey = group.siteKey;
        page.dataset.day = group.day;
        const header = doc.createElement("header");
        header.className = "day-heading";
        const brand = doc.createElement("p");
        brand.className = "brand";
        brand.textContent = "FIKA · PRODUCTION RUN SHEET";
        const title = doc.createElement("h1");
        title.textContent = group.siteLabel + " · " + group.day;
        const scope = doc.createElement("p");
        scope.className = "page-scope";
        scope.textContent = group.cards.length + " collections · Printed " + printedAt + " · Cancelled / amended work may make this paper stale.";
        const warning = doc.createElement("p");
        warning.className = "print-warning";
        warning.textContent = "Paper-only checkboxes · Reprint after changes · Not electronic delivery or allergen confirmation.";
        const gridElement = doc.createElement("div");
        gridElement.className = "page-cards";
        const handover = doc.createElement("footer");
        handover.className = "handover";
        handover.setAttribute("aria-label", "Paper handover fields");
        handover.innerHTML = "<span>Packed by:</span><span>Checked by:</span><span>Driver / collected by:</span><span>Departure time:</span><span>Delivered time:</span><span class=\"signature\">Received by / signature:</span><span>Notes / issues:</span>";
        const footer = doc.createElement("p");
        footer.className = "page-number";
        page.append(header, gridElement, handover, footer);
        header.append(brand, title, scope, warning);
        output.append(page);
        pages.push(page);
        return gridElement;
      };
      grid = newPage();
      const width = grid.getBoundingClientRect().width;
      const height = grid.getBoundingClientRect().height;
      const gap = parseFloat(doc.defaultView!.getComputedStyle(grid).rowGap) || 0;
      const halfWidth = (width - gap) / 2;
      const halfHeight = (height - gap) / 2;
      let used = 0, rows = 0, open: HTMLElement | undefined, openHeight = 0;
      const measured = (card: HTMLElement, w: number) => {
        measure.style.width = w + "px";
        measure.replaceChildren(card);
        card.style.width = "100%";
        return card.getBoundingClientRect().height;
      };
      const closeRow = () => {
        if (open) {
          used += (rows ? gap : 0) + openHeight;
          rows++;
          open = undefined;
          openHeight = 0;
        }
      };
      const advance = () => {
        grid = newPage();
        used = 0;
        rows = 0;
        open = undefined;
        openHeight = 0;
      };
      const place = (card: HTMLElement, size: "small" | "medium" | "large") => {
        const h = measured(card, size === "small" ? halfWidth : width);
        if (size === "small" && open) {
          if (used + (rows ? gap : 0) + Math.max(openHeight, h) <= height - 0.5) {
            open.append(card);
            openHeight = Math.max(openHeight, h);
            closeRow();
            return;
          }
          closeRow();
          advance();
        } else closeRow();
        if (used + (rows ? gap : 0) + h > height - 0.5) advance();
        const row = doc.createElement("div");
        row.className = "print-row";
        row.style.gridTemplateColumns = size === "small" ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)";
        row.append(card);
        grid.append(row);
        if (size === "small") {
          open = row;
          openHeight = h;
        } else {
          used += (rows ? gap : 0) + h;
          rows++;
        }
      };
      for (const original of group.cards) {
        const card = original.cloneNode(true) as HTMLElement;
        const half = measured(card, halfWidth);
        if (half <= halfHeight - 0.5) {
          place(card, "small");
          continue;
        }
        const full = measured(card, width);
        if (full <= halfHeight - 0.5) {
          place(card, "medium");
          continue;
        }
        if (full <= height - 0.5) {
          place(card, "large");
          continue;
        }
        const lines = Array.from(card.querySelectorAll("tbody tr")) as HTMLElement[];
        const segments: HTMLElement[] = [];
        let part: HTMLElement | undefined;
        const start = () => {
          const next = original.cloneNode(true) as HTMLElement;
          next.querySelector("tbody")!.replaceChildren();
          const label = doc.createElement("p");
          label.className = "continuation";
          label.textContent = "Collection continued · part 999 of 999";
          next.querySelector("header")!.append(label);
          return next;
        };
        for (const line of lines) {
          if (!part) part = start();
          part.querySelector("tbody")!.append(line.cloneNode(true));
          if (measured(part, width) > height - 0.5) {
            part.querySelector("tbody")!.lastElementChild!.remove();
            if (!part.querySelector("tbody")!.children.length)
              throw Error("A dish description is too large for readable A4 output. Review it before printing.");
            segments.push(part);
            part = start();
            part.querySelector("tbody")!.append(line.cloneNode(true));
            if (measured(part, width) > height - 0.5)
              throw Error("A dish description is too large for readable A4 output.");
          }
        }
        if (part) segments.push(part);
        segments.forEach((segment, index) => {
          if (index > 0) segment.removeAttribute("data-collection-start");
          segment.querySelector(".continuation")!.textContent = "Collection continued · part " + (index + 1) + " of " + segments.length;
          place(segment, "large");
        });
      }
      closeRow();
      const groupPages = pages.slice(groupPageStart);
      groupPages.forEach((page, index) => {
        const scope = page.querySelector(".page-scope")!;
        if (groupPages.length > 1) scope.textContent = "Continuation " + (index + 1) + " of " + groupPages.length + " · " + group.cards.length + " collections · Printed " + printedAt + " · Reprint after amendments or cancellations.";
      });
    }
    const actual = Array.from(output.children) as HTMLElement[];
    actual.forEach((page, index) => {
      page.querySelector(".page-number")!.textContent = "Page " + (index + 1) + " of " + actual.length;
    });
    output.dataset.layoutReady = "true";
  } finally {
    measure.remove();
  }
}
