import { groupLifecycleStatus } from "../../shared/hospitality-group-lifecycle";
import { createHash } from "node:crypto";
import type { CanonicalBooking } from "./hospitality-booking-service";
import type { QuoteCommercialSnapshot } from "./quote-engine";
import { validateStoredAdditionalCharge } from "./hospitality-additional-charges";
import type { GroupMoneyTotals, HospitalityBookingGroup, HospitalityGroupService } from "../../shared/hospitality-group-quotes";
import type { HospitalityGroupQuote } from "./hospitality-group-quote-workflow";

export const MAX_GROUP_SERVICES = 12;
export const groupError = (message: string, status = 409) => Object.assign(new Error(message), { status });
export const groupHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item)).digest("hex");
const cents = (value: number) => {
  if (!Number.isFinite(value) || value < 0) throw groupError("Invalid stored commercial amount.", 422);
  return Math.round(value * 100);
};
const round = (value: number) => Math.round(value * 100) / 100;
const money = (amount: number) => ({ amount: round(amount), currency: "GBP" as const });

export function validateBookingGroup(id: string, children: CanonicalBooking[]) {
  if (!id.trim() || id.length > 160 || !children.length || children.length > MAX_GROUP_SERVICES) throw groupError("Booking group is missing or invalid.", 422);
  const first = children[0]; const size = first.bookingGroup?.size;
  const shared = (b: CanonicalBooking) => groupHash([b.client, b.service.eventDate, b.service.oplocId, b.service.portalSiteId, b.source.provider]);
  const sequences = new Set<number>(); const ids = new Set<string>();
  for (const child of children) {
    const link = child.bookingGroup;
    if (!link || link.id !== id || !Number.isInteger(link.size) || link.size !== size || link.size !== children.length || !Number.isInteger(link.sequence) || link.sequence < 1 || link.sequence > link.size || sequences.has(link.sequence) || ids.has(child.canonicalId) || !child.service.oplocId || shared(child) !== shared(first)) throw groupError("The booking group is incomplete or its shared details conflict. Review the services before quoting.", 422);
    sequences.add(link.sequence); ids.add(child.canonicalId);
  }
  return [...children].sort((a, b) => a.service.startTime.localeCompare(b.service.startTime) || a.bookingGroup!.sequence - b.bookingGroup!.sequence);
}

