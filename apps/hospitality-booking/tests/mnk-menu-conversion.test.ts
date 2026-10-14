import assert from "node:assert/strict";
import test from "node:test";
import { localMnkMenuCatalogue } from "../lib/local-mnk-menu";
import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";

test("MNK conversion covers every source item and retains deterministic source IDs", () => {
  assert.equal(localMnkMenuCatalogue.source.itemCount, 46);
  assert.equal(localMnkMenuCatalogue.items.length, localMnkMenuCatalogue.source.itemCount);
  assert.equal(new Set(localMnkMenuCatalogue.items.map(item => item.source.sourceItemId)).size, 46);
  assert.equal(localMnkMenuCatalogue.items.find(item => item.source.sourceItemId === "mini_pastries")?.canonicalId, "hospitality-menu-item:mnk:mini_pastries");
});
test("MNK conversion preserves inactive handling and reports missing canonical enrichment", () => {
  assert.equal(localMnkMenuCatalogue.items.every(item => item.lifecycleState === "active"), true);
  assert.ok(localMnkMenuCatalogue.validationReport.missingCanonicalFields.some(item => item.field === "vatRate"));
  assert.ok(localMnkMenuCatalogue.validationReport.missingCanonicalFields.some(item => item.field === "allergenInformation"));
});
test("MNK conversion retains source choice groups and ordering constraints", () => {
  const water = localMnkMenuCatalogue.items.find(item => item.source.sourceItemId === "belu_water");
  assert.equal(water?.optionGroups[0]?.id, "water");
  assert.equal(water?.orderingConstraints.noticeRequiredDays, 3);
});

test("all FIKA OS booking catalogues carry the requested prices, feeds, variants and salad choices", () => {
  const saladOptions = [
    "Menu 1 — Cajun Chicken & Avo Mex Bowl",
    "Menu 1 — Vegan BBQ & Avo Mex Bowl",
    "Menu 2 — Hot Honey Roasted Sweet Potato Jerk Chicken & Quinoa Bowl",
    "Menu 2 — Hot Honey Roasted Sweet Potato & Quinoa Bowl",
    "Menu 3 — Roasted Miso Salmon & Edamame Bowl",
    "Menu 3 — Char-Sui Smoked Tofu & Edamame Bowl",
    "Menu 4 — Mediterranean Chicken & Halloumi Bowl",
    "Menu 4 — Mediterranean Falafel Bowl",
  ];
  for (const [site, catalogue] of Object.entries(hospitalityCatalogues)) {
    const byName = new Map(catalogue.items.map(item => [item.name, item]));
    assert.equal(byName.get("Cookie Box")?.pricing.unitPrice, 64, `${site} Cookie Box`);
    assert.equal(byName.get("Cookie Box")?.pricing.servingInfo, "Feeds 20 people", `${site} Cookie Box feeds`);
    assert.equal(byName.get("Loaf Cake")?.pricing.unitPrice, 38, `${site} Loaf Cake`);
    assert.equal(byName.get("Loaf Cake")?.pricing.servingInfo, "Feeds 14 people", `${site} Loaf Cake feeds`);
    assert.equal(byName.get("Doughnut Box")?.pricing.unitPrice, 42, `${site} Doughnut Box`);
    assert.equal(byName.get("Doughnut Box")?.pricing.servingInfo, "Feeds 12 people", `${site} Doughnut Box feeds`);
    const nuts = byName.get("Traybake Box — Contains Nuts");
    const nutFree = byName.get("Traybake Box — Nut Free");
    assert.ok(nuts && nutFree, `${site} exposes both distinct Traybake variants`);
    assert.notEqual(nuts.canonicalId, nutFree.canonicalId, `${site} traybake IDs remain distinct`);
    for (const item of [nuts, nutFree]) {
      assert.equal(item.pricing.unitPrice, 75, `${site} ${item.name} price`);
      assert.equal(item.pricing.servingInfo, "Feeds 24 or 48 smaller bites", `${site} ${item.name} feeds`);
    }
    assert.deepEqual(nuts.allergenInformation, ["Nuts"], `${site} explicit nut allergen`);
    const salads = catalogue.items.find(item => item.name === "Propper Salads");
    assert.ok(salads, `${site} Propper Salads`);
    assert.equal(salads.pricing.unitPrice, 12.5, `${site} Propper Salads price`);
    assert.equal(salads.orderingConstraints.minimumQuantity, 25, `${site} Propper Salads minimum`);
    assert.deepEqual(salads.optionGroups[0]?.options.map(option => option.label), saladOptions, `${site} exact salad option pairs`);
    assert.equal(Math.round(salads.pricing.unitPrice * salads.orderingConstraints.minimumQuantity * 100) / 100, 312.5, `${site} total at minimum`);
    assert.equal(Math.round(salads.pricing.unitPrice * (salads.orderingConstraints.minimumQuantity + 1) * 100) / 100, 325, `${site} total above minimum`);
  }
});
