import type { ProductionOrder } from "../../lib/production-types";
import {
  collectionDetails,
  collectionServiceDate,
  runSheetDateLabel,
  collectionQuantity,
  collectionQuantityHeading,
  isCoreSaladLine,
} from "./run-sheet-presentation";
import {
  cpuDestinationLabel,
} from "../../lib/production-presentation";
import { paperRunSheetStyles } from "./run-sheet-paper-styles";
import { runSheetMenuSections } from "../../lib/menu-run-sheet-order";
import {
  eligibleRunSheetDayOrders,
  runSheetDestinationKey,
  runSheetPrintSiteOptions,
  selectedRunSheetPrintOrders,
  type RunSheetServiceKey,
  type RunSheetServiceOverrides,
} from "./run-sheet-printing";
export const escapePrintHtml = (value: unknown) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const escape = escapePrintHtml;

export function dayCollections(orders: ProductionOrder[], day: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day))
    throw Error("Select a production date before printing.");
  return eligibleRunSheetDayOrders(orders, day);
}
const londonPrintTimestamp = (date: Date) => new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London", dateStyle: "medium", timeStyle: "short",
}).format(date);

function printLineRows(order: ProductionOrder) {
  return runSheetMenuSections(order).flatMap(section => [
    `<tr class="menu-section-row"><th colspan="4">${escape(section.label)}</th></tr>`,
    ...section.lines.map(({ line, slotLabel }, index) => {
      const core = isCoreSaladLine(line);
      const style = core ? "core-salad" : index % 2 ? "stripe" : "";
      return `<tr data-line-id="${escape(line.canonicalId)}" class="${style}"><td class="check"><i class="box"></i></td><td class="category">${escape(slotLabel || "—")}</td><td class="dish">${escape(line.itemName)}${core ? ' <small class="core-salad-label" aria-label="Core Salad">CORE</small>' : ""}</td><td class="quantity"><strong>${escape(collectionQuantity(line))}</strong></td></tr>`;
    }),
  ]).join("");
}

const handoverFields = '<footer class="handover" aria-label="Paper handover fields"><span>Packed by:</span><span>Checked by:</span><span>Driver / collected by:</span><span>Departure time:</span><span>Delivered time:</span><span class="signature">Received by / signature:</span><span class="notes">Notes / issues:</span></footer>';

function printCollection(order: ProductionOrder, day: string, siteKey: string, siteLabel: string) {
  const details = collectionDetails(order);
  const event = [details.client, details.event].filter(Boolean).join(" · ");
  return `<article class="collection" data-collection-id="${escape(order.canonicalId)}" data-collection-start="true" data-site-key="${escape(siteKey)}" data-site-label="${escape(siteLabel)}" data-day="${escape(day)}" data-date-label="${escape(runSheetDateLabel(day))}">
<header class="collection-header"><h2>${escape(cpuDestinationLabel(order))}</h2>${event ? `<p class="event">${escape(event)}</p>` : ""}
<dl class="collection-details">
<div><dt>Service type</dt><dd>${escape(details.service)}</dd></div>
<div><dt>Ready By</dt><dd>${escape(details.readyBy)}</dd></div>
<div><dt>Collection Time</dt><dd>${escape(details.collection)}</dd></div>
<div><dt>Order ref</dt><dd>${escape(details.reference)}</dd></div>
${details.serviceWindow && details.serviceWindow !== "TBC" ? `<div class="service-window"><dt>Service / delivery window</dt><dd>${escape(details.serviceWindow)}</dd></div>` : ""}
</dl></header>${order.kitchenNotes ? `<section class="kitchen-instructions"><strong>Kitchen notes</strong><p>${escape(order.kitchenNotes).replace(/\r?\n/g, "<br>")}</p></section>` : ""}
<table><thead><tr><th class="check" scope="col">Pack</th><th class="category-column" scope="col">Category</th><th scope="col">Dish name</th><th class="quantity" scope="col">${escape(collectionQuantityHeading(order))}</th></tr></thead><tbody>${printLineRows(order)}</tbody></table>${handoverFields}</article>`;
}

