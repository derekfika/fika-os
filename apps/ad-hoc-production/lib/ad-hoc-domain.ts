import type { CpuCreatedProductionInput, ProductionCategory } from "@hub/lib/production-domain";

// Ad-Hoc Production owns only the requester's bespoke request. Production
// Orders, allergen review and fulfilment remain owned by Hub/CPU/Logistics.

export type AdHocStatus = "DRAFT" | "SENT_TO_CPU" | "NEEDS_UPDATE" | "CANCELLED";
export type AdHocDestinationMode = "oploc" | "one_off";
export type AdHocDestination = { mode: AdHocDestinationMode; oplocId?: string; label: string; address: string; contactName?: string; contactPhone?: string; deliveryInstructions?: string; identity: string };
export type AdHocLine = { id: string; description: string; quantity: number; unit: string; note?: string; sortOrder: number };
export type AdHocAudit = { action: string; at: string; by: string; version: number; reason?: string };
export type AdHocRequest = {
  id: string; reference: string; schemaVersion: 2; version: number;
  createdAt: string; createdBy: string; updatedAt: string; updatedBy: string;
  eventName: string; serviceDate: string; requiredReadyTime: string; category: AdHocCategory; guestCount?: number; notes?: string;
  destination: AdHocDestination; lines: AdHocLine[];
  status: AdHocStatus;
  archivedAt?: string; cancelledAt?: string; cancelReason?: string; duplicatedFrom?: string;
  productionOrderId?: string; sentVersion?: number; sentAt?: string; sentBy?: string;
  audit: AdHocAudit[];
};
/** The requester-editable part of a request. */
export type AdHocDraft = Pick<AdHocRequest, "eventName" | "serviceDate" | "requiredReadyTime" | "category" | "guestCount" | "notes" | "destination" | "lines">;

export const AD_HOC_CATEGORIES = [
  { value: "board_meeting", label: "Board meeting catering", production: "hospitality" },
  { value: "hospitality", label: "Hospitality", production: "hospitality" },
  { value: "private_event", label: "Private event", production: "events" },
  { value: "tasting", label: "Tasting / fine dining", production: "fine_dining" },
  { value: "other", label: "Other / bespoke", production: "other" },
] as const satisfies ReadonlyArray<{ value: string; label: string; production: ProductionCategory }>;
export type AdHocCategory = (typeof AD_HOC_CATEGORIES)[number]["value"];
export const AD_HOC_UNITS = ["portions", "platters", "trays", "boxes", "items", "setup", "kg", "litres"] as const;
export const NOTES_LIMIT = 500;
export const STATUS_LABELS: Record<AdHocStatus, string> = { DRAFT: "Draft", SENT_TO_CPU: "Sent to CPU", NEEDS_UPDATE: "Needs update", CANCELLED: "Cancelled" };

export const isArchived = (request: Pick<AdHocRequest, "status" | "archivedAt">) => request.status === "CANCELLED" || Boolean(request.archivedAt);
export const isSent = (request: Pick<AdHocRequest, "status">) => request.status === "SENT_TO_CPU" || request.status === "NEEDS_UPDATE";

// ── Europe/London business dates ────────────────────────────────────────────
export function londonBusinessDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}
/** Calendar arithmetic on a YYYY-MM-DD string; UTC is used only as a neutral calendar, never for the business date. */
export function addDays(date: string, days: number) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
export function weekStart(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}
export const isDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
export const isTime = (value: unknown): value is string => typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

// ── Validation ──────────────────────────────────────────────────────────────
export type ReadinessItem = { key: string; label: string; hint: string; done: boolean };
export function readiness(draft: AdHocDraft): ReadinessItem[] {
  const destination = draft.destination;
  const destinationDone = destination.mode === "oploc" ? Boolean(destination.oplocId?.trim()) : Boolean(destination.label.trim() && destination.address.trim());
  return [
    { key: "details", label: "Event details complete", hint: "Name, service date, category and guest count", done: Boolean(draft.eventName.trim()) && isDate(draft.serviceDate) && Boolean(draft.category) && Number.isInteger(draft.guestCount) && (draft.guestCount ?? 0) > 0 },
    { key: "destination", label: "Destination provided", hint: "Required for Logistics", done: destinationDone },
    { key: "ready", label: "Ready time provided", hint: "Required for CPU and Logistics", done: isTime(draft.requiredReadyTime) },
    { key: "lines", label: "Menu items added", hint: "At least one item with a quantity and unit", done: draft.lines.length > 0 && draft.lines.every(line => line.description.trim() && line.quantity > 0 && line.unit.trim()) },
  ];
}
export function submitBlockers(draft: AdHocDraft, today = londonBusinessDate()) {
  const blockers = readiness(draft).filter(item => !item.done).map(item => `${item.label}: ${item.hint.toLowerCase()}`);
  if (isDate(draft.serviceDate) && draft.serviceDate < today) blockers.push("Service date is in the past");
  if ((draft.notes || "").length > NOTES_LIMIT) blockers.push(`Internal notes are over ${NOTES_LIMIT} characters`);
  return blockers;
}

