import type { GrabAndGoProductContract } from "@fika/server-shared/grab-and-go-catalogue";

export type GrabAndGoCategory = "grab_250ml" | "stacking_salad_750ml";
export type GrabAndGoProduct = GrabAndGoProductContract;
export type GrabAndGoLine = { productId: string; quantity: number; productName: string; category: GrabAndGoCategory; sortOrder: number; price?: number };
export type GrabAndGoHistoryEntry = { version: number; action: "submitted" | "amended" | "cancelled"; status: "submitted" | "cancelled"; at: string; actor: string; lines: GrabAndGoLine[] };
export type GrabAndGoOrder = { orderId: string; oplocId: string; deliveryDate: string; rotationWeek: number; status: "submitted" | "cancelled"; submittedAt: string; updatedAt: string; updatedBy: string; lines: GrabAndGoLine[]; version: number; history: GrabAndGoHistoryEntry[] };

export const ROTATION_WEEK_1_ANCHOR = process.env.GRAB_N_GO_ROTATION_WEEK_1_DATE || "2026-08-24";
export const ORDER_CUTOFF_HOUR = 12;
export const DELIVERY_WEEKDAYS = ["Monday", "Wednesday"] as const;

const LONDON_DATE_FORMATTER = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const londonDateString = (date: Date) => { const parts = Object.fromEntries(LONDON_DATE_FORMATTER.formatToParts(date).filter(part => part.type !== "literal").map(part => [part.type, part.value])); return `${parts.year}-${parts.month}-${parts.day}`; };
const dateOnly = (value: string | Date) => { const date = typeof value === "string" ? value.slice(0, 10) : londonDateString(value); return new Date(`${date}T00:00:00Z`); };
const iso = (date: Date) => date.toISOString().slice(0, 10);
const addDays = (date: Date, days: number) => { const next = new Date(date); next.setUTCDate(next.getUTCDate() + days); return next; };
const weekday = (date: Date) => date.toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
const positiveMod = (value: number, divisor: number) => ((value % divisor) + divisor) % divisor;

export function rotationWeekForDate(date: string | Date, anchor = ROTATION_WEEK_1_ANCHOR) {
  const days = Math.round((dateOnly(typeof date === "string" ? date : date).getTime() - dateOnly(anchor).getTime()) / 86_400_000);
  return positiveMod(Math.floor(days / 7), 4) + 1;
}

export function deliveryCutoff(deliveryDate: string) {
  const previous = addDays(dateOnly(deliveryDate), -1);
  const targetUtc = Date.UTC(previous.getUTCFullYear(), previous.getUTCMonth(), previous.getUTCDate(), ORDER_CUTOFF_HOUR);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(targetUtc)).filter(part => part.type !== "literal").map(part => [part.type, part.value]));
  const renderedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  return new Date(targetUtc - (renderedAsUtc - targetUtc));
}

export function isBeforeOrderCutoff(deliveryDate: string, now = new Date()) { return now.getTime() < deliveryCutoff(deliveryDate).getTime(); }

export function availableDeliveryDates(now = new Date(), daysAhead = 28) {
  const start = dateOnly(now); const dates: Array<{ date: string; rotationWeek: number; weekday: string; cutoff: string }> = [];
  for (let offset = 1; offset <= daysAhead; offset += 1) { const date = addDays(start, offset); const name = weekday(date); if (!DELIVERY_WEEKDAYS.includes(name as typeof DELIVERY_WEEKDAYS[number])) continue; const deliveryDate = iso(date); if (!isBeforeOrderCutoff(deliveryDate, now)) continue; dates.push({ date: deliveryDate, rotationWeek: rotationWeekForDate(deliveryDate), weekday: name, cutoff: deliveryCutoff(deliveryDate).toISOString() }); }
  return dates;
}

