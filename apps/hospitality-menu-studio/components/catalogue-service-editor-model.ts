import {
  MAX_CATEGORIES_PER_SERVICE,
  SERVICE_IDS,
  SERVICE_LAYOUT_SEED,
  sameServiceRule,
  type ServiceId,
  type ServiceRule,
  type ServiceRules,
} from "@fika/server-shared/hospitality-service-layout";
import type {
  CataloguePayload,
  CatalogueServiceLayout,
} from "./catalogue-wire";

export const BOOKING_SERVICE_LABELS: Record<ServiceId, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  afternoon: "Afternoon",
  meeting_hospitality: "Meeting hospitality",
  finger_food: "Finger food",
  event_catering: "Event catering",
  dining: "Dining",
  bespoke: "Bespoke",
};

export function configuredService(
  layout: CatalogueServiceLayout,
  siteId: string,
  serviceId: ServiceId,
) {
  const companyRule =
    layout.company.services[serviceId] ?? SERVICE_LAYOUT_SEED[serviceId];
  const site = siteId ? layout.sites[siteId] : undefined;
  const override = site?.services[serviceId];
  return {
    rule: override ?? companyRule,
    companyRule,
    override: Boolean(override),
    version: siteId ? (site?.version ?? 0) : layout.company.version,
  };
}

export function visibleServiceRule(
  rule: ServiceRule,
  visible: boolean,
): ServiceRule {
  return {
    categories: [...rule.categories],
    ...(visible ? {} : { hidden: true }),
  };
}

export function moveServiceCategory(
  categories: readonly string[],
  index: number,
  delta: -1 | 1,
): string[] {
  const next = [...categories];
  const to = index + delta;
  if (index >= 0 && index < next.length && to >= 0 && to < next.length) {
    [next[index], next[to]] = [next[to]!, next[index]!];
  }
  return next;
}

function containsCategory(rules: ServiceRules, category: string): boolean {
  return SERVICE_IDS.some((serviceId) =>
    rules[serviceId]?.categories.includes(category),
  );
}

function categoriesIn(rules: ServiceRules): string[] {
  return SERVICE_IDS.flatMap((serviceId) => rules[serviceId]?.categories ?? []);
}

export function serviceCategoryOptions(
  layout: CatalogueServiceLayout,
): string[] {
  return [
    ...new Set([
      ...layout.vocabulary.seedCategories,
      ...layout.vocabulary.catalogueCategories,
      ...categoriesIn(layout.company.services),
      ...Object.values(layout.sites).flatMap((site) =>
        categoriesIn(site.services),
      ),
    ]),
  ].sort((a, b) => a.localeCompare(b, "en-GB"));
}

export function serviceDraftProblem(
  current: ReturnType<typeof configuredService>,
  draft: ServiceRule,
  siteId: string,
): string | undefined {
  if (sameServiceRule(current.rule, draft)) return "No changes to save.";
  if (!draft.hidden && !draft.categories.length)
    return "Add a category or hide the service.";
  if (draft.categories.length > MAX_CATEGORIES_PER_SERVICE) {
    return (
      "A service can contain up to " +
      MAX_CATEGORIES_PER_SERVICE +
      " categories."
    );
  }
  if (siteId && sameServiceRule(current.companyRule, draft)) {
    return "Use the company settings to inherit this layout.";
  }
}

export function serviceUpdateCommand(
  serviceId: ServiceId,
  siteId: string,
  expectedVersion: number,
  reason: string,
  draft?: ServiceRule,
) {
  if (!draft) {
    if (!siteId || expectedVersion < 1)
      throw new Error("Choose a saved site override.");
    return {
      action: "clear-service-override" as const,
      serviceId,
      oplocId: siteId,
      expectedVersion,
      reason: reason.trim(),
    };
  }
  return {
    action: "set-service-categories" as const,
    serviceId,
    ...(siteId ? { oplocId: siteId } : {}),
    expectedVersion,
    categories: [...draft.categories],
    ...(draft.hidden ? { hidden: true } : {}),
    reason: reason.trim(),
  };
}

export function renameCategoryImpact(
  payload: CataloguePayload,
  category: string,
) {
  const items = payload.rows.filter((row) => row.category === category);
  const layout = payload.serviceLayout;
  const company = layout?.company;
  const siteVersions = Object.entries(layout?.sites ?? {}).filter(([, site]) =>
    containsCategory(site.services, category),
  );
  const companyServices =
    company && company.version > 0
      ? SERVICE_IDS.filter((id) =>
          company.services[id]?.categories.includes(category),
        )
      : [];
  return {
    items,
    companyServices,
    sites: siteVersions.map(([id, site]) => ({
      id,
      serviceIds: SERVICE_IDS.filter((serviceId) =>
        site.services[serviceId]?.categories.includes(category),
      ),
    })),
    expectedItemVersions: Object.fromEntries(
      items.map(({ itemId, version }) => [itemId, version]),
    ),
    expectedLayoutVersions: {
      ...(company && companyServices.length
        ? { company: company.version }
        : {}),
      ...Object.fromEntries(
        siteVersions.map(([id, { version }]) => ["site:" + id, version]),
      ),
    },
  };
}
