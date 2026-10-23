import { DELIVERY_WEEKDAYS, addIsoDays, deliveryCutoff, isBeforeOrderCutoff, londonToday, orderIdFor, productsForDeliveryDate, representativeDeliveryDate, rotationWeekForDate, weekdayOf, type GrabAndGoOrder, type GrabAndGoProduct } from "./grab-and-go";

/**
 * Grab & Go standing orders: one versioned template per OPLOC describing the quantities for each
 * (rotation week, delivery weekday) slot of the existing four-week rotation. A template never owns
 * an order: it only produces ordinary canonical Grab & Go orders through applyOrderAction.
 */
export const STANDING_WEEKS = [1, 2, 3, 4] as const;
export const STANDING_HORIZON_DAYS = 14;
export const STANDING_MAX_LINES_PER_SLOT = 60;
export const STANDING_MAX_QUANTITY = 9999;
export type StandingWeekday = typeof DELIVERY_WEEKDAYS[number];
export type StandingLine = { productId: string; quantity: number };
/** Only configured slots are present. Key: `${rotationWeek}:${weekday}`. An absent slot never generates an order. */
export type StandingSlots = Record<string, StandingLine[]>;
export type StandingStatus = "draft" | "active" | "paused" | "terminated";
export type StandingAction = "save" | "populate-slot" | "activate" | "pause" | "resume" | "terminate";
export type StandingVersionAction = "created" | "drafted" | "amended" | "slot-populated" | "activated" | "paused" | "resumed" | "terminated" | "redrafted";

export type StandingOrder = {
  schemaVersion: 2; recordType: "head"; standingOrderId: string; oplocId: string; status: StandingStatus; version: number;
  /** Increments when a terminated template is started again; the version number keeps counting. */
  cycle: number; slots: StandingSlots;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  activatedAt?: string; pausedAt?: string; terminatedAt?: string;
};
/** Immutable audit record of every head version. Written in the same transaction as the head. */
export type StandingVersion = {
  schemaVersion: 2; recordType: "version"; standingOrderId: string; oplocId: string; version: number; action: StandingVersionAction;
  fromStatus?: StandingStatus; status: StandingStatus; slots: StandingSlots; changedSlots: string[]; at: string; actor: string;
  note?: string; sourceOrderId?: string;
};

/** Firestore rejects undefined fields; lifecycle timestamps are removed rather than stored as undefined. */
const stripUndefined = <T extends object>(value: T): T => Object.fromEntries(Object.entries(value).filter(([, field]) => field !== undefined)) as T;
const fail = (message: string, status = 422) => Object.assign(new Error(message), { status });
export const standingOrderIdFor = (oplocId: string) => `grab-and-go-standing:v2:${oplocId}`;
export const standingVersionIdFor = (standingOrderId: string, version: number) => `${standingOrderId}:v${version}`;
export const slotKey = (rotationWeek: number, weekday: StandingWeekday) => `${rotationWeek}:${weekday}`;
export function parseSlotKey(key: string) {
  const [week, weekday] = key.split(":"); const rotationWeek = Number(week);
  if (!STANDING_WEEKS.includes(rotationWeek as typeof STANDING_WEEKS[number]) || !DELIVERY_WEEKDAYS.includes(weekday as StandingWeekday) || key !== slotKey(rotationWeek, weekday as StandingWeekday)) throw fail(`"${key}" is not a rotation slot (weeks 1–4, Monday or Wednesday).`);
  return { rotationWeek, weekday: weekday as StandingWeekday };
}
export const slotKeyForDate = (deliveryDate: string) => slotKey(rotationWeekForDate(deliveryDate), weekdayOf(deliveryDate) as StandingWeekday);
export const orderedSlotKeys = () => STANDING_WEEKS.flatMap(week => DELIVERY_WEEKDAYS.map(weekday => slotKey(week, weekday)));
export const configuredSlotCount = (slots: StandingSlots) => Object.keys(slots).filter(key => slots[key]?.length).length;
const sameLines = (a: StandingLine[] = [], b: StandingLine[] = []) => a.length === b.length && a.every((line, index) => line.productId === b[index].productId && line.quantity === b[index].quantity);
export const sameSlots = (a: StandingSlots, b: StandingSlots) => orderedSlotKeys().every(key => sameLines(a[key], b[key]));
export const changedSlotKeys = (before: StandingSlots, after: StandingSlots) => orderedSlotKeys().filter(key => !sameLines(before[key], after[key]));

