import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, deriveNoKeyAllergens, type CanonicalAllergenMap } from "../../shared/allergen-contract";
import { buildPublishedDay, buildCompiledPublicationSnapshot, type MenuPublication } from "../../menu-planning/lib/menu-publication";
import { parseExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { allergenMatrixContentHash } from "../lib/cpu-allergen-release";
import { buildCpuPacketItems } from "../lib/cpu-packet-identity";
import { buildCpuReviewProjection } from "../lib/cpu-review-package";
import { matrixSignatureScope, type PlannedMenuItem, type ProductionPlan } from "../app/lib/production-plan";
import type { ProductionOrder } from "../lib/production-types";

const allClear = (): CanonicalAllergenMap => Object.fromEntries(CANONICAL_ALLERGEN_KEYS.map(key => [key, "clear" as const]));
const allergensFor = (override: Partial<CanonicalAllergenMap>) => deriveNoKeyAllergens({ ...allClear(), ...(override as CanonicalAllergenMap) });

test("No Key Allergens survives Menu publication, Hub materialisation, CPU review, plan and signed packet", async () => {
  const serviceDate = "2026-09-14";
  const day = { id: "menu-day:no-key", date: serviceDate, dayName: "Monday", entryIds: ["entry:a", "entry:b", "entry:c"] };
  const snapshot = {
    week: { id: "week:no-key", weekCommencing: serviceDate, weekEnding: "2026-09-20", status: "ready" as const, version: 1, dayIds: [day.id], entryIds: day.entryIds, sourceFiles: [], audit: [] },
    days: [day],
    entries: [
      { id: "entry:a", dayId: day.id, date: serviceDate, slot: "SALAD 1", itemLabel: "All Clear Dish", portions: 10, allocations: [{ destinationId: "oploc:test", destinationLabel: "Test site", quantity: 10 }], allergens: allergensFor({}), allergenReviewInvalidated: false, audit: [] },
      { id: "entry:b", dayId: day.id, date: serviceDate, slot: "SALAD 2", itemLabel: "Contains Dish", portions: 10, allocations: [{ destinationId: "oploc:test", destinationLabel: "Test site", quantity: 10 }], allergens: allergensFor({ gluten: "contains" }), allergenReviewInvalidated: false, audit: [] },
      { id: "entry:c", dayId: day.id, date: serviceDate, slot: "SALAD 3", itemLabel: "Unrecorded Dish", portions: 10, allocations: [{ destinationId: "oploc:test", destinationLabel: "Test site", quantity: 10 }], allergens: allergensFor({ milk: "unrecorded" }), allergenReviewInvalidated: false, audit: [] },
    ],
  } as any;
  const publishedDay = buildPublishedDay(snapshot, day);
  const dayContentHash = (publishedDay as { contentHash: string }).contentHash;
  assert.deepEqual(publishedDay.entries.map(entry => entry.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);

  const publication = {
    publicationId: "menu-publication:no-key",
    sourceWeekId: snapshot.week.id,
    weekCommencing: serviceDate,
    weekEnding: "2026-09-20",
    publicationVersion: 1,
    days: [{ ...publishedDay, publicationDayId: "publication-day:no-key", sourceDayId: day.id, version: 1, status: "published" as const, publishedAt: "2026-09-01T10:00:00.000Z", publishedBy: "menu-test" }],
    audit: [],
  } satisfies MenuPublication;
  const compiled = buildCompiledPublicationSnapshot(publication, 1);
  const publishedEntries = compiled.days[0].entries;
  assert.deepEqual(publishedEntries.map(entry => entry.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);

  const materialised = parseExternalProductionMaterialisation({
    sourceDomain: "menu-planning",
    sourceEntityId: day.id,
    publicationId: publication.publicationId,
    sourcePublicationDayId: compiled.days[0].publicationDayId,
    sourceVersion: 1,
    sourceContentHash: dayContentHash,
    destinationOplocId: "oploc:test",
    destinationLabel: "Test site",
    serviceDate,
    status: "published",
    lines: publishedEntries.map(entry => ({ sourceLineId: entry.sourceEntryId, canonicalItemId: entry.canonicalDishId, itemName: entry.dishName, quantity: entry.portions, unit: "portion", workstream: "delivered_in" as const, approvedAllergenSnapshot: { allergens: entry.allergens, allergenEvidenceStatus: entry.allergenEvidenceStatus, sourcePublicationDayId: compiled.days[0].publicationDayId, sourceVersion: 1, sourceContentHash: dayContentHash } })),
  });
  assert.deepEqual(materialised.lines.map(line => line.approvedAllergenSnapshot?.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);

  const order = {
    canonicalId: "production-order:no-key",
    version: 1,
    currentRevision: 1,
    origin: "menu_planning",
    destinationOplocId: "oploc:test",
    serviceDate,
    requiredBy: `${serviceDate}T12:00:00.000Z`,
    sourceEntityId: day.id,
    sourcePublicationId: publication.publicationId,
    sourcePublicationDayId: compiled.days[0].publicationDayId,
    sourceVersion: 1,
    sourceContentHash: dayContentHash,
    lines: materialised.lines.map((line, index) => ({ canonicalId: `production-line:no-key:${index + 1}`, sourceBookingLineId: line.sourceLineId, sourceMenuItemId: line.canonicalItemId, itemName: line.itemName, customerQuantity: line.quantity, customerUnit: line.unit, dietaries: {}, approvedAllergenSnapshot: line.approvedAllergenSnapshot, allergenEvidenceStatus: "confirmed" as const, status: "ready" as const, sortOrder: index })),
  } as unknown as ProductionOrder;
  const menuItems: PlannedMenuItem[] = order.lines.map((line, index) => ({ id: `menu-item:no-key:${index + 1}`, sourceLineId: line.canonicalId, name: line.itemName, note: "", subItems: [{ id: `sub-item:no-key:${index + 1}`, name: line.itemName, quantity: line.customerQuantity, allergens: line.approvedAllergenSnapshot!.allergens as never, note: "", evidenceStatus: "completed" }] }));
  const scope = matrixSignatureScope(order, allergenMatrixContentHash(menuItems))!;
  const signatures = ["production_chef", "head_chef_site_manager"].map(role => ({ role, printedName: role, signedAt: "2026-09-14T10:00:00.000Z", actor: "test", attestation: "Reviewed", scope } as const));
  const plan = { id: "production-plan:no-key", orderId: order.canonicalId, status: "planned", menuItems, planningNotes: "", signatures, signedSignatures: signatures, signedMenuContentHash: scope.matrixContentHash, audit: [] } as unknown as ProductionPlan;

  const review = buildCpuReviewProjection(serviceDate, "oploc:test", [order], [plan]);
  assert.equal(review.sourceOrders[0].reviewStatus, "signed");
  assert.deepEqual(review.sourceOrders[0].entries.map(entry => entry.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);
  assert.equal(review.sourceOrders[0].entries[2].allergenState, "UNRECORDED");
  const packetItems = buildCpuPacketItems(menuItems, order);
  assert.deepEqual(packetItems.map(item => item.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);
});

test("CPU allergen UI uses the shared No Key derivation instead of a second algorithm", async () => {
  const source = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(source, /deriveNoKeyAllergens\(states \|\| \{\}\)\.no_key_allergens/);
  assert.doesNotMatch(source, /namedAllergenPresent/);
});
