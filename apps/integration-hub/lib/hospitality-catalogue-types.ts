/**
 * Client-safe types and labels for the Hospitality Catalogue admin read model.
 * No server imports: the browser bundle may import this module.
 *
 * Model (extends the canonical Item / Offering / Price architecture; nothing parallel):
 *   Item      one company-wide product: name, category, description, defaultMinimumQuantity, lifecycleState.
 *   Price     scoped to exactly one of: an Item (company default) or an Offering (sparse site override).
 *   Offering  Item x OPLOC (x operational area): availability. minimumQuantity / configuration display text are sparse overrides.
 *   Routing   one governed record per Item (integrationHubHospitalityMenuProductionRouting); never per site.
 */

import { effectiveServiceLayout, SERVICE_IDS, SERVICE_LAYOUT_SEED, sameServiceRule, type ServiceId, type ServiceRule, type ServiceRules } from "@fika/server-shared/hospitality-service-layout";

export const ROUTING_CHOICES = ["in_house", "cpu_hospitality", "cpu_sandwiches", "cpu_delivered_in"] as const;
export type RoutingChoice = (typeof ROUTING_CHOICES)[number];
export const ROUTING_CHOICE_LABELS: Record<RoutingChoice, string> = {
  in_house: "No CPU / In house",
  cpu_hospitality: "CPU · Hospitality",
  cpu_sandwiches: "CPU · Sandwiches",
  cpu_delivered_in: "CPU · Delivered-In",
};
export const ROUTING_CHOICE_WORKSTREAMS: Record<RoutingChoice, Array<"hospitality" | "sandwiches" | "delivered_in">> = {
  in_house: [],
  cpu_hospitality: ["hospitality"],
  cpu_sandwiches: ["sandwiches"],
  cpu_delivered_in: ["delivered_in"],
};

/** `routing_required` = no governed decision (fail closed). `routing_conflict` = a combination the hand-off cannot honour. */
export type CatalogueRoutingState = RoutingChoice | "routing_required" | "routing_conflict";
export const ROUTING_STATE_LABELS: Record<CatalogueRoutingState, string> = { ...ROUTING_CHOICE_LABELS, routing_required: "Routing required", routing_conflict: "Routing conflict" };

/** `site_only` = the Offering has its own value but the Item has no company default yet, so it is not an override of anything. */
export type PriceSource = "inherits" | "overrides" | "site_only" | "none" | "quote_only";
export type MinimumSource = "inherits" | "overrides" | "site_only" | "none";

export type CataloguePriceView = { amount: number; vatRate: number; priceId: string; version: number; effectiveFrom: string };
export type CatalogueOfferingView = {
  offeringId: string;
  version: number;
  oplocId: string;
  operationalAreaId?: string;
  mode: "standard" | "quote_only";
  status: "active" | "archived";
  /** SPARSE EXCEPTION: `false` = the Item is NOT offered at this site. Absent/true = available (the default everywhere). */
  available: boolean;
  /** A stored record that states nothing beyond the company defaults (legacy). It has no effect and is retired by migration. */
  noEffect: boolean;
  retiredReason?: "item-archived" | "redundant-default";
  displayName?: string;
  description?: string;
  price: { source: PriceSource; effective?: CataloguePriceView; override?: CataloguePriceView; redundant?: boolean };
  minimum: { source: MinimumSource; effective?: number; override?: number; redundant?: boolean };
};
export type CatalogueRow = {
  itemId: string;
  version: number;
  name: string;
  category: string;
  description: string;
  status: "active" | "archived";
  routing: { state: CatalogueRoutingState; workstreams: string[]; version: number };
  /** Exact-source-ID evidence only (never names). A suggestion is never applied; the operator must choose explicitly. */
  routingSuggestion?: { choice: RoutingChoice; reason: string };
  defaultPrice?: CataloguePriceView;
  defaultMinimumQuantity?: number;
  offerings: CatalogueOfferingView[];
  /** Active OPLOC ids where the Item is available: every active OPLOC except sparse `available:false` exceptions (empty if the Item is archived). */
  availableAt: string[];
  unavailableAt: string[];
  overrideCount: number;
  /** Reasons this row needs an operator; empty when nothing is outstanding. */
  needsReview: Array<"routing_required" | "routing_conflict" | "price_missing" | "duplicate_candidate">;
  /** Pre-canonicalisation site copy (id carries a site prefix). Read-only governance hint. */
  siteCopyOf?: string;
  sourceIds: string[];
  providerMappings: Array<{ provider: string; sourceItemId: string; sourceVersion?: string }>;
  dietaryInformation: string[];
  allergenInformation: string[];
  priceMigration: PriceMigrationView;
};