function printDocument(source: string, printedAt: Date, scope: string, layout: RunSheetLayout) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>FIKA CPU production run sheets</title><style>${paperRunSheetStyles}</style></head><body><div id="day-pages" data-layout="${layout}" data-printed-at="${escape(londonPrintTimestamp(printedAt))}" data-scope="${escape(scope)}"></div><div id="collection-source">${source}</div></body></html>`;
}

export type RunSheetLayout = "compact" | "full";
export function collectionPrintHtml(order: ProductionOrder, printedAt = new Date()) {
  const day = collectionServiceDate(order);
  const site = cpuDestinationLabel(order);
  return printDocument(printCollection(order, day, runSheetDestinationKey(order), site), printedAt, site, "full");
}

export function runSheetProductionPrintHtml(
  ordersByDay: ReadonlyMap<string, readonly ProductionOrder[]>,
  days: readonly string[],
  selectedSiteKeys: readonly string[],
  printedAt = new Date(),
  selectionLabel = "Selected sites",
  layout: RunSheetLayout = "compact",
  selectedServiceKeys?: readonly RunSheetServiceKey[],
  siteServiceOverrides: RunSheetServiceOverrides = {},
) {
  const selectedByDay = selectedRunSheetPrintOrders(ordersByDay, days, selectedSiteKeys, selectedServiceKeys, siteServiceOverrides);
  const allSelected = [...selectedByDay.values()].flat();
  if (!allSelected.length) throw Error("No eligible collections were found for the selected services, sites and dates.");
  const sites = runSheetPrintSiteOptions(ordersByDay, days);
  const labels = new Map(sites.map((site) => [site.key, site.displayLabel]));
  const source = days.flatMap((day) => (selectedByDay.get(day) || []).map((order) => {
    const siteKey = runSheetDestinationKey(order);
    return printCollection(order, day, siteKey, labels.get(siteKey) || cpuDestinationLabel(order));
  })).join("");
  return printDocument(source, printedAt, selectionLabel, layout);
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
  const staging = doc.documentElement.dataset.fikaRuntime === "staging";
  output.replaceChildren();
  const grouped = new Map<string, { day: string; dateLabel: string; siteKey: string; siteLabel: string; cards: HTMLElement[] }>();
  for (const card of Array.from(source.children) as HTMLElement[]) {
    const day = card.dataset.day || output.dataset.day || "";
    const siteKey = card.dataset.siteKey || "order:" + (card.dataset.collectionId || "");
    const siteLabel = card.dataset.siteLabel || card.querySelector("h2")?.textContent || "Unspecified destination";
    const key = JSON.stringify([day, siteKey]);
    const group = grouped.get(key) || { day, dateLabel: card.dataset.dateLabel || day, siteKey, siteLabel, cards: [] };
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
      let grid: HTMLElement;
      const newPage = () => {
        const page = doc.createElement("section");
        page.className = "print-page";
        page.dataset.siteKey = group.siteKey;
        page.dataset.day = group.day;
        const header = doc.createElement("header");
        header.className = "day-heading";
        header.innerHTML = (staging ? '<p class="staging-print-warning">STAGING / NOT FOR OPERATIONAL USE</p>' : '') + '<div class="brand-lockup"><span class="wordmark" aria-hidden="true">FIKA</span><div class="heading-copy"><p class="brand">FIKA · CPU PRODUCTION RUN SHEET</p><h1></h1></div><p class="heading-date"></p></div><p class="page-scope"></p><p class="print-warning">Paper-only checkboxes · Reprint after changes · Not electronic delivery or allergen confirmation.</p><p class="stale-warning">Cancelled or amended work may make this paper stale.</p>';
        header.querySelector("h1")!.textContent = group.siteLabel;
        header.querySelector(".heading-date")!.textContent = group.dateLabel;
        const count = group.cards.length;
        header.querySelector(".page-scope")!.textContent = `Printed ${printedAt} · ${count} collection${count === 1 ? "" : "s"}`;
        const gridElement = doc.createElement("div");
        gridElement.className = "page-cards";
        const footer = doc.createElement("p");
        footer.className = "page-number";
        footer.textContent = "Page";
        page.append(header, gridElement, footer);
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
        const compact = output.dataset.layout === "compact" && group.cards.length > 1;
        if (compact && measured(card, halfWidth) <= halfHeight - 0.5) {
          place(card, "small");
          continue;
        }
        const full = measured(card, width);
        if (compact && full <= halfHeight - 0.5) {
          place(card, "medium");
          continue;
        }
        if (full <= height - 0.5) {
          place(card, "large");
          continue;
        }
        const lines = Array.from(card.querySelectorAll("tbody tr")) as HTMLElement[];
        let section: HTMLElement | undefined;
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
          if (line.classList.contains("menu-section-row")) {
            section = line;
            continue;
          }
          if (!part) part = start();
          let body = part.querySelector("tbody")!;
          const lastSection = Array.from(body.querySelectorAll(".menu-section-row")).at(-1);
          const addHeading = section && section.textContent !== lastSection?.textContent;
          if (addHeading) body.append(section!.cloneNode(true));
          body.append(line.cloneNode(true));
          if (measured(part, width) > height - 0.5) {
            body.lastElementChild!.remove();
            if (addHeading) body.lastElementChild!.remove();
            if (!body.children.length)
              throw Error("A dish description is too large for readable A4 output. Review it before printing.");
            segments.push(part);
            part = start();
            body = part.querySelector("tbody")!;
            if (section) body.append(section.cloneNode(true));
            body.append(line.cloneNode(true));
            if (measured(part, width) > height - 0.5)
              throw Error("A dish description is too large for readable A4 output.");
          }
        }
        if (part) segments.push(part);
        segments.forEach((segment, index) => {
          if (index > 0) segment.removeAttribute("data-collection-start");
          if (index < segments.length - 1) segment.querySelector(".handover")!.remove();
          segment.querySelector(".continuation")!.textContent = "Collection continued · part " + (index + 1) + " of " + segments.length;
          place(segment, "large");
        });
      }
      closeRow();

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