export function productsForDeliveryDate(products: GrabAndGoProduct[], deliveryDate: string) {
  const date = dateOnly(deliveryDate); const name = weekday(date); const rotationWeek = rotationWeekForDate(deliveryDate);
  return products.filter(product => product.active && product.rotationWeeks.includes(rotationWeek) && product.allowedDeliveryWeekdays.includes(name)).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

export function orderIdFor(oplocId: string, deliveryDate: string) { return `grab-and-go:${oplocId}:${deliveryDate}`; }

function snapshotLines(lines: Array<{ productId: string; quantity: number }>, products: GrabAndGoProduct[], deliveryDate: string) {
  const valid = productsForDeliveryDate(products, deliveryDate); const byId = new Map(valid.map(product => [product.productId, product])); const result: GrabAndGoLine[] = [];
  for (const line of lines) { const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0)); if (!quantity) continue; const product = byId.get(line.productId); if (!product) throw Object.assign(new Error("One or more selected products are not available for this delivery date."), { status: 422 }); result.push({ productId: product.productId, quantity, productName: product.name, category: product.category, sortOrder: product.sortOrder, ...(product.price !== undefined ? { price: product.price } : {}) }); }
  if (!result.length) throw Object.assign(new Error("Select at least one product before submitting the order."), { status: 422 });
  return result;
}

export function applyOrderAction(existing: GrabAndGoOrder | undefined, input: { action: "submit" | "amend" | "cancel"; oplocId: string; deliveryDate: string; rotationWeek: number; lines?: Array<{ productId: string; quantity: number }>; actor: string; expectedVersion?: number; at?: string }, products: GrabAndGoProduct[]) {
  const at = input.at || new Date().toISOString();
  if (!isBeforeOrderCutoff(input.deliveryDate, new Date(at))) throw Object.assign(new Error("This Grab & Go order is read-only after the 12:00 cutoff for next-day production."), { status: 409 });
  if (existing && (existing.oplocId !== input.oplocId || existing.deliveryDate !== input.deliveryDate)) throw Object.assign(new Error("This order does not belong to the selected site and delivery date."), { status: 403 });
  if (input.action === "submit" && existing) throw Object.assign(new Error("Submit only creates a new Grab & Go order; this delivery already has an order."), { status: 409 });
  if (input.action === "cancel") {
    const active = existing;
    if (!active || active.status === "cancelled") throw Object.assign(new Error("Cancel requires an existing active Grab & Go order."), { status: 404 });
    if (input.expectedVersion !== active.version) throw Object.assign(new Error(`This Grab & Go order changed elsewhere (expected version ${active.version}). Refresh and try again.`), { status: 409 });
    const version = active.version + 1; const history = [...active.history, { version, action: "cancelled" as const, status: "cancelled" as const, at, actor: input.actor, lines: structuredClone(active.lines) }];
    return { ...active, status: "cancelled" as const, updatedAt: at, updatedBy: input.actor, version, history };
  }
  if (input.action === "amend") {
    const active = existing;
    if (!active || active.status === "cancelled") throw Object.assign(new Error("Amend requires an existing active Grab & Go order."), { status: 404 });
    if (input.expectedVersion !== active.version) throw Object.assign(new Error(`This Grab & Go order changed elsewhere (expected version ${active.version}). Refresh and try again.`), { status: 409 });
  }
  const lines = snapshotLines(input.lines || [], products, input.deliveryDate); const action = existing ? "amended" as const : "submitted" as const; const version = existing ? existing.version + 1 : 1; const order: GrabAndGoOrder = existing ? { ...existing, status: "submitted", rotationWeek: input.rotationWeek, updatedAt: at, updatedBy: input.actor, lines, version, history: [...existing.history, { version, action, status: "submitted", at, actor: input.actor, lines: structuredClone(lines) }] } : { orderId: orderIdFor(input.oplocId, input.deliveryDate), oplocId: input.oplocId, deliveryDate: input.deliveryDate, rotationWeek: input.rotationWeek, status: "submitted", submittedAt: at, updatedAt: at, updatedBy: input.actor, lines, version, history: [{ version, action, status: "submitted", at, actor: input.actor, lines: structuredClone(lines) }] };
  return order;
}
