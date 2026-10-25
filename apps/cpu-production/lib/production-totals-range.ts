import type { ProductionOrder } from "./production-types";
import { isCpuWithdrawn } from "./production-presentation";
import { orderDate } from "./production-day";

export type ProductionTotalsPreset = "today" | "tomorrow" | "this_week" | "next_week" | "custom";
export type ProductionTotalsDateRange = { from: string; to: string };
export type ProductionTotalsRangeResolution = { range: ProductionTotalsDateRange; error?: undefined } | { range?: undefined; error: string };

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isOperationalDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function addOperationalDays(value: string, days: number): string {
  if (!isOperationalDate(value) || !Number.isInteger(days)) throw new Error("A valid operational date and whole number of days are required.");
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function operationalWeekRange(value: string, weekOffset = 0): ProductionTotalsDateRange {
  if (!isOperationalDate(value) || !Number.isInteger(weekOffset)) throw new Error("A valid operational date and whole number week offset are required.");
  const date = new Date(`${value}T00:00:00Z`);
  const weekday = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() - weekday + 1 + weekOffset * 7);
  const from = date.toISOString().slice(0, 10);
  return { from, to: addOperationalDays(from, 6) };
}

export function inclusiveOperationalDays(range: ProductionTotalsDateRange): number {
  if (!isOperationalDate(range.from) || !isOperationalDate(range.to)) return 0;
  const start = Date.parse(`${range.from}T00:00:00Z`);
  const end = Date.parse(`${range.to}T00:00:00Z`);
  return Math.floor((end - start) / 86_400_000) + 1;
}

export function resolveProductionTotalsRange(preset: ProductionTotalsPreset, today: string, customFrom = "", customTo = ""): ProductionTotalsRangeResolution {
  if (!isOperationalDate(today)) return { error: "The London operational date is not ready yet." };
  if (preset === "today") return { range: { from: today, to: today } };
  if (preset === "tomorrow") {
    const tomorrow = addOperationalDays(today, 1);
    return { range: { from: tomorrow, to: tomorrow } };
  }
  if (preset === "this_week") return { range: operationalWeekRange(today) };
  if (preset === "next_week") return { range: operationalWeekRange(today, 1) };
  if (!isOperationalDate(customFrom) || !isOperationalDate(customTo)) return { error: "Choose both a valid From and To date." };
  if (customFrom > customTo) return { error: "From must be on or before To." };
  if (inclusiveOperationalDays({ from: customFrom, to: customTo }) > 31) return { error: "Choose a date range of 31 days or fewer." };
  return { range: { from: customFrom, to: customTo } };
}

export function productionWeeksInRange(range: ProductionTotalsDateRange): string[] {
  if (!isOperationalDate(range.from) || !isOperationalDate(range.to) || range.from > range.to || inclusiveOperationalDays(range) > 31) return [];
  const weeks: string[] = [];
  let week = operationalWeekRange(range.from).from;
  while (week <= range.to) {
    weeks.push(week);
    week = addOperationalDays(week, 7);
  }
  return weeks;
}

export function filterProductionTotalsOrders(orders: ProductionOrder[], range: ProductionTotalsDateRange | undefined, site = "", origin = ""): ProductionOrder[] {
  if (!range) return [];
  const unique = new Map<string, ProductionOrder>();
  for (const order of orders) {
    const prior = unique.get(order.canonicalId);
    if (!prior || order.version > prior.version) unique.set(order.canonicalId, order);
  }
  return [...unique.values()].filter(order => {
    const date = orderDate(order);
    return !isCpuWithdrawn(order) && date >= range.from && date <= range.to && (!site || order.destinationOplocId === site) && (!origin || order.origin === origin);
  });
}

/** Apply an already-verified selected-day set after weekly canonical deduplication. */
export function filterProductionTotalsOrdersToDates(orders: ProductionOrder[], selectedDates: string[]): ProductionOrder[] {
  const dates = new Set(selectedDates.filter(isOperationalDate));
  return orders.filter(order => dates.has(orderDate(order)) && !isCpuWithdrawn(order));
}

export function productionTotalsWeekDates(weekCommencing: string): string[] {
  if (!isOperationalDate(weekCommencing) || operationalWeekRange(weekCommencing).from !== weekCommencing) return [];
  return Array.from({ length: 7 }, (_, index) => addOperationalDays(weekCommencing, index));
}

export function formatProductionTotalsSelection(weekCommencing: string, selectedDays: number[]): string {
  const dates = productionTotalsWeekDates(weekCommencing);
  const indexes = [...new Set(selectedDays)].filter(index => Number.isInteger(index) && index >= 0 && index < dates.length).sort((a, b) => a - b);
  if (!indexes.length) return "No days selected";
  const shortDate = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  if (indexes.length === 7) return `All days · ${shortDate(dates[0])} – ${shortDate(dates[6])}`;
  if (indexes.length === 5 && indexes.every((day, index) => day === index)) return `Weekdays · ${shortDate(dates[0])} – ${shortDate(dates[4])}`;
  return `Selected days · ${indexes.map(index => shortDate(dates[index])).join(", ")}`;
}

export function formatProductionTotalsDateRange(range: ProductionTotalsDateRange): string {
  const format = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `${format(range.from)} – ${format(range.to)}`;
}
