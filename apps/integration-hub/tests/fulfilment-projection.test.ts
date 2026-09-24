import assert from "node:assert/strict";
import test from "node:test";
import { createDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromGrabAndGoOrder, fulfilmentFromProductionOrder, fulfilmentFromPublishedMenuDay, productionOrderRequiresFulfilment, productionStatusToFulfilmentStatus, sourceContentHash } from "../../shared/fulfilment-requirement";
import { applyFulfilmentEvent, listFulfilmentReceipts, listFulfilmentRequirements, normaliseFulfilmentEvent, shouldApplyFulfilmentVersion } from "../lib/fulfilment-projection";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { getLogisticsProjectionOutboxEvent } from "../lib/logistics-projection-outbox";
import { logisticsProjectionEventId } from "../../shared/logistics-projection";

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
  assert.notEqual(
    logisticsProjectionEventId({ ...haleon, destinationOplocId: haleon.destinationOplocId }),
    logisticsProjectionEventId({ ...other, destinationOplocId: other.destinationOplocId }),
  );
});

test("ProductionOrder lifecycle maps explicitly to Fulfilment lifecycle", () => {
  for (const status of ["received", "draft", "needs_review"]) assert.equal(productionStatusToFulfilmentStatus(status), "pending");
  for (const status of ["failed", "blocked", "needs_clarification", "reconciliation_required", "amended"]) assert.equal(productionStatusToFulfilmentStatus(status), "amended");
  for (const status of ["accepted", "planning", "planned", "menu_available", "scheduled", "in_production", "partially_complete", "ready", "complete"]) assert.equal(productionStatusToFulfilmentStatus(status), "ready_for_planning");
  for (const status of ["cancelled", "withdrawn", "superseded", "rejected"]) assert.equal(productionStatusToFulfilmentStatus(status), "withdrawn");
  assert.equal(productionStatusToFulfilmentStatus("accepted", "production-order:v2"), "withdrawn");
});

test("canonical destination, not requiresDelivery, governs Production Order applicability", () => {
  assert.equal(productionOrderRequiresFulfilment({ destinationOplocId: "oploc:customer" }), true);
  assert.equal(productionOrderRequiresFulfilment({ destinationOplocId: "oploc:customer", requiresDelivery: false }), true);
  assert.equal(productionOrderRequiresFulfilment({ destinationOplocId: "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d", requiresDelivery: true }), false);
  assert.equal(productionOrderRequiresFulfilment({}), true);
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
  assert.equal(planning.status, "ready_for_planning");
  assert.equal(amended.status, "amended");
  assert.equal(withdrawn.status, "withdrawn");
});

test("Production Fulfilment hashing and reconciliation distinguish delivery changes from metadata", () => {
  const first = fulfilmentFromProductionOrder(productionOrder, "integration-hub", "2026-08-20T10:00:00Z");
  const replay = fulfilmentFromProductionOrder(productionOrder, "integration-hub-reconciliation", "2026-08-20T10:01:00Z", first);
  assert.equal(replay, first);

  const metadataRevision = { ...productionOrder, version: 2, bookingNotes: "CPU-local note", operationalNotes: "Review metadata" };
  const sourceRevisionOnly = fulfilmentFromProductionOrder(metadataRevision, "integration-hub-reconciliation", "2026-08-22T10:00:00Z", first);
  assert.equal(sourceRevisionOnly.status, "ready_for_planning");
  assert.equal(sourceRevisionOnly.sourceContentHash, first.sourceContentHash);
  assert.equal(sourceRevisionOnly.sourceVersion, 2);

  const legacyHash = sourceContentHash({ ...productionOrder, sourceEntityId: productionOrder.canonicalId });
  const legacyAmendment = {
    ...first,
    status: "amended" as const,
    sourceContentHash: legacyHash,
    idempotencyKey: `${first.idempotencyKey}:legacy-reconciliation`,
    audit: [...first.audit, { action: "fulfilment-amended", at: "2026-08-21T10:00:00Z", by: "integration-hub-reconciliation", sourceVersion: first.sourceVersion, idempotencyKey: `${first.idempotencyKey}:legacy-reconciliation` }],
  };
  const migrated = fulfilmentFromProductionOrder(productionOrder, "integration-hub-reconciliation", "2026-08-22T10:01:00Z", legacyAmendment);
  assert.equal(migrated.status, "ready_for_planning");
  assert.equal(migrated.audit.at(-1)?.action, "fulfilment-reconciled");

  const quantityChange = fulfilmentFromProductionOrder({ ...productionOrder, version: 2, lines: [{ ...productionOrder.lines[0], productionQuantity: 2 }] }, "integration-hub", "2026-08-22T10:02:00Z", first);
  assert.equal(quantityChange.status, "amended");
  const destinationChange = fulfilmentFromProductionOrder({ ...productionOrder, version: 2, destinationOplocId: "oploc:new-destination" }, "integration-hub", "2026-08-22T10:03:00Z", first);
  assert.equal(destinationChange.status, "amended");
  const windowChange = fulfilmentFromProductionOrder({ ...productionOrder, version: 2, serviceWindow: { startTime: "10:00", endTime: "10:30" } }, "integration-hub", "2026-08-22T10:04:00Z", first);
  assert.equal(windowChange.status, "amended");
  const cancellation = fulfilmentFromProductionOrder({ ...productionOrder, version: 2, status: "cancelled" }, "integration-hub", "2026-08-22T10:05:00Z", first);
  assert.equal(cancellation.status, "withdrawn");
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
    const staged = await getLogisticsProjectionOutboxEvent(logisticsProjectionEventId({ serviceDate: requirements[2].serviceDate, sourceDomain: requirements[2].sourceDomain, sourceEntityId: requirements[2].sourceEntityId, sourceVersion: requirements[2].sourceVersion, destinationOplocId: requirements[2].destinationOplocId }));
    assert.equal(staged?.payload.changeType, "created");
    assert.equal(staged?.delivery.status, "pending");
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
    const logisticsOutboxSnapshot = await db.collection("fikaLogisticsProjectionOutboxV1").get();
    const batch = db.batch();
    for (const doc of requirementsSnapshot.docs) if ((doc.data() as { sourceEntityId?: string }).sourceEntityId?.endsWith(suffix)) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) if (String(doc.data().eventId || "").includes(suffix)) batch.delete(doc.ref);
    for (const doc of logisticsOutboxSnapshot.docs) if (String(doc.data().payload?.sourceEntityId || "").includes(suffix)) batch.delete(doc.ref);
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
