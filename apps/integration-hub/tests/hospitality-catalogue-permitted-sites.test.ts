import assert from "node:assert/strict";
import test from "node:test";
import { buildCataloguePackage, type PackageSource } from "../lib/hospitality-catalogue-package";
import { resolveHospitalityOffering, resolveSiteCatalogue } from "../lib/hospitality-effective-offering";
import type { CanonicalRecord } from "../lib/types";

const wrap = (entityType: string, canonicalId: string, record: Record<string, unknown>) => ({ canonicalId, entityType, record: { version: 1, canonicalId, ...record }, dataHash: "x", lifecycleStatus: "published", publicationStatus: "published" }) as unknown as CanonicalRecord;
const OAC = "oploc:oac", RCOA = "oploc:rcoa", OTHER = "oploc:other";
const TODAY = "2026-10-30";
const wine = (allowed?: string[]) => wrap("Hospitality Menu Item", "hospitality-menu-item:wine", { name: "Organic Macabeo", category: "Wine", lifecycleState: "active", dietaryInformation: [], allergenInformation: [], providerMappings: [], defaultMinimumQuantity: 1, ...(allowed ? { allowedOplocIds: allowed } : {}) });
const source = (allowed: string[] | undefined, offerings: CanonicalRecord[] = []): PackageSource => ({
  items: [wine(allowed)], offerings, oplocs: [OAC, RCOA, OTHER].map(id => wrap("OPLOC", id, { approvedName: id, lifecycleState: "active" })),
  prices: [wrap("Hospitality Menu Price", "hospitality-menu-price:wine", { hospitalityMenuItemId: "hospitality-menu-item:wine", amount: 27, currency: "GBP", vatRate: 0.2, effectiveFrom: "2026-01-01", lifecycleState: "active" })], routing: [],
});
const at = (pkg: ReturnType<typeof buildCataloguePackage>, oplocId: string) => resolveHospitalityOffering(pkg, "hospitality-menu-item:wine", oplocId, { serviceDate: TODAY });

test("a restricted Item is unavailable at an unlisted site; adding RCoA to the allowlist makes it effective there at the unchanged price while OAC is unchanged and others stay excluded", () => {
  const before = buildCataloguePackage(source([OAC]), TODAY), after = buildCataloguePackage(source([OAC, RCOA]), TODAY);
  assert.deepEqual(at(before, RCOA), { available: false, reason: "site_unavailable" });
  const rcoa = at(after, RCOA), oac = at(after, OAC);
  assert.equal(rcoa.available, true); assert.equal(oac.available, true);
  if (rcoa.available && oac.available) { assert.equal(rcoa.offering.price?.amount, 27); assert.deepEqual({ ...rcoa.offering, offeringId: "" }, { ...oac.offering, offeringId: "" }); }
  assert.deepEqual(at(after, OTHER), { available: false, reason: "site_unavailable" });
  assert.deepEqual(at(before, OAC), at(after, OAC), "OAC resolution is identical before and after");
  assert.equal(resolveSiteCatalogue(after, RCOA, { serviceDate: TODAY }).length, 1);
  assert.equal(resolveSiteCatalogue(after, OTHER, { serviceDate: TODAY }).length, 0);
});

test("the published package differs only by the allowlist, creates no Item or exception and an explicit unavailable exception still wins", () => {
  const before = buildCataloguePackage(source([OAC]), TODAY), after = buildCataloguePackage(source([OAC, RCOA]), TODAY);
  assert.equal(after.items.length, before.items.length); assert.equal(after.exceptions.length, 0);
  assert.deepEqual({ ...after.items[0], allowedOplocIds: undefined }, { ...before.items[0], allowedOplocIds: undefined });
  assert.deepEqual(after.items[0].allowedOplocIds, [OAC, RCOA].sort());
  const blocked = wrap("Hospitality Menu Offering", "hospitality-menu-offering:b", { hospitalityMenuItemId: "hospitality-menu-item:wine", oplocId: RCOA, offeringMode: "standard", lifecycleState: "active", available: false });
  assert.equal(at(buildCataloguePackage(source([OAC, RCOA], [blocked]), TODAY), RCOA).available, false, "permission never overrides a site exclusion");
});
