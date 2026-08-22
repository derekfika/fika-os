import assert from "node:assert/strict";
import test from "node:test";
import { createCpuProductionOrder, externalProductionStatus, materialisedProductionId, productionOrderV1Id, productionRequirementId } from "../lib/production-domain";
import { transitionProductionOrder } from "../lib/production-domain";
import { db } from "../lib/firebase-admin";
import type { ProductionLine } from "../lib/production-domain";

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