/** Deterministic rule: every standard Offering price equal -> that value is the proposed company default. Anything else needs the operator. */
export type PriceMigrationView =
  | { status: "not_needed" }
  | { status: "uniform"; amount: number; vatRate: number; minimumQuantity?: number; offeringIds: string[] }
  | { status: "operator_required"; reason: string; values: Array<{ oplocId: string; offeringId: string; amount?: number; vatRate?: number; minimumQuantity?: number }>; minimumQuantity?: number };

export type ReviewGroupView = { id: string; memberIds: string[]; reasons: string[]; decision?: "merge" | "keep_separate" | "defer"; decidedAt?: string; decidedBy?: string };
/** Every active OPLOC is Hospitality-capable; "Select all sites" = every active location. */
export type CatalogueOplocView = { oplocId: string; label: string; active: boolean };
export type CataloguePayload = {
  generatedAt: string;
  canManage: boolean;
  rows: CatalogueRow[];
  oplocs: CatalogueOplocView[];
  reviewGroups: ReviewGroupView[];
  /** `itemsAwaitingConsolidation` = active Items that still have a decisive duplicate pending; 0 once canonicalisation is complete. */
  canonicalisation: { itemsAwaitingConsolidation: number; mergeGroupsReady: number; reviewGroups: number };
  counts: { active: number; archived: number; needsReview: number; routingRequired: number };
  /** Booking-service category layout (issue #175). Additive: absent on payloads built before the editor existed. */
  serviceLayout?: ServiceLayoutView;
};

/* ------------------------------------------------------------------------------------------------------------------
 * Booking-service category layout (issue #175, slice 2a). Pure and client-safe so the editor and its tests share one rule set.
 * Category names are identity: matched EXACTLY (case and spacing significant), never normalised, never auto-created or auto-mapped.
 * ---------------------------------------------------------------------------------------------------------------- */
export const SERVICE_LABELS: Record<ServiceId, string> = {
  breakfast: "Breakfast", lunch: "Lunch", afternoon: "Afternoon", meeting_hospitality: "Meeting hospitality",
  finger_food: "Finger food", event_catering: "Event catering", dining: "Dining", bespoke: "Bespoke",
};
/** `version` is the stored document's own version (0 = nothing stored): the `expectedVersion` for the existing commands. */
export type ServiceLayoutScopeView = { version: number; services: ServiceRules };
/** The stored part of the layout: this is also what a layout command returns so the client can refresh versions without a reload. */
export type ServiceLayoutStoredView = {
  /** Effective company rules: every service present, gaps filled from the seed. */
  company: ServiceLayoutScopeView;
  /** Sparse: only sites with a stored document, and only the services each overrides (an emptied document keeps its version). */
  sites: Record<string, ServiceLayoutScopeView>;
};
export type ServiceLayoutView = ServiceLayoutStoredView & { vocabulary: { catalogueCategories: string[]; seedCategories: string[] } };

const uniqueInOrder = (values: Iterable<string>) => [...new Set(values)];
export const seedServiceCategories = (): string[] => uniqueInOrder(SERVICE_IDS.flatMap(id => SERVICE_LAYOUT_SEED[id].categories));

/** Pure: stored documents -> the stored part of the editor read model. */
export function storedServiceLayoutView(documents: Array<{ scope: "company" | "site"; oplocId?: string; version: number; services: ServiceRules }>): ServiceLayoutStoredView {
  const company = documents.find(document => document.scope === "company");
  const sites: Record<string, ServiceLayoutScopeView> = {};
  for (const document of documents) {
    if (document.scope !== "site" || !document.oplocId) continue;
    const services: ServiceRules = {};
    for (const id of SERVICE_IDS) { const rule = document.services?.[id]; if (rule) services[id] = { categories: [...rule.categories], ...(rule.hidden ? { hidden: true } : {}) }; }
    sites[document.oplocId] = { version: document.version, services };
  }
  return { company: { version: company?.version ?? 0, services: effectiveServiceLayout({ company: company?.services }).company }, sites };
}
/** Pure: stored documents + the active Items' exact category names -> the editor's read model. No catalogue package is touched. */
export function buildServiceLayoutView(documents: Parameters<typeof storedServiceLayoutView>[0], activeCategories: Iterable<string>): ServiceLayoutView {
  return {
    ...storedServiceLayoutView(documents),
    vocabulary: { catalogueCategories: uniqueInOrder([...activeCategories].filter(category => category.length > 0)).sort((a, b) => a.localeCompare(b, "en-GB")), seedCategories: seedServiceCategories() },
  };
}

type Stored = Pick<ServiceLayoutStoredView, "company" | "sites">;
/** What a scope shows for a service. At a site, no stored override means the company rule is inherited. */
export function serviceRuleAt(view: Stored, oplocId: string | undefined, serviceId: ServiceId): { rule: ServiceRule; source: "company" | "site" } {
  const override = oplocId ? view.sites[oplocId]?.services[serviceId] : undefined;
  if (override) return { rule: override, source: "site" };
  return { rule: view.company.services[serviceId] ?? SERVICE_LAYOUT_SEED[serviceId], source: "company" };
}
export const scopeVersion = (view: Stored, oplocId?: string) => (oplocId ? view.sites[oplocId]?.version ?? 0 : view.company.version);

