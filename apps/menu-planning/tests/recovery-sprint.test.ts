import assert from "node:assert/strict";
import test from "node:test";
import { readExplicitAllergens, storedExplicitAllergens, toggleExplicitAllergen } from "../../shared/allergen-declaration";
import { applyRollingEntryPatch } from "../lib/rolling-command";
import { resolveAllergenSnapshot } from "../lib/allergen-resolution";
import type { RollingEntry } from "../lib/rolling-menu-types";
import { menuDestination } from "@fika/server-shared/menu-destination";
import { emptyWeek, normaliseRollingSnapshotDestinations, validateWeek } from "../lib/rolling-menu";

const context = { actor: "isolated-reviewer", at: "2026-11-04T15:00:00Z" };
const entry = (): RollingEntry => ({ id: "synthetic-entry", dayId: "synthetic-day", date: "2026-11-05", slot: "SOUP", itemLabel: "Synthetic soup", portions: 1, allocations: [], allergens: {}, audit: [] });

test("publication supports recorded day-scoped one-offs without weakening governed validation", () => {
  const week = emptyWeek("2098-11-02");
  const day = week.days[0];
  const oneOff = { id: `${day.id}:one-off:fixture`, label: "Synthetic site", address: "12 Test Street", addressStatus: "confirmed" as const };
  day.oneOffDestinations = [oneOff];
  const allocation = { oneOffDestinationId: oneOff.id, destinationLabel: oneOff.label, destinationAddress: oneOff.address, quantity: 7 };
  week.entries = [{ ...entry(), itemId: "dish:synthetic", dayId: day.id, date: day.date, portions: 16, allocations: [
    { destinationId: "oploc:a", destinationLabel: "Site A", quantity: 4 },
    { destinationId: "oploc:b", destinationLabel: "Site B", quantity: 5 }, allocation,
  ] }];
  const normalized = normaliseRollingSnapshotDestinations(week, [{ canonicalId: "oploc:coincidental-name", label: oneOff.label }]);
  assert.equal(normalized.entries[0].allocations[2].destinationId, undefined, "explicit one-off intent is never matched to a Hub label");
  assert.deepEqual(validateWeek(normalized, { governedOplocIds: new Set(["oploc:a", "oploc:b"]) }), []);
  assert.equal(menuDestination(allocation, day.id, day.oneOffDestinations).kind, "one-off");
  assert.throws(() => menuDestination(allocation, week.days[1].id, day.oneOffDestinations), /does not belong/);
  const pending = { kind: "one-off", id: oneOff.id, sourceDayId: day.id, label: oneOff.label, address: "", addressStatus: "pending" };
  assert.deepEqual(menuDestination(allocation, day.id, [{ ...oneOff, addressStatus: "pending" }]), pending);
  assert.deepEqual(menuDestination({ destinationLabel: oneOff.label }, day.id, [{ id: oneOff.id, label: oneOff.label, addressStatus: "pending" }]), pending);
  assert.throws(() => menuDestination({ ...allocation, destinationId: "oploc:a" }, day.id, day.oneOffDestinations), /cannot also declare/);
  const legacy = { destinationLabel: oneOff.label, destinationAddress: oneOff.address, quantity: 7 };
  assert.equal(menuDestination(legacy, day.id, day.oneOffDestinations).id, oneOff.id);
  assert.throws(() => menuDestination(legacy, day.id, [oneOff, { ...oneOff, id: `${day.id}:one-off:other` }]), /ambiguous/);
  const forged = { destination: { kind: "one-off" as const, id: `${day.id}:one-off:unrecorded`, sourceDayId: day.id, label: "Forged", address: "Unconfirmed address" }, destinationLabel: "Forged", quantity: 7 };
  assert.throws(() => menuDestination(forged, day.id, []), /missing or ambiguous/);
  const pendingSnapshot = { ...allocation, destination: { kind: "one-off" as const, id: oneOff.id, sourceDayId: day.id, label: oneOff.label, address: oneOff.address } };
  assert.deepEqual(menuDestination(pendingSnapshot, day.id, [{ ...oneOff, addressStatus: "pending" }]), pending);
  assert.throws(() => menuDestination({ ...pendingSnapshot, destination: { ...pendingSnapshot.destination, address: "" } }, day.id), /address and its status are inconsistent/);
});

test("explicit No Key toggles independently; positives withdraw it and the last removed positive stays blank", () => {
  const noKey = toggleExplicitAllergen({ milk: "contains" }, "no_key_allergens");
  assert.deepEqual(noKey, { no_key_allergens: "contains" });
  assert.deepEqual(toggleExplicitAllergen(noKey, "no_key_allergens"), {});
  const positive = toggleExplicitAllergen(noKey, "tree_nuts");
  assert.deepEqual(positive, { tree_nuts: "contains" });
  assert.deepEqual(toggleExplicitAllergen(toggleExplicitAllergen(positive, "tree_nuts"), "tree_nuts"), {});
  assert.deepEqual(storedExplicitAllergens({ no_key_allergens: "contains", milk: "clear" }, {}), { milk: "clear" });
});

test("Menu stamps deliberate declaration and explicit review, rejects contradictions and invalidates material edits", () => {
  const row = entry();
  applyRollingEntryPatch(row, { allergens: { no_key_allergens: "contains" }, explicitAllergenDeclaration: true }, context);
  assert.deepEqual(row.noKeyDeclaration, { declared: true, declaredBy: context.actor, declaredAt: context.at });
  assert.equal(row.allergenReview, undefined);
  assert.equal(row.allergens.milk, undefined, "saving a declaration alone does not clear unchecked allergens");
  applyRollingEntryPatch(row, { allergens: row.allergens, explicitAllergenDeclaration: true, confirmAllergenReview: true }, context);
  const savedReview = (JSON.parse(JSON.stringify(row)) as RollingEntry).allergenReview;
  assert.equal(savedReview?.semantics, 3);
  assert.equal(savedReview?.confirmedBy, context.actor);
  assert.equal(row.allergens.milk, "clear");
  assert.equal(resolveAllergenSnapshot(row).evidenceStatus, "confirmed");
  const reloaded: RollingEntry = JSON.parse(JSON.stringify(row));
  assert.equal(storedExplicitAllergens(reloaded.allergens, { review: reloaded.allergenReview, declaration: reloaded.noKeyDeclaration }).no_key_allergens, "contains");
  applyRollingEntryPatch(row, { allergens: { tree_nuts: "contains" }, mayContainNotes: "Shared sesame equipment", explicitAllergenDeclaration: true }, context);
  assert.equal(row.allergenReview, undefined);
  assert.equal(row.noKeyDeclaration, undefined);
  assert.deepEqual(readExplicitAllergens(row.allergens), { tree_nuts: "contains" });
  assert.equal(resolveAllergenSnapshot(row).allergens.tree_nuts, "contains");
  assert.equal(resolveAllergenSnapshot(row).mayContainNotes, "Shared sesame equipment");
  assert.throws(() => applyRollingEntryPatch(entry(), { allergens: { milk: "contains", no_key_allergens: "contains" }, explicitAllergenDeclaration: true }, context), { status: 422 });
  assert.throws(() => applyRollingEntryPatch(entry(), { allergens: {}, explicitAllergenDeclaration: true, confirmAllergenReview: true }, context), { status: 422 });
});
