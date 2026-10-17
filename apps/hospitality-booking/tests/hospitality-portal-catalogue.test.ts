import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, type CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";
import { hospitalityCatalogueServiceDate, portalMenuFromCatalogue } from "../lib/hospitality-portal-catalogue";

const pkg: CataloguePackage = {
  schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION,
  contract: CATALOGUE_PACKAGE_CONTRACT,
  items: [
    { id: "item:inherited", name: "Inherited", category: "Lunch", defaultPrices: [{ amount: 10, vatRate: 0.2, from: "2026-01-01" }], defaultMinimumQuantity: 2, defaultNoticeRequiredDays: 3, configuration: { choices: [{ id: "side", label: "Side", controlType: "select", required: true, options: [{ id: "salad", label: "Salad" }] }] }, dietaryInformation: ["vegetarian"], allergenInformation: ["contains milk"] },
    { id: "item:quote", name: "Quote", category: "Events", defaultPrices: [], defaultMode: "quote_only", dietaryInformation: [], allergenInformation: [] },
    { id: "item:unpriced", name: "Unpriced", category: "Lunch", defaultPrices: [], dietaryInformation: [], allergenInformation: [] },
    { id: "item:scoped", name: "Scoped", category: "Lunch", defaultPrices: [{ amount: 5, vatRate: 0.2, from: "2026-01-01" }], dietaryInformation: [], allergenInformation: [] },
  ],
  exceptions: [
    { id: "offering:angel", itemId: "item:inherited", oplocId: "oploc:angel", mode: "standard", available: true, prices: [{ amount: 12, vatRate: 0.2, from: "2026-01-01" }], minimumQuantity: 4, displayName: "Angel Special" },
    { id: "offering:quote", itemId: "item:quote", oplocId: "oploc:mnk", mode: "quote_only", available: true, prices: [] },
    { id: "offering:blocked", itemId: "item:scoped", oplocId: "oploc:mnk", mode: "standard", available: false, prices: [] },
  ],
  oplocs: [{ id: "oploc:mnk", label: "MNK" }, { id: "oploc:angel", label: "Angel Court" }, { id: "oploc:rcoa", label: "RCoA" }],
};

test("booking uses the shared effective-offering resolver for MNK, Angel Court and RCoA scopes", () => {
  const mnk = portalMenuFromCatalogue(pkg, "oploc:mnk", "2026-10-17");
  const angel = portalMenuFromCatalogue(pkg, "oploc:angel", "2026-10-17");
  const rcoa = portalMenuFromCatalogue(pkg, "oploc:rcoa", "2026-10-17");
  assert.deepEqual(mnk.map(item => item.id), ["item:inherited"]);
  assert.equal(mnk[0].unitPrice, 10); assert.equal(mnk[0].minimumQuantity, 2); assert.equal(mnk[0].noticeRequiredDays, 3);
  assert.equal(mnk[0].optionGroups?.[0].options[0].id, "salad"); assert.deepEqual(mnk[0].dietaryInformation, ["vegetarian"]);
  assert.deepEqual(angel.map(item => item.id), ["item:inherited", "item:scoped"]);
  assert.equal(angel[0].name, "Angel Special"); assert.equal(angel[0].unitPrice, 12); assert.equal(angel[0].minimumQuantity, 4);
  assert.deepEqual(rcoa.map(item => item.id), ["item:inherited", "item:scoped"]);
  assert.equal(rcoa[0].unitPrice, 10, "site-specific pricing never leaks between OPLOCs");
  assert.ok(!mnk.some(item => item.id === "item:unpriced"), "unpriced Items fail closed");
  assert.ok(!mnk.some(item => item.id === "item:quote"), "quote-only work is never coerced into a priced item");
  assert.ok(!mnk.some(item => item.id === "item:scoped"), "explicitly unavailable exceptions remain unavailable");
});

test("pricing date is a UK operational business date", () => {
  assert.equal(hospitalityCatalogueServiceDate(new Date("2026-07-01T23:30:00Z")), "2026-07-02");
  assert.equal(hospitalityCatalogueServiceDate(new Date("2026-12-01T23:30:00Z")), "2026-12-01");
});

test("normal public startup loads the global package and public endpoints only read stored package data", () => {
  const portal = readFileSync(new URL("../app/ui/BookingPortal.tsx", import.meta.url), "utf8");
  const rcoa = readFileSync(new URL("../app/ui/RcoaBookingPortal.tsx", import.meta.url), "utf8");
  const manifest = readFileSync(new URL("../app/api/hospitality-catalogue/package/route.ts", import.meta.url), "utf8");
  const bytes = readFileSync(new URL("../app/api/hospitality-catalogue/package/[hash]/route.ts", import.meta.url), "utf8");
  assert.match(portal, /loadHospitalityPortalMenu\(site\.key, oplocId\)/);
  assert.match(rcoa, /loadHospitalityPortalMenu\("rcoa"\)/);
  assert.doesNotMatch(portal, /fetch\(`\/api\/reference-data/);
  assert.doesNotMatch(rcoa, /fetch\("\/api\/reference-data/);
  assert.match(manifest, /hubFetch/); assert.doesNotMatch(manifest, /firestore|integrationHubCanonical|collection\(/i);
  assert.match(bytes, /immutable/); assert.doesNotMatch(bytes, /firestore|integrationHubCanonical|collection\(/i);
});