/** No catalogue/settings reads. Preserve recorded line totals, VAT and charges, including net-only historical bookings. */
export function childCommercialSnapshot(booking: CanonicalBooking): QuoteCommercialSnapshot {
  if (cents(booking.order.netTotal) + cents(booking.order.vatTotal) !== cents(booking.order.grossTotal)) throw groupError("Stored service totals do not reconcile.", 422);
  const current = booking.quoteState?.revisions.find(q => q.id === booking.quoteState?.currentRevisionId);
  const stored = current?.snapshot as QuoteCommercialSnapshot | undefined;
  if (current && !current.stale && current.commercialVersion === (booking.commercialVersion || 1) && stored?.order?.lines && stored.totals && stored.charges) {
    validateSnapshot(stored);
    if (["net", "vat", "gross"].some(key => cents(stored.totals[key as "net" | "vat" | "gross"].amount) !== cents(booking.order[`${key}Total` as "netTotal" | "vatTotal" | "grossTotal"]))) throw groupError("Current service quote and booking totals conflict.", 422);
    return structuredClone(stored);
  }
  const lines = booking.order.items.map(item => ({ itemId: item.itemId, name: item.itemName || item.itemId, ...(item.description ? { description: item.description } : {}), quantity: item.quantity, unitNet: money(item.unitPrice), lineNet: money(item.lineTotal), ...(item.servingInfo ? { servingInfo: item.servingInfo } : {}), ...(item.choices ? { choices: structuredClone(item.choices) } : {}), ...(item.comments ? { comments: item.comments } : {}) }));
  const items = round(lines.reduce((sum, line) => sum + line.lineNet.amount, 0));
  let charges: QuoteCommercialSnapshot["charges"] = [];
  let vatRate = booking.order.netTotal ? booking.order.vatTotal / booking.order.netTotal : 0;
  let baseVat = booking.order.vatTotal;
  // A charge amendment leaves the old quote totals in order. Replace only its manual charges; retain historical policy charges.
  if (stored?.totals && stored.charges && cents(stored.totals.net.amount) === cents(booking.order.netTotal) && cents(stored.totals.itemsNet.amount) === cents(items)) {
    validateSnapshot(stored);
    charges = structuredClone(stored.charges.filter(c => c.code !== "booking_additional"));
    baseVat = round(stored.totals.vat.amount - stored.charges.filter(c => c.code === "booking_additional").reduce((n, c) => n + c.net.amount * c.vatRate, 0));
    vatRate = stored.totals.vatRate;
  } else if (cents(booking.order.netTotal) !== cents(items)) {
    // Do not guess which legacy charges an unexplained total contains.
    throw groupError(`Service ${booking.source.sourceBookingId} has no reconcilable commercial snapshot. Review its stored totals.`, 422);
  }
  for (const raw of booking.additionalCharges || []) {
    const c = validateStoredAdditionalCharge(raw);
    charges.push({ code: "booking_additional", label: c.label, net: money(c.netTotal), vatRate, sourceAdditionalChargeId: c.id, category: c.category, ...(c.kind === "labour" ? { labour: c.labour, detail: `${c.labour.staffCount} staff × ${c.labour.hoursPerPerson} hours × £${c.labour.hourlyRate}` } : {}) });
  }
  const chargesNet = round(charges.reduce((sum, c) => sum + c.net.amount, 0));
  const net = round(items + chargesNet);
  const vat = round(baseVat + charges.filter(c => c.code === "booking_additional").reduce((sum, c) => sum + c.net.amount * c.vatRate, 0));
  const result: QuoteCommercialSnapshot = {
    contractVersion: "fika.quote-engine.v1", bookingId: booking.canonicalId, client: structuredClone(booking.client), service: structuredClone(booking.service),
    order: { ...(booking.order.eventType ? { eventType: booking.order.eventType } : {}), lines }, charges,
    totals: { itemsNet: money(items), chargesNet: money(chargesNet), net: money(net), vat: money(vat), gross: money(net + vat), vatRate },
    dietaries: structuredClone(booking.dietaries), ...(booking.notes ? { notes: booking.notes } : {}),
    pricingPolicy: stored?.pricingPolicy || { dashboardId: "authoritative-booking-snapshot", version: 0, managementFee: { mode: "fixed", value: 0, label: "Recorded charges" }, deliveryCharge: { enabled: false, amount: 0, label: "Recorded delivery" }, vatRate },
  };
  validateSnapshot(result);
  return result;
}

function validateSnapshot(s: QuoteCommercialSnapshot) {
  if (s.order.lines.some(line => !Number.isFinite(line.quantity) || line.quantity < 0 || !Number.isFinite(line.unitNet.amount) || line.unitNet.amount < 0)) throw groupError("Stored service line failed integrity checks.", 422);
  const sumLines = s.order.lines.reduce((sum, l) => sum + cents(l.lineNet.amount), 0);
  const sumCharges = s.charges.reduce((sum, c) => sum + cents(c.net.amount), 0);
  if (sumLines !== cents(s.totals.itemsNet.amount) || sumCharges !== cents(s.totals.chargesNet.amount) || sumLines + sumCharges !== cents(s.totals.net.amount) || cents(s.totals.net.amount) + cents(s.totals.vat.amount) !== cents(s.totals.gross.amount)) throw groupError("Stored service commercial snapshot failed integrity checks.", 422);
}

