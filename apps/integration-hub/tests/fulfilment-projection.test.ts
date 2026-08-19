import assert from "node:assert/strict";
import test from "node:test";
import { createDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromGrabAndGoOrder, fulfilmentFromProductionOrder, fulfilmentFromPublishedMenuDay } from "../../shared/fulfilment-requirement";
import { applyFulfilmentEvent, listFulfilmentReceipts, listFulfilmentRequirements, normaliseFulfilmentEvent, shouldApplyFulfilmentVersion } from "../lib/fulfilment-projection";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";

const menuDay = { publicationDayId: "publication:day:v1", sourceDayId: "rolling-week:day:1", version: 2, contentHash: "hash", date: "2026-08-24", status: "published" as const, entries: [{ sourceEntryId: "entry:1", canonicalDishId: "dish:leaf", dishName: "Mixed Leaf", slot: "SALAD", allocations: [{ destinationId: "oploc:haleon", destinationLabel: "Haleon", quantity: 7 }] }] };
const grabOrder = { orderId: "grab-and-go:oploc:haleon:2026-08-24", oplocId: "oploc:haleon", deliveryDate: "2026-08-24", version: 3, status: "submitted" as const, lines: [{ productId: "grab:pot", productName: "Fruit Pot", quantity: 4, sortOrder: 0 }] };
const productionOrder = { canonicalId: "production-order:cpu:1", version: 1, productionLocationId: "oploc:cpux", destinationOplocId: "oploc:haleon", destinationLabel: "Haleon", serviceDate: "2026-08-24", requiredBy: "2026-08-24T09:00:00", serviceWindow: { startTime: "09:00" }, status: "ready", lines: [{ canonicalId: "production-line:1", sourceMenuItemId: "dish:leaf", itemName: "Mixed Leaf", customerQuantity: 7, customerUnit: "portion", productionQuantity: 7, productionUnit: "portion", sortOrder: 0 }] };

test("all three source domains normalize into one Logistics-facing contract", () => {
  const sources = [
    fulfilmentFromPublishedMenuDay(menuDay, "oploc:haleon"),
    fulfilmentFromGrabAndGoOrder(grabOrder, "site"),
    fulfilmentFromProductionOrder(productionOrder, "cpu"),
  ];
  assert.deepEqual(sources.map(source => source.destinationOplocId), ["oploc:haleon", "oploc:haleon", "oploc:haleon"]);
  assert.deepEqual(sources.map(source => source.lines[0].quantity), [7, 4, 7]);
  assert.equal(sources[2].productionLocationId, "oploc:cpux");
  assert.ok(sources.every(source => source.entityType === "Fulfilment Requirement" && source.sourceVersion > 0));
});

test("central projection accepts source snapshots, is idempotent, and rejects stale versions", () => {
  const requirement = fulfilmentFromGrabAndGoOrder(grabOrder, "site");
  const event = createDomainEvent({ eventType: "fulfilment.requirement.created", sourceAggregateId: requirement.canonicalId, sourceVersion: requirement.sourceVersion, occurredAt: "2026-08-20T10:00:00Z", payload: requirement });
  assert.deepEqual(normaliseFulfilmentEvent(event), requirement);
  assert.equal(shouldApplyFulfilmentVersion(undefined, requirement), true);
  assert.equal(shouldApplyFulfilmentVersion(requirement, requirement), true);
  const stale = { ...requirement, sourceVersion: 2 };
  assert.equal(shouldApplyFulfilmentVersion(requirement, stale), false);
  assert.equal(event.eventId, `fulfilment.requirement.created:${requirement.canonicalId}:v${requirement.sourceVersion}`);
});

test("canonical destination identity prevents display labels from merging requirements", () => {
  const haleon = fulfilmentFromGrabAndGoOrder(grabOrder, "site");
  const other = fulfilmentFromGrabAndGoOrder({ ...grabOrder, oplocId: "oploc:other" }, "site");
  assert.notEqual(haleon.canonicalId, other.canonicalId);
  assert.notEqual(haleon.destinationOplocId, other.destinationOplocId);
});

test("the central store receives all three sources and applies amendments, withdrawal and duplicate replay safely", async () => {
  const suffix = `${Date.now()}:${process.pid}`;
  const menu = { ...menuDay, sourceDayId: `rolling-week:contract:${suffix}` };
  const grab = { ...grabOrder, orderId: `grab-and-go:contract:${suffix}` };
  const production = { ...productionOrder, canonicalId: `production-order:contract:${suffix}` };
  const requirements = [
    fulfilmentFromPublishedMenuDay(menu, "oploc:haleon"),
    fulfilmentFromGrabAndGoOrder(grab, "site"),
    fulfilmentFromProductionOrder(production, "cpu"),
  ];
  const events = requirements.map(requirement => createDomainEvent({ eventType: "fulfilment.requirement.created", sourceAggregateId: requirement.canonicalId, sourceVersion: requirement.sourceVersion, occurredAt: "2026-08-20T10:00:00Z", payload: requirement }));
  try {
    for (const event of events) assert.equal((await applyFulfilmentEvent(event)).applied, true);
    assert.equal((await applyFulfilmentEvent(events[0])).duplicate, true);
    const amended = fulfilmentFromGrabAndGoOrder({ ...grab, version: 4, lines: [{ ...grab.lines[0], quantity: 9 }] }, "site", "2026-08-21T10:00:00Z", requirements[1]);
    const amendedEvent = createDomainEvent({ eventType: "fulfilment.requirement.amended", sourceAggregateId: amended.canonicalId, sourceVersion: amended.sourceVersion, occurredAt: "2026-08-21T10:00:00Z", payload: amended });
    assert.equal((await applyFulfilmentEvent(amendedEvent)).applied, true);
    const withdrawn = fulfilmentFromGrabAndGoOrder({ ...grab, version: 5, status: "cancelled", lines: [{ ...grab.lines[0], quantity: 9 }] }, "site", "2026-08-22T10:00:00Z", amended);
    const withdrawnEvent = createDomainEvent({ eventType: "fulfilment.requirement.withdrawn", sourceAggregateId: withdrawn.canonicalId, sourceVersion: withdrawn.sourceVersion, occurredAt: "2026-08-22T10:00:00Z", payload: withdrawn });
    assert.equal((await applyFulfilmentEvent(withdrawnEvent)).requirement?.status, "withdrawn");
    const listed = await listFulfilmentRequirements();
    assert.equal(listed.filter(item => item.sourceEntityId.endsWith(suffix)).length, 3);
    assert.equal(listed.find(item => item.sourceEntityId === grab.orderId)?.lines[0].quantity, 9);
    assert.equal(listed.find(item => item.sourceEntityId === grab.orderId)?.status, "withdrawn");
    const receipts = await listFulfilmentReceipts();
    assert.ok(receipts.some(item => item.eventId === amendedEvent.eventId && item.outcome === "processed"));
  } finally {
    const requirementsSnapshot = await db.collection("fikaFulfilmentRequirementsV1").get();
    const receiptsSnapshot = await db.collection("fikaDomainEventInboxV1").get();
    const batch = db.batch();
    for (const doc of requirementsSnapshot.docs) if ((doc.data() as { sourceEntityId?: string }).sourceEntityId?.endsWith(suffix)) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) if (String(doc.data().eventId || "").includes(suffix)) batch.delete(doc.ref);
    await batch.commit();
  }
});
