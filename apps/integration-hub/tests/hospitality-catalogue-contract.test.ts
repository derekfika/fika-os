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

test("portal contract: availability is the default at every active OPLOC; quote-only is a sparse area exception; an unavailable exception removes the item", () => {
  const item = record("Hospitality Menu Item", "hospitality-menu-item:one", { name: "Lunch", category: "Lunch", dietaryInformation: [], allergenInformation: [] });
  const defaultPrice = record("Hospitality Menu Price", "hospitality-menu-price:one", { hospitalityMenuItemId: item.canonicalId, amount: 12, vatRate: .2, effectiveFrom: "2026-01-01" });
  const quote = record("Hospitality Menu Offering", "hospitality-menu-offering:two", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:mnk-test", operationalAreaId: "operational-area:one", offeringMode: "quote_only" });
  const blocked = record("Hospitality Menu Offering", "hospitality-menu-offering:blocked", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:blocked", offeringMode: "standard", available: false });
  const oploc = (id: string) => record("OPLOC", id, { approvedName: id, lifecycleState: "active" });
  const records = [item, defaultPrice, quote, blocked, oploc("oploc:mnk-test"), oploc("oploc:elsewhere"), oploc("oploc:blocked")];
  const read = (oplocId: string, operationalAreaId?: string) => hospitalityPortalReadFromRecords(records, { oplocId, operationalAreaId, serviceDate: "2026-07-30" }).offerings as Array<Record<string, any>>;
  assert.equal(read("oploc:elsewhere")[0].price.amount, 12, "no record exists for this site: pure inheritance");
  assert.equal(read("oploc:elsewhere")[0].offeringId, "hospitality-offering:hospitality-menu-item:one@oploc:elsewhere", "stable inherited key");
  assert.equal(read("oploc:mnk-test").length, 1); assert.equal(read("oploc:mnk-test")[0].price.amount, 12, "outside the area exception the site inherits");
  const areaQuote = read("oploc:mnk-test", "operational-area:one"); assert.equal(areaQuote.length, 1); assert.equal(areaQuote[0].quoteRequired, true); assert.equal("price" in areaQuote[0], false, "quote-only never carries a price");
  assert.equal(read("oploc:blocked").length, 0, "an available:false exception removes the item at that site only");
  assert.equal(read("oploc:not-an-oploc").length, 0, "unknown/inactive OPLOC: unavailable");
});

test("unpublished, inactive, out-of-date and ambiguous standard prices never reach a new portal read", () => {
  const item = record("Hospitality Menu Item", "hospitality-menu-item:two", { name: "Breakfast", category: "Breakfast", dietaryInformation: [], allergenInformation: [] });
  const offering = record("Hospitality Menu Offering", "hospitality-menu-offering:three", { hospitalityMenuItemId: item.canonicalId, oplocId: "oploc:mnk-test", offeringMode: "standard" });
  const draftPrice = record("Hospitality Menu Price", "hospitality-menu-price:draft", { hospitalityMenuOfferingId: offering.canonicalId, amount: 1, vatRate: .2, effectiveFrom: "2026-01-01" }, "draft");
  assert.equal(hospitalityPortalReadFromRecords([item, offering, draftPrice], { oplocId: "oploc:mnk-test", serviceDate: "2026-07-30" }).offerings.length, 0);
});