export function groupCommercialState(id: string, children: CanonicalBooking[]) {
  const ordered = validateBookingGroup(id, children);
  const snapshots = ordered.map(childCommercialSnapshot);
  const sourceHash = groupHash(snapshots.map((snapshot, i) => ({ snapshot, commercialVersion: ordered[i].commercialVersion || 1, cancelled: ordered[i].lifecycleStatus === "Cancelled" })));
  const totals: GroupMoneyTotals = { itemsNet: 0, chargesNet: 0, net: 0, vat: 0, gross: 0 };
  for (const snapshot of snapshots) for (const key of Object.keys(totals) as Array<keyof GroupMoneyTotals>) totals[key] = round(totals[key] + snapshot.totals[key].amount);
  return { ordered, snapshots, sourceHash, totals };
}

export function projectBookingGroup(id: string, children: CanonicalBooking[], quote?: HospitalityGroupQuote, version = 0, routing: Record<string, HospitalityGroupService["routing"]> = {}, production: Record<string, HospitalityGroupService["production"]> = {}): HospitalityBookingGroup {
  const { ordered, snapshots, sourceHash, totals } = groupCommercialState(id, children);
  const current = quote?.status === "complete" && quote.sourceHash === sourceHash;
  const services: HospitalityGroupService[] = ordered.map((b, i) => ({ bookingId: b.canonicalId, sourceReference: b.source.sourceBookingId, commercialVersion: b.commercialVersion || 1, lifecycleStatus: b.lifecycleStatus, serviceType: b.order.eventType || "Hospitality", time: b.service.startTime, ...(b.service.endTime ? { endTime: b.service.endTime } : {}), location: b.service.roomOrArea || b.service.deliveryPoint || b.service.floorLevel || "Location to confirm", guests: b.service.guestCount,
    lines: snapshots[i].order.lines.map(l => ({ name: l.name, ...(l.description ? { description: l.description } : {}), quantity: l.quantity, unitNet: l.unitNet.amount, net: l.lineNet.amount, ...(l.choices ? { choices: l.choices } : {}), ...(l.comments ? { comments: l.comments } : {}) })),
    charges: snapshots[i].charges.map(c => ({ label: c.label, net: c.net.amount, ...(c.detail ? { detail: c.detail } : {}) })),
    totals: Object.fromEntries(Object.entries(snapshots[i].totals).filter(([key]) => key !== "vatRate").map(([key, value]) => [key, (value as { amount: number }).amount])) as GroupMoneyTotals,
    ...(production[b.canonicalId] ? { production: production[b.canonicalId] } : {}),
    ...(b.dashboardWorkflow?.cancellation ? { cancellation: { downstreamPropagation: b.dashboardWorkflow.cancellation.downstreamPropagation || "pending", productionOutcome: b.dashboardWorkflow.cancellation.productionOutcome } } : {}),
    ...(routing[b.canonicalId] ? { routing: routing[b.canonicalId] } : {}),
  }));
  const group: HospitalityBookingGroup = { kind: "booking-group", id, reference: id, version, sourceHash, client: ordered[0].client, eventDate: ordered[0].service.eventDate, eventName: ordered[0].notes?.match(/^Event: (.+)$/m)?.[1], firstTime: services[0].time, lastTime: services.flatMap(s => [s.time, s.endTime || s.time]).sort().at(-1)!, status: "New", services, totals,
    ...(quote ? { quote: { id: quote.id, revision: quote.revision, sourceHash: quote.sourceHash, status: quote.status, createdAt: quote.createdAt, updatedAt: quote.updatedAt, stale: quote.sourceHash !== sourceHash || quote.status === "superseded", ...(current && quote.artifact.driveUrl ? { driveUrl: quote.artifact.driveUrl } : {}), ...(quote.error ? { error: quote.error } : {}) } } : {}),
    routing: { cpuServices: services.filter(s => s.routing?.status === "cpu_required").length, inHouseServices: services.filter(s => s.routing?.status === "no_cpu_production").length, warnings: services.filter(s => !s.routing || ["routing_required", "routing_conflict"].includes(s.routing.status)).length },
  };
  return { ...group, status: groupLifecycleStatus(group) };
}
