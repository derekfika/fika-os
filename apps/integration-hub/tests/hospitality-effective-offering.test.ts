import assert from "node:assert/strict";
import test from "node:test";
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, inheritedOfferingId, isRedundantException, resolveHospitalityOffering, resolveSiteCatalogue, type CataloguePackage, type PackageException, type PackageItem } from "../lib/hospitality-effective-offering";

const DATE = "2026-10-17";
const item = (id: string, extra: Partial<PackageItem> = {}): PackageItem => ({ id, name: id, category: "Food", defaultPrices: [{ amount: 4, vatRate: 0.2, from: "2026-01-01" }], dietaryInformation: [], allergenInformation: [], routing: "cpu_hospitality", ...extra });
const exception = (itemId: string, oplocId: string, extra: Partial<PackageException> = {}): PackageException => ({ id: `exc:${itemId}:${oplocId}`, itemId, oplocId, mode: "standard", available: true, prices: [], ...extra });
const sites = Array.from({ length: 19 }, (_, index) => ({ id: `oploc:${index}`, label: `Site ${index}` }));
const pkg = (overrides: Partial<CataloguePackage> = {}): CataloguePackage => ({ schemaVersion: CATALOGUE_PACKAGE_SCHEMA_VERSION, contract: CATALOGUE_PACKAGE_CONTRACT, items: [item("i:1")], exceptions: [], oplocs: sites, ...overrides });
const resolve = (p: CataloguePackage, itemId: string, oplocId: string, area?: string) => resolveHospitalityOffering(p, itemId, oplocId, { serviceDate: DATE, operationalAreaId: area });

test("an active Item is available at EVERY active OPLOC with no stored record, inheriting company defaults", () => {
  const p = pkg({ items: [item("i:1", { defaultMinimumQuantity: 6, description: "Fresh" })] });
  assert.equal(p.exceptions.length, 0);
  for (const site of sites) {
    const result = resolve(p, "i:1", site.id); assert.equal(result.available, true);
    if (result.available) { assert.equal(result.offering.price?.amount, 4); assert.equal(result.offering.constraints.minimumQuantity, 6); assert.equal(result.offering.source, "default"); assert.equal(result.offering.offeringId, inheritedOfferingId("i:1", site.id), "a stable key, not a stored id"); }
  }
  assert.equal(resolveSiteCatalogue(p, "oploc:7", { serviceDate: DATE }).length, 1);
});

test("an unavailable exception removes the Item at that site only", () => {
  const p = pkg({ exceptions: [exception("i:1", "oploc:3", { available: false })] });
  assert.deepEqual(resolve(p, "i:1", "oploc:3"), { available: false, reason: "site_unavailable" });
  assert.equal(resolve(p, "i:1", "oploc:4").available, true);
  assert.equal(resolveSiteCatalogue(p, "oploc:3", { serviceDate: DATE }).length, 0);
});

test("site price and minimum overrides win over the company default; other sites keep inheriting", () => {
  const p = pkg({ items: [item("i:1", { defaultMinimumQuantity: 5 })], exceptions: [exception("i:1", "oploc:2", { prices: [{ amount: 4.75, vatRate: 0.2, from: "2026-01-01" }], minimumQuantity: 12 })] });
  const at = (site: string) => { const r = resolve(p, "i:1", site); assert.equal(r.available, true); return (r as { offering: { price?: { amount: number }; constraints: { minimumQuantity?: number }; source: string } }).offering; };
  assert.equal(at("oploc:2").price?.amount, 4.75); assert.equal(at("oploc:2").constraints.minimumQuantity, 12); assert.equal(at("oploc:2").source, "exception");
  assert.equal(at("oploc:9").price?.amount, 4); assert.equal(at("oploc:9").constraints.minimumQuantity, 5);
  const changed = pkg({ items: [item("i:1", { defaultPrices: [{ amount: 5, vatRate: 0.2, from: "2026-01-01" }], defaultMinimumQuantity: 5 })], exceptions: p.exceptions });
  assert.equal((resolve(changed, "i:1", "oploc:9") as { offering: { price?: { amount: number } } }).offering.price?.amount, 5, "a company default change reaches every non-overridden site");
  assert.equal((resolve(changed, "i:1", "oploc:2") as { offering: { price?: { amount: number } } }).offering.price?.amount, 4.75, "and never touches an override");
});

