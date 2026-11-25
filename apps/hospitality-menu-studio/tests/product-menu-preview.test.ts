import assert from "node:assert/strict";
import test from "node:test";
import type { CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { productMenuPreviewOffering } from "../lib/product-menu-preview";

const catalogue: CataloguePackage = {
  contract: "fika.hospitality-catalogue-package.v2", schemaVersion: 2,
  items: [{
    id: "item:one", name: "Finger Food", category: "Hospitality", defaultPrices: [{ amount: 4, vatRate: 20, from: "2026-11-01" }],
    defaultMinimumQuantity: 6, dietaryInformation: [], allergenInformation: [],
    configuration: { choices: [{ id: "variety", controlType: "quantities", minimumQuantity: 4 }], privateContract: "must not leave the provider" },
  }],
  oplocs: ["site:one", "site:two", "site:three"].map(id => ({ id, label: id })),
  exceptions: [
    { id: "offering:one", itemId: "item:one", oplocId: "site:one", mode: "standard", available: true, prices: [{ amount: 5, vatRate: 20, from: "2026-12-01" }] },
    { id: "offering:two", itemId: "item:one", oplocId: "site:two", mode: "quote_only", available: true, prices: [] },
    { id: "offering:three", itemId: "item:one", oplocId: "site:three", mode: "standard", available: false, prices: [] },
  ],
};

test("a draft preview returns only verified site and date price and choice rules", () => {
  const view = productMenuPreviewOffering(catalogue, "item:one", "site:one", "2026-12-02");
  assert.deepEqual(view, {
    itemId: "item:one", siteId: "site:one", eventDate: "2026-12-02", draftOnly: true, state: "priced", name: "Finger Food",
    price: { currency: "GBP", amount: 5, vatRate: 20 }, minimumQuantity: 6, minimumDishQuantity: 4,
    supportedPresentations: ["dropdown", "quantities"],
  });
  assert.equal(productMenuPreviewOffering(catalogue, "item:one", "site:two", "2026-12-02").state, "quote-only");
  assert.equal(productMenuPreviewOffering(catalogue, "item:one", "site:three", "2026-12-02").state, "unavailable");
  assert.equal(productMenuPreviewOffering(catalogue, "item:one", "retired-site", "2026-12-02").state, "unavailable");
});
