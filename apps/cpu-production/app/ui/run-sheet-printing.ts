import type { ProductionOrder } from "../../lib/production-types";
import { addOperationalDays, inclusiveOperationalDays, isOperationalDate } from "../../lib/production-totals-range";
import { cpuDestinationLabel, isCpuWithdrawn } from "../../lib/production-presentation";
import { loadWholeDay } from "./whole-day-production";
import { europeLondonDate } from "../../lib/operational-date";
import { collectionTime, referenceAlias } from "./run-sheet-presentation";
import { isAdHocProductionOrder } from "../../lib/production-presentation";

export const MAX_RUN_SHEET_PRINT_DAYS = 31;

export type RunSheetPrintSite = {
  key: string;
  label: string;
  displayLabel: string;
  orderCount: number;
  serviceCounts: Partial<Record<RunSheetServiceKey, number>>;
};

export const RUN_SHEET_SERVICES = [
  { key: "delivered_in", label: "Delivered-In", detail: "Published and routed Delivered-In production" },
  { key: "grab_and_go", label: "Grab & Go", detail: "Grab & Go service orders" },
  { key: "hospitality", label: "Hospitality", detail: "Hospitality bookings and production" },
  { key: "direct_cpu", label: "Ad-Hoc / direct CPU", detail: "Direct CPU-created orders" },
  { key: "events", label: "Events & Corporate", detail: "Events production category" },
  { key: "fine_dining", label: "Fine Dining", detail: "Fine Dining production category" },
  { key: "other", label: "Other CPU production", detail: "Other canonical production category" },
] as const;

export type RunSheetServiceKey = (typeof RUN_SHEET_SERVICES)[number]["key"];
export type RunSheetServiceOverrides = Readonly<Record<string, Readonly<Partial<Record<RunSheetServiceKey, boolean>>>>>;

/** Service identity comes from canonical category and source routing, never the display label. */
export function runSheetServiceKey(order: ProductionOrder): RunSheetServiceKey {
  if (isAdHocProductionOrder(order)) return "direct_cpu";
  switch (order.productionCategory) {
    case "delivered_in": return "delivered_in";
    case "grab_and_go": return "grab_and_go";
    case "hospitality": return "hospitality";
    case "events": return "events";
    case "fine_dining": return "fine_dining";
    case "other": return "other";
  }
  switch (order.origin) {
    case "hospitality_booking": return "hospitality";
    case "grab_and_go": return "grab_and_go";
    case "cpu_created": return "direct_cpu";
    case "menu_planning":
    case "legacy_import": return "delivered_in";
  }
}

export type RunSheetPrintMode = "today" | "tomorrow" | "custom";

export function eligibleRunSheetDayOrders(orders: readonly ProductionOrder[], day: string): ProductionOrder[] {
  const latest = new Map<string, ProductionOrder>();
  for (const order of orders) {
    const prior = latest.get(order.canonicalId);
    if (!prior || prior.version < order.version) latest.set(order.canonicalId, order);
  }
  return [...latest.values()]
    .filter((order) => order.serviceDate === day && !order.supersededBy && !["cancelled", "rejected"].includes(order.status) && !isCpuWithdrawn(order))
    .sort((a, b) => collectionTime(a).localeCompare(collectionTime(b)) || cpuDestinationLabel(a).localeCompare(cpuDestinationLabel(b)) || a.canonicalId.localeCompare(b.canonicalId));
}

export function runSheetPrintDates(
  mode: RunSheetPrintMode,
  now = new Date(),
  customFrom = "",
  customTo = "",
): string[] {
  const today = europeLondonDate(now);
  const from = mode === "today" ? today : mode === "tomorrow" ? addOperationalDays(today, 1) : customFrom;
  const to = mode === "today" || mode === "tomorrow" ? from : customTo;
  if (!isOperationalDate(from) || !isOperationalDate(to)) return [];
  const count = inclusiveOperationalDays({ from, to });
  if (count < 1 || count > MAX_RUN_SHEET_PRINT_DAYS) return [];
  return Array.from({ length: count }, (_, index) => addOperationalDays(from, index));
}

/** Stable destination identity; labels are presentation only. Unscoped snapshots stay order-scoped. */
export function runSheetDestinationKey(order: ProductionOrder): string {
  const oploc = order.destinationOplocId?.trim();
  if (oploc) return `oploc:${oploc}`;
  const snapshot = order.destinationAddress?.identity?.trim();
  if (snapshot) return `snapshot:${snapshot}`;
  return `order:${order.canonicalId}`;
}