test("inactive/unknown OPLOCs and archived Items (absent from the package) are unavailable", () => {
  const p = pkg();
  assert.deepEqual(resolve(p, "i:1", "oploc:inactive"), { available: false, reason: "oploc_inactive" });
  assert.deepEqual(resolve(p, "i:archived", "oploc:1"), { available: false, reason: "unknown_item" });
  assert.deepEqual(resolve(pkg({ oplocs: sites.slice(0, 2) }), "i:1", "oploc:5"), { available: false, reason: "oploc_inactive" });
});

test("pricing fails closed: no price, ambiguous price, malformed price, and a priced quote-only record", () => {
  assert.deepEqual(resolve(pkg({ items: [item("i:1", { defaultPrices: [] })] }), "i:1", "oploc:1"), { available: false, reason: "no_price" });
  assert.deepEqual(resolve(pkg({ items: [item("i:1", { defaultPrices: [{ amount: 1, vatRate: 0.2, from: "2026-01-01" }, { amount: 2, vatRate: 0.2, from: "2026-02-01" }] })] }), "i:1", "oploc:1"), { available: false, reason: "ambiguous_price" });
  assert.deepEqual(resolve(pkg({ items: [item("i:1", { defaultPrices: [{ amount: Number.NaN, vatRate: 0.2, from: "2026-01-01" }] })] }), "i:1", "oploc:1"), { available: false, reason: "invalid_price" });
  assert.deepEqual(resolve(pkg({ items: [item("i:1", { defaultPrices: [{ amount: -1, vatRate: 0.2, from: "2026-01-01" }] })] }), "i:1", "oploc:1"), { available: false, reason: "invalid_price" });
  assert.deepEqual(resolve(pkg({ exceptions: [exception("i:1", "oploc:1", { mode: "quote_only", prices: [{ amount: 3, vatRate: 0.2, from: "2026-01-01" }] })] }), "i:1", "oploc:1"), { available: false, reason: "quote_only_has_price" });
  const dated = pkg({ items: [item("i:1", { defaultPrices: [{ amount: 1, vatRate: 0.2, from: "2026-01-01", to: "2026-06-30" }] })] });
  assert.equal(resolve(dated, "i:1", "oploc:1").available, false, "an expired default is not silently used");
});

test("quote-only at a site, and operational-area exceptions: the most specific record wins, duplicates fail closed", () => {
  const quote = exception("i:1", "oploc:1", { mode: "quote_only" });
  const q = resolve(pkg({ exceptions: [quote] }), "i:1", "oploc:1"); assert.equal(q.available, true); if (q.available) { assert.equal(q.offering.quoteRequired, true); assert.equal(q.offering.price, undefined); }
  const area = exception("i:1", "oploc:1", { id: "exc:area", operationalAreaId: "area:x", prices: [{ amount: 9, vatRate: 0.2, from: "2026-01-01" }] });
  const withArea = pkg({ exceptions: [area] });
  assert.equal((resolve(withArea, "i:1", "oploc:1", "area:x") as { offering: { price?: { amount: number } } }).offering.price?.amount, 9);
  assert.equal((resolve(withArea, "i:1", "oploc:1", "area:other") as { offering: { price?: { amount: number } } }).offering.price?.amount, 4, "another area inherits");
  assert.equal((resolve(withArea, "i:1", "oploc:1") as { offering: { price?: { amount: number } } }).offering.price?.amount, 4);
  assert.deepEqual(resolve(pkg({ exceptions: [exception("i:1", "oploc:1"), exception("i:1", "oploc:1", { id: "exc:dup" })] }), "i:1", "oploc:1"), { available: false, reason: "ambiguous_exception" });
});