/** Lines a slot may contain: the products the governed catalogue offers for that rotation week and weekday. */
export function slotCatalogue(catalogue: GrabAndGoProduct[], key: string, anchor?: string) {
  const { rotationWeek, weekday } = parseSlotKey(key);
  return productsForDeliveryDate(catalogue, representativeDeliveryDate(rotationWeek, weekday, anchor));
}
/** Product ids of a line set the catalogue does not offer for the date. */
export function unavailableLines(lines: StandingLine[], catalogue: GrabAndGoProduct[], deliveryDate: string) {
  const offered = new Set(productsForDeliveryDate(catalogue, deliveryDate).map(product => product.productId));
  return lines.filter(line => !offered.has(line.productId)).map(line => line.productId);
}

/** Validate and canonicalise slot input. Unknown slots, duplicate/unavailable products and bad quantities are rejected. */
export function normaliseSlots(input: unknown, catalogue: GrabAndGoProduct[], anchor?: string): StandingSlots {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw fail("Standing-order slots are required.");
  const result: StandingSlots = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    parseSlotKey(key);
    if (!Array.isArray(value)) throw fail(`Slot ${key} must be a list of product quantities.`);
    if (value.length > STANDING_MAX_LINES_PER_SLOT) throw fail(`Slot ${key} has too many products.`);
    const offered = new Map(slotCatalogue(catalogue, key, anchor).map(product => [product.productId, product])); const seen = new Set<string>(); const lines: StandingLine[] = [];
    for (const raw of value) {
      const line = raw as { productId?: unknown; quantity?: unknown };
      if (typeof line?.productId !== "string" || !line.productId) throw fail(`Slot ${key} contains a line without a product.`);
      if (typeof line.quantity !== "number" || !Number.isInteger(line.quantity) || line.quantity < 0 || line.quantity > STANDING_MAX_QUANTITY) throw fail(`Slot ${key} has an invalid quantity for ${line.productId}.`);
      if (seen.has(line.productId)) throw fail(`Slot ${key} lists a product more than once.`);
      seen.add(line.productId);
      if (!line.quantity) continue;
      if (!offered.has(line.productId)) throw fail(`Slot ${key} contains a product that is not available for that rotation week and weekday.`);
      lines.push({ productId: line.productId, quantity: line.quantity });
    }
    if (lines.length) result[key] = lines.sort((a, b) => offered.get(a.productId)!.sortOrder - offered.get(b.productId)!.sortOrder || a.productId.localeCompare(b.productId));
  }
  return result;
}

export type StandingActionInput = { action: StandingAction; oplocId: string; actor: string; at?: string; expectedVersion?: number; slots?: unknown; note?: string; slotKey?: string; sourceOrder?: Pick<GrabAndGoOrder, "orderId" | "status" | "deliveryDate" | "oplocId" | "lines"> };
export type StandingTransition = { head: StandingOrder; version: StandingVersion } | { head: StandingOrder; version?: undefined; unchanged: true };

