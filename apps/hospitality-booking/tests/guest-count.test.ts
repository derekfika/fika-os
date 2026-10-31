import assert from "node:assert/strict";
import test from "node:test";
import { effectiveGuestMinimum, guestCountMessage } from "../lib/guest-count";
import { createEmptyRcoaDraft, rcoaGuestMinimum, validateRcoaStep } from "../lib/rcoa-portal";
import { composeServiceDraft, createEmptyAllDay, validateAllDay } from "../lib/rcoa-all-day";
import { buildTrustedRcoaHubPayload } from "../lib/rcoa-booking-request";
import { buildRcoaClientRequest } from "../lib/rcoa-booking-request-client";
import type { PortalMenuItem } from "../lib/mnk-contract";

const product = { id: "item:product", name: "Test pack", category: "Breakfast", unitPrice: 2, minimumQuantity: 8, governedConstraintsResolved: true } as PortalMenuItem;
const guestItem = { ...product, id: "item:event", minimumGuests: 12 };
const line = (itemId: string) => ({ itemId, quantity: 8, choices: {} });

test("all sites keep product quantities, names, production pieces and event guest minimums independent", () => {
  for (const siteId of ["mnk", "angel-court", "cfc", "munich-re", "rcoa"]) {
    const item = { ...product, name: "Minimum 50 guests", servingInfo: "Serves 20", serves: 20 };
    assert.equal(effectiveGuestMinimum([line(item.id)], [item], { gallagher: false, siteId }), 1);
    assert.equal(guestCountMessage(1, effectiveGuestMinimum([line(item.id)], [item])), "");
    assert.equal(effectiveGuestMinimum([line(item.id), line(guestItem.id)], [item, guestItem], { gallagher: false, siteId }), 12);
    assert.equal(effectiveGuestMinimum([line(item.id)], [item], { gallagher: false, siteId }), 1, "removing the guest policy lowers only the guest minimum");
  }
});

test("Gallagher's explicit guest policy remains independent of capped product quantities and uncapped event floors", () => {
  assert.equal(effectiveGuestMinimum([line(product.id)], [product], { gallagher: true }), 5);
  assert.equal(effectiveGuestMinimum([line(guestItem.id)], [guestItem], { gallagher: true }), 12);
  const derived = { ...guestItem, rules: { guestMinimumKind: "product" as const } };
  assert.equal(effectiveGuestMinimum([line(derived.id)], [derived], { gallagher: true }), 5);
  assert.equal(effectiveGuestMinimum([line(derived.id)], [derived], { gallagher: false }), 12);
});

test("blank editing is allowed; blank, zero, negative, decimal, NaN and unknown restored selections block progression", () => {
  assert.equal(guestCountMessage(0, 12, true), "");
  for (const value of [0, -1, 1.5, NaN, Infinity]) assert.ok(guestCountMessage(value, 12));
  assert.equal(guestCountMessage(12, 12), "");
  assert.equal(effectiveGuestMinimum([line("unknown")], [product]), null);
  assert.match(guestCountMessage(50, null), /unavailable/);
  assert.equal(effectiveGuestMinimum([{ ...line("unknown"), quantity: 0 }], [product]), 1);
});

const validDraft = () => ({ ...createEmptyRcoaDraft(), occasion: "breakfast" as const,
  contact: { name: "Test", email: "test@example.invalid", phone: "1", companyName: "Test", invoiceReference: "" },
  event: { ...createEmptyRcoaDraft().event, eventDate: "2099-12-10", startTime: "10:00", guestCount: 11, floorLevel: "1", roomOrArea: "Room" },
  lines: [line(guestItem.id)], acknowledgements: { quoteSubjectToConfirmation: true, noticePolicyAccepted: true, dietaryResponsibilityAccepted: true } });

test("RCoA event, menu, dietary/review and direct server request enforce the selected guest minimum", () => {
  const draft = validDraft();
  for (const step of [2, 3, 4, 5]) assert.match(validateRcoaStep(step, draft, [guestItem]).guestCount, /12/);
  const request = buildRcoaClientRequest({ ...draft, event: { ...draft.event, guestCount: 12 } }, [guestItem], { bookingId: "RCOA-20991201090000-ABCD", submittedAt: "2099-12-01T09:00:00Z" });
  assert.throws(() => buildTrustedRcoaHubPayload({ ...request, event: { ...request.event, guestCount: 11 } }, [guestItem]), /at least 12 guests/);
  assert.equal(buildTrustedRcoaHubPayload(request, [guestItem]).event.guestCount, 12);
});

test("All Day requirements use only that service's selected items and own count, never the event default or another service", () => {
  const shared = validDraft();
  const day = { ...createEmptyAllDay(), contact: shared.contact, eventDate: shared.event.eventDate, floorLevel: "1", defaultGuests: 100,
    acknowledgements: shared.acknowledgements, services: [
      { id: "first", category: "breakfast" as const, startTime: "09:00", guestCount: 1, location: "Room A", lines: [line(product.id)], notes: "" },
      { id: "second", category: "breakfast" as const, startTime: "12:00", guestCount: 11, location: "Room B", lines: [line(guestItem.id)], notes: "" },
    ] };
  assert.equal(composeServiceDraft(day, "first").event.guestCount, 1);
  const failure = validateAllDay(day, [product, guestItem]);
  assert.equal(failure?.serviceId, "second");
  assert.match(failure?.errors["guestCount:second"] || "", /12/);
  day.services[1].guestCount = 12;
  assert.equal(validateAllDay(day, [product, guestItem]), undefined);
  assert.deepEqual(day.services.map(service => service.guestCount), [1, 12]);
});


test("RCoA applies Hub's explicit Gallagher floor while retaining its trusted adapter's raw item guest minima", () => {
  const draft = { ...validDraft(), lines: [line(product.id)], event: { ...validDraft().event, guestCount: 1 } };
  assert.equal(rcoaGuestMinimum(draft, [product]), 1);
  assert.equal(validateRcoaStep(2, draft, [product]).guestCount, undefined);
  for (const contact of [{ ...draft.contact, companyName: "Gallagher" }, { ...draft.contact, email: "test@redington.co.uk" }]) {
    const contextual = { ...draft, contact };
    assert.equal(rcoaGuestMinimum(contextual, [product]), 5);
    for (const step of [2, 3, 4, 5]) assert.match(validateRcoaStep(step, contextual, [product]).guestCount, /5/);
  }
  const derived = { ...guestItem, rules: { guestMinimumKind: "product" as const } };
  assert.equal(rcoaGuestMinimum({ ...draft, contact: { ...draft.contact, companyName: "Gallagher" }, lines: [line(derived.id)] }, [derived]), 12, "the RCoA trusted adapter independently enforces the raw item floor");
  const day = { ...createEmptyAllDay(), contact: { ...draft.contact, companyName: "Gallagher" }, eventDate: draft.event.eventDate, floorLevel: "1", defaultGuests: 100, acknowledgements: draft.acknowledgements,
    services: [{ id: "one", category: "breakfast" as const, startTime: "09:00", guestCount: 5, location: "Room A", lines: [line(product.id)], notes: "" },
      { id: "two", category: "breakfast" as const, startTime: "12:00", guestCount: 1, location: "Room B", lines: [line(product.id)], notes: "" }] };
  assert.equal(validateAllDay(day, [product])?.serviceId, "two");
  assert.match(validateAllDay(day, [product])?.errors["guestCount:two"] || "", /5/);
});