test("wording and configuration: an exception overrides, otherwise the Item default applies", () => {
  const p = pkg({ items: [item("i:1", { description: "Company text", configuration: { servingInfo: "Serves 10" } })], exceptions: [exception("i:1", "oploc:1", { displayName: "House Special", description: "Local text" })] });
  const local = resolve(p, "i:1", "oploc:1"); const other = resolve(p, "i:1", "oploc:2");
  assert.ok(local.available && other.available);
  if (local.available && other.available) { assert.equal(local.offering.name, "House Special"); assert.equal(local.offering.description, "Local text"); assert.equal(other.offering.name, "i:1"); assert.equal(other.offering.description, "Company text"); assert.deepEqual(other.offering.configuration, { servingInfo: "Serves 10" }); }
});

test("an exception that only restates the company defaults is redundant and must not exist", () => {
  const defaults = { defaultPrices: [{ amount: 4, vatRate: 0.2, from: "2026-01-01" }], defaultMinimumQuantity: 5 };
  const stated = (extra: Partial<PackageException> = {}) => ({ mode: "standard" as const, available: true, prices: [], ...extra });
  assert.equal(isRedundantException(stated(), defaults, DATE), true, "nothing stated");
  assert.equal(isRedundantException(stated({ prices: [{ amount: 4, vatRate: 0.2, from: "2026-01-01" }], minimumQuantity: 5 }), defaults, DATE), true, "restates price and minimum");
  assert.equal(isRedundantException(stated({ available: false }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ prices: [{ amount: 4.5, vatRate: 0.2, from: "2026-01-01" }] }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ minimumQuantity: 6 }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ displayName: "x" }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ mode: "quote_only" }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ operationalAreaId: "area:x" }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ noticeRequiredDays: 3 }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ configuration: { servingInfo: "x" } }), defaults, DATE), false);
  assert.equal(isRedundantException(stated({ prices: [{ amount: 4, vatRate: 0.2, from: "2026-01-01" }] }), { defaultPrices: [], defaultMinimumQuantity: undefined }, DATE), false, "a site price with no company default states something");
});

test("item-level booking defaults (notice, guests, configuration) reach every site; a site may override; equal restatements are redundant", () => {
  const p = pkg({ items: [item("i:1", { defaultNoticeRequiredDays: 3, defaultMinimumGuests: 8, configuration: { servingInfo: "Serves 10", choices: [] } })], exceptions: [exception("i:1", "oploc:2", { noticeRequiredDays: 5 })] });
  const at = (site: string) => (resolve(p, "i:1", site) as { offering: { constraints: { noticeRequiredDays?: number; minimumGuests?: number }; configuration?: unknown } }).offering;
  assert.equal(at("oploc:9").constraints.noticeRequiredDays, 3); assert.equal(at("oploc:9").constraints.minimumGuests, 8); assert.deepEqual(at("oploc:9").configuration, { servingInfo: "Serves 10", choices: [] });
  assert.equal(at("oploc:2").constraints.noticeRequiredDays, 5, "site override"); assert.equal(at("oploc:2").constraints.minimumGuests, 8, "other defaults still inherited");
  const defaults = { defaultPrices: [{ amount: 4, vatRate: 0.2, from: "2026-01-01" }], defaultNoticeRequiredDays: 3, defaultMinimumGuests: 8 };
  assert.equal(isRedundantException({ mode: "standard", available: true, prices: [], noticeRequiredDays: 3, minimumGuests: 8 }, defaults, DATE), true, "restating the defaults is redundant");
  assert.equal(isRedundantException({ mode: "standard", available: true, prices: [], noticeRequiredDays: 4 }, defaults, DATE), false);
});
