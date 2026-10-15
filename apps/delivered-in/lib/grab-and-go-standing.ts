import { applyOrderAction, isBeforeOrderCutoff, orderIdFor, productsForDeliveryDate, rotationWeekForDate, type GrabAndGoOrder, type GrabAndGoProduct } from "./grab-and-go";

/** Grab & Go is only valid for Monday and Wednesday service days; recurrence cannot name any other weekday. */
export const STANDING_WEEKDAYS = ["Monday", "Wednesday"] as const;
export type StandingWeekday = typeof STANDING_WEEKDAYS[number];
export type StandingOrderStatus = "active" | "paused" | "stopped";
export type StandingOrderLine = { productId: string; quantity: number };
export type StandingOrder = {
  standingOrderId: string; oplocId: string; weekdays: StandingWeekday[]; lines: StandingOrderLine[]; status: StandingOrderStatus;
  sourceOrderId: string; endDate?: string;
  /** Latest occurrence date this template has produced (or the source order's date). Advanced atomically with order creation. */
  lastOccurrenceDate: string;
  createdBy: string; createdAt: string; updatedBy: string; updatedAt: string; version: number;
};

const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
const parseDate = (value: string) => new Date(`${value}T00:00:00Z`);
const iso = (date: Date) => date.toISOString().slice(0, 10);
const shift = (value: string, days: number) => { const date = parseDate(value); date.setUTCDate(date.getUTCDate() + days); return iso(date); };
export const weekdayName = (value: string) => parseDate(value).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
export const isIsoDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(parseDate(value)) === value;

export function assertServiceDay(date: string) {
  if (!isIsoDate(date) || !STANDING_WEEKDAYS.includes(weekdayName(date) as StandingWeekday)) throw fail("Standing orders can only occur on a Monday or Wednesday.");
}

/** Only Monday, Wednesday, or Monday & Wednesday are accepted. */
export function normaliseWeekdays(input: unknown): StandingWeekday[] {
  if (!Array.isArray(input) || !input.length) throw fail("Choose Monday, Wednesday, or both.");
  const unique = new Set<string>();
  for (const value of input) { if (!STANDING_WEEKDAYS.includes(value as StandingWeekday)) throw fail("Standing orders can only repeat on Monday and/or Wednesday."); unique.add(value as string); }
  return STANDING_WEEKDAYS.filter(day => unique.has(day));
}

export function standingLabel(weekdays: StandingWeekday[]) { return `Standing order · ${weekdays.map(day => day.slice(0, 3)).join(" & ")}`; }

/** First configured recurrence date strictly after `after`. */
export function nextOccurrenceAfter(weekdays: StandingWeekday[], after: string) {
  for (let offset = 1; offset <= 7; offset += 1) { const candidate = shift(after, offset); if (weekdays.includes(weekdayName(candidate) as StandingWeekday)) return candidate; }
  throw fail("Standing order has no valid recurrence weekday.");
}

export type GenerationPlan = { action: "create"; occurrenceDate: string } | { action: "none"; reason: "not-active" | "future-occurrence-exists" | "ended" };

/**
 * Pure generation rule. At most one occurrence is planned. Dates already in the past, and dates whose
 * order cut-off has gone, are never back-filled: the plan moves on to the next configured date.
 */
export function planNextOccurrence(template: StandingOrder, now = new Date(), today = londonToday(now)): GenerationPlan {
  if (template.status !== "active") return { action: "none", reason: "not-active" };
  if (template.lastOccurrenceDate >= today) return { action: "none", reason: "future-occurrence-exists" };
  // Start no earlier than yesterday so a long pause cannot walk through months of expired dates.
  let cursor = template.lastOccurrenceDate < shift(today, -1) ? shift(today, -1) : template.lastOccurrenceDate;
  for (let guard = 0; guard < 4; guard += 1) {
    const candidate = nextOccurrenceAfter(template.weekdays, cursor);
    if (template.endDate && candidate > template.endDate) return { action: "none", reason: "ended" };
    if (candidate >= today && isBeforeOrderCutoff(candidate, now)) { assertServiceDay(candidate); return { action: "create", occurrenceDate: candidate }; }
    cursor = candidate;
  }
  return { action: "none", reason: "ended" };
}

