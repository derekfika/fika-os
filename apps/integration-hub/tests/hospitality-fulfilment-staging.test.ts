import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { prepareHospitalityProductionChanges } from "../lib/hospitality-booking-service";
import { normaliseFulfilmentEvent } from "../lib/fulfilment-projection";
import { fulfilmentFromProductionOrder } from "../../shared/fulfilment-requirement";
import { createDomainEvent } from "../../shared/domain-events";
import { stableDocumentId } from "../lib/canonical-editor";
import type { ProductionOrder } from "../lib/production-domain";

const order = (id: string): ProductionOrder => ({ canonicalId: id, entityType: "Production Order", schemaVersion: "0.1.0", version: 1, requirementIds: [], sourceBookingId: "booking:uat", sourceQuoteRevisionId: "quote:r1", productionLocationId: "oploc:cpu", destinationOplocId: "oploc:mnk", destinationLabel: "UAT", serviceDate: "2099-10-13", requiredBy: "2099-10-13T11:00:00Z", serviceWindow: { startTime: "12:00" }, status: "draft", priority: "normal", lines: [{ canonicalId: `${id}:line:1`, sourceBookingLineId: "line:1", itemName: "UAT sandwich", customerQuantity: 12, customerUnit: "per-person", productionQuantity: 36, productionUnit: "piece", dietaries: {}, status: "ready", sortOrder: 0 }], exceptions: [], origin: "hospitality_booking", currentRevision: 1, createdAt: "2099-10-12T09:00:00Z", createdBy: "uat", idempotencyKey: id, externalReferences: [], audit: [] });

for (const status of ["amended", "cancelled"] as const) test(`Hospitality ${status} atomically stages both fulfilment withdrawals with history and durable Logistics events`, async () => {
  const records = new Map<string, any>();
  const prior = [order("order:uat:a"), order("order:uat:b")];
  for (const source of prior) {
    const requirement = fulfilmentFromProductionOrder(source, "original-actor", "2099-10-12T09:00:00Z");
    records.set(`fikaFulfilmentRequirementsV1/${stableDocumentId(requirement.canonicalId)}`, requirement);
  }
  const changes = prior.map(source => ({ order: { ...source, version: 2, status }, changeType: status === "cancelled" ? "withdrawn" as const : "amended" as const, idempotencyKey: `booking:uat:${status}:v2` }));
  async function stage() {
    const writes: Array<[string, any]> = [];
    const tx = { async get(ref: { path: string }) { assert.equal(writes.length, 0, "Firestore prohibits read-after-write"); const value = records.get(ref.path); return { exists: value !== undefined, data: () => value }; }, set(ref: { path: string }, value: any) { writes.push([ref.path, value]); }, create(ref: { path: string }, value: any) { assert(!records.has(ref.path)); writes.push([ref.path, value]); } };
    const apply = await prepareHospitalityProductionChanges(tx as any, changes, "actor:uat", "booking:uat", "2099-10-13T08:00:00Z", "Owned UAT amendment");
    assert.equal(writes.length, 0);
    apply();
    for (const [key, value] of writes) records.set(key, value);
  }
  await stage();
  const values = (collection: string) => [...records].filter(([key]) => key.startsWith(`${collection}/`)).map(([, value]) => value);
  assert.equal(values("fikaFulfilmentRequirementsV1").length, 2);
  for (const requirement of values("fikaFulfilmentRequirementsV1")) {
    assert.equal(requirement.status, "withdrawn");
    assert.equal(requirement.sourceVersion, 2);
    assert.equal(requirement.version, 2);
    assert.equal(requirement.audit.length, 2);
    assert.equal(requirement.audit[0].by, "original-actor");
    assert.equal(requirement.audit[1].by, "actor:uat");
    assert.equal(requirement.lines[0].quantity, 36);
  }
  assert.equal(values("fikaLogisticsProjectionOutboxV1").length, 2);
  for (const event of values("fikaLogisticsProjectionOutboxV1")) assert.equal(event.payload.changeType, "withdrawn");
  assert.equal(values("fikaDomainEventsV1").length, 2);
  const before = structuredClone([...records]);
  await stage();
  assert.deepEqual([...records], before, "replay cannot create duplicate work or erase history");
});

test("only the retired Hospitality snapshot is withdrawn; an ordinary CPU amendment remains active", () => {
  const retired = { ...order("order:uat"), status: "amended" as const, version: 2 };
  const event = (productionOrder: ProductionOrder) => createDomainEvent({ eventType: "production.order.amended", sourceAggregateId: productionOrder.canonicalId, sourceVersion: 2, occurredAt: "2099-10-13T08:00:00Z", payload: { productionOrder, actorId: "actor:uat" } });
  assert.equal(normaliseFulfilmentEvent(event(retired)).status, "withdrawn");
  assert.equal(normaliseFulfilmentEvent(event({ ...retired, origin: "cpu_created" })).status, "amended");
});

test("both authoritative booking retirement paths prepare fulfilment before their order writes", () => {
  const source = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");
  assert.equal((source.match(/await prepareHospitalityProductionChanges\(transaction, projectionChanges/g) || []).length, 2);
  assert.match(source, /stageChanges\(\);\s*for \(const prior of retiringOrders\)/);
  assert.match(source, /stageChanges\(\);\s*for \(const prior of activeOrders\)/);
});
