import { seedVisibility } from "./support/rcoa-service-visibility";
import assert from "node:assert/strict";
import test from "node:test";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { createEmptyRcoaDraft, validateRcoaStep } from "../lib/rcoa-portal";
import { addAllDayService, applyAllDayDefaults, changeAllDayFloor, createEmptyAllDay, updateAllDayService, validateAllDay } from "../lib/rcoa-all-day";
import type { PortalMenuItem } from "../lib/mnk-contract";
import { RCOA_FLOORS, RCOA_LOCATIONS_BY_FLOOR, isValidRcoaLocationPair, rcoaFloorChange } from "@fika/server-shared/rcoa-locations";

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
  const missingFloor = validateRcoaStep(2, withEvent({ floorLevel: "", roomOrArea: "Boardroom" }), noMenu, seedVisibility);
  assert.equal(missingFloor.floorLevel, "Choose the floor.");
  assert.match(missingFloor.roomOrArea || "", /Choose a location/);
  const missingRoom = validateRcoaStep(2, withEvent({ floorLevel: "Second Floor", roomOrArea: "" }), noMenu, seedVisibility);
  assert.equal(missingRoom.roomOrArea, "Choose the room or area.");
  const whitespace = validateRcoaStep(2, withEvent({ floorLevel: "   ", roomOrArea: "\t" }), noMenu, seedVisibility);
  assert.equal(whitespace.floorLevel, "Choose the floor.");
  assert.equal(whitespace.roomOrArea, "Choose the room or area.");
});

test("all 19 governed RCoA locations validate, and a room on another floor is rejected", () => {
  const draft = createEmptyRcoaDraft();
  const rooms = RCOA_FLOORS.flatMap(floor => RCOA_LOCATIONS_BY_FLOOR[floor].map(room => ({ floor, room })));
  assert.equal(rooms.length, 19);
  for (const { floor, room } of rooms) {
    assert.equal(isValidRcoaLocationPair(floor, room), true, floor + " / " + room);
    const errors = validateRcoaStep(2, { ...draft, event: { ...draft.event, eventDate: "2026-10-20", startTime: "10:00", guestCount: 12, floorLevel: floor, roomOrArea: room, deliveryPoint: "" } }, noMenu, seedVisibility);
    assert.equal(errors.floorLevel, undefined, floor);
    assert.equal(errors.roomOrArea, undefined, room);
    assert.doesNotThrow(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: floor, roomOrArea: room }), undefined, seedVisibility));
  }
  assert.equal(isValidRcoaLocationPair("Ground Floor", "Boardroom 1"), false);
  assert.equal(isValidRcoaLocationPair("Second Floor", "Meeting Room 15"), false);
  assert.deepEqual(rcoaFloorChange("First Floor", "Boardroom 2"), { floor: "First Floor", location: "Boardroom 2" });
  assert.deepEqual(rcoaFloorChange("Third Floor", "Boardroom 2"), { floor: "Third Floor", location: "" });
});

test("server rejects incomplete new RCoA requests and accepts a blank optional delivery point", () => {
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "", roomOrArea: "Conference Suite" }), undefined, seedVisibility), /Choose a listed RCoA floor/);
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "Second Floor", roomOrArea: "   " }), undefined, seedVisibility), /Choose a listed RCoA floor/);
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "  ", roomOrArea: "  " }), undefined, seedVisibility), /Choose a listed RCoA floor/);
  assert.throws(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "Second Floor", roomOrArea: "", deliveryPoint: "" }), undefined, seedVisibility));
  assert.doesNotThrow(() => buildTrustedRcoaHubPayload(eventRequest({ floorLevel: "Second Floor", roomOrArea: "Meeting Room 1", deliveryPoint: "" }), undefined, seedVisibility));
});

test("All Day: a missing shared floor is reported on the event step", () => {
  const day = { ...createEmptyAllDay(), floorLevel: "  ", defaultLocation: "Conference Suite" };
  const failure = validateAllDay(applyAllDayDefaults(day), noMenu, seedVisibility);
  assert.ok(failure, "an incomplete All Day request must fail validation");
  assert.equal(failure.step, 1);
  assert.equal(failure.errors.floorLevel, "Choose a listed floor.");
});

test("All Day: each service must have its own room, while a shared floor is entered once", () => {
  const contact = { name: "Casey Guest", email: "casey@example.test", phone: "020 0000 0000", companyName: "The College", invoiceReference: "PO-1" };
  let day = applyAllDayDefaults({ ...createEmptyAllDay(), contact, eventDate: "2026-12-10", defaultGuests: 10, floorLevel: "Second Floor", defaultLocation: "" });
  day = addAllDayService(day, "s2");
  const [first, second] = day.services;
  day = { ...day, services: [{ ...first, category: "breakfast", startTime: "09:00", location: "" }, { ...second, category: "lunch", startTime: "13:00", location: "Meeting Room 1" }] };
  const failure = validateAllDay(day, noMenu, seedVisibility);
  assert.ok(failure, "a service with no room must not pass");
  assert.equal(failure.errors.floorLevel, undefined, "the shared floor is not repeated per service");
  assert.ok(Object.keys(failure.errors).some(key => key.startsWith("location:") || key.startsWith("service:")));
  assert.equal(updateAllDayService(day, first.id, { location: "Meeting Room 2" }).services[0].location, "Meeting Room 2");
});

test("changing an All Day floor clears incompatible rooms but keeps rooms still available", () => {
  const day = { ...createEmptyAllDay(), floorLevel: "First Floor", defaultLocation: "Boardroom 2", services: [
    { ...createEmptyAllDay().services[0], id: "first", location: "Boardroom 1" },
    { ...createEmptyAllDay().services[0], id: "second", location: "Meeting Room 1" },
  ] };
  const changed = changeAllDayFloor(day, "Second Floor");
  assert.equal(changed.defaultLocation, "");
  assert.equal(changed.services[0].location, "");
  assert.equal(changed.services[1].location, "Meeting Room 1");
});
