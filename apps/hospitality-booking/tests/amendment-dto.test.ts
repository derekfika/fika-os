import assert from "node:assert/strict";
import test from "node:test";
import { amendmentPatchDto } from "../lib/amendment-dto";

test("manager amendment DTO contains editable order lines without canonical totals or routing metadata", () => {
  const patch = amendmentPatchDto({
    client: { name: "Alex", email: "alex@example.test", companyName: "Client", clientName: "Derived", clientCompany: "Derived" } as never,
    service: { eventDate: "2026-09-01", startTime: "12:00", guestCount: 10, portalSiteId: "mnk", oplocId: "derived" } as never,
    order: { eventType: "Lunch", netTotal: 999, vatTotal: 199, grossTotal: 1198, currency: "GBP", items: [{ itemId: "rice-paper-rolls", itemName: "Rice paper rolls", unitPrice: 12, quantity: 3, lineTotal: 36, choices: [], comments: "No peanuts" }] } as never,
    notes: "Updated quantities",
    deliveryChargeRequired: true,
  });
  assert.deepEqual(patch.order.items[0], { itemId: "rice-paper-rolls", itemName: "Rice paper rolls", unitPrice: 12, quantity: 3, choices: [], comments: "No peanuts" });
  assert.equal("netTotal" in patch.order, false);
  assert.equal("portalSiteId" in patch.service, false);
  assert.equal("clientName" in patch.client, false);
});
