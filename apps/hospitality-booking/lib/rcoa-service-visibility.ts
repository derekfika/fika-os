import { MAX_CATEGORIES_PER_SERVICE, SERVICE_IDS, isServiceId, resolveServiceCategories, type ServiceLayoutPackage } from "@fika/server-shared/hospitality-service-layout";
import type { CataloguePackage } from "@fika/server-shared/hospitality-effective-offering";

export type RcoaServiceVisibility = { layout: ServiceLayoutPackage; oplocId: string };
export type HospitalityServiceVisibility = RcoaServiceVisibility;
export const RCOA_SERVICE_SETTINGS_UNAVAILABLE = "The RCoA service settings could not be verified. Refresh the menu and try again.";
export const HOSPITALITY_SERVICE_SETTINGS_UNAVAILABLE = "The Hospitality service settings could not be verified. Refresh the menu and try again.";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === "object" && !Array.isArray(value));
const validRule = (value: unknown) => object(value) && Array.isArray(value.categories) && value.categories.length <= MAX_CATEGORIES_PER_SERVICE &&
  value.categories.every(category => typeof category === "string" && category.length > 0 && category.length <= 120 && category === category.trim()) &&
  new Set(value.categories).size === value.categories.length && (value.hidden === undefined || typeof value.hidden === "boolean");

/** The package is already hash-verified by the shared loader; reject missing/old or malformed visibility data explicitly. */
export function rcoaVisibilityFromCatalogue(pkg: Pick<CataloguePackage, "serviceLayout" | "oplocs">, oplocId: string): RcoaServiceVisibility {
  return buildHospitalityVisibility(pkg, oplocId, RCOA_SERVICE_SETTINGS_UNAVAILABLE);
}

export function hospitalityVisibilityFromCatalogue(pkg: Pick<CataloguePackage, "serviceLayout" | "oplocs">, oplocId: string): HospitalityServiceVisibility {
  return buildHospitalityVisibility(pkg, oplocId, HOSPITALITY_SERVICE_SETTINGS_UNAVAILABLE);
}

function buildHospitalityVisibility(pkg: Pick<CataloguePackage, "serviceLayout" | "oplocs">, oplocId: string, unavailableMessage: string): HospitalityServiceVisibility {
  const layout: unknown = pkg.serviceLayout;
  if (!oplocId || !pkg.oplocs.some(site => site.id === oplocId) || !object(layout) || typeof layout.version !== "string" || !layout.version.trim() ||
    !object(layout.company) || !SERVICE_IDS.every(id => validRule((layout.company as Record<string, unknown>)[id])) || !object(layout.sites) ||
    !Object.values(layout.sites).every(rules => object(rules) && Object.entries(rules).every(([id, rule]) => isServiceId(id) && validRule(rule)))) {
    throw Object.assign(new Error(unavailableMessage), { status: 503 });
  }
  return { layout: layout as ServiceLayoutPackage, oplocId };
}

/** No consumer-side defaults: only the verified package can offer a service or category. */
export const rcoaServiceCategories = (visibility: RcoaServiceVisibility | undefined, serviceId: string) =>
  visibility ? resolveServiceCategories(visibility.layout, visibility.oplocId, serviceId) : undefined;
export const rcoaServiceIsOffered = (visibility: RcoaServiceVisibility | undefined, serviceId: string) => rcoaServiceCategories(visibility, serviceId) !== undefined;
