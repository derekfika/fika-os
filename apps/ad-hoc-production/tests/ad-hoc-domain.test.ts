import assert from "node:assert/strict";
import test from "node:test";
import { addDays, blankDraft, contentKey, isDate, isTime, londonBusinessDate, readiness, submitBlockers, toProductionInput, weekStart, type AdHocDraft, type AdHocRequest } from "../lib/ad-hoc-domain";

const complete = (overrides: Partial<AdHocDraft> = {}): AdHocDraft => ({
  eventName: "Client board lunch", serviceDate: "2026-10-31", requiredReadyTime: "12:00", category: "board_meeting", guestCount: 20, notes: "Vegetarian options",
  destination: { mode: "oploc", oplocId: "oploc:angel", label: "One Angel Court", address: "1 Angel Court, London EC2R", contactName: "Sarah", contactPhone: "+44 20 7123 4567", identity: "oploc:angel" },
  lines: [{ id: "line:a", description: "Sandwich platters", quantity: 5, unit: "platters", note: "Include vegetarian", sortOrder: 0 }, { id: "line:b", description: "Coffee setup", quantity: 1, unit: "setup", sortOrder: 1 }],
  ...overrides,
});
const asRequest = (draft: AdHocDraft): AdHocRequest => ({ ...draft, id: "adhoc-request:1", reference: "REQ-2026-001", schemaVersion: 2, version: 4, createdAt: "", createdBy: "u", updatedAt: "", updatedBy: "u", status: "DRAFT", audit: [] });

test("a complete request has no submit blockers and a full readiness checklist", () => {
  assert.deepEqual(submitBlockers(complete(), "2026-10-24"), []);
  assert.ok(readiness(complete()).every(item => item.done));
});

test("destination, ready time, items and guest count each block submission", () => {
  const blockers = submitBlockers(complete({ destination: { mode: "one_off", label: "", address: "", identity: "" }, requiredReadyTime: "", guestCount: undefined, lines: [] }), "2026-10-24").join(" | ");
  assert.match(blockers, /Destination provided/);
  assert.match(blockers, /Ready time provided/);
  assert.match(blockers, /Menu items added/);
  assert.match(blockers, /Event details complete/);
  assert.ok(submitBlockers(complete({ lines: [{ id: "x", description: "Soup", quantity: 0, unit: "portions", sortOrder: 0 }] }), "2026-10-24").length > 0);
});

test("a past service date cannot be submitted but a draft can still hold it", () => {
  assert.ok(submitBlockers(complete({ serviceDate: "2026-10-01" }), "2026-10-24").some(item => /past/.test(item)));
  assert.equal(blankDraft("2026-10-01").serviceDate, "2026-10-01");
});

test("an OPLOC destination is passed by canonical id with no address snapshot object", () => {
  const input = toProductionInput(asRequest(complete()));
  assert.equal(input.destinationOplocId, "oploc:angel");
  assert.equal(input.destinationAddress, undefined);
  assert.equal(input.productionCategory, "hospitality");
});

test("a one-off destination is a request-scoped identity and snapshot, never an OPLOC", () => {
  const input = toProductionInput(asRequest(complete({ destination: { mode: "one_off", label: "Client residence", address: "1 Test Street", identity: "adhoc-destination:adhoc-request:1", contactName: "A", contactPhone: "123" } })));
  assert.equal(input.destinationOplocId, "adhoc-destination:adhoc-request:1");
  assert.equal(input.destinationAddress?.address, "1 Test Street");
  assert.equal(input.destinationAddress?.identity, input.destinationOplocId);
  assert.equal(input.destinationAddress?.contact, "A · 123");
});

test("ready time is a ready-by request only: no dispatch or arrival time is invented", () => {
  const input = toProductionInput(asRequest(complete()));
  assert.equal(input.requiredBy, "2026-10-31T12:00");
  assert.deepEqual(input.serviceWindow, { startTime: "12:00" });
  assert.equal("dispatchTime" in input, false);
  assert.equal(input.deliveryDateTime, input.requiredBy);
});

test("lines keep stable ids, quantities, units and order; no allergen evidence is sent", () => {
  const input = toProductionInput(asRequest(complete({ lines: [{ id: "line:b", description: "B", quantity: 1, unit: "setup", sortOrder: 1 }, { id: "line:a", description: "A", quantity: 5, unit: "platters", sortOrder: 0 }] })));
  assert.deepEqual(input.lines.map(line => [line.sourceLineId, line.itemName, line.customerQuantity, line.customerUnit, line.productionQuantity, line.productionUnit]), [["line:a", "A", 5, "platters", 5, "platters"], ["line:b", "B", 1, "setup", 1, "setup"]]);
  assert.ok(input.lines.every(line => !("dietary" in line) && !("approvedAllergenSnapshot" in line)));
});

test("the source version identifies the request revision being sent", () => {
  const request = asRequest(complete());
  assert.equal(toProductionInput(request).sourceVersion, 4);
  assert.equal(toProductionInput(request, 9).sourceVersion, 9);
  assert.equal(toProductionInput(request).sourceEntityId, "adhoc-request:1");
});

test("content key ignores line order metadata drift but detects real edits", () => {
  const base = complete();
  assert.equal(contentKey(base), contentKey(structuredClone(base)));
  assert.notEqual(contentKey(base), contentKey({ ...base, lines: base.lines.map((line, index) => index ? line : { ...line, quantity: 6 }) }));
  assert.notEqual(contentKey(base), contentKey({ ...base, requiredReadyTime: "12:30" }));
});

test("Europe/London business dates hold across midnight and DST changes", () => {
  assert.equal(londonBusinessDate(new Date("2026-10-24T23:30:00Z")), "2026-10-25", "BST: 23:30Z is already 00:30 on the 25th in London");
  assert.equal(londonBusinessDate(new Date("2026-10-25T23:30:00Z")), "2026-10-25", "after the clocks go back, 23:30Z is still the 25th");
  assert.equal(londonBusinessDate(new Date("2026-03-29T00:30:00Z")), "2026-03-29");
  assert.equal(addDays("2026-10-25", 1), "2026-10-26");
  assert.equal(weekStart("2026-10-28"), "2026-10-26");
  assert.equal(weekStart("2026-11-01"), "2026-10-26");
});

test("date and time validators reject impossible values", () => {
  assert.equal(isDate("2026-02-30"), false);
  assert.equal(isDate("2026-10-31"), true);
  assert.equal(isTime("24:00"), false);
  assert.equal(isTime("09:05"), true);
});
