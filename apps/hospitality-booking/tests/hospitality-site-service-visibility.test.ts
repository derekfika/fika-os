import assert from "node:assert/strict";
import test from "node:test";
import { effectiveServiceLayout, resolveServiceCategories } from "@fika/server-shared/hospitality-service-layout";
import { hospitalityVisibilityFromCatalogue } from "../lib/rcoa-service-visibility";
import { visibleHospitalityServiceOptions } from "../lib/hospitality-portal-service-options";
import { assertHospitalityVisibilityPackageCurrent } from "../lib/hospitality-portal-catalogue";
import type { CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";

const oploc = "oploc:confirmed-site";
const pkg = (serviceLayout = effectiveServiceLayout({ sites: { [oploc]: { breakfast: { categories: ["Drinks"] }, lunch: { categories: [], hidden: true } } } })): CataloguePackage => ({
  schemaVersion: 2,
  contract: "fika.hospitality-catalogue-package.v2",
  oplocs: [{ id: oploc, label: "Untrusted display text" }],
  items: [],
  exceptions: [],
  serviceLayout,
});

test("CFC/Munich RE visibility consumes only the verified package and site override", () => {
  const visibility = hospitalityVisibilityFromCatalogue(pkg(), oploc);
  assert.deepEqual(resolveServiceCategories(visibility.layout, visibility.oplocId, "breakfast"), ["Drinks"]);
  assert.equal(resolveServiceCategories(visibility.layout, visibility.oplocId, "lunch"), undefined);
  assert.throws(() => hospitalityVisibilityFromCatalogue({ ...pkg(), serviceLayout: undefined } as CataloguePackage, oploc), /could not be verified/);
  assert.throws(() => hospitalityVisibilityFromCatalogue(pkg(), "oploc:unmapped"), /could not be verified/);
});

test("all configured shared services appear by their package categories; hidden services remain absent", () => {
  const layout = effectiveServiceLayout({ sites: { [oploc]: { dining: { categories: ["Dinner" ] }, finger_food: { categories: ["Canapes"] }, lunch: { categories: [], hidden: true } } } });
  const options = visibleHospitalityServiceOptions(hospitalityVisibilityFromCatalogue(pkg(layout), oploc));
  assert.deepEqual(options.find(option => option.id === "dining")?.categories, ["Dinner"]);
  assert.deepEqual(options.find(option => option.id === "finger_food")?.categories, ["Canapes"]);
  assert.equal(options.some(option => option.id === "lunch"), false);
});

test("CFC and Munich RE cannot authorize visibility from an unverified cached package", () => {
  assert.throws(() => assertHospitalityVisibilityPackageCurrent("cfc", "cache-unverified"), /could not be verified/);
  assert.throws(() => assertHospitalityVisibilityPackageCurrent("munich-re", "cache-unverified"), /could not be verified/);
  assert.doesNotThrow(() => assertHospitalityVisibilityPackageCurrent("cfc", "network"));
  assert.doesNotThrow(() => assertHospitalityVisibilityPackageCurrent("munich-re", "cache"));
  assert.doesNotThrow(() => assertHospitalityVisibilityPackageCurrent("mnk", "cache-unverified"));
});
