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
  /** Governed site restriction (Item.allowedOplocIds). Absent = unrestricted. Distinct from availability exceptions. */
  permittedSites?: string[];
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
};
