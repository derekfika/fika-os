import assert from "node:assert/strict";
import test from "node:test";
import { createDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromGrabAndGoOrder, fulfilmentFromProductionOrder, fulfilmentFromPublishedMenuDay, productionStatusToFulfilmentStatus } from "../../shared/fulfilment-requirement";
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
  assert.equal(shouldApplyFulfilmentVersion(requirement, requirement), false);
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

test("ProductionOrder lifecycle maps explicitly to Fulfilment lifecycle", () => {
  assert.equal(productionStatusToFulfilmentStatus("received"), "pending");
  assert.equal(productionStatusToFulfilmentStatus("draft"), "pending");
  assert.equal(productionStatusToFulfilmentStatus("needs_review"), "pending");
  assert.equal(productionStatusToFulfilmentStatus("planning"), "ready_for_planning");
  assert.equal(productionStatusToFulfilmentStatus("ready"), "ready_for_planning");
  assert.equal(productionStatusToFulfilmentStatus("cancelled"), "withdrawn");
  assert.equal(productionStatusToFulfilmentStatus("accepted", "production-order:v2"), "withdrawn");
});

test("Fulfilment materialisation preserves pending and ready lifecycle semantics", () => {
  const draft = fulfilmentFromProductionOrder({ ...productionOrder, status: "draft" }, "cpu");
  const needsReview = fulfilmentFromProductionOrder({ ...productionOrder, version: 2, status: "needs_review" }, "cpu", "2026-08-20T10:00:00Z", draft);
  const accepted = fulfilmentFromProductionOrder({ ...productionOrder, version: 3, status: "accepted" }, "cpu", "2026-08-21T10:00:00Z", needsReview);
  const planning = fulfilmentFromProductionOrder({ ...productionOrder, version: 4, status: "planning" }, "cpu", "2026-08-22T10:00:00Z", accepted);
  const amended = fulfilmentFromProductionOrder({ ...productionOrder, version: 5, status: "planning", lines: [{ ...productionOrder.lines[0], productionQuantity: 8 }] }, "cpu", "2026-08-23T10:00:00Z", planning);
  const withdrawn = fulfilmentFromProductionOrder({ ...productionOrder, version: 6, status: "cancelled" }, "cpu", "2026-08-24T10:00:00Z", amended);
  assert.equal(draft.status, "pending");
  assert.equal(needsReview.status, "pending");
  assert.equal(accepted.status, "ready_for_planning");
  assert.equal(planning.status, "amended");
  assert.equal(amended.status, "amended");
  assert.equal(withdrawn.status, "withdrawn");
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
    const sameVersionConflict = fulfilmentFromGrabAndGoOrder({ ...grab, lines: [{ ...grab.lines[0], quantity: 8 }] }, "site", "2026-08-20T10:01:00Z");
    const conflictResult = await applyFulfilmentEvent(createDomainEvent({ eventType: "fulfilment.requirement.amended", sourceAggregateId: sameVersionConflict.canonicalId, sourceVersion: sameVersionConflict.sourceVersion, occurredAt: "2026-08-20T10:01:00Z", payload: sameVersionConflict }));
    assert.match(conflictResult.error || "", /same source version/i);
    const amended = fulfilmentFromGrabAndGoOrder({ ...grab, version: 4, lines: [{ ...grab.lines[0], quantity: 9 }] }, "site", "2026-08-21T10:00:00Z", requirements[1]);
    const amendedEvent = createDomainEvent({ eventType: "fulfilment.requirement.amended", sourceAggregateId: amended.canonicalId, sourceVersion: amended.sourceVersion, occurredAt: "2026-08-21T10:00:00Z", payload: amended });
    assert.equal((await applyFulfilmentEvent(amendedEvent)).applied, true);
    const withdrawn = fulfilmentFromGrabAndGoOrder({ ...grab, version: 5, status: "cancelled", lines: [{ ...grab.lines[0], quantity: 9 }] }, "site", "2026-08-22T10:00:00Z", amended);
    const withdrawnEvent = createDomainEvent({ eventType: "fulfilment.requirement.withdrawn", sourceAggregateId: withdrawn.canonicalId, sourceVersion: withdrawn.sourceVersion, occurredAt: "2026-08-22T10:00:00Z", payload: withdrawn });
    assert.equal((await applyFulfilmentEvent(withdrawnEvent)).requirement?.status, "withdrawn");
    const listed = await listFulfilmentRequirements({}, { allowUnbounded: true });
    assert.equal(listed.filter(item => item.sourceEntityId.endsWith(suffix)).length, 3);
    assert.equal(listed.find(item => item.sourceEntityId === grab.orderId)?.lines[0].quantity, 9);
    assert.equal(listed.find(item => item.sourceEntityId === grab.orderId)?.status, "withdrawn");
    const receipts = await listFulfilmentReceipts();
    assert.ok(receipts.some(item => item.eventId === amendedEvent.eventId && item.outcome === "processed"));
    assert.ok(receipts.some(item => item.outcome === "conflict" && item.requirementId === requirements[1].canonicalId));
  } finally {
    const requirementsSnapshot = await db.collection("fikaFulfilmentRequirementsV1").get();
    const receiptsSnapshot = await db.collection("fikaDomainEventInboxV1").get();
    const batch = db.batch();
    for (const doc of requirementsSnapshot.docs) if ((doc.data() as { sourceEntityId?: string }).sourceEntityId?.endsWith(suffix)) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) if (String(doc.data().eventId || "").includes(suffix)) batch.delete(doc.ref);
    await batch.commit();
  }
});

test("normal Fulfilment reads require an indexed scope and retain all predicates", async () => {
  await assert.rejects(() => listFulfilmentRequirements(), /service date, status or OPLOC scope is required/i);
  const matching = fulfilmentFromPublishedMenuDay({ ...menuDay, publicationDayId: `publication:day:bounded:${Date.now()}` }, "oploc:bounded");
  const outsideDate = { ...matching, canonicalId: `${matching.canonicalId}:outside-date`, serviceDate: "2099-01-02" };
  try {
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(matching.canonicalId)).set(matching);
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(outsideDate.canonicalId)).set(outsideDate);
    const listed = await listFulfilmentRequirements({ serviceDate: matching.serviceDate, status: matching.status, destinationOplocId: matching.destinationOplocId });
    assert.deepEqual(listed.map(item => item.canonicalId), [matching.canonicalId]);
  } finally {
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(matching.canonicalId)).delete();
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(outsideDate.canonicalId)).delete();
  }
});

test("Fulfilment week reads use a bounded service-date range", async () => {
  const matching = fulfilmentFromPublishedMenuDay({ ...menuDay, publicationDayId: `publication:day:range:${Date.now()}` }, "oploc:range");
  const outsideRange = { ...matching, canonicalId: `${matching.canonicalId}:outside`, serviceDate: "2099-01-08" };
  try {
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(matching.canonicalId)).set(matching);
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(outsideRange.canonicalId)).set(outsideRange);
    const listed = await listFulfilmentRequirements({ serviceDateFrom: "2026-08-24", serviceDateToExclusive: "2026-08-29" });
    assert.ok(listed.some(item => item.canonicalId === matching.canonicalId));
    assert.ok(!listed.some(item => item.canonicalId === outsideRange.canonicalId));
  } finally {
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(matching.canonicalId)).delete();
    await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(outsideRange.canonicalId)).delete();
  }
});
