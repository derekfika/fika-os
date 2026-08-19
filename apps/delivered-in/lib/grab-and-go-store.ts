import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { GrabAndGoOrder, GrabAndGoProduct } from "./grab-and-go";
import { createDomainEvent, replayDueEvents, type DurableDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromGrabAndGoOrder, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { reconcileFulfilmentRequirements } from "../../shared/fulfilment-reconciliation";

type Stored = { version: 1; orders: GrabAndGoOrder[]; events: DurableDomainEvent[]; fulfilmentRequirements: FulfilmentRequirement[] };
const file = join(process.cwd(), "local-data", "delivered-in", "grab-and-go-orders.json");
const unavailable = (message: string, cause?: unknown) => Object.assign(new Error(message, cause ? { cause } : undefined), { status: 503 });
const read = (): Stored => { if (!existsSync(file)) return { version: 1, orders: [], events: [], fulfilmentRequirements: [] }; try { const value = JSON.parse(readFileSync(file, "utf8")) as Partial<Stored>; if (!Array.isArray(value.orders)) throw new Error("orders is not an array"); return { version: 1, orders: value.orders, events: Array.isArray(value.events) ? value.events : [], fulfilmentRequirements: Array.isArray(value.fulfilmentRequirements) ? value.fulfilmentRequirements : [] }; } catch (cause) { throw unavailable("Grab & Go order data is unavailable; no order list was loaded.", cause); } };
const write = (value: Stored) => { mkdirSync(dirname(file), { recursive: true }); const temporary = `${file}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2)); renameSync(temporary, file); };
const catalogueFile = join(process.cwd(), "local-data", "delivered-in", "grab-and-go-catalogue.json");
export function readGrabAndGoCatalogue(): GrabAndGoProduct[] { try { const value = JSON.parse(readFileSync(catalogueFile, "utf8")) as { products?: GrabAndGoProduct[] }; if (!Array.isArray(value.products)) throw new Error("products is not an array"); return value.products; } catch (cause) { throw unavailable("Grab & Go catalogue is unavailable; no product list was loaded.", cause); } }
export function listGrabAndGoOrders(oplocId?: string) { return read().orders.filter(order => !oplocId || order.oplocId === oplocId); }
export function getGrabAndGoOrder(oplocId: string, deliveryDate: string) { return read().orders.find(order => order.oplocId === oplocId && order.deliveryDate === deliveryDate); }
export function saveGrabAndGoOrder(order: GrabAndGoOrder) {
  const stored = read(); const index = stored.orders.findIndex(value => value.orderId === order.orderId); const previous = index >= 0 ? stored.orders[index] : undefined; if (index >= 0) stored.orders[index] = order; else stored.orders.push(order);
  const action = order.status === "cancelled" ? "cancelled" : previous ? "amended" : "submitted";
  const addEvent = (event: DurableDomainEvent) => { if (!stored.events.some(existing => existing.eventId === event.eventId)) stored.events.push(event); };
  addEvent(createDomainEvent({ eventType: `grab-and-go.order.${action}`, sourceAggregateId: order.orderId, sourceVersion: order.version, occurredAt: order.updatedAt, payload: { orderId: order.orderId, oplocId: order.oplocId, deliveryDate: order.deliveryDate, version: order.version, status: order.status } }));
  const previousRequirement = stored.fulfilmentRequirements.find(requirement => requirement.sourceEntityId === order.orderId);
  const requirement = fulfilmentFromGrabAndGoOrder(order, order.updatedBy, order.updatedAt, previousRequirement);
  stored.fulfilmentRequirements = [...stored.fulfilmentRequirements.filter(value => value.canonicalId !== requirement.canonicalId), requirement];
  addEvent(createDomainEvent({ eventType: `fulfilment.requirement.${requirement.status === "withdrawn" ? "withdrawn" : previousRequirement ? "amended" : "created"}`, sourceAggregateId: requirement.canonicalId, sourceVersion: requirement.version, occurredAt: order.updatedAt, payload: requirement, causationId: order.orderId }));
  write(stored); return order;
}
export function listGrabAndGoEvents() { return read().events.map(event => structuredClone(event)); }
export async function replayGrabAndGoOutbox(consumer: (event: DurableDomainEvent) => Promise<void> | void, at = new Date()) { const stored = read(); const result = await replayDueEvents(stored.events, consumer, at); stored.events = result.events; write(stored); return result; }
export function reconcileGrabAndGoFulfilment() { const stored = read(); const expected = stored.orders.map(order => ({ sourceDomain: "grab-and-go" as const, sourceEntityId: order.orderId, sourceVersion: order.version, destinationOplocId: order.oplocId, status: order.status === "cancelled" ? "withdrawn" as const : "active" as const })); return reconcileFulfilmentRequirements(expected, stored.fulfilmentRequirements, stored.events); }