/** Rows of the matrix: seed + live catalogue + anything already in a stored layout. Nothing else is ever offered as a row. */
export function layoutVocabulary(view: ServiceLayoutView): string[] {
  const stored: string[] = [];
  const collect = (rules: ServiceRules) => { for (const id of SERVICE_IDS) stored.push(...(rules[id]?.categories ?? [])); };
  collect(view.company.services); for (const site of Object.values(view.sites)) collect(site.services);
  const all = uniqueInOrder([...view.vocabulary.seedCategories, ...view.vocabulary.catalogueCategories, ...stored]);
  const seed = new Set(view.vocabulary.seedCategories);
  return [...all.filter(category => seed.has(category)), ...all.filter(category => !seed.has(category)).sort((a, b) => a.localeCompare(b, "en-GB"))];
}
/** ORPHAN: named in the layout but no live catalogue Item has exactly that category. Reported, never removed automatically. */
export function orphanCategories(rules: ServiceRules, catalogueCategories: readonly string[]): string[] {
  const live = new Set(catalogueCategories);
  return uniqueInOrder(SERVICE_IDS.flatMap(id => rules[id]?.categories ?? [])).filter(category => !live.has(category));
}
/** UNMAPPED: a live catalogue category that no company-level service offers. Reported, never added automatically. */
export function unmappedCategories(companyRules: ServiceRules, catalogueCategories: readonly string[]): string[] {
  const mapped = new Set(SERVICE_IDS.flatMap(id => companyRules[id]?.categories ?? []));
  return catalogueCategories.filter(category => !mapped.has(category));
}
/** Explicit tick/untick of one category. A newly ticked category goes to the END of the service's order; unticking keeps the rest in order. */
export function setCategoryIncluded(categories: readonly string[], category: string, included: boolean): string[] {
  const without = categories.filter(entry => entry !== category);
  return included ? [...without, category] : without;
}
/** Moves a category one place within a service. Out-of-range moves and unknown categories return the list unchanged. */
export function moveCategory(categories: readonly string[], category: string, delta: -1 | 1): string[] {
  const from = categories.indexOf(category), to = from + delta;
  if (from < 0 || to < 0 || to >= categories.length) return [...categories];
  const next = [...categories]; [next[from], next[to]] = [next[to], next[from]];
  return next;
}

export type ServicePreview = { serviceId: ServiceId; label: string; hidden: boolean; categories: string[]; source: "company" | "site"; edited: boolean };
/** Ordered effective state for a scope. Hidden services keep their list (so it stays editable) but are flagged hidden. `drafts` overlay unsaved edits. */
export function effectivePreview(view: Stored, oplocId: string | undefined, drafts: Partial<Record<ServiceId, ServiceRule>> = {}): ServicePreview[] {
  return SERVICE_IDS.map(serviceId => {
    const { rule, source } = serviceRuleAt(view, oplocId, serviceId);
    const draft = drafts[serviceId];
    const shown = draft ?? rule;
    return { serviceId, label: SERVICE_LABELS[serviceId], hidden: Boolean(shown.hidden), categories: [...shown.categories], source, edited: Boolean(draft) && !sameServiceRule(rule, draft) };
  });
}

/** Why a draft cannot be saved yet (empty string = it can). Mirrors the server rules; the server remains the authority. */
export function saveBlocker(view: Stored, oplocId: string | undefined, serviceId: ServiceId, draft: ServiceRule, reason: string): string {
  const { rule } = serviceRuleAt(view, oplocId, serviceId);
  if (sameServiceRule(rule, draft)) return "No changes to save.";
  if (!draft.hidden && draft.categories.length === 0) return "Choose at least one category, or hide the service.";
  if (oplocId && sameServiceRule(view.company.services[serviceId], draft)) return "This matches the company default, so it is not an override. Use Clear override to inherit it.";
  if (reason.trim().length < 8) return "Record a reason of at least eight characters.";
  return "";
}
/** The existing governed commands, with the expected version of exactly the document being written. */
export function setServiceCategoriesCommand(view: Stored, oplocId: string | undefined, serviceId: ServiceId, draft: ServiceRule, reason: string) {
  return { action: "set-service-categories" as const, serviceId, categories: [...draft.categories], ...(draft.hidden ? { hidden: true } : {}), ...(oplocId ? { oplocId } : {}), expectedVersion: scopeVersion(view, oplocId), reason: reason.trim() };
}
export function clearServiceOverrideCommand(view: Stored, oplocId: string, serviceId: ServiceId, reason: string) {
  return { action: "clear-service-override" as const, serviceId, oplocId, expectedVersion: scopeVersion(view, oplocId), reason: reason.trim() };
}
