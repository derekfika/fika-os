import { browserCatalogueDeps, loadHospitalityCatalogue, type CatalogueLoadResult } from "@fika/server-shared/hospitality-catalogue-client";
import { resolveSiteCatalogue, type EffectiveOffering } from "@fika/server-shared/hospitality-effective-offering";
import type { PortalMenuItem } from "./mnk-contract";
import type { PortalSiteKey } from "./portal-sites";
import { hospitalityVisibilityFromCatalogue, rcoaVisibilityFromCatalogue, RCOA_SERVICE_SETTINGS_UNAVAILABLE, type HospitalityServiceVisibility } from "./rcoa-service-visibility";

const UK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
export function assertHospitalityVisibilityPackageCurrent(site: PortalSiteKey, source: CatalogueLoadResult["source"]) {
  if ((site === "cfc" || site === "munich-re") && source === "cache-unverified") throw new Error("The Hospitality catalogue and service settings could not be verified. Refresh and try again.");
}
export function hospitalityCatalogueServiceDate(now = new Date()) { return UK_DATE.format(now); }

function portalMenuItem(offering: EffectiveOffering): PortalMenuItem | undefined {
  // Quote-only work remains an enquiry path and must never be coerced into a
  // zero-priced line in the existing price-based public booking forms.
  if (offering.offeringMode !== "quote_only" && (!offering.price || !Number.isFinite(offering.price.amount) || offering.price.amount < 0)) return undefined;
  const configuration = offering.configuration || {};
  const choices = Array.isArray(configuration.choices) ? configuration.choices as Array<Record<string, unknown>> : [];
  const optionGroups = choices.flatMap(group => {
    if (typeof group.id !== "string" || typeof group.label !== "string" || !Array.isArray(group.options)) return [];
    const options = group.options.filter((option): option is { id: string; label: string } => {
      if (!option || typeof option !== "object") return false;
      const candidate = option as { id?: unknown; label?: unknown };
      return typeof candidate.id === "string" && typeof candidate.label === "string";
    });
    return [{ id: group.id, label: group.label, ...(typeof group.minimumQuantity === "number" ? { minimumQuantity: group.minimumQuantity } : {}), selectionType: typeof group.controlType === "string" ? group.controlType : "select", required: group.required === true, options }];
  });
  const serves = typeof configuration.serves === "number" || configuration.serves === null ? configuration.serves : undefined;
  return {
    id: offering.itemId, canonicalId: offering.itemId, name: offering.name, description: offering.description,
    category: offering.category, unitPrice: offering.price?.amount ?? 0, vatRate: offering.price?.vatRate ?? null,
    bookingPolicy: offering.bookingPolicy,
    governedConstraintsResolved: true, ...(offering.quoteRequired ? { quoteRequired: true } : {}),
    ...(configuration.rules ? { rules: configuration.rules as PortalMenuItem["rules"] } : {}),
    dietaryInformation: offering.dietaryInformation, allergenInformation: offering.allergenInformation,
    minimumQuantity: offering.constraints.minimumQuantity, minimumGuests: offering.constraints.minimumGuests,
    noticeRequiredDays: offering.constraints.noticeRequiredDays, ...(serves !== undefined ? { serves } : {}),
    ...(typeof configuration.servingInfo === "string" ? { servingInfo: configuration.servingInfo } : {}),
    ...(typeof configuration.suggestionType === "string" || configuration.suggestionType === null ? { suggestionType: configuration.suggestionType } : {}),
    ...(typeof configuration.suggestionLabel === "string" ? { suggestionLabel: configuration.suggestionLabel } : {}),
    ...(typeof configuration.suggestionUnit === "string" ? { suggestionUnit: configuration.suggestionUnit } : {}),
    ...(optionGroups.length ? { optionGroups } : {}),
  };
}

export async function loadHospitalityPortalMenu(site: PortalSiteKey, requestedOplocId?: string, init: RequestInit = {}): Promise<{ menu: PortalMenuItem[]; catalogue: CatalogueLoadResult; visibility?: HospitalityServiceVisibility }> {
  let oplocId = requestedOplocId?.trim();
  if (!oplocId) {
    const siteResponse = await fetch(`/api/hospitality-catalogue/site?site=${encodeURIComponent(site)}`, { cache: "no-cache", ...init });
    if (!siteResponse.ok) {
      throw new Error("This Hospitality site has no configured catalogue location.");
    }
    const body = await siteResponse.json() as { oplocId?: unknown };
    if (typeof body.oplocId !== "string" || !body.oplocId.trim()) throw new Error("This Hospitality site has no configured catalogue location.");
    oplocId = body.oplocId;
  }
  const catalogue = await loadHospitalityCatalogue(browserCatalogueDeps("/api/hospitality-catalogue/package", init));
  if (site === "rcoa" && catalogue.source === "cache-unverified") throw new Error(RCOA_SERVICE_SETTINGS_UNAVAILABLE);
  assertHospitalityVisibilityPackageCurrent(site, catalogue.source);
  const visibility = site === "rcoa" ? rcoaVisibilityFromCatalogue(catalogue.catalogue, oplocId) : site === "cfc" || site === "munich-re" ? hospitalityVisibilityFromCatalogue(catalogue.catalogue, oplocId) : undefined;
  return { menu: portalMenuFromCatalogue(catalogue.catalogue, oplocId, hospitalityCatalogueServiceDate(), site === "angel-court"), catalogue, ...(visibility ? { visibility } : {}) };
}

export function portalMenuFromCatalogue(pkg: Parameters<typeof resolveSiteCatalogue>[0], oplocId: string, serviceDate: string, includeQuoteEnquiries = false): PortalMenuItem[] {
  return resolveSiteCatalogue(pkg, oplocId, { serviceDate }).flatMap(offering => {
    const item = portalMenuItem(offering);
    return item && (!item.quoteRequired || includeQuoteEnquiries) ? [item] : [];
  });
}
