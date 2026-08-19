export type GrabAndGoCategory = "grab_250ml" | "stacking_salad_750ml";
export type GrabAndGoProduct = { productId: string; name: string; category: GrabAndGoCategory; rotationWeeks: number[]; allowedDeliveryWeekdays: string[]; price?: number; active: boolean; sortOrder: number };
export type GrabAndGoLine = { productId: string; quantity: number; productName: string; price?: number };
export type GrabAndGoHistoryEntry = { version: number; action: "submitted" | "amended" | "cancelled"; status: "submitted" | "cancelled"; at: string; actor: string; lines: GrabAndGoLine[] };
export type GrabAndGoOrder = { orderId: string; oplocId: string; deliveryDate: string; rotationWeek: number; status: "submitted" | "cancelled"; submittedAt: string; updatedAt: string; updatedBy: string; lines: GrabAndGoLine[]; version: number; history: GrabAndGoHistoryEntry[] };

export const ROTATION_WEEK_1_ANCHOR = process.env.GRAB_N_GO_ROTATION_WEEK_1_DATE || "2026-08-24";
export const ORDER_CUTOFF_HOUR = 12;
export const DELIVERY_WEEKDAYS = ["Monday", "Wednesday"] as const;

const dateOnly = (value: string | Date) => { const date = typeof value === "string" ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value; return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())); };
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
  return new Date(previous.getUTCFullYear(), previous.getUTCMonth(), previous.getUTCDate(), ORDER_CUTOFF_HOUR, 0, 0, 0);
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
  for (const line of lines) { const quantity = Math.max(0, Math.floor(Number(line.quantity) || 0)); if (!quantity) continue; const product = byId.get(line.productId); if (!product) throw Object.assign(new Error("One or more selected products are not available for this delivery date."), { status: 422 }); result.push({ productId: product.productId, quantity, productName: product.name, ...(product.price !== undefined ? { price: product.price } : {}) }); }
  if (!result.length) throw Object.assign(new Error("Select at least one product before submitting the order."), { status: 422 });
  return result;
}

export function applyOrderAction(existing: GrabAndGoOrder | undefined, input: { action: "submit" | "amend" | "cancel"; oplocId: string; deliveryDate: string; rotationWeek: number; lines?: Array<{ productId: string; quantity: number }>; actor: string; at?: string }, products: GrabAndGoProduct[]) {
  const at = input.at || new Date().toISOString();
  if (!isBeforeOrderCutoff(input.deliveryDate, new Date(at))) throw Object.assign(new Error("This Grab & Go order is read-only after the 12:00 cutoff for next-day production."), { status: 409 });
  if (existing && (existing.oplocId !== input.oplocId || existing.deliveryDate !== input.deliveryDate)) throw Object.assign(new Error("This order does not belong to the selected site and delivery date."), { status: 403 });
  if (input.action === "cancel") {
    if (!existing || existing.status === "cancelled") throw Object.assign(new Error("There is no active Grab & Go order to cancel."), { status: 404 });
    const version = existing.version + 1; const history = [...existing.history, { version, action: "cancelled" as const, status: "cancelled" as const, at, actor: input.actor, lines: structuredClone(existing.lines) }];
    return { ...existing, status: "cancelled" as const, updatedAt: at, updatedBy: input.actor, version, history };
  }
  const lines = snapshotLines(input.lines || [], products, input.deliveryDate); const action = existing ? "amended" as const : "submitted" as const; const version = existing ? existing.version + 1 : 1; const order: GrabAndGoOrder = existing ? { ...existing, status: "submitted", rotationWeek: input.rotationWeek, updatedAt: at, updatedBy: input.actor, lines, version, history: [...existing.history, { version, action, status: "submitted", at, actor: input.actor, lines: structuredClone(lines) }] } : { orderId: orderIdFor(input.oplocId, input.deliveryDate), oplocId: input.oplocId, deliveryDate: input.deliveryDate, rotationWeek: input.rotationWeek, status: "submitted", submittedAt: at, updatedAt: at, updatedBy: input.actor, lines, version, history: [{ version, action, status: "submitted", at, actor: input.actor, lines: structuredClone(lines) }] };
  return order;
}
