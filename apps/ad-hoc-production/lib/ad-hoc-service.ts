import crypto from "node:crypto";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { adHocSendKey } from "../../shared/ad-hoc-production-contract";
import { db } from "./firebase-admin";
import { addDays, applySendRecord, contentKey, isArchived, isSent, londonBusinessDate, newLineId, submitBlockers, toProductionInput, type AdHocAudit, type AdHocDraft, type AdHocRequest } from "./ad-hoc-domain";
import type { HubPort } from "./hub-client";
import { recordAdHocReadBudget } from "./ad-hoc-read-budget";

/** The authenticated caller, as resolved by the Hub. */
export type Actor = { uid: string; name?: string };

// Ad-Hoc requests live in their own collection. The legacy quote-era documents
// in fikaAdHocProductionRequestsV1 are historical evidence and are never read
// or rewritten here.
const collection = () => db.collection("fikaAdHocProductionOrdersV2");
const counters = () => db.collection("fikaAdHocProductionCountersV2");
const httpError = (status: number, message: string) => Object.assign(new Error(message), { status });
const actorName = (actor: Actor) => actor.name || actor.uid;
const MAX_WINDOW_DAYS = 62;

export async function listRequests(from = londonBusinessDate(), days = 7) {
  const span = Math.min(Math.max(Math.trunc(days) || 7, 1), MAX_WINDOW_DAYS);
  const endExclusive = addDays(from, span);
  const snap = await collection().where("serviceDate", ">=", from).where("serviceDate", "<", endExclusive).orderBy("serviceDate", "asc").limit(200).get();
  recordAdHocReadBudget({ stage: "current_window_discovery", requestDocs: snap.size, serviceDateStart: from, serviceDateEndExclusive: endExclusive, knownId: false });
  return snap.docs.map(doc => doc.data() as AdHocRequest);
}

export async function getRequest(id: string) {
  const snap = await collection().doc(stableDocumentId(id)).get();
  recordAdHocReadBudget({ stage: "known_request_lookup", requestDocs: snap.exists ? 1 : 0, knownId: true });
  return snap.exists ? snap.data() as AdHocRequest : undefined;
}

/** Normalises requester input; identity is derived server-side, never trusted from the client. */
export function cleanDraft(input: AdHocDraft, id: string): AdHocDraft {
  const text = (value?: string) => (value ?? "").trim();
  const optional = (value?: string) => text(value) || undefined;
  const destination = input.destination.mode === "oploc"
    ? { mode: "oploc" as const, oplocId: optional(input.destination.oplocId), label: text(input.destination.label), address: text(input.destination.address), contactName: optional(input.destination.contactName), contactPhone: optional(input.destination.contactPhone), identity: text(input.destination.oplocId) }
    : { mode: "one_off" as const, label: text(input.destination.label), address: text(input.destination.address), contactName: optional(input.destination.contactName), contactPhone: optional(input.destination.contactPhone), deliveryInstructions: optional(input.destination.deliveryInstructions), identity: `adhoc-destination:${id}` };
  const compact = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
  return {
    eventName: text(input.eventName), serviceDate: input.serviceDate, requiredReadyTime: input.requiredReadyTime, category: input.category,
    ...(input.guestCount ? { guestCount: input.guestCount } : {}), ...(optional(input.notes) ? { notes: text(input.notes) } : {}),
    destination: compact(destination),
    lines: input.lines.map((line, index) => compact({ id: text(line.id) || newLineId(), description: text(line.description), quantity: line.quantity, unit: text(line.unit), note: optional(line.note), sortOrder: index })),
  };
}

export async function createRequest(input: AdHocDraft, actor: Actor, duplicatedFrom?: string) {
  const id = `adhoc-request:${crypto.randomUUID()}`;
  const draft = cleanDraft(input, id);
  const timestamp = new Date().toISOString();
  const year = londonBusinessDate().slice(0, 4);
  return db.runTransaction(async tx => {
    const counterRef = counters().doc(year);
    const counter = await tx.get(counterRef);
    const sequence = ((counter.exists ? counter.data()?.next : 1) as number) || 1;
    tx.set(counterRef, { next: sequence + 1 });
    const request: AdHocRequest = { ...draft, id, reference: `REQ-${year}-${String(sequence).padStart(3, "0")}`, schemaVersion: 2, version: 1, createdAt: timestamp, createdBy: actor.uid, updatedAt: timestamp, updatedBy: actor.uid, status: "DRAFT", ...(duplicatedFrom ? { duplicatedFrom } : {}), audit: [{ action: duplicatedFrom ? "request-duplicated" : "request-created", at: timestamp, by: actorName(actor), version: 1, ...(duplicatedFrom ? { reason: `Copied from ${duplicatedFrom}` } : {}) }] };
    tx.create(collection().doc(stableDocumentId(id)), request);
    return request;
  });
}

async function mutate(id: string, expectedVersion: number, actor: Actor, change: (current: AdHocRequest, at: string) => Omit<Partial<AdHocRequest>, "audit"> & { audit: AdHocAudit }) {
  return db.runTransaction(async tx => {
    const ref = collection().doc(stableDocumentId(id));
    const snap = await tx.get(ref);
    if (!snap.exists) throw httpError(404, "Request not found.");
    const current = snap.data() as AdHocRequest;
    if (current.version !== expectedVersion) throw httpError(409, "This request changed elsewhere. Refresh and review the latest version.");
    const at = new Date().toISOString();
    const { audit, ...changes } = change(current, at);
    const next: AdHocRequest = { ...current, ...changes, version: current.version + 1, updatedAt: at, updatedBy: actor.uid, audit: [...current.audit, { ...audit, at, by: actorName(actor), version: current.version + 1 }] };
    tx.set(ref, next);
    return next;
  });
}

