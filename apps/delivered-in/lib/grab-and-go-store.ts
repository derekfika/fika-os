import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GrabAndGoOrder } from "./grab-and-go";
import { resolveAttention, type StandingOrder } from "./grab-and-go-standing";
import { claimEvent, createDomainEvent, eventIsDue, markEventDelivered, markEventFailed, type DurableDomainEvent } from "../../shared/domain-events";
import { appDataPath } from "../../shared/app-data-path";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { db } from "./firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { recordDeliveredInAppReadBudget } from "./delivered-in-read-budget";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { stageGrabHandoff } from "./grab-and-go-handoff";

type Stored = { version: 1; orders: GrabAndGoOrder[]; events: DurableDomainEvent[]; standingOrders?: StandingOrder[]; /** Legacy migration field; central Integration Hub is authoritative. */ fulfilmentRequirements?: FulfilmentRequirement[] };
const file = appDataPath("delivered-in", "delivered-in", "grab-and-go-orders.json");
const databaseFile = appDataPath("delivered-in", "delivered-in", "grab-and-go.sqlite");
const unavailable = (message: string, cause?: unknown) => Object.assign(new Error(message, cause ? { cause } : undefined), { status: 503 });
function seed(): Stored {
  if (!existsSync(file)) return { version: 1, orders: [], events: [] };
  try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Stored>; if (!Array.isArray(value.orders)) throw new Error("orders is not an array"); return { version: 1, orders: value.orders, events: Array.isArray(value.events) ? value.events : [] }; } catch (cause) { throw unavailable("Grab & Go order data is unavailable; no order list was loaded.", cause); }
}
function open() {
  let database: DatabaseSync | undefined;
  const initialise = (candidate: DatabaseSync, initial?: Stored) => {
    candidate.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; CREATE TABLE IF NOT EXISTS grab_and_go_state (state_id INTEGER PRIMARY KEY CHECK (state_id = 1), state_json TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const row = candidate.prepare("SELECT state_json FROM grab_and_go_state WHERE state_id = 1").get() as { state_json?: string } | undefined;
    if (!row) candidate.prepare("INSERT INTO grab_and_go_state (state_id, state_json, updated_at) VALUES (1, ?, ?)").run(JSON.stringify(initial || seed()), new Date().toISOString());
    return candidate;
  };
  const recoverCorruptDatabase = (cause: unknown) => {
    const restored = seed();
    const backup = `${databaseFile}.corrupt-${new Date().toISOString().replace(/[:.]/g, "-")}.bak`;
    try { database?.close(); } catch { /* preserve the original corruption for the backup move */ }
    renameSync(databaseFile, backup);
    database = new DatabaseSync(databaseFile);
    return initialise(database, restored);
  };
  try {
    mkdirSync(dirname(databaseFile), { recursive: true }); database = new DatabaseSync(databaseFile);
    try { return initialise(database); } catch (cause) {
      if (!existsSync(file)) throw cause;
      return recoverCorruptDatabase(cause);
    }
  } catch (cause) { try { database?.close(); } catch { /* preserve original persistence error */ } if (cause && typeof cause === "object" && "status" in cause) throw cause; throw unavailable("Grab & Go operational persistence is unavailable.", cause); }
}
function parse(database: DatabaseSync): Stored {
  try { const row = database.prepare("SELECT state_json FROM grab_and_go_state WHERE state_id = 1").get() as { state_json?: string } | undefined; if (!row?.state_json) throw new Error("missing state"); const value = JSON.parse(row.state_json) as Stored; if (!Array.isArray(value.orders) || !Array.isArray(value.events)) throw new Error("invalid state"); return { version: 1, orders: value.orders, events: value.events, standingOrders: Array.isArray(value.standingOrders) ? value.standingOrders : [] }; } catch (cause) { throw unavailable("Grab & Go order data is unavailable; no order list was loaded.", cause); }
}
const read = (): Stored => { const database = open(); try { const stored = parse(database); recordDataAccess({ app: "delivered-in", operation: "grab-and-go.sqlite.read", source: "STATIC", documents: stored.orders.length }); return stored; } finally { database.close(); } };
function backfillMissingFulfilmentEvents(_stored: Stored) { /* CPU materialisation owns the only production-bound fulfilment path. */ }
function withTransaction<T>(mutator: (stored: Stored) => T) {
  const database = open(); database.exec("BEGIN IMMEDIATE");
  try { const stored = parse(database); const result = mutator(stored); database.prepare("UPDATE grab_and_go_state SET state_json = ?, updated_at = ? WHERE state_id = 1").run(JSON.stringify(stored), new Date().toISOString()); database.exec("COMMIT"); return result; } catch (cause) { try { database.exec("ROLLBACK"); } catch { /* preserve original failure */ } throw cause; } finally { database.close(); }
}
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const hostedOrders = () => db.collection("fikaDeliveredInGrabAndGoOrdersV1");
export function listGrabAndGoOrders(oplocId?: string) { return read().orders.filter(order => !oplocId || order.oplocId === oplocId); }
export function getGrabAndGoOrder(oplocId: string, deliveryDate: string) { return read().orders.find(order => order.oplocId === oplocId && order.deliveryDate === deliveryDate); }
export async function listGrabAndGoOrdersHosted(oplocId: string, startDate: string, endDateExclusive: string) {
  if (!hosted()) return listGrabAndGoOrders(oplocId).filter(order => order.deliveryDate >= startDate && order.deliveryDate < endDateExclusive);
  const snapshot = await hostedOrders().where("oplocId", "==", oplocId).where("deliveryDate", ">=", startDate).where("deliveryDate", "<", endDateExclusive).orderBy("deliveryDate", "asc").limit(100).get();
  recordDataAccess({ app: "delivered-in", operation: "grab-and-go.orders.by-oploc-date", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" });
  recordDeliveredInAppReadBudget({ stage: "grab_and_go_oploc_date_discovery", recordsInspected: snapshot.size, oplocId });
  return snapshot.docs.map(document => document.data() as GrabAndGoOrder);
}
export async function listGrabAndGoOrdersForProductionHosted(startDate: string, endDateExclusive: string) {
  if (!hosted()) return listGrabAndGoOrders().filter(order => order.deliveryDate >= startDate && order.deliveryDate < endDateExclusive);
  const snapshot = await hostedOrders().where("deliveryDate", ">=", startDate).where("deliveryDate", "<", endDateExclusive).where("status", "==", "submitted").orderBy("deliveryDate", "asc").limit(500).get();
  recordDataAccess({ app: "delivered-in", operation: "grab-and-go.orders.for-production", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" });
  recordDeliveredInAppReadBudget({ stage: "grab_and_go_cpu_fulfilment", recordsInspected: snapshot.size, serviceDate: startDate });
  return snapshot.docs.map(document => document.data() as GrabAndGoOrder);
}
export async function getGrabAndGoOrderHosted(oplocId: string, deliveryDate: string) {
  if (!hosted()) return getGrabAndGoOrder(oplocId, deliveryDate);
  const snapshot = await hostedOrders().doc(stableDocumentId(`grab-and-go:${oplocId}:${deliveryDate}`)).get();
  recordDataAccess({ app: "delivered-in", operation: "grab-and-go.order.by-oploc-date", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "document" });
  recordDeliveredInAppReadBudget({ stage: "grab_and_go_direct_order", recordsInspected: snapshot.exists ? 1 : 0, oplocId, knownId: true });
  return snapshot.exists ? snapshot.data() as GrabAndGoOrder : undefined;
}
export async function saveGrabAndGoOrderHosted(order: GrabAndGoOrder, expectedVersion?: number) {
  if (!hosted()) return saveGrabAndGoOrder(order, expectedVersion);
  await db.runTransaction(async transaction => {
    const ref = hostedOrders().doc(stableDocumentId(order.orderId));
    const snapshot = await transaction.get(ref);
    recordDataAccess({ app: "delivered-in", operation: "grab-and-go.order.transaction-read", source: "FIRESTORE", documents: snapshot.exists ? 1 : 0, firestoreReadKind: "transaction" });
    const previous = snapshot.exists ? snapshot.data() as GrabAndGoOrder : undefined;
    if (previous && expectedVersion !== previous.version) throw Object.assign(new Error(`This Grab & Go order changed elsewhere (expected version ${previous.version}). Refresh and try again.`), { status: 409 });
    if (!previous && expectedVersion !== undefined) throw Object.assign(new Error("This Grab & Go order no longer exists. Refresh and try again."), { status: 409 });
    if (previous && order.version !== previous.version + 1) throw Object.assign(new Error("The submitted Grab & Go order version is stale. Refresh and try again."), { status: 409 });
    if (!previous && order.version !== 1) throw Object.assign(new Error("Submit must create the first order version."), { status: 409 });
    await stageGrabHandoff(transaction, order);
    transaction.set(ref, order);
  });
  recordDeliveredInAppReadBudget({ stage: "grab_and_go_order_mutation", recordsInspected: 1, oplocId: order.oplocId, knownId: true });
  return order;
}
export function saveGrabAndGoOrder(order: GrabAndGoOrder, expectedVersion?: number) { return withTransaction(stored => putOrder(stored, order, expectedVersion)); }
function putOrder(stored: Stored, order: GrabAndGoOrder, expectedVersion?: number) {
  const index = stored.orders.findIndex(value => value.orderId === order.orderId); const previous = index >= 0 ? stored.orders[index] : undefined;
  if (previous && expectedVersion !== previous.version) throw Object.assign(new Error(`This Grab & Go order changed elsewhere (expected version ${previous.version}). Refresh and try again.`), { status: 409 });
  if (!previous && expectedVersion !== undefined) throw Object.assign(new Error("This Grab & Go order no longer exists. Refresh and try again."), { status: 409 });
  if (previous && order.version !== previous.version + 1) throw Object.assign(new Error("The submitted Grab & Go order version is stale. Refresh and try again."), { status: 409 });
  if (!previous && order.version !== 1) throw Object.assign(new Error("Submit must create the first order version."), { status: 409 });
  if (index >= 0) stored.orders[index] = order; else stored.orders.push(order);
  const action = order.status === "cancelled" ? "cancelled" : previous ? "amended" : "submitted";
  const addEvent = (event: DurableDomainEvent) => { if (!stored.events.some(existing => existing.eventId === event.eventId)) stored.events.push(event); };
  addEvent(createDomainEvent({ eventType: `grab-and-go.order.${action}`, sourceAggregateId: order.orderId, sourceVersion: order.version, occurredAt: order.updatedAt, payload: { orderId: order.orderId, oplocId: order.oplocId, deliveryDate: order.deliveryDate, version: order.version, status: order.status } }));
  return order;
}

// ---- Standing-order templates (Grab & Go only). Occurrences stay ordinary canonical orders. ----
const hostedStanding = () => db.collection("fikaDeliveredInGrabAndGoStandingOrdersV1");
const standingRef = (standingOrderId: string) => hostedStanding().doc(stableDocumentId(standingOrderId));
const conflict = (message: string) => Object.assign(new Error(message), { status: 409 });
export type StandingCommit = "created" | "skipped-existing-order" | "conflict";

export async function listStandingOrdersHosted(filter: { oplocId?: string; status?: StandingOrder["status"] } = {}) {
  if (!hosted()) return (read().standingOrders || []).filter(item => (!filter.oplocId || item.oplocId === filter.oplocId) && (!filter.status || item.status === filter.status)).map(item => structuredClone(item));
  let query: FirebaseFirestore.Query = hostedStanding();
  if (filter.oplocId) query = query.where("oplocId", "==", filter.oplocId);
  if (filter.status) query = query.where("status", "==", filter.status);
  const snapshot = await query.limit(500).get();
  recordDataAccess({ app: "delivered-in", operation: "grab-and-go.standing-orders.list", source: "FIRESTORE", documents: snapshot.size, firestoreReadKind: "query" });
  return snapshot.docs.map(document => document.data() as StandingOrder);
}
export async function getStandingOrderHosted(standingOrderId: string) {
  if (!hosted()) { const found = (read().standingOrders || []).find(item => item.standingOrderId === standingOrderId); return found && structuredClone(found); }
  const snapshot = await standingRef(standingOrderId).get();
  return snapshot.exists ? snapshot.data() as StandingOrder : undefined;
}

/** Creates the template and links the source order (metadata only: no version bump, no new CPU handoff) in one transaction. */
export async function createStandingOrderHosted(template: StandingOrder, sourceOrderId: string, sourceVersion: number) {
  const link = (order: GrabAndGoOrder): GrabAndGoOrder => ({ ...order, standingOrderId: template.standingOrderId, standingOrderOccurrenceDate: order.deliveryDate });
  const check = (order: GrabAndGoOrder | undefined, existing: unknown) => {
    if (!order || order.status !== "submitted") throw conflict("The source order is no longer active.");
    if (order.version !== sourceVersion) throw conflict("The source order changed elsewhere. Refresh and try again.");
    if (order.standingOrderId || existing) throw conflict("This order already belongs to a standing order.");
  };
  if (!hosted()) return withTransaction(stored => {
    const list = stored.standingOrders ||= []; const index = stored.orders.findIndex(order => order.orderId === sourceOrderId);
    check(stored.orders[index], list.find(item => item.standingOrderId === template.standingOrderId));
    stored.orders[index] = link(stored.orders[index]); list.push(template); return template;
  });
  await db.runTransaction(async transaction => {
    const orderRef = hostedOrders().doc(stableDocumentId(sourceOrderId)); const ref = standingRef(template.standingOrderId);
    const [order, existing] = await Promise.all([transaction.get(orderRef), transaction.get(ref)]);
    check(order.exists ? order.data() as GrabAndGoOrder : undefined, existing.exists);
    transaction.set(orderRef, link(order.data() as GrabAndGoOrder)); transaction.set(ref, template);
  });
  return template;
}

/** Optimistic-version template update (edit / pause / resume / stop / update-from-order). */
export async function saveStandingOrderHosted(next: StandingOrder, expectedVersion: number) {
  const check = (current: StandingOrder | undefined) => {
    if (!current) throw Object.assign(new Error("Standing order not found."), { status: 404 });
    if (current.version !== expectedVersion || next.version !== current.version + 1) throw conflict("This standing order changed elsewhere. Refresh and try again.");
  };
  if (!hosted()) return withTransaction(stored => { const list = stored.standingOrders ||= []; const index = list.findIndex(item => item.standingOrderId === next.standingOrderId); check(list[index]); list[index] = next; return next; });
  await db.runTransaction(async transaction => { const ref = standingRef(next.standingOrderId); const snapshot = await transaction.get(ref); check(snapshot.exists ? snapshot.data() as StandingOrder : undefined); transaction.set(ref, next); });
  return next;
}

/** Transactional read-modify-write of one template. `mutate` returns the next template, or undefined for "no change" (nothing is written). */
export async function updateStandingOrderHosted(standingOrderId: string, mutate: (current: StandingOrder) => StandingOrder | undefined) {
  if (!hosted()) return withTransaction(stored => { const list = stored.standingOrders ||= []; const index = list.findIndex(item => item.standingOrderId === standingOrderId); if (index < 0) return undefined; const next = mutate(list[index]); if (next) list[index] = next; return next; });
  return db.runTransaction(async transaction => { const ref = standingRef(standingOrderId); const snapshot = await transaction.get(ref); if (!snapshot.exists) return undefined; const next = mutate(snapshot.data() as StandingOrder); if (next) transaction.set(ref, next); return next; });
}

/**
 * Atomically records one occurrence. Idempotent on standingOrderId + occurrenceDate: the order id is deterministic
 * (site + date), the template must still be active and sitting at `expectedLast`, and the template pointer advances in
 * the same transaction as the order write. A repeated or concurrent run sees the advanced pointer and returns
 * "conflict" without writing. A pre-existing order for that site/date (manual or cancelled) is never touched.
 */
export async function commitStandingOccurrenceHosted(input: { standingOrderId: string; expectedLast: string; occurrenceDate: string; order: GrabAndGoOrder; at: string }): Promise<StandingCommit> {
  const advance = (template: StandingOrder | undefined) => {
    if (!template || template.status !== "active" || template.lastOccurrenceDate !== input.expectedLast || input.order.standingOrderId !== template.standingOrderId || input.order.oplocId !== template.oplocId || input.order.deliveryDate !== input.occurrenceDate) return undefined;
    return { ...template, lastOccurrenceDate: input.occurrenceDate, updatedAt: input.at, ...(template.attention ? { attention: resolveAttention(template, input.occurrenceDate, input.at) } : {}) };
  };
  if (!hosted()) return withTransaction(stored => {
    const list = stored.standingOrders ||= []; const index = list.findIndex(item => item.standingOrderId === input.standingOrderId); const next = advance(list[index]);
    if (!next) return "conflict" as const;
    list[index] = next;
    if (stored.orders.some(order => order.orderId === input.order.orderId)) return "skipped-existing-order" as const;
    putOrder(stored, input.order); return "created" as const;
  });
  return db.runTransaction(async transaction => {
    const ref = standingRef(input.standingOrderId); const orderRef = hostedOrders().doc(stableDocumentId(input.order.orderId));
    const [snapshot, existing] = await Promise.all([transaction.get(ref), transaction.get(orderRef)]);
    const next = advance(snapshot.exists ? snapshot.data() as StandingOrder : undefined);
    if (!next) return "conflict" as const;
    // Firestore requires every read (including the handoff-event read inside stageGrabHandoff) before any write.
    if (existing.exists) { transaction.set(ref, next); return "skipped-existing-order" as const; }
    await stageGrabHandoff(transaction, input.order); transaction.set(ref, next); transaction.set(orderRef, input.order); return "created" as const;
  });
}
export function listGrabAndGoEvents() { return read().events.map(event => structuredClone(event)); }
export async function replayGrabAndGoOutbox(consumer: (event: DurableDomainEvent) => Promise<void> | void, at = new Date()) {
  withTransaction(stored => { backfillMissingFulfilmentEvents(stored); });
  let delivered = 0; let failed = 0;
  while (true) {
    const claimId = `grab-and-go-replay:${crypto.randomUUID()}`;
    const claimed = withTransaction(stored => {
      const sorted = stored.events.slice().sort((a, b) => a.sourceAggregateId.localeCompare(b.sourceAggregateId) || a.sourceVersion - b.sourceVersion || a.eventId.localeCompare(b.eventId));
      const event = sorted.find(candidate => eventIsDue(candidate, at) && !sorted.some(previous => previous.sourceAggregateId === candidate.sourceAggregateId && previous.sourceVersion < candidate.sourceVersion && previous.delivery.status !== "delivered"));
      if (!event) return undefined;
      const next = claimEvent(event, claimId, at.toISOString()); const index = stored.events.findIndex(candidate => candidate.eventId === event.eventId); stored.events[index] = next; return structuredClone(next);
    });
    if (!claimed) break;
    try {
      await consumer(claimed);
      withTransaction(stored => { const index = stored.events.findIndex(event => event.eventId === claimed.eventId && event.delivery.claimId === claimId); if (index >= 0) stored.events[index] = markEventDelivered(stored.events[index], new Date().toISOString()); });
      delivered += 1;
    } catch (error) {
      withTransaction(stored => { const index = stored.events.findIndex(event => event.eventId === claimed.eventId && event.delivery.claimId === claimId); if (index >= 0) stored.events[index] = markEventFailed(stored.events[index], error, new Date().toISOString()); });
      failed += 1;
    }
  }
  return { delivered, failed };
}
