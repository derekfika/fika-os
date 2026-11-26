import assert from "node:assert/strict";
import test from "node:test";
import { amendmentPatchDto } from "../lib/amendment-dto";

test("standalone location patches retain each canonical field and never send dashboard routing keys", () => {
  for (const portalSiteId of ["angel-court", "mnk"] as const) {
    const draft = {
      client: { name: "Fixture", email: "fixture@example.test", companyName: "Fixture" },
      service: { eventDate: "2027-01-20", startTime: "12:00", guestCount: 4, oplocId: "oploc:test", portalSiteId },
      order: { items: [] } as never, notes: "", deliveryChargeRequired: true,
    };
    for (const location of [
      {}, { floorLevel: "B1" }, { roomOrArea: "Meeting room" }, { deliveryPoint: "Reception" },
      { floorLevel: "B1", roomOrArea: "Meeting room", deliveryPoint: "Reception" },
    ]) {
      const service = { ...draft.service, ...location };
      const patch = amendmentPatchDto({ ...draft, service });
      assert.deepEqual(patch.service, { eventDate: service.eventDate, startTime: service.startTime, guestCount: 4, ...location });
    }
  }
});

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
