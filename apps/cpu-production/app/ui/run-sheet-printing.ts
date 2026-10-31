import type { ProductionOrder } from "../../lib/production-types";
import { addOperationalDays, inclusiveOperationalDays, isOperationalDate } from "../../lib/production-totals-range";
import { cpuDestinationLabel, isCpuWithdrawn } from "../../lib/production-presentation";
import { loadWholeDay } from "./whole-day-production";
import { europeLondonDate } from "../../lib/operational-date";
import { collectionTime } from "./kitchen-print";

export const MAX_RUN_SHEET_PRINT_DAYS = 31;

export type RunSheetPrintSite = {
  key: string;
  label: string;
  displayLabel: string;
  orderCount: number;
};

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
  const counts = new Map<string, { label: string; orderIds: Set<string> }>();
  for (const day of days) {
    for (const order of eligibleRunSheetDayOrders(ordersByDay.get(day) || [], day)) {
      const key = runSheetDestinationKey(order);
      const current = counts.get(key) || { label: cpuDestinationLabel(order), orderIds: new Set<string>() };
      current.orderIds.add(order.canonicalId);
      counts.set(key, current);
    }
  }
  const rows = [...counts.entries()].map(([key, value]) => ({ key, label: value.label, orderCount: value.orderIds.size }));
  const labelCounts = new Map<string, number>();
  for (const row of rows) labelCounts.set(row.label, (labelCounts.get(row.label) || 0) + 1);
  return rows
    .map((row) => ({
      ...row,
      displayLabel: labelCounts.get(row.label)! > 1 ? `${row.label} · ${row.key.replace(/^(oploc|snapshot|order):/, "")}` : row.label,
    }))
    .sort((a, b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
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
): Map<string, ProductionOrder[]> {
  const selected = new Set(selectedSiteKeys);
  const output = new Map<string, ProductionOrder[]>();
  for (const day of days) {
    const orders = eligibleRunSheetDayOrders(ordersByDay.get(day) || [], day)
      .filter((order) => selected.has(runSheetDestinationKey(order)));
    if (orders.length) output.set(day, orders);
  }
  return output;
}