export function londonToday(now: Date) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Builds the occurrence through the canonical submit action. Template lines that the catalogue does not offer on
 * that date/rotation week are omitted (and reported); an occurrence with no valid lines is not created.
 */
export function buildOccurrenceOrder(template: StandingOrder, occurrenceDate: string, products: GrabAndGoProduct[], now = new Date()) {
  assertServiceDay(occurrenceDate);
  const available = new Set(productsForDeliveryDate(products, occurrenceDate).map(product => product.productId));
  const lines = template.lines.filter(line => available.has(line.productId)); const dropped = template.lines.filter(line => !available.has(line.productId)).map(line => line.productId);
  if (!lines.length) return { order: undefined, dropped };
  const order = applyOrderAction(undefined, { action: "submit", oplocId: template.oplocId, deliveryDate: occurrenceDate, rotationWeek: rotationWeekForDate(occurrenceDate), lines, actor: `standing-order:${template.standingOrderId}`, at: now.toISOString(), standing: { standingOrderId: template.standingOrderId, occurrenceDate } }, products);
  return { order, dropped };
}

export const standingOrderIdFor = (sourceOrderId: string) => `standing:${sourceOrderId}`;
export { orderIdFor };

export function createTemplate(input: { source: GrabAndGoOrder; weekdays: unknown; endDate?: unknown; actor: string; at: string }): StandingOrder {
  const { source } = input;
  if (source.status !== "submitted") throw fail("Only an active Grab & Go order can become a standing order.", 409);
  if (source.standingOrderId) throw fail("This order already belongs to a standing order.", 409);
  assertServiceDay(source.deliveryDate);
  const weekdays = normaliseWeekdays(input.weekdays); const endDate = normaliseEndDate(input.endDate, source.deliveryDate);
  return { standingOrderId: standingOrderIdFor(source.orderId), oplocId: source.oplocId, weekdays, lines: source.lines.map(line => ({ productId: line.productId, quantity: line.quantity })), status: "active", sourceOrderId: source.orderId, ...(endDate ? { endDate } : {}), lastOccurrenceDate: source.deliveryDate, createdBy: input.actor, createdAt: input.at, updatedBy: input.actor, updatedAt: input.at, version: 1 };
}

export function normaliseEndDate(value: unknown, notBefore?: string) {
  if (value === undefined || value === null || value === "") return undefined;
  if (!isIsoDate(value)) throw fail("End date must be a calendar date.");
  if (notBefore && value < notBefore) throw fail("End date cannot be before the first occurrence.");
  return value;
}

export type StandingOrderAction =
  | { action: "edit"; weekdays?: unknown; endDate?: unknown }
  | { action: "pause" } | { action: "resume" } | { action: "stop" }
  | { action: "update-from-order"; order: GrabAndGoOrder };

/** Pure template transition. The caller persists it with an expected-version check. */
export function transitionTemplate(current: StandingOrder, change: StandingOrderAction, actor: string, at: string): StandingOrder {
  if (current.status === "stopped") throw fail("This standing order has been stopped permanently.", 409);
  const base = { ...current, updatedBy: actor, updatedAt: at, version: current.version + 1 };
  switch (change.action) {
    case "pause": if (current.status !== "active") throw fail("Only an active standing order can be paused.", 409); return { ...base, status: "paused" };
    case "resume": if (current.status !== "paused") throw fail("Only a paused standing order can be resumed.", 409); return { ...base, status: "active" };
    case "stop": return { ...base, status: "stopped" };
    case "edit": {
      const next: StandingOrder = { ...base, weekdays: change.weekdays === undefined ? current.weekdays : normaliseWeekdays(change.weekdays) };
      if (change.endDate !== undefined) { const endDate = normaliseEndDate(change.endDate); if (endDate) next.endDate = endDate; else delete next.endDate; }
      return next;
    }
    case "update-from-order": {
      const { order } = change;
      if (order.standingOrderId !== current.standingOrderId || order.oplocId !== current.oplocId) throw fail("This order does not belong to the standing order.", 403);
      if (order.status !== "submitted") throw fail("Update from an active order, not a cancelled one.", 409);
      return { ...base, lines: order.lines.map(line => ({ productId: line.productId, quantity: line.quantity })) };
    }
  }
}
