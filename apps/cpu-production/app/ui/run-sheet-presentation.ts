import type { ProductionLine, ProductionOrder } from "../../lib/production-types";
import { cpuSourceLabel } from "../../lib/production-presentation";
import { orderedQuantityLabel } from "../../lib/ordered-quantity";
import { europeLondonDate } from "../../lib/operational-date";

export function collectionOrders(orders: ProductionOrder[]) {
  const unique = new Map<string, ProductionOrder>();
  for (const order of orders) {
    if ((unique.get(order.canonicalId)?.version ?? -1) < order.version) unique.set(order.canonicalId, order);
  }
  return [...unique.values()].sort(
    (a, b) => a.requiredBy.localeCompare(b.requiredBy) || a.canonicalId.localeCompare(b.canonicalId),
  );
}

export function collectionQuantity(line: ProductionLine) { return orderedQuantityLabel(line); }
export const isCoreSaladLine = (line: ProductionLine) => line.isCoreSalad === true;
export const collectionQuantityHeading = (order: ProductionOrder) => order.origin === "menu_planning" ? "Portions" : "Customer ordered quantity";

const londonTime = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
const londonDate = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", dateStyle: "full" });

export function collectionReadyBy(order: ProductionOrder) {
  const value = order.requiredBy || "";
  const localTime = /^\d{4}-\d{2}-\d{2}T(\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value)?.[1];
  if (localTime) return localTime === "00:00" ? "TBC" : localTime;
  const parsed = new Date(value);
  return value.includes("T") && Number.isFinite(parsed.getTime()) ? londonTime.format(parsed) : "TBC";
}

function recordedServiceWindow(order: ProductionOrder) {
  const window = order.serviceWindow;
  return window?.startTime && window.startTime !== "00:00"
    ? [window.startTime, window.endTime].filter(Boolean).join("–")
    : "TBC";
}

export function collectionTime(order: ProductionOrder) {
  return recordedServiceWindow(order);
}

export function runSheetDateLabel(day: string) {
  const date = new Date(day + "T12:00:00Z");
  return Number.isFinite(date.getTime()) ? londonDate.format(date) : "Date TBC";
}

export function collectionServiceDate(order: ProductionOrder) {
  if (order.serviceDate) return order.serviceDate;
  const date = new Date(order.requiredBy);
  if (!Number.isFinite(date.getTime())) return "";
  return /(?:Z|[+-]\d{2}:\d{2})$/.test(order.requiredBy) ? europeLondonDate(date) : order.requiredBy.slice(0, 10);
}

export function collectionDate(order: ProductionOrder) {
  return runSheetDateLabel(collectionServiceDate(order));
}

/** A short print alias for the actual order ID. Keep the full identity for matching and packing writes. */
export function referenceAlias(identity: string) {
  const existingDigest = /:([a-f\d]{12,})$/i.exec(identity)?.[1];
  if (existingDigest) return existingDigest.slice(0, 10).toUpperCase();
  let hash = 0x811c9dc5;
  for (const character of identity) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193);
  return (hash >>> 0).toString(36).padStart(7, "0").toUpperCase();
}

export function collectionDetails(order: ProductionOrder) {
  const hospitality = order.origin === "hospitality_booking";
  const source = (hospitality ? order.sourceBookingId : order.sourceEntityId || order.sourceBookingId)?.trim();
  const reference = order.origin !== "menu_planning" && source && /^[\w-]{1,32}$/.test(source) && source !== order.canonicalId
    ? source
    : (hospitality ? "BK-" : order.origin === "menu_planning" ? "DI-" : order.origin === "grab_and_go" ? "GG-" : "CPU-") +
      referenceAlias(hospitality && source ? source : order.canonicalId);
  const event = hospitality ? order.bookingNotes?.match(/^Event:[ \t]*([^\r\n]+)/m)?.[1].trim() : undefined;
  return {
    service: order.serviceType || cpuSourceLabel(order),
    readyBy: collectionReadyBy(order),
    collection: order.requiresDelivery === false ? recordedServiceWindow(order) : "TBC",
    serviceWindow: order.requiresDelivery !== false ? recordedServiceWindow(order) : undefined,
    client: hospitality ? order.clientName : undefined,
    event,
    reference: order.sourceVersion === undefined ? reference : `${reference} · v${order.sourceVersion}`,
  };
}