/** Pure state machine. Callers persist head + version atomically and compare-and-set on `expectedVersion`. */
export function applyStandingAction(existing: StandingOrder | undefined, input: StandingActionInput, catalogue: GrabAndGoProduct[], anchor?: string): StandingTransition {
  const at = input.at || new Date().toISOString(); const standingOrderId = standingOrderIdFor(input.oplocId); const note = input.note?.trim().slice(0, 500) || undefined;
  if (existing && existing.oplocId !== input.oplocId) throw fail("This standing order does not belong to the selected site.", 403);
  if (existing && input.expectedVersion !== existing.version) throw fail(`This standing order changed elsewhere (expected version ${existing.version}). Refresh and try again.`, 409);
  if (!existing && input.expectedVersion !== undefined) throw fail("This standing order no longer exists. Refresh and try again.", 409);
  const finish = (next: Omit<StandingOrder, "version" | "updatedAt" | "updatedBy">, action: StandingVersionAction, extra: Partial<StandingVersion> = {}): StandingTransition => {
    const version = (existing?.version || 0) + 1; const head = stripUndefined<StandingOrder>({ ...next, version, updatedAt: at, updatedBy: input.actor });
    return { head, version: { schemaVersion: 2, recordType: "version", standingOrderId, oplocId: input.oplocId, version, action, ...(existing ? { fromStatus: existing.status } : {}), status: head.status, slots: structuredClone(head.slots), changedSlots: changedSlotKeys(existing?.slots || {}, head.slots), at, actor: input.actor, ...(note ? { note } : {}), ...extra } };
  };
  const base = (): Omit<StandingOrder, "version" | "updatedAt" | "updatedBy"> => existing ? { ...existing } : { schemaVersion: 2, recordType: "head", standingOrderId, oplocId: input.oplocId, status: "draft", cycle: 1, slots: {}, createdAt: at, createdBy: input.actor };
  const requireStatus = (...allowed: StandingStatus[]) => { if (!existing || !allowed.includes(existing.status)) throw fail(`This action needs a ${allowed.join(" or ")} standing order${existing ? ` (this one is ${existing.status})` : ""}.`, 409); return existing; };
  const revalidate = (slots: StandingSlots) => normaliseSlots(slots, catalogue, anchor);

  if (input.action === "save" || input.action === "populate-slot") {
    let slots: StandingSlots; let sourceOrderId: string | undefined;
    if (input.action === "populate-slot") {
      const order = input.sourceOrder; if (!order) throw fail("A submitted order is required to populate a standing-order slot.");
      if (order.oplocId !== input.oplocId) throw fail("This order does not belong to the selected site.", 403);
      if (order.status !== "submitted") throw fail("Only a submitted order can populate a standing-order slot.", 409);
      const key = slotKeyForDate(order.deliveryDate); sourceOrderId = order.orderId;
      slots = { ...(existing?.slots || {}), ...normaliseSlots({ [key]: order.lines.map(line => ({ productId: line.productId, quantity: line.quantity })) }, catalogue, anchor) };
    } else slots = normaliseSlots(input.slots, catalogue, anchor);
    if (existing?.status === "terminated") return finish({ ...base(), status: "draft", cycle: existing.cycle + 1, slots }, "redrafted", sourceOrderId ? { sourceOrderId } : {});
    if (existing && sameSlots(existing.slots, slots)) return { head: existing, unchanged: true };
    if (existing && existing.status !== "draft" && !configuredSlotCount(slots)) throw fail("An active or paused standing order must keep at least one configured slot. Pause or terminate it instead.");
    const action: StandingVersionAction = input.action === "populate-slot" ? "slot-populated" : !existing ? "created" : existing.status === "draft" ? "drafted" : "amended";
    return finish({ ...base(), slots }, action, sourceOrderId ? { sourceOrderId } : {});
  }
  if (input.action === "activate") {
    const current = requireStatus("draft"); const slots = revalidate(current.slots);
    if (!configuredSlotCount(slots)) throw fail("Configure at least one Monday or Wednesday slot before activating.");
    return finish({ ...current, slots, status: "active", activatedAt: at, pausedAt: undefined }, "activated");
  }
  if (input.action === "pause") { const current = requireStatus("active"); return finish({ ...current, status: "paused", pausedAt: at }, "paused"); }
  if (input.action === "resume") {
    const current = requireStatus("paused"); const slots = revalidate(current.slots);
    if (!configuredSlotCount(slots)) throw fail("Configure at least one slot before resuming.");
    return finish({ ...current, slots, status: "active", pausedAt: undefined }, "resumed");
  }
  if (input.action === "terminate") { const current = requireStatus("draft", "active", "paused"); return finish({ ...current, status: "terminated", terminatedAt: at }, "terminated"); }
  throw fail("Unsupported standing-order action.");
}