// ── Hub contract mapping ────────────────────────────────────────────────────
/**
 * The requester's ready time is carried as `requiredBy`/`serviceWindow.startTime`
 * only. It is a ready-by request, never a confirmed dispatch or arrival time:
 * Logistics owns dispatch scheduling. A one-off destination is passed as an
 * order-scoped snapshot under a request-scoped identity, never as an OPLOC.
 * No allergen evidence is sent: CPU's own review/sign-off applies.
 */
export function toProductionInput(request: AdHocRequest, version = request.version): CpuCreatedProductionInput {
  const category = AD_HOC_CATEGORIES.find(item => item.value === request.category) || AD_HOC_CATEGORIES[AD_HOC_CATEGORIES.length - 1];
  const destination = request.destination;
  const contact = [destination.contactName, destination.contactPhone].filter(Boolean).join(" · ") || undefined;
  const oneOff = destination.mode === "one_off";
  return {
    clientName: request.eventName, productionCategory: category.production, serviceDate: request.serviceDate,
    deliveryDateTime: `${request.serviceDate}T${request.requiredReadyTime}`, requiredBy: `${request.serviceDate}T${request.requiredReadyTime}`,
    serviceWindow: { startTime: request.requiredReadyTime },
    destinationOplocId: oneOff ? destination.identity : destination.oplocId, requiresDelivery: true, deliveryLocation: destination.label,
    ...(oneOff ? { destinationAddress: { identity: destination.identity, label: destination.label, address: destination.address, ...(destination.deliveryInstructions ? { deliveryInstructions: destination.deliveryInstructions } : {}), ...(contact ? { contact } : {}) } } : {}),
    ...(contact ? { contact } : {}), serviceType: `Ad-hoc · ${category.label}`, pax: request.guestCount || 1, priority: "normal",
    sourceReference: request.reference, sourceEntityId: request.id, sourceVersion: version, stableSourceIdentity: true, ...(request.notes ? { notes: request.notes } : {}),
    lines: [...request.lines].sort((a, b) => a.sortOrder - b.sortOrder).map(line => ({ sourceLineId: line.id, itemName: line.description, customerQuantity: line.quantity, customerUnit: line.unit, productionQuantity: line.quantity, productionUnit: line.unit, ...(line.note ? { notes: line.note } : {}) })),
  };
}

/**
 * Records a committed Hub send on the request. The Hub write is already durable,
 * so this never rejects: it converges the request on that truth.
 * - Already recorded for this version (concurrent double send / retry): unchanged.
 * - Cancelled meanwhile: stays cancelled (a send must never resurrect it).
 * - Archived meanwhile: the order now exists downstream, so the archive is superseded.
 * - Edited meanwhile: flagged Needs update, since the Hub holds an older version.
 */
export function applySendRecord(current: AdHocRequest, sentVersion: number, orderId: string, by: string, at: string, destination?: AdHocDestination): AdHocRequest {
  if (current.status === "CANCELLED") return current;
  if (current.sentVersion === sentVersion && current.productionOrderId === orderId && !current.archivedAt) return current;
  const { archivedAt: _superseded, ...rest } = current;
  const unchanged = current.version === sentVersion;
  const first = !current.productionOrderId;
  return { ...rest, ...(unchanged && destination ? { destination } : {}), productionOrderId: orderId, sentVersion, sentAt: at, sentBy: by, status: unchanged ? "SENT_TO_CPU" : "NEEDS_UPDATE", version: current.version + 1, updatedAt: at, updatedBy: by, audit: [...current.audit, { action: first ? "sent-to-cpu" : "update-sent-to-cpu", at, by, version: current.version + 1, reason: orderId }] };
}

/** Fields whose change after sending means CPU/Logistics hold out-of-date information. */
export function contentKey(draft: AdHocDraft) {
  const { eventName, serviceDate, requiredReadyTime, category, guestCount, notes, destination, lines } = draft;
  return JSON.stringify({ eventName, serviceDate, requiredReadyTime, category, guestCount: guestCount ?? null, notes: notes ?? "", destination: { ...destination, contactName: destination.contactName ?? "", contactPhone: destination.contactPhone ?? "", deliveryInstructions: destination.deliveryInstructions ?? "" }, lines: lines.map(({ id, description, quantity, unit, note }) => ({ id, description, quantity, unit, note: note ?? "" })) });
}

export const newLineId = () => `line:${crypto.randomUUID()}`;
export const blankDestination = (): AdHocDestination => ({ mode: "oploc", label: "", address: "", identity: "" });
export const blankDraft = (serviceDate = londonBusinessDate()): AdHocDraft => ({ eventName: "", serviceDate, requiredReadyTime: "12:00", category: "board_meeting", destination: blankDestination(), lines: [{ id: newLineId(), description: "", quantity: 1, unit: "portions", sortOrder: 0 }] });
