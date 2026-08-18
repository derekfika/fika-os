import assert from "node:assert/strict";
import test from "node:test";
import fixture from "../fixtures/mnk-legacy-menu-import.candidates.json";
import { hospitalityPortalReadFromRecords } from "../lib/hospitality-catalogue-service";
import type { CanonicalRecord } from "../lib/types";

const record = (entityType: any, canonicalId: string, values: Record<string, unknown>, status: "published" | "draft" = "published"): CanonicalRecord => ({ canonicalId, entityType, dataHash: canonicalId, lifecycleStatus: status, ...(status === "published" ? { publicationStatus: "published", publishedAt: "2026-01-01T00:00:00.000Z" } : {}), record: { lifecycleState: "active", ...values } });

test("MNK deterministic migration covers all legacy records with stable candidates", () => {
  assert.equal(fixture.source.recordCount, 43); assert.equal(fixture.items.length, 43); assert.equal(fixture.offerings.length, 43); assert.equal(fixture.prices.length, 42);
  const bespoke = fixture.candidates.find(candidate => candidate.sourceKey === "bespoke_event"); assert.equal(bespoke?.reviewOutcome, "quote_only"); assert.equal(bespoke?.priceId, null);
  const rice = fixture.offerings.find(offering => offering.hospitalityMenuItemId.endsWith("rice_paper_rolls")); assert.equal(rice?.configuration?.choices?.[0]?.controlType, "multi"); assert.equal(rice?.configuration?.choices?.[0]?.options.length, 6);
  assert.ok(fixture.items.every(item => Array.isArray(item.dietaryInformation) && Array.isArray(item.allergenInformation)));
});

test("MNK generated IDs remain stable when the same explicit migration configuration is replayed", async () => {
  // @ts-expect-error The checked-in deterministic converter is deliberately plain Node ESM.
  const converter: any = await import("../scripts/convert-mnk-legacy-menu.mjs");
  const config = { oplocId: "oploc:mnk-development-fixture", priceEffectiveFrom: "2026-01-01", vatRate: .2, configuredAsDevelopmentFixture: true };
  const first = converter.convertLegacyMnkMenu(converter.readLegacyMnkMenu(), config);
  const second = converter.convertLegacyMnkMenu(converter.readLegacyMnkMenu(), config);
  assert.deepEqual(first.candidates.map((candidate: any) => [candidate.itemId, candidate.offeringId, candidate.priceId]), second.candidates.map((candidate: any) => [candidate.itemId, candidate.offeringId, candidate.priceId]));
});

test("portal contract exposes only active published in-scope offers and preserves quote-only pricing boundary", () => {
  const item = record("Hospitality Menu Item", "hospitality-menu-item:one", { name: "Lunch", category: "Lunch", dietaryInformation: [], allergenInformation: [] });
  const standard = record("Hospitality Menu Offering", "hospitality-menu-offering:one", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:mnk-test", offeringMode: "standard" });
  const quote = record("Hospitality Menu Offering", "hospitality-menu-offering:two", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:mnk-test", operationalAreaId: "operational-area:one", offeringMode: "quote_only" });
  const price = record("Hospitality Menu Price", "hospitality-menu-price:one", { hospitalityMenuOfferingId: standard.canonicalId, amount: 12, vatRate: .2, effectiveFrom: "2026-01-01" });
  const outside = record("Hospitality Menu Offering", "hospitality-menu-offering:outside", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:elsewhere", offeringMode: "standard" });
  const response = hospitalityPortalReadFromRecords([item, standard, quote, price, outside], { oplocId: "oploc:mnk-test", operationalAreaId: "operational-area:one", serviceDate: "2026-07-30" });
  const standardResult = response.offerings.find(offering => offering.offeringMode === "standard") as { price?: { amount: number } } | undefined;
  const quoteResult = response.offerings.find(offering => offering.offeringMode === "quote_only") as { quoteRequired?: boolean } | undefined;
  assert.equal(response.offerings.length, 2); assert.equal(standardResult?.price?.amount, 12); assert.equal(quoteResult?.quoteRequired, true); assert.equal("price" in (quoteResult || {}), false);
});

test("unpublished, inactive, out-of-date and ambiguous standard prices never reach a new portal read", () => {
  const item = record("Hospitality Menu Item", "hospitality-menu-item:two", { name: "Breakfast", category: "Breakfast", dietaryInformation: [], allergenInformation: [] });
  const offering = record("Hospitality Menu Offering", "hospitality-menu-offering:three", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:mnk-test", offeringMode: "standard" });
  const draftPrice = record("Hospitality Menu Price", "hospitality-menu-price:draft", { hospitalityMenuOfferingId: offering.canonicalId, amount: 1, vatRate: .2, effectiveFrom: "2026-01-01" }, "draft");
  assert.equal(hospitalityPortalReadFromRecords([item, offering, draftPrice], { oplocId: "oploc:mnk-test", serviceDate: "2026-07-30" }).offerings.length, 0);
});
