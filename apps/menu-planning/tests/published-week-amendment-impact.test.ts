import assert from "node:assert/strict";
import test from "node:test";
import { amendmentImpactForDays, type PublishedMenuDay, type PublishedMenuEntry } from "../lib/menu-publication";

const base = (overrides: Partial<PublishedMenuEntry> = {}): PublishedMenuEntry => ({
  sourceEntryId: "entry:soup", canonicalDishId: "dish:soup", slot: "SOUP", dishName: "Leek soup", portions: 10,
  allocations: [{ destination: { kind: "governed", id: "oploc:bank", label: "Bank" }, destinationId: "oploc:bank", destinationLabel: "Bank", quantity: 10 }],
  allergens: { milk: "clear", no_key_allergens: "clear" }, allergenEvidenceStatus: "confirmed",
  allergenEvidenceComplete: true, allergenEvidenceHash: "a".repeat(64), ...overrides,
});
const day = (entries: PublishedMenuEntry[], contentHash = "v7") => ({ sourceDayId: "menu-day:2026-11-17", date: "2026-11-17", dayName: "Tuesday", contentHash, entries }) as PublishedMenuDay;

test("v7 to v8 same-content publication pointer leaves demand and approval unchanged", () => {
  const result = amendmentImpactForDays([day([base()])], [day([base()])]);
  assert.equal(result.destinations.length, 0);
  assert.equal(result.freshAllergenReviewCount, 0);
});

test("incident sequence preserves v7 signatures for equivalent v8 and v9, then requires fresh review at v10", () => {
  const v7 = day([base()], "v7");
  const v8 = day([base()], "v8");
  const v9 = day([base({ portions: 14, allocations: [{ destination: { kind: "governed", id: "oploc:bank", label: "Bank" }, destinationId: "oploc:bank", destinationLabel: "Bank", quantity: 14 }] })], "v9");
  const v10 = day([base({ sourceEntryId: "entry:fish", canonicalDishId: "dish:fish", dishName: "Fish soup", allergenEvidenceHash: "b".repeat(64) })], "v10");
  assert.equal(amendmentImpactForDays([v7], [v8]).destinations.length, 0);
  assert.equal(amendmentImpactForDays([v8], [v9]).destinations[0].allergenApproval, "preserved");
  const materialChange = amendmentImpactForDays([v9], [v10]);
  assert.equal(materialChange.destinations[0].productionDemand, "dish_set_changed");
  assert.equal(materialChange.destinations[0].allergenApproval, "fresh_review_required");
  const withdrawal = amendmentImpactForDays([v10], [day([], "withdrawn")]);
  assert.equal(withdrawal.destinations[0].allergenApproval, "withdrawn");
});

test("portion-only v7 to v9 amendment updates demand while preserving complete equivalent allergen evidence", () => {
  const result = amendmentImpactForDays([day([base()])], [day([base({ portions: 14, allocations: [{ destination: { kind: "governed", id: "oploc:bank", label: "Bank" }, destinationId: "oploc:bank", destinationLabel: "Bank", quantity: 14 }] })], "v9")]);
  assert.equal(result.destinations[0].productionDemand, "quantity_only");
  assert.equal(result.destinations[0].allergenApproval, "preserved");
});

test("a changed dish or ingredient fingerprint requires fresh review", () => {
  const changedDish = base({ sourceEntryId: "entry:fish", canonicalDishId: "dish:fish", dishName: "Fish soup", allergenEvidenceHash: "b".repeat(64) });
  const result = amendmentImpactForDays([day([base()])], [day([changedDish], "v10")]);
  assert.equal(result.destinations[0].productionDemand, "dish_set_changed");
  assert.equal(result.destinations[0].allergenApproval, "fresh_review_required");
});

test("moving the service date is a demand change and cannot carry dated approval", () => {
  const prior = { ...day([base()]), date: "2026-11-17" };
  const next = { ...day([base()], "v10"), date: "2026-11-18" };
  const result = amendmentImpactForDays([prior], [next]);
  assert.equal(result.destinations[0].productionDemand, "service_date_changed");
  assert.equal(result.destinations[0].allergenApproval, "fresh_review_required");
});

test("a withdrawn service closes its destination release; zero portions do not remain served", () => {
  const result = amendmentImpactForDays([day([base()])], [day([], "v10")]);
  assert.equal(result.destinations[0].productionDemand, "withdrawal");
  assert.equal(result.destinations[0].allergenApproval, "withdrawn");
  assert.equal(result.withdrawnDestinationCount, 1);
});

test("mixed governed and one-off allocations classify independently and incomplete evidence fails closed", () => {
  const governed = (quantity: number) => base({ allocations: [{ destination: { kind: "governed", id: "oploc:bank", label: "Bank" }, destinationId: "oploc:bank", destinationLabel: "Bank", quantity }] });
  const oneOff = (complete: boolean) => base({ sourceEntryId: "entry:side", canonicalDishId: "dish:side", allergenEvidenceHash: "b".repeat(64), allocations: [{ destination: { kind: "one-off", id: "one-off:asana", sourceDayId: "menu-day:2026-11-17", label: "Asana", address: "1 Example Road" }, destinationLabel: "Asana", quantity: 4 }], allergenEvidenceComplete: complete });
  const result = amendmentImpactForDays([day([governed(10), oneOff(true)])], [day([governed(12), oneOff(false)], "v10")]);
  assert.deepEqual(result.destinations.map(value => [value.siteId, value.productionDemand, value.allergenApproval]), [
    ["governed:oploc:bank", "quantity_only", "preserved"],
    ["one-off:one-off:asana", "unchanged", "fresh_review_required"],
  ]);
});
