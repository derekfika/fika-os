import assert from "node:assert/strict";
import test from "node:test";
import { createCpuProductionOrder, externalProductionStatus, materialiseExternalProductionOrder, materialisedProductionId, productionOrderV1Id, productionRequirementId } from "../lib/production-domain";
import { transitionProductionOrder } from "../lib/production-domain";
import { db } from "../lib/firebase-admin";
import type { ProductionLine } from "../lib/production-domain";
import { listDomainEvents } from "../lib/domain-event-outbox";
import { stableDocumentId } from "../lib/canonical-editor";

test("production identifiers are stable and distinct by source booking and quote", () => {
  assert.equal(productionOrderV1Id("booking:mnk:one"), "production-order:v1:booking:mnk:one");
  assert.equal(productionOrderV1Id("booking:mnk:one", 2), "production-order:v1:booking:mnk:one:r2");
  assert.equal(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), "production-requirement:booking:mnk:one:quote:booking:mnk:one:r1");
  assert.notEqual(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r2"));
});

test("external production identities are deterministic per source and destination", () => {
  const input = { sourceDomain: "grab-and-go" as const, sourceEntityId: "UAT-WC240826:haleon:2026-08-24", destinationOplocId: "oploc:haleon" };
  assert.equal(materialisedProductionId(input), materialisedProductionId(input));
  assert.notEqual(materialisedProductionId(input), materialisedProductionId({ ...input, destinationOplocId: "oploc:xchange" }));
});

test("Grab & Go external production is immediately plannable without CPU acceptance", () => {
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "submitted" }), "planned");
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "amended" }), "planned");
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "cancelled" }), "cancelled");
  assert.equal(externalProductionStatus({ sourceDomain: "menu-planning", status: "published" }), "menu_available");
});

test("Menu publication materialisation is idempotent and preserves publication lineage", async () => {
  const suffix = `${Date.now()}:${process.pid}`;
  const input = {
    sourceDomain: "menu-planning" as const,
    sourceEntityId: `rolling-week:handoff:${suffix}:day:0`,
    publicationId: `menu-publication:handoff:${suffix}`,
    sourcePublicationDayId: `menu-publication:handoff:${suffix}:day:0:v1`,
    sourceVersion: 1,
    sourceContentHash: "b".repeat(64),
    destinationOplocId: "oploc:haleon",
    destinationLabel: "Haleon",
    serviceDate: "2026-09-07",
    status: "published" as const,
    lines: [{ sourceLineId: `entry:${suffix}`, canonicalItemId: "dish:salad", itemName: "Mixed Leaf", quantity: 7, unit: "portion", workstream: "delivered_in" as const, approvedAllergenSnapshot: { allergens: { milk: "clear" }, sourcePublicationDayId: `menu-publication:handoff:${suffix}:day:0:v1`, sourceVersion: 1, sourceContentHash: "b".repeat(64) } }],
  };
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  try {
    const first = await materialiseExternalProductionOrder(actor, input);
    const replay = await materialiseExternalProductionOrder(actor, input);
    assert.equal(first.created, true);
    assert.equal(replay.duplicate, true);
    assert.equal(first.order.sourcePublicationId, input.publicationId);
    assert.equal(first.order.sourcePublicationDayId, input.sourcePublicationDayId);
    assert.match(first.order.idempotencyKey, new RegExp(`${input.sourceEntityId}.*${input.destinationOplocId}`));
    const event = (await listDomainEvents()).find(item => item.sourceAggregateId === first.order.canonicalId);
    assert.equal(event?.correlationId, first.order.idempotencyKey);
    assert.equal((event?.payload as { productionOrder?: { sourcePublicationId?: string } })?.productionOrder?.sourcePublicationId, input.publicationId);
  } finally {
    const orderId = materialisedProductionId(input);
    const eventId = `production.order.created:${orderId}:v1`;
    const [requirementsSnapshot, receiptsSnapshot] = await Promise.all([
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const batch = db.batch();
    batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)));
    batch.delete(db.collection("fikaDomainEventsV1").doc(eventId));
    for (const doc of requirementsSnapshot.docs) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) batch.delete(doc.ref);
    await batch.commit();
  }
});

test("production contracts keep customer and preparation quantities separate", async () => {
  const line: ProductionLine = { canonicalId: "line:1", sourceBookingLineId: "booking:1:line:1", itemName: "Platters", customerQuantity: 4, customerUnit: "platter", productionQuantity: 48, productionUnit: "portion", conversionSnapshot: { quantity: 48, unit: "portion", rule: "Explicit configured production conversion." }, dietaries: {}, status: "ready", sortOrder: 0 };
  assert.equal(line.customerQuantity, 4);
  assert.equal(line.productionQuantity, 48);
});

test("CPU delivery creation requires a canonical destination OPLOC", async () => {
  await assert.rejects(
    createCpuProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, {
      clientName: "Delivery",
      serviceDate: "2026-08-24",
      deliveryDateTime: "2026-08-24T09:00:00Z",
      requiredBy: "2026-08-24T09:00:00Z",
      serviceWindow: { startTime: "09:00" },
      deliveryLocation: "Unknown venue",
      serviceType: "Delivered-in",
      pax: 1,
      lines: [{ itemName: "Dish", customerQuantity: 1, customerUnit: "portion" }],
    }, "cpu-destination-test"),
    (error: any) => error.status === 422 && /canonical destination OPLOC/i.test(error.message),
  );
});

test("explicitly internal CPU production creates no Fulfilment work on create or transition", async () => {
  const idempotencyKey = `cpu-internal-test:${Date.now()}`;
  const result = await createCpuProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, {
    clientName: "Internal prep",
    serviceDate: "2026-08-24",
    deliveryDateTime: "2026-08-24T09:00:00Z",
    requiredBy: "2026-08-24T09:00:00Z",
    serviceWindow: { startTime: "09:00" },
    requiresDelivery: false,
    deliveryLocation: "CPU internal",
    serviceType: "Internal production",
    pax: 1,
    lines: [{ itemName: "Internal dish", customerQuantity: 1, customerUnit: "portion" }],
  }, idempotencyKey);
  assert.equal(result.order.requiresDelivery, false);
  const receiptsBefore = await db.collection("fikaDomainEventInboxV1").get();
  assert.equal(receiptsBefore.docs.some(doc => doc.data().sourceAggregateId === result.order.canonicalId), false);
  const next = await transitionProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, result.order.canonicalId, result.order.version, "needs_review", "Review internal work.");
  assert.equal(next.requiresDelivery, false);
  const receiptsAfter = await db.collection("fikaDomainEventInboxV1").get();
  assert.equal(receiptsAfter.docs.some(doc => doc.data().sourceAggregateId === result.order.canonicalId), false);
});