export async function updateRequest(id: string, expectedVersion: number, input: AdHocDraft, actor: Actor) {
  return mutate(id, expectedVersion, actor, current => {
    if (isArchived(current)) throw httpError(409, "Cancelled or archived requests cannot be edited. Duplicate it to start a new one.");
    const draft = cleanDraft(input, current.id);
    const changed = contentKey(draft) !== contentKey(current);
    // A sent request that is edited is flagged, not silently re-sent: CPU and
    // Logistics keep the last sent version until the requester sends the update.
    return { ...draft, ...(changed && isSent(current) ? { status: "NEEDS_UPDATE" as const } : {}), audit: { action: changed && isSent(current) ? "request-amended-after-send" : "request-updated", at: "", by: "", version: 0 } };
  });
}

/** Drafts that were never sent are archived. Sent requests must be cancelled so CPU/Logistics are told. */
export async function archiveRequest(id: string, expectedVersion: number, actor: Actor) {
  return mutate(id, expectedVersion, actor, (current, at) => {
    if (current.status !== "DRAFT") throw httpError(409, "Only a draft that was never sent can be archived. Cancel a sent request instead.");
    if (current.archivedAt) return { audit: { action: "request-archive-noop", at, by: "", version: 0 } };
    return { archivedAt: at, audit: { action: "request-archived", at, by: "", version: 0 } };
  });
}

export async function duplicateRequest(id: string, actor: Actor) {
  const source = await getRequest(id);
  if (!source) throw httpError(404, "Request not found.");
  const today = londonBusinessDate();
  const { destination } = source;
  return createRequest({
    eventName: source.eventName, serviceDate: source.serviceDate < today ? today : source.serviceDate, requiredReadyTime: source.requiredReadyTime, category: source.category, guestCount: source.guestCount, notes: source.notes,
    destination: { ...destination }, lines: source.lines.map(line => ({ ...line, id: newLineId() })),
  }, actor, source.reference);
}

/**
 * Sends the request to CPU through the Hub (the authority for Production Orders).
 * The Hub keeps ONE canonical order per request: the first send creates it, later
 * sends amend it, and replaying a version is a no-op, so retries and concurrent
 * sends cannot create a second order or Logistics requirement. This app records a
 * send only after the Hub has confirmed it; a failure or timeout leaves the
 * request exactly as it was and is safe to retry.
 */
export async function sendToCpu(id: string, expectedVersion: number, actor: Actor, hub: HubPort) {
  const request = await getRequest(id);
  if (!request) throw httpError(404, "Request not found.");
  if (isArchived(request)) throw httpError(409, "A cancelled or archived request cannot be sent.");
  if (request.version !== expectedVersion) throw httpError(409, "This request changed elsewhere. Refresh and review the latest version.");
  if (request.status === "SENT_TO_CPU") return { request, sent: false as const };
  const blockers = submitBlockers(request);
  if (blockers.length) throw httpError(422, blockers.join("; "));
  const result = await hub.send({ action: "send", requestId: request.id, requestVersion: request.version, idempotencyKey: adHocSendKey(request.id, request.version), order: toProductionInput(request, request.version) });
  // The Hub write is confirmed. Converge the request on it; never fail here.
  const destination = request.destination.mode === "oploc" ? { ...request.destination, oplocId: result.destination.oplocId || request.destination.oplocId, label: result.destination.label, address: result.destination.address ?? request.destination.address, identity: result.destination.oplocId || request.destination.identity } : undefined;
  const next = await db.runTransaction(async tx => {
    const ref = collection().doc(stableDocumentId(id));
    const current = (await tx.get(ref)).data() as AdHocRequest;
    const merged = applySendRecord(current, request.version, result.canonicalId, actorName(actor), new Date().toISOString(), destination);
    if (merged !== current) tx.set(ref, merged);
    return merged;
  });
  return { request: next, sent: true as const };
}

/** Cancels a sent request by withdrawing its Production Order through the Hub (which withdraws the Logistics requirement). */
export async function cancelRequest(id: string, expectedVersion: number, reason: string, actor: Actor, hub: HubPort) {
  const request = await getRequest(id);
  if (!request) throw httpError(404, "Request not found.");
  if (request.status === "CANCELLED") return request;
  if (!isSent(request)) throw httpError(409, "Only a sent request can be cancelled. Archive a draft instead.");
  if (request.version !== expectedVersion) throw httpError(409, "This request changed elsewhere. Refresh and review the latest version.");
  if (!reason.trim()) throw httpError(422, "A cancellation reason is required.");
  // The Hub cancels by the request's stable identity and is repeat-safe, so a retry after a lost
  // response (or after CPU cancelled first) converges. The request is marked only after confirmation.
  await hub.cancel({ action: "cancel", requestId: request.id, reason: reason.trim() });
  return mutate(id, expectedVersion, actor, (_current, at) => ({ status: "CANCELLED", cancelledAt: at, cancelReason: reason.trim(), audit: { action: "request-cancelled", at, by: "", version: 0, reason: reason.trim() } }));
}

/**
 * Authoritative CPU state of a sent request's Production Order, read on demand
 * for the single request being opened (one bounded read, no sync job). It is
 * display-only: the request is not rewritten, so there is no two-way state.
 */
export async function downstreamState(request: AdHocRequest, hub: HubPort) {
  if (!isSent(request)) return null;
  try {
    const order = await hub.status(request.id);
    return order ? { status: order.orderStatus, cancelled: order.cancelled } : null;
  } catch { return null; }
}