export type OccurrenceState =
  | "generate"            // template will create the order (or has just been asked to)
  | "in-sync"             // automatic order already matches the template slot
  | "sync"                // automatic order differs from the template and is still editable
  | "manual-order"        // a manually controlled order exists; the template never touches it
  | "cancelled"           // an order for the date was cancelled; never resurrected
  | "unavailable-lines"   // catalogue no longer offers a template line for the date
  | "slot-removed"        // automatic order exists but its slot is no longer configured
  | "no-slot"             // slot not configured: nothing is generated
  | "not-active"          // template draft/paused/terminated
  | "cutoff-passed";      // cutoff passed; the order (if any) is read-only
export type Occurrence = {
  deliveryDate: string; weekday: StandingWeekday; rotationWeek: number; slotKey: string; cutoff: string; cutoffPassed: boolean; state: OccurrenceState;
  templateLines: StandingLine[]; unavailableProductIds: string[]; order?: GrabAndGoOrder;
};

/** Mon/Wed delivery dates from today to `days` ahead (inclusive of today), regardless of cutoff. */
export function standingDeliveryDates(now: Date, days = STANDING_HORIZON_DAYS) {
  const today = londonToday(now); const dates: string[] = [];
  for (let offset = 0; offset <= days; offset += 1) { const date = addIsoDays(today, offset); if (DELIVERY_WEEKDAYS.includes(weekdayOf(date) as StandingWeekday)) dates.push(date); }
  return dates;
}

/** Classify every upcoming delivery against the template, orders and catalogue. Pure and idempotent. */
export function planStandingOccurrences(head: StandingOrder | undefined, ordersByDate: Map<string, GrabAndGoOrder>, catalogue: GrabAndGoProduct[], now: Date, days = STANDING_HORIZON_DAYS): Occurrence[] {
  return standingDeliveryDates(now, days).map(deliveryDate => {
    const weekday = weekdayOf(deliveryDate) as StandingWeekday; const rotationWeek = rotationWeekForDate(deliveryDate); const key = slotKey(rotationWeek, weekday);
    const order = ordersByDate.get(deliveryDate); const templateLines = head?.slots[key] || []; const open = isBeforeOrderCutoff(deliveryDate, now);
    const unavailableProductIds = templateLines.length ? unavailableLines(templateLines, catalogue, deliveryDate) : [];
    const result = (state: OccurrenceState): Occurrence => ({ deliveryDate, weekday, rotationWeek, slotKey: key, cutoff: deliveryCutoff(deliveryDate).toISOString(), cutoffPassed: !open, state, templateLines, unavailableProductIds, ...(order ? { order } : {}) });
    if (order?.status === "cancelled") return result("cancelled");
    if (order && !(order.control === "automatic" && order.source)) return result("manual-order");
    if (!open) return result(order || templateLines.length ? "cutoff-passed" : "no-slot");
    if (order) { // automatic, submitted, editable
      if (head?.status !== "active") return result("in-sync");
      if (!templateLines.length) return result("slot-removed");
      if (unavailableProductIds.length) return result("unavailable-lines");
      return result(sameLines(order.lines.map(line => ({ productId: line.productId, quantity: line.quantity })).sort((a, b) => a.productId.localeCompare(b.productId)), [...templateLines].sort((a, b) => a.productId.localeCompare(b.productId))) ? "in-sync" : "sync");
    }
    if (!head || !templateLines.length) return result("no-slot");
    if (head.status !== "active") return result("not-active");
    return result(unavailableProductIds.length ? "unavailable-lines" : "generate");
  });
}
export { orderIdFor };
