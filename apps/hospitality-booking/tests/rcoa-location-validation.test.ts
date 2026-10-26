import assert from "node:assert/strict";
import test from "node:test";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { createEmptyRcoaDraft, validateRcoaStep } from "../lib/rcoa-portal";
import { addAllDayService, applyAllDayDefaults, createEmptyAllDay, updateAllDayService, validateAllDay } from "../lib/rcoa-all-day";
import type { PortalMenuItem } from "../lib/mnk-contract";

// Location rules concern only floor, room and delivery fields; no menu items are needed to reach them.
const noMenu: PortalMenuItem[] = [];
const acknowledgements = { quoteSubjectToConfirmation: true as const, noticePolicyAccepted: true as const, dietaryResponsibilityAccepted: true as const };
const dietaries = { hasDietaries: false, vegetarian: 0, vegan: 0, glutenFree: 0, coeliac: 0, dairyFree: 0, halal: 0, otherCount: 0, allergyDetails: "", severeAllergyAcknowledged: false, freeText: "" };
const eventRequest = (event: Record<string, string>) => ({
  bookingId: "RCOA-20261005103000-AB12",
  submittedAt: "2026-10-05T10:30:00.000Z",
  client: { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "College" },
  event: { eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, ...event },
  order: { eventType: "bespoke", items: [] },
  dietaries,
  acknowledgements,
});

test("standard RCoA Event step: missing floor, missing room and whitespace-only values are rejected field by field", () => {
  const draft = createEmptyRcoaDraft();
  const withEvent = (overrides: Partial<typeof draft.event>) => ({ ...draft, event: { ...draft.event, eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, ...overrides } });
  const missingFloor = validateRcoaStep(2, withEvent({ floorLevel: "", roomOrArea: "Boardroom" }), noMenu);
  assert.equal(missingFloor.floorLevel, "Enter the floor level.");
  assert.equal(missingFloor.roomOrArea, undefined);
  const missingRoom = validateRcoaStep(2, withEvent({ floorLevel: "7", roomOrArea: "" }), noMenu);
  assert.equal(missingRoom.roomOrArea, "Enter the room or area.");
  const whitespace = validateRcoaStep(2, withEvent({ floorLevel: "   ", roomOrArea: "\t" }), noMenu);
  assert.equal(whitespace.floorLevel, "Enter the floor level.");
  assert.equal(whitespace.roomOrArea, "Enter the room or area.");
});

test("optional delivery point never blocks progression, and trimmed floor and room pass", () => {
  const draft = createEmptyRcoaDraft();
  const errors = validateRcoaStep(2, { ...draft, event: { ...draft.event, eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, floorLevel: " 7 ", roomOrArea: " Boardroom ", deliveryPoint: "" } }, noMenu);
  assert.equal(errors.floorLevel, undefined);
  assert.equal(errors.roomOrArea, undefined);
  assert.equal(errors.deliveryPoint, undefined);
});

test("server rejects incomplete new RCoA requests and accepts a blank optional delivery point", () => {
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "", roomOrArea: "Boardroom" })), /Enter the floor level\./);
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "7", roomOrArea: "   " })), /Enter the room or area\./);
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "  ", roomOrArea: "  " })), /Enter the floor level\./);
  assert.doesNotThrow(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "7", roomOrArea: "Boardroom", deliveryPoint: "" })));
});

test("All Day: a missing shared floor is reported on the event step", () => {
  const day = { ...createEmptyAllDay(), floorLevel: "  ", defaultLocation: "Lecture Hall" };
  const failure = validateAllDay(applyAllDayDefaults(day), noMenu);
  assert.ok(failure, "an incomplete All Day request must fail validation");
  assert.equal(failure.step, 1);
  assert.equal(failure.errors.floorLevel, "Enter the floor level.");
});

test("All Day: each service must have its own room, while a shared floor is entered once", () => {
  const contact = { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "The College", invoiceReference: "PO-1" };
  let day = applyAllDayDefaults({ ...createEmptyAllDay(), contact, eventDate: "2026-12-10", defaultGuests: 10, floorLevel: "2", defaultLocation: "" });
  day = addAllDayService(day, "s2");
  const [first, second] = day.services;
  day = { ...day, services: [{ ...first, category: "breakfast", startTime: "09:00", location: "" }, { ...second, category: "lunch", startTime: "13:00", location: "Dining Room" }] };
  const failure = validateAllDay(day, noMenu);
  assert.ok(failure, "a service with no room must not pass");
  assert.equal(failure.errors.floorLevel, undefined, "the shared floor is not repeated per service");
  assert.ok(Object.keys(failure.errors).some(key => key.startsWith("location:") || key.startsWith("service:")));
  assert.equal(updateAllDayService(day, first.id, { location: "Lecture Hall" }).services[0].location, "Lecture Hall");
});
