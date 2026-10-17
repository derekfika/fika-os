/**
 * THE authoritative Hospitality effective-offering resolver (pure, client-safe: no server imports, so the browser resolves the very same
 * way the server does).
 *
 *   canonical Item  +  company defaults  +  optional SPARSE OPLOC exception  =  effective Offering
 *
 * Availability is the DEFAULT: an active Item is available at every active OPLOC. Nothing is stored to say "available here with company
 * defaults". A stored exception exists only where a site genuinely differs (unavailable, price, minimum, notice, wording, configuration,
 * quote-only, operational-area scope). Archived Items and inactive OPLOCs are always unavailable; unresolved pricing fails closed.
 */
export const CATALOGUE_PACKAGE_SCHEMA_VERSION = 1;
export const CATALOGUE_PACKAGE_CONTRACT = "fika.hospitality-catalogue-package.v1";

export type PricePeriod = { amount: number; vatRate: number; from: string; to?: string };
export type PackageItem = {
  id: string; name: string; category: string; description?: string;
  defaultPrices: PricePeriod[]; defaultMinimumQuantity?: number; defaultNoticeRequiredDays?: number; defaultMinimumGuests?: number; configuration?: Record<string, unknown>;
  dietaryInformation: string[]; allergenInformation: string[]; routing: string;
};
/** A sparse site exception. `available:false` removes the Item from that site; the other fields override company defaults. */
export type PackageException = {
  id: string; itemId: string; oplocId: string; operationalAreaId?: string; mode: "standard" | "quote_only"; available: boolean;
  prices: PricePeriod[]; minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number;
  displayName?: string; description?: string; configuration?: Record<string, unknown>;
};
export type PackageOploc = { id: string; label: string };
export type CataloguePackage = { schemaVersion: number; contract: string; items: PackageItem[]; exceptions: PackageException[]; oplocs: PackageOploc[] };

export type EffectiveOffering = {
  offeringId: string; itemId: string; name: string; description?: string; category: string; offeringMode: "standard" | "quote_only";
  configuration?: Record<string, unknown>;
  constraints: { minimumQuantity?: number; minimumGuests?: number; noticeRequiredDays?: number };
  price?: { amount: number; vatRate: number; currency: "GBP" }; quoteRequired?: true;
  dietaryInformation: string[]; allergenInformation: string[];
  /** `default` = pure inheritance (nothing stored); `exception` = a stored sparse site exception shaped the result. */
  source: "default" | "exception";
};
export type Unavailable = "unknown_item" | "oploc_inactive" | "site_unavailable" | "ambiguous_exception" | "no_price" | "ambiguous_price" | "invalid_price" | "quote_only_has_price";
export type Resolution = { available: true; offering: EffectiveOffering } | { available: false; reason: Unavailable };
export type ResolveOptions = { serviceDate: string; operationalAreaId?: string };

/** Stable id for an inherited (non-stored) offering: the same Item at the same OPLOC always resolves to the same key. */
export const inheritedOfferingId = (itemId: string, oplocId: string) => `hospitality-offering:${itemId}@${oplocId}`;
const applies = (period: PricePeriod, date: string) => (!period.from || period.from <= date) && (!period.to || period.to >= date);

/** "none" / "ambiguous" are explicit outcomes, never silently resolved. */
export function pickPrice(periods: readonly PricePeriod[], date: string): PricePeriod | "none" | "ambiguous" {
  const live = periods.filter(period => applies(period, date));
  return live.length === 0 ? "none" : live.length === 1 ? live[0] : "ambiguous";
}

type Index = { items: Map<string, PackageItem>; oplocs: Set<string>; exceptions: Map<string, PackageException[]> };
const indexes = new WeakMap<CataloguePackage, Index>();
function indexOf(pkg: CataloguePackage): Index {
  let index = indexes.get(pkg);
  if (!index) {
    index = { items: new Map(pkg.items.map(item => [item.id, item])), oplocs: new Set(pkg.oplocs.map(oploc => oploc.id)), exceptions: new Map() };
    for (const exception of pkg.exceptions) { const key = `${exception.itemId}|${exception.oplocId}`; index.exceptions.set(key, [...(index.exceptions.get(key) || []), exception]); }
    indexes.set(pkg, index);
  }
  return index;
}