export function runSheetPrintSiteOptions(
  ordersByDay: ReadonlyMap<string, readonly ProductionOrder[]>,
  days: readonly string[],
): RunSheetPrintSite[] {
  const counts = new Map<string, { label: string; orderIds: Set<string>; serviceOrderIds: Map<RunSheetServiceKey, Set<string>> }>();
  for (const day of days) {
    for (const order of eligibleRunSheetDayOrders(ordersByDay.get(day) || [], day)) {
      const key = runSheetDestinationKey(order);
      const current = counts.get(key) || { label: cpuDestinationLabel(order), orderIds: new Set<string>(), serviceOrderIds: new Map<RunSheetServiceKey, Set<string>>() };
      current.orderIds.add(order.canonicalId);
      const service = runSheetServiceKey(order);
      const serviceIds = current.serviceOrderIds.get(service) || new Set<string>();
      serviceIds.add(order.canonicalId);
      current.serviceOrderIds.set(service, serviceIds);
      counts.set(key, current);
    }
  }
  const rows = [...counts.entries()].map(([key, value]) => ({
    key,
    label: value.label,
    orderCount: value.orderIds.size,
    serviceCounts: Object.fromEntries([...value.serviceOrderIds].map(([service, ids]) => [service, ids.size])) as Partial<Record<RunSheetServiceKey, number>>,
  }));
  const labelCounts = new Map<string, number>();
  for (const row of rows) labelCounts.set(row.label, (labelCounts.get(row.label) || 0) + 1);
  return rows
    .map((row) => ({
      ...row,
      displayLabel: labelCounts.get(row.label)! > 1 ? `${row.label} · Site ${referenceAlias(row.key)}` : row.label,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
}

export function runSheetPrintServiceOptions(
  ordersByDay: ReadonlyMap<string, readonly ProductionOrder[]>,
  days: readonly string[],
) {
  const orderIds = new Map<RunSheetServiceKey, Set<string>>();
  for (const day of days) {
    for (const order of eligibleRunSheetDayOrders(ordersByDay.get(day) || [], day)) {
      const service = runSheetServiceKey(order);
      const ids = orderIds.get(service) || new Set<string>();
      ids.add(order.canonicalId);
      orderIds.set(service, ids);
    }
  }
  return RUN_SHEET_SERVICES.flatMap((service) => {
    const count = orderIds.get(service.key)?.size || 0;
    return count ? [{ ...service, orderCount: count }] : [];
  });
}

export async function loadRunSheetPrintDays(
  days: readonly string[],
  fetcher: typeof fetch = fetch,
  onProgress?: (completed: number, total: number, day: string) => void,
): Promise<Map<string, ProductionOrder[]>> {
  if (!days.length || days.length > MAX_RUN_SHEET_PRINT_DAYS || days.some((day) => !isOperationalDate(day))) {
    throw Error(`Choose a valid date range of 1–${MAX_RUN_SHEET_PRINT_DAYS} days.`);
  }
  const ordersByDay = new Map<string, ProductionOrder[]>();
  for (const [index, day] of days.entries()) {
    const orders = await loadWholeDay(day, fetcher);
    ordersByDay.set(day, orders);
    onProgress?.(index + 1, days.length, day);
  }
  return ordersByDay;
}

export function selectedRunSheetPrintOrders(
  ordersByDay: ReadonlyMap<string, readonly ProductionOrder[]>,
  days: readonly string[],
  selectedSiteKeys: readonly string[],
  selectedServiceKeys?: readonly RunSheetServiceKey[],
  siteServiceOverrides: RunSheetServiceOverrides = {},
): Map<string, ProductionOrder[]> {
  const selected = new Set(selectedSiteKeys);
  const selectedServices = selectedServiceKeys ? new Set(selectedServiceKeys) : undefined;
  const output = new Map<string, ProductionOrder[]>();
  for (const day of days) {
    const orders = eligibleRunSheetDayOrders(ordersByDay.get(day) || [], day)
      .filter((order) => {
        const siteKey = runSheetDestinationKey(order);
        if (!selected.has(siteKey)) return false;
        const service = runSheetServiceKey(order);
        const override = siteServiceOverrides[siteKey]?.[service];
        return override === undefined ? !selectedServices || selectedServices.has(service) : override;
      });
    if (orders.length) output.set(day, orders);
  }
  return output;
}
