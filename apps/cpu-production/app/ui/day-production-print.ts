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
  const latest = new Map<string, ProductionOrder>();
  for (const order of orders) {
    const prior = latest.get(order.canonicalId);
    if (!prior || prior.version < order.version)
      latest.set(order.canonicalId, order);
  }
  return [...latest.values()]
    .filter(
      (o) =>
        o.serviceDate === day &&
        !o.supersededBy &&
        !["cancelled", "rejected"].includes(o.status),
    )
    .sort(
      (a, b) =>
        collectionTime(a).localeCompare(collectionTime(b)) ||
        cpuDestinationLabel(a).localeCompare(cpuDestinationLabel(b)) ||
        a.canonicalId.localeCompare(b.canonicalId),
    );
}
export function dayProductionPrintHtml(orders: ProductionOrder[], day: string, siteFilterLabel = "All sites") {
  const selected = dayCollections(orders, day);
  if (!selected.length)
    throw Error("No eligible collections were found for this production day.");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Production ${escape(day)}</title><style>
@page{size:A4 portrait;margin:10mm}*{box-sizing:border-box}body{margin:0;background:white;color:black;font:10pt/1.25 Arial,sans-serif}
.print-page{width:190mm;height:276mm;break-after:page;page-break-after:always;display:flex;flex-direction:column}.print-page:last-child{break-after:auto;page-break-after:auto}
.day-heading{height:18mm;flex:none;border-bottom:.5pt solid black;margin-bottom:3mm}.day-heading h1{font-size:15pt;margin:0 0 1mm}.day-heading p{font-size:8pt;margin:0}
.page-cards{height:249mm;display:flex;flex-direction:column;gap:3mm;flex:none}.print-row{display:grid;gap:3mm;align-items:start;flex:none;min-width:0}
.collection{border:1pt dashed black;padding:3mm;break-inside:avoid;overflow-wrap:anywhere;min-width:0}.collection h2{font-size:15pt;line-height:1.1;margin:0 0 2mm}.collection p{font-size:9pt;margin:1mm 0}.collection .source{font-size:8pt}.collection table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:2mm}.collection th,.collection td{text-align:left;vertical-align:top;padding:1.6mm .7mm;border-bottom:.4pt solid #aaa;font-size:10pt;font-weight:normal}.collection thead th{font-size:8pt;font-weight:bold}.collection thead{display:table-header-group}.collection tr{break-inside:avoid}.collection .check{width:8mm}.collection .quantity{width:25%;text-align:right}.box{display:block;width:5mm;height:5mm;border:1pt solid black}.collection footer{display:flex;flex-wrap:wrap;gap:2mm 5mm;margin-top:4mm;font-size:9pt}.collection footer span{white-space:nowrap}.continuation{font-weight:bold}.page-number{height:5mm;margin:1mm 0 0;font-size:8pt;text-align:right;flex:none}
#collection-source{position:absolute;left:-10000px;top:0;width:190mm;visibility:hidden}#measure-card{position:absolute;left:-10000px;top:0;visibility:hidden}
@media screen{body{background:#ddd}.print-page{background:white;margin:0 auto 5mm;box-shadow:0 0 2px #777}}
@media print{#collection-source,#measure-card{display:none!important}.print-page{margin:0;box-shadow:none}}
</style></head><body><div id="day-pages" data-day="${escape(day)}" data-count="${selected.length}" data-scope="${escape(siteFilterLabel)}"></div><div id="collection-source">${selected.map((order) => `<article class="collection" data-collection-id="${escape(order.canonicalId)}" data-collection-start="true"><header><h2>${escape(cpuDestinationLabel(order))}</h2><p><b>${escape(collectionDate(order))} · Ready / collection ${escape(collectionTime(order))}</b></p><p class="source">${escape([cpuSourceLabel(order), order.serviceType, order.sourcePublicationDayId || order.sourcePublicationId || order.sourceEntityId || order.sourceBookingId, order.sourceVersion === undefined ? "" : "v" + order.sourceVersion].filter(Boolean).join(" · "))}</p></header><table><thead><tr><th class="check">Tick</th><th>Dish</th><th class="quantity">Quantity</th></tr></thead><tbody>${order.lines.map((line) => `<tr data-line-id="${escape(line.canonicalId)}"><td class="check"><i class="box"></i></td><td>${escape(line.itemName)}</td><td class="quantity">${escape(collectionQuantity(line))}</td></tr>`).join("")}</tbody></table><footer><span>Packed by: __________</span><span>Checked by: __________</span></footer></article>`).join("")}</div></body></html>`;
}

/** Runs in the print document after fonts settle. No estimated character/row limits:
 * each complete card is measured at both widths before assigning A4 space. */
export function paginateDayProduction(doc: Document = document) {
  const source = doc.getElementById("collection-source")!;
  const output = doc.getElementById("day-pages")!;
  output.replaceChildren();
  const measure = doc.createElement("div");
  measure.id = "measure-card";
  doc.body.append(measure);
  const pages: HTMLElement[] = [];
  const newPage = () => {
    const page = doc.createElement("section");
    page.className = "print-page";
    const header = doc.createElement("header");
    header.className = "day-heading";
    const title = doc.createElement("h1");
    title.textContent = "Production · " + output.dataset.day;
    const scope = doc.createElement("p");
    scope.textContent =
      "Whole day · " + output.dataset.scope + " / all origins / production scopes · " +
      output.dataset.count +
      " collections · cancelled / superseded excluded";
    header.append(title, scope);
    const grid = doc.createElement("div");
    grid.className = "page-cards";
    const footer = doc.createElement("p");
    footer.className = "page-number";
    page.append(header, grid, footer);
    output.append(page);
    pages.push(page);
    return grid;
  };
  let grid = newPage();
  const width = grid.getBoundingClientRect().width;
  const height = grid.getBoundingClientRect().height;
  const gap = parseFloat(doc.defaultView!.getComputedStyle(grid).columnGap);
  const halfWidth = (width - gap) / 2,
    halfHeight = (height - gap) / 2;
  let used = 0,
    rows = 0,
    open: HTMLElement | undefined,
    openHeight = 0;
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
    row.style.gridTemplateColumns =
      size === "small" ? "repeat(2,minmax(0,1fr))" : "minmax(0,1fr)";
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
  try {
    for (const original of Array.from(source.children) as HTMLElement[]) {
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
      // Oversized collection: repeat identity/header/signatures, partition only rows.
      const rows = Array.from(
        card.querySelectorAll("tbody tr"),
      ) as HTMLElement[];
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
      for (const row of rows) {
        if (!part) part = start();
        part.querySelector("tbody")!.append(row.cloneNode(true));
        if (measured(part, width) > height - 0.5) {
          part.querySelector("tbody")!.lastElementChild!.remove();
          if (!part.querySelector("tbody")!.children.length)
            throw Error(
              "A dish description is too large for readable A4 output. Review it before printing.",
            );
          segments.push(part);
          part = start();
          part.querySelector("tbody")!.append(row.cloneNode(true));
          if (measured(part, width) > height - 0.5)
            throw Error(
              "A dish description is too large for readable A4 output.",
            );
        }
      }
      if (part) segments.push(part);
      segments.forEach((segment, i) => {
        if (i > 0) segment.removeAttribute("data-collection-start");
        segment.querySelector(".continuation")!.textContent =
          "Collection continued · part " + (i + 1) + " of " + segments.length;
        place(segment, "large");
      });
    }
    pages
      .filter((page) => !page.querySelector(".collection"))
      .forEach((page) => page.remove());
    const actual = Array.from(output.children);
    actual.forEach((page, i) => {
      page.querySelector(".page-number")!.textContent =
        "Page " + (i + 1) + " of " + actual.length;
    });
    output.dataset.layoutReady = "true";
  } finally {
    measure.remove();
  }
}
