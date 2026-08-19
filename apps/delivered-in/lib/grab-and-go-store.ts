import { DatabaseSync } from "node:sqlite";
import crypto from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GrabAndGoOrder, GrabAndGoProduct } from "./grab-and-go";
import { claimEvent, createDomainEvent, eventIsDue, markEventDelivered, markEventFailed, type DurableDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromGrabAndGoOrder, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { appDataPath } from "../../shared/app-data-path";

type Stored = { version: 1; orders: GrabAndGoOrder[]; events: DurableDomainEvent[]; /** Legacy migration field; central Integration Hub is authoritative. */ fulfilmentRequirements?: FulfilmentRequirement[] };
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
  try { const row = database.prepare("SELECT state_json FROM grab_and_go_state WHERE state_id = 1").get() as { state_json?: string } | undefined; if (!row?.state_json) throw new Error("missing state"); const value = JSON.parse(row.state_json) as Stored; if (!Array.isArray(value.orders) || !Array.isArray(value.events)) throw new Error("invalid state"); return { version: 1, orders: value.orders, events: value.events }; } catch (cause) { throw unavailable("Grab & Go order data is unavailable; no order list was loaded.", cause); }
}
const read = (): Stored => { const database = open(); try { return parse(database); } finally { database.close(); } };
function withTransaction<T>(mutator: (stored: Stored) => T) {
  const database = open(); database.exec("BEGIN IMMEDIATE");
  try { const stored = parse(database); const result = mutator(stored); database.prepare("UPDATE grab_and_go_state SET state_json = ?, updated_at = ? WHERE state_id = 1").run(JSON.stringify(stored), new Date().toISOString()); database.exec("COMMIT"); return result; } catch (cause) { try { database.exec("ROLLBACK"); } catch { /* preserve original failure */ } throw cause; } finally { database.close(); }
}
const catalogueFile = appDataPath("delivered-in", "delivered-in", "grab-and-go-catalogue.json");
export function readGrabAndGoCatalogue(): GrabAndGoProduct[] { try { const value = JSON.parse(readFileSync(catalogueFile, "utf8")) as { products?: GrabAndGoProduct[] }; if (!Array.isArray(value.products)) throw new Error("products is not an array"); return value.products; } catch (cause) { throw unavailable("Grab & Go catalogue is unavailable; no product list was loaded.", cause); } }
export function listGrabAndGoOrders(oplocId?: string) { return read().orders.filter(order => !oplocId || order.oplocId === oplocId); }
export function getGrabAndGoOrder(oplocId: string, deliveryDate: string) { return read().orders.find(order => order.oplocId === oplocId && order.deliveryDate === deliveryDate); }
export function saveGrabAndGoOrder(order: GrabAndGoOrder, expectedVersion?: number) {
  return withTransaction(stored => {
  const index = stored.orders.findIndex(value => value.orderId === order.orderId); const previous = index >= 0 ? stored.orders[index] : undefined;
  if (previous && expectedVersion !== previous.version) throw Object.assign(new Error(`This Grab & Go order changed elsewhere (expected version ${previous.version}). Refresh and try again.`), { status: 409 });
  if (!previous && expectedVersion !== undefined) throw Object.assign(new Error("This Grab & Go order no longer exists. Refresh and try again."), { status: 409 });
  if (previous && order.version !== previous.version + 1) throw Object.assign(new Error("The submitted Grab & Go order version is stale. Refresh and try again."), { status: 409 });
  if (!previous && order.version !== 1) throw Object.assign(new Error("Submit must create the first order version."), { status: 409 });
  if (index >= 0) stored.orders[index] = order; else stored.orders.push(order);
  const action = order.status === "cancelled" ? "cancelled" : previous ? "amended" : "submitted";
  const addEvent = (event: DurableDomainEvent) => { if (!stored.events.some(existing => existing.eventId === event.eventId)) stored.events.push(event); };
  addEvent(createDomainEvent({ eventType: `grab-and-go.order.${action}`, sourceAggregateId: order.orderId, sourceVersion: order.version, occurredAt: order.updatedAt, payload: { orderId: order.orderId, oplocId: order.oplocId, deliveryDate: order.deliveryDate, version: order.version, status: order.status } }));
  const previousRequirement = stored.events
    .map(event => event.payload as FulfilmentRequirement)
    .filter(requirement => requirement?.entityType === "Fulfilment Requirement" && requirement.sourceEntityId === order.orderId)
    .sort((a, b) => b.sourceVersion - a.sourceVersion)[0];
  const requirement = fulfilmentFromGrabAndGoOrder(order, order.updatedBy, order.updatedAt, previousRequirement);
  addEvent(createDomainEvent({ eventType: `fulfilment.requirement.${requirement.status === "withdrawn" ? "withdrawn" : previousRequirement ? "amended" : "created"}`, sourceAggregateId: requirement.canonicalId, sourceVersion: requirement.sourceVersion, occurredAt: order.updatedAt, payload: requirement, causationId: order.orderId }));
  return order;
  });
}
export function listGrabAndGoEvents() { return read().events.map(event => structuredClone(event)); }
export async function replayGrabAndGoOutbox(consumer: (event: DurableDomainEvent) => Promise<void> | void, at = new Date()) {
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
