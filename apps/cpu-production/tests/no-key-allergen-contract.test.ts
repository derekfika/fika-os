import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CANONICAL_ALLERGEN_KEYS, deriveNoKeyAllergens, resolveNoKeyAllergenState, type CanonicalAllergenMap } from "../../shared/allergen-contract";
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
  const dayId = "menu-day:no-key";
  const publicationId = "menu-publication:no-key";
  const publicationDayId = "publication-day:no-key";
  const dayContentHash = "a".repeat(64);
  // Use the published contract shape as a fixture. Menu Planning's private
  // implementation is tested by Menu Planning and must not enter the CPU graph.
  const publishedEntries = [
    { sourceEntryId: "entry:a", slot: "SALAD 1", dishName: "All Clear Dish", portions: 10, allergens: allergensFor({}), allergenEvidenceStatus: "confirmed" as const },
    { sourceEntryId: "entry:b", slot: "SALAD 2", dishName: "Contains Dish", portions: 10, allergens: allergensFor({ gluten: "contains" }), allergenEvidenceStatus: "confirmed" as const },
    { sourceEntryId: "entry:c", slot: "SALAD 3", dishName: "Unrecorded Dish", portions: 10, allergens: allergensFor({ milk: "unrecorded" }), allergenEvidenceStatus: "confirmed" as const },
  ];
  assert.deepEqual(publishedEntries.map(entry => entry.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);

  const materialised = parseExternalProductionMaterialisation({
    sourceDomain: "menu-planning",
    sourceEntityId: dayId,
    publicationId,
    sourcePublicationDayId: publicationDayId,
    sourceVersion: 1,
    sourceContentHash: dayContentHash,
    destinationOplocId: "oploc:test",
    destinationLabel: "Test site",
    serviceDate,
    status: "published",
    lines: publishedEntries.map(entry => ({ sourceLineId: entry.sourceEntryId, itemName: entry.dishName, quantity: entry.portions, unit: "portion", workstream: "delivered_in" as const, approvedAllergenSnapshot: { allergens: entry.allergens, allergenEvidenceStatus: entry.allergenEvidenceStatus, sourcePublicationDayId: publicationDayId, sourceVersion: 1, sourceContentHash: dayContentHash } })),
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
    sourceEntityId: dayId,
    sourcePublicationId: publicationId,
    sourcePublicationDayId: publicationDayId,
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

test("explicit No Key state survives sparse source and CPU review rendering", async () => {
  assert.equal(resolveNoKeyAllergenState({ no_key_allergens: "contains" }), "contains");
  assert.equal(resolveNoKeyAllergenState({ milk: "clear" }), "unrecorded");
  assert.equal(resolveNoKeyAllergenState(undefined), "unrecorded");
  const source = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  assert.match(source, /resolveNoKeyAllergenState\(states\)/);
  assert.match(source, /completeAllergenReviewMap\(states\)/);
  assert.match(source, /checkpointAllergenReviewRow/);
  assert.match(source, /Explicit no key allergens/);
  assert.doesNotMatch(source, /namedAllergenPresent/);
});
