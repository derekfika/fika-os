/** Wire view returned by the Hub catalogue through Studio's session-bound gateway. */
export type CataloguePrice = {
  amount: number;
  vatRate: number;
  priceId: string;
  version: number;
  effectiveFrom: string;
};
export type CatalogueOffering = {
  offeringId: string;
  version: number;
  oplocId: string;
  operationalAreaId?: string;
  minimumGuestsOverride?: number;
  noticeRequiredDaysOverride?: number;
  configurationOverride?: Record<string, unknown>;
  mode: "standard" | "quote_only";
  status: "active" | "archived";
  available: boolean;
  noEffect: boolean;
  retiredReason?: "item-archived" | "redundant-default";
  displayName?: string;
  description?: string;
  price: {
    source: "inherits" | "overrides" | "site_only" | "none" | "quote_only";
    effective?: CataloguePrice;
    override?: CataloguePrice;
    redundant?: boolean;
  };
  minimum: {
    source: "inherits" | "overrides" | "site_only" | "none";
    effective?: number;
    override?: number;
    redundant?: boolean;
  };
};
export type CatalogueRow = {
  itemId: string;
  version: number;
  name: string;
  category: string;
  description: string;
  status: "active" | "archived";
  routing: {
    state:
      | "in_house"
      | "cpu_hospitality"
      | "cpu_sandwiches"
      | "cpu_delivered_in"
      | "routing_required"
      | "routing_conflict";
    workstreams: string[];
    version: number;
  };
  defaultPrice?: CataloguePrice;
  defaultMinimumQuantity?: number;
  defaultMode?: "standard" | "quote_only";
  defaultMinimumGuests?: number;
  defaultNoticeRequiredDays?: number;
  defaultConfiguration?: Record<string, unknown>;
  offerings: CatalogueOffering[];
  availableAt: string[];
  unavailableAt: string[];
  overrideCount: number;
  needsReview: string[];
  siteCopyOf?: string;
  sourceIds: string[];
  providerMappings: {
    provider: string;
    sourceItemId: string;
    sourceVersion?: string;
  }[];
  dietaryInformation: string[];
  allergenInformation: string[];
  priceMigration: unknown;
};
export type CatalogueSite = { oplocId: string; label: string; active: boolean };
export type CatalogueServiceRule = { categories: string[]; hidden?: boolean };
export type CatalogueServiceLayout = {
  company: { version: number; services: Record<string, CatalogueServiceRule> };
  sites: Record<
    string,
    { version: number; services: Record<string, CatalogueServiceRule> }
  >;
  vocabulary: { catalogueCategories: string[]; seedCategories: string[] };
};
export type CataloguePayload = {
  generatedAt: string;
  canManage: boolean;
  rows: CatalogueRow[];
  oplocs: CatalogueSite[];
  reviewGroups: {
    id: string;
    memberIds: string[];
    reasons: string[];
    decision?: "merge" | "keep_separate" | "defer";
    decidedAt?: string;
    decidedBy?: string;
  }[];
  canonicalisation: {
    itemsAwaitingConsolidation: number;
    mergeGroupsReady: number;
    reviewGroups: number;
  };
  counts: {
    active: number;
    archived: number;
    needsReview: number;
    routingRequired: number;
  };
  serviceLayout?: CatalogueServiceLayout;
};
export type CatalogueBulkItemResult = {
  itemId: string;
  status: "applied" | "unchanged" | "already_applied" | "failed";
  message: string;
};
export type CatalogueBulkCreateItemResult = {
  requestId: string;
  name: string;
  itemId?: string;
  status: "applied" | "already_applied" | "failed";
  message: string;
};
export type CatalogueBulkResult<T = CatalogueBulkItemResult> = {
  operationId: string;
  results: T[];
  succeeded: number;
  failed: number;
  message: string;
};
export type CatalogueCommand = Record<string, unknown> & { action: string };
export type CatalogueCommandResult = {
  message: string;
  package: "published" | "unchanged" | "stale";
  rows?: CatalogueRow[];
  payload?: CataloguePayload;
  serviceLayoutStored?: Pick<CatalogueServiceLayout, "company" | "sites">;
  bulk?: CatalogueBulkResult;
  bulkCreate?: CatalogueBulkResult<CatalogueBulkCreateItemResult>;
};
export type CatalogueSend = (
  command: CatalogueCommand,
) => Promise<CatalogueCommandResult>;
