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
  assert.equal(patch.client.clientName, "Derived");
});

test("Angel Court amendment preserves requester and booking-for data", () => {
  const patch = amendmentPatchDto({
    client: {
      name: "Derek Buckley",
      email: "derek@example.test",
      companyName: "Angel Court",
      requester: { name: "Derek Buckley", email: "derek@example.test", companyName: "FIKA" },
      clientName: "Angel Court Events",
      clientCompany: "Angel Court",
      invoiceReference: "AC-123",
    },
    service: { eventDate: "2026-09-01", startTime: "12:00", guestCount: 10 },
    order: { items: [{ itemId: "lunch", unitPrice: 9, quantity: 10, lineTotal: 90 }] } as never,
    notes: "Keep requester details",
    deliveryChargeRequired: true,
  });
  assert.deepEqual(patch.client.requester, { name: "Derek Buckley", email: "derek@example.test", companyName: "FIKA" });
  assert.equal(patch.client.clientName, "Angel Court Events");
  assert.equal(patch.client.clientCompany, "Angel Court");
  assert.equal(patch.client.invoiceReference, "AC-123");
});
