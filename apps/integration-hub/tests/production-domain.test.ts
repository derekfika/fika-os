import assert from "node:assert/strict";
import test from "node:test";
import { createCpuProductionOrder, productionOrderV1Id, productionRequirementId } from "../lib/production-domain";
import type { ProductionLine } from "../lib/production-domain";

test("production identifiers are stable and distinct by source booking and quote", () => {
  assert.equal(productionOrderV1Id("booking:mnk:one"), "production-order:v1:booking:mnk:one");
  assert.equal(productionOrderV1Id("booking:mnk:one", 2), "production-order:v1:booking:mnk:one:r2");
  assert.equal(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), "production-requirement:booking:mnk:one:quote:booking:mnk:one:r1");
  assert.notEqual(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r2"));
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