export function resolveHospitalityOffering(pkg: CataloguePackage, itemId: string, oplocId: string, options: ResolveOptions): Resolution {
  const index = indexOf(pkg);
  const item = index.items.get(itemId);
  if (!item) return { available: false, reason: "unknown_item" }; // archived Items are not in the package at all
  if (!index.oplocs.has(oplocId)) return { available: false, reason: "oploc_inactive" };
  const candidates = index.exceptions.get(`${itemId}|${oplocId}`) || [];
  // Most specific wins: an operational-area exception for the requested area, else the site-wide exception, else pure inheritance.
  const areaScoped = options.operationalAreaId ? candidates.filter(candidate => candidate.operationalAreaId === options.operationalAreaId) : [];
  const siteWide = candidates.filter(candidate => !candidate.operationalAreaId);
  const tier = areaScoped.length ? areaScoped : siteWide;
  if (tier.length > 1) return { available: false, reason: "ambiguous_exception" };
  const exception = tier[0];
  if (exception && exception.available === false) return { available: false, reason: "site_unavailable" };
  const mode = exception?.mode ?? "standard";
  const constraints: EffectiveOffering["constraints"] = {
    ...((exception?.minimumQuantity ?? item.defaultMinimumQuantity) !== undefined ? { minimumQuantity: exception?.minimumQuantity ?? item.defaultMinimumQuantity } : {}),
    ...((exception?.minimumGuests ?? item.defaultMinimumGuests) !== undefined ? { minimumGuests: exception?.minimumGuests ?? item.defaultMinimumGuests } : {}),
    ...((exception?.noticeRequiredDays ?? item.defaultNoticeRequiredDays) !== undefined ? { noticeRequiredDays: exception?.noticeRequiredDays ?? item.defaultNoticeRequiredDays } : {}),
  };
  const configuration = exception?.configuration ?? item.configuration;
  const description = exception?.description ?? item.description;
  const base: Omit<EffectiveOffering, "price" | "quoteRequired"> = {
    offeringId: exception?.id ?? inheritedOfferingId(itemId, oplocId), itemId, name: exception?.displayName ?? item.name, ...(description ? { description } : {}), category: item.category,
    offeringMode: mode, ...(configuration ? { configuration: structuredClone(configuration) } : {}), constraints,
    dietaryInformation: [...item.dietaryInformation], allergenInformation: [...item.allergenInformation], source: exception ? "exception" : "default",
  };
  if (mode === "quote_only") return exception && exception.prices.length ? { available: false, reason: "quote_only_has_price" } : { available: true, offering: { ...base, quoteRequired: true } };
  const own = exception && exception.prices.length ? pickPrice(exception.prices, options.serviceDate) : "none";
  const chosen = own !== "none" ? own : pickPrice(item.defaultPrices, options.serviceDate); // site price override first, else the company default
  if (chosen === "ambiguous") return { available: false, reason: "ambiguous_price" };
  if (chosen === "none") return { available: false, reason: "no_price" };
  // A malformed price (non-numeric, negative, non-finite) is never coerced into something bookable.
  if (typeof chosen.amount !== "number" || !Number.isFinite(chosen.amount) || chosen.amount < 0 || typeof chosen.vatRate !== "number" || !Number.isFinite(chosen.vatRate)) return { available: false, reason: "invalid_price" };
  return { available: true, offering: { ...base, price: { amount: chosen.amount, vatRate: chosen.vatRate, currency: "GBP" } } };
}

/** Every bookable effective offering at one OPLOC on one date, deterministically ordered. */
export function resolveSiteCatalogue(pkg: CataloguePackage, oplocId: string, options: ResolveOptions): EffectiveOffering[] {
  return pkg.items.flatMap(item => { const result = resolveHospitalityOffering(pkg, item.id, oplocId, options); return result.available ? [result.offering] : []; })
    .sort((a, b) => a.category.localeCompare(b.category, "en-GB") || a.name.localeCompare(b.name, "en-GB") || a.itemId.localeCompare(b.itemId));
}

/** An exception that states nothing beyond the defaults must not exist (it is retired, never stored as "available here"). */
export function isRedundantException(exception: Pick<PackageException, "mode" | "available" | "operationalAreaId" | "minimumQuantity" | "minimumGuests" | "noticeRequiredDays" | "displayName" | "description" | "configuration"> & { prices: PricePeriod[] }, item: Pick<PackageItem, "defaultPrices" | "defaultMinimumQuantity"> & Partial<Pick<PackageItem, "defaultNoticeRequiredDays" | "defaultMinimumGuests">>, today: string) {
  if (exception.available === false || exception.mode !== "standard" || exception.operationalAreaId) return false;
  if ((exception.minimumGuests !== undefined && exception.minimumGuests !== item.defaultMinimumGuests) || (exception.noticeRequiredDays !== undefined && exception.noticeRequiredDays !== item.defaultNoticeRequiredDays) || exception.displayName || exception.description) return false;
  if (exception.configuration && Object.keys(exception.configuration).length) return false;
  if (exception.minimumQuantity !== undefined && exception.minimumQuantity !== item.defaultMinimumQuantity) return false;
  if (exception.prices.length) {
    const own = pickPrice(exception.prices, today), base = pickPrice(item.defaultPrices, today);
    if (own === "none" || own === "ambiguous" || base === "none" || base === "ambiguous") return false;
    if (own.amount !== base.amount || own.vatRate !== base.vatRate) return false;
  }
  return true;
}
