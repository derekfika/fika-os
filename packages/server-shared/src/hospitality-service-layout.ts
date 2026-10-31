/**
 * Which Item categories each booking service offers, as governed Hub configuration (issue #175).
 *
 * One company default with sparse per-site overrides. An override REPLACES a service's category list at that site; it never
 * adds a site permission, price, minimum or availability rule. Those remain independent, conjunctive checks. The same pure
 * resolver is used by browsers and servers so they cannot disagree.
 *
 * `SERVICE_LAYOUT_SEED` is today's hard-coded portal behaviour, byte for byte (RCoA `rcoaEventTypes` and the shared
 * BookingPortal map agree for every service they share). Until an administrator saves a change, the effective company
 * default IS the seed, so nothing moves on release.
 */
export const SERVICE_IDS = ["breakfast", "lunch", "afternoon", "meeting_hospitality", "finger_food", "event_catering", "dining", "bespoke"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];
export type ServiceRule = { categories: string[]; hidden?: boolean };
export type ServiceRules = Partial<Record<ServiceId, ServiceRule>>;
/** Published inside the catalogue package. `version` changes whenever any stored layout document changes. */
export type ServiceLayoutPackage = { version: string; company: ServiceRules; sites: Record<string, ServiceRules> };

export const SERVICE_LAYOUT_SEED: Readonly<Record<ServiceId, Readonly<ServiceRule>>> = {
  breakfast: { categories: ["Drinks", "Breakfast", "Sweet treats"] },
  lunch: { categories: ["Lunch", "Lunch Boxes", "Salads & Sushi", "Grazing Boxes", "Sweet treats"] },
  afternoon: { categories: ["Afternoon", "Sweet treats", "Finger Food", "Drinks"] },
  meeting_hospitality: { categories: ["Drinks", "Breakfast", "Lunch", "Lunch Boxes", "Salads & Sushi", "Sweet treats", "Afternoon"] },
  finger_food: { categories: ["Finger Food", "Grazing Boxes", "Sweet treats", "Drinks"] },
  event_catering: { categories: ["Fork Buffet & Bowl Food", "Canapes", "Grazing Events", "Drinks"] },
  dining: { categories: ["Dining", "Drinks"] },
  bespoke: { categories: ["Bespoke Events", "Grazing Events", "Dining"] },
};

export const MAX_CATEGORIES_PER_SERVICE = 40;
export const isServiceId = (value: unknown): value is ServiceId => typeof value === "string" && (SERVICE_IDS as readonly string[]).includes(value);

/** Trims, de-duplicates (first occurrence wins, order preserved) and bounds a category list. Throws on anything unusable. */
export function normaliseCategories(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error("Categories must be a list.");
  const seen = new Set<string>(), result: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") throw new Error("Each category must be text.");
    const category = entry.trim();
    if (!category) continue;
    if (category.length > 120) throw new Error("A category name is too long.");
    if (!seen.has(category)) { seen.add(category); result.push(category); }
  }
  if (result.length > MAX_CATEGORIES_PER_SERVICE) throw new Error(`A service can offer at most ${MAX_CATEGORIES_PER_SERVICE} categories.`);
  return result;
}

const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);
export const sameServiceRule = (a: ServiceRule | undefined, b: ServiceRule | undefined) => Boolean(a && b && same(a.categories, b.categories) && Boolean(a.hidden) === Boolean(b.hidden));

/** Stored company rules fill gaps from the seed (a service added later is never silently empty); stored sites are used as given. */
export function effectiveServiceLayout(stored: { company?: ServiceRules; sites?: Record<string, ServiceRules>; version?: string } = {}): ServiceLayoutPackage {
  const company: ServiceRules = {};
  for (const id of SERVICE_IDS) { const rule = stored.company?.[id] ?? SERVICE_LAYOUT_SEED[id]; company[id] = { categories: [...rule.categories], ...(rule.hidden ? { hidden: true } : {}) }; }
  const sites: Record<string, ServiceRules> = {};
  for (const oplocId of Object.keys(stored.sites || {}).sort()) {
    const rules: ServiceRules = {};
    for (const id of SERVICE_IDS) { const rule = stored.sites?.[oplocId]?.[id]; if (rule) rules[id] = { categories: [...rule.categories], ...(rule.hidden ? { hidden: true } : {}) }; }
    if (Object.keys(rules).length) sites[oplocId] = rules;
  }
  return { version: stored.version || "seed", company, sites };
}

/**
 * The categories a service offers at a site, or `undefined` when the service is hidden or unknown there (fail closed: nothing is offered).
 * A site rule replaces the company rule for that service.
 */
export function resolveServiceCategories(layout: ServiceLayoutPackage, oplocId: string | undefined, serviceId: string): readonly string[] | undefined {
  if (!isServiceId(serviceId)) return undefined;
  const rule = (oplocId ? layout.sites[oplocId]?.[serviceId] : undefined) ?? layout.company[serviceId];
  return !rule || rule.hidden ? undefined : rule.categories;
}

export const categoryAllowedForService = (layout: ServiceLayoutPackage, oplocId: string | undefined, serviceId: string, category: string) =>
  resolveServiceCategories(layout, oplocId, serviceId)?.includes(category) ?? false;
