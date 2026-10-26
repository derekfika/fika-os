import assert from "node:assert/strict";
import test from "node:test";
import { projectBookingGroup } from "../lib/hospitality-group-commercial";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";

const GROUP = "RCOA-GROUP-LOCATION";
const at = "2026-10-15T10:00:00.000Z";
const childrenFixture = (id = GROUP): CanonicalBooking[] => ["15:00", "09:00", "13:00", "11:00"].map((time, i) => ({
  canonicalId: `booking:${id}:${i + 1}`, entityType: "Booking", schemaVersion: "0.1.0", version: 1, lifecycleStatus: "New", createdAt: at, updatedAt: at, createdBy: "fixture", updatedBy: "fixture",
  source: { provider: "rcoa-booking-platform", sourceBookingId: `${id}-${i + 1}`, submissionTimestamp: at, contractVersion: "test", originalPayload: {} },
  bookingGroup: { id, size: 4, sequence: i + 1 }, client: { name: "Test Requester", email: "host@example.test", companyName: "FIKA", invoiceReference: "PO-22" }, service: { eventDate: "2026-11-05", startTime: time, guestCount: 25, roomOrArea: "Room 2", oplocId: "oploc:rcoa-test", portalSiteId: "rcoa" },
  // Deliberately different from today's unit-price multiplication: the recorded line total is authoritative.
  order: { eventType: ["meeting_hospitality", "breakfast", "lunch", "meeting_hospitality"][i], items: [{ itemId: `item-${i}`, itemName: `Service item ${i}`, quantity: 25, unitPrice: 999, lineTotal: (i + 1) * 10 }], netTotal: (i + 1) * 10, vatTotal: 0, grossTotal: (i + 1) * 10, currency: "GBP" },
  dietaries: { milk: "UNRECORDED" }, acknowledgements: {}, attachments: [], statusHistory: [], audit: [], commercialVersion: 1, quoteState: { revisions: [] }, deliveryChargeRequired: i === 1 || i === 2,
  notes: "Event: Annual lecture",
} as unknown as CanonicalBooking));

test("group services carry authoritative floor, room and delivery fields to the dashboard contract", () => {
  const children = childrenFixture(GROUP).map((child, i) => ({ ...child, service: { ...child.service, floorLevel: i === 0 ? " 7 " : "2", roomOrArea: i === 0 ? "Boardroom" : "Lecture Hall", deliveryPoint: i === 1 ? "Loading bay" : "" } })) as CanonicalBooking[];
  const services = projectBookingGroup(GROUP, children).services;
  // Services are ordered by time, so match each by its own recorded room rather than by position.
  const boardroom = services.find(service => service.roomOrArea === "Boardroom")!;
  const lecture = services.find(service => service.roomOrArea === "Lecture Hall")!;
  assert.equal(boardroom.floorLevel, "7");
  assert.equal(boardroom.deliveryPoint, undefined);
  assert.equal(lecture.floorLevel, "2");
  assert.equal(lecture.deliveryPoint, "Loading bay");
});

test("historical services without floor, room or delivery fields project without invented values", () => {
  const children = childrenFixture(GROUP).map(child => ({ ...child, service: { ...child.service, floorLevel: undefined, roomOrArea: undefined, deliveryPoint: undefined } })) as CanonicalBooking[];
  const service = projectBookingGroup(GROUP, children).services[0];
  assert.equal(service.floorLevel, undefined);
  assert.equal(service.roomOrArea, undefined);
  assert.equal(service.deliveryPoint, undefined);
  assert.equal(service.location, "Location to confirm");
});
