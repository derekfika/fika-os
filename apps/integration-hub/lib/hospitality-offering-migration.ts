/**
 * Legacy Offering -> sparse exception migration planning (pure; no I/O). Nothing here writes.
 *
 * Model: availability is the DEFAULT at every active OPLOC; a stored Offering record is only a SPARSE EXCEPTION. A legacy Offering that
 * states nothing beyond the company defaults has no effect and is retired (archived, kept for history, never deleted). A legacy Offering
 * that carries a genuine site difference is KEPT as the exception, with its original id so historical references stay valid.
 */
import type { CanonicalRecord } from "./types";
import { buildCatalogueRows } from "./hospitality-catalogue-read-model";
import type { CatalogueSnapshot } from "./hospitality-catalogue-canonicalisation";

export const BULK_ALL_SITES_ACTOR = "migration:hospitality-all-sites";
export const BULK_CREATED_REASON = "Offering created by bulk operation (inherits company defaults).";

export type RevisionEvidence = { canonicalId: string; version: number; actorId: string; reason: string };
export type ReceiptEvidence = { entityReference: string; action: string; actorId: string; details?: { bulkOperationId?: string; oplocIds?: string[] } };
export type MigrationInput = CatalogueSnapshot & { prices: CanonicalRecord[]; oplocs: Array<{ oplocId: string; active: boolean }>; revisions: RevisionEvidence[]; receipts: ReceiptEvidence[]; today?: string };

export type ExceptionReason = "site unavailable" | "site price override" | "site minimum override" | "site wording" | "quote-only at this site" | "operational-area scope" | "notice/guests constraint" | "booking configuration" | "price with no company default";
export type OfferingVerdict = { offeringId: string; itemId: string; oplocId: string; version: number; verdict: "redundant" | "exception"; reasons: ExceptionReason[]; bulkCreated: boolean };
export type MigrationPlan = {
  verdicts: OfferingVerdict[];
  /** Offerings created by the all-sites bulk operation purely to state default availability: identified by revision evidence AND matching receipt, never by timestamp. */
  bulkCreatedRedundant: OfferingVerdict[];
  bulkCreatedNotRedundant: OfferingVerdict[];
  legacyRedundant: OfferingVerdict[];
  exceptions: OfferingVerdict[];
  /** Active Offerings that point at an archived Item (an archived Item must have no active effective availability). */
  archivedItemOfferings: Array<{ offeringId: string; itemId: string; oplocId: string; version: number }>;
  summary: Record<string, number>;
};

export function planOfferingMigration(input: MigrationInput, bulkOperationId?: string): MigrationPlan {
  const today = input.today;
  const { rows } = buildCatalogueRows({ items: input.items, offerings: input.offerings, prices: input.prices, routing: input.routing, merges: input.merges, oplocs: input.oplocs, ...(today ? { today } : {}) });
  const rowById = new Map(rows.map(row => [row.itemId, row]));
  const itemById = new Map(input.items.map(item => [item.canonicalId, item]));
  const recordById = new Map(input.offerings.map(offering => [offering.canonicalId, offering]));
  const createdByBulk = new Set(input.revisions.filter(revision => revision.version === 1 && revision.actorId === BULK_ALL_SITES_ACTOR && revision.reason === BULK_CREATED_REASON).map(revision => revision.canonicalId));
  const receiptSites = new Map<string, Set<string>>();
  for (const receipt of input.receipts) if (receipt.action === "Hospitality Catalogue bulk update" && receipt.actorId === BULK_ALL_SITES_ACTOR && (!bulkOperationId || receipt.details?.bulkOperationId === bulkOperationId)) receiptSites.set(receipt.entityReference, new Set([...(receiptSites.get(receipt.entityReference) || []), ...(receipt.details?.oplocIds || [])]));

  const verdicts: OfferingVerdict[] = [];
  for (const row of rows.filter(candidate => candidate.status === "active")) {
    for (const view of row.offerings.filter(candidate => candidate.status === "active")) {
      const record = recordById.get(view.offeringId)!.record; const reasons: ExceptionReason[] = [];
      if (!view.available) reasons.push("site unavailable");
      if (view.price.source === "overrides" && !view.price.redundant) reasons.push("site price override"); else if (view.price.source === "site_only") reasons.push("price with no company default");
      if ((view.minimum.source === "overrides" && !view.minimum.redundant) || view.minimum.source === "site_only") reasons.push("site minimum override");
      if (view.displayName || view.description) reasons.push("site wording");
      if (view.mode !== (itemById.get(row.itemId)?.record.defaultOfferingMode === "quote_only" ? "quote_only" : "standard")) reasons.push("quote-only at this site");
      if (view.operationalAreaId) reasons.push("operational-area scope");
      const owner = itemById.get(row.itemId)!.record;
      if ((record.minimumGuests !== undefined && record.minimumGuests !== owner.defaultMinimumGuests) || (record.noticeRequiredDays !== undefined && record.noticeRequiredDays !== owner.defaultNoticeRequiredDays)) reasons.push("notice/guests constraint");
      const configuration = (record.configuration || {}) as Record<string, unknown>;
      if (Object.keys(productConfiguration(record)).length && JSON.stringify(productConfiguration(record)) !== JSON.stringify(owner.configuration)) reasons.push("booking configuration");
      const evidence = createdByBulk.has(view.offeringId) && Boolean(receiptSites.get(row.itemId)?.has(view.oplocId));
      verdicts.push({ offeringId: view.offeringId, itemId: row.itemId, oplocId: view.oplocId, version: view.version, verdict: view.noEffect && reasons.length === 0 ? "redundant" : "exception", reasons, bulkCreated: evidence });
    }
  }
  const bulkCreated = verdicts.filter(verdict => verdict.bulkCreated);
  const archivedItemOfferings = input.offerings.filter(offering => offering.record.lifecycleState !== "archived" && rowById.get(String(offering.record.hospitalityMenuItemId))?.status === "archived")
    .map(offering => ({ offeringId: offering.canonicalId, itemId: String(offering.record.hospitalityMenuItemId), oplocId: String(offering.record.oplocId), version: Number(offering.record.version || 1) }));
  const plan: MigrationPlan = {
    verdicts, bulkCreatedRedundant: bulkCreated.filter(verdict => verdict.verdict === "redundant" && verdict.version === 1), bulkCreatedNotRedundant: bulkCreated.filter(verdict => verdict.verdict !== "redundant" || verdict.version !== 1),
    legacyRedundant: verdicts.filter(verdict => !verdict.bulkCreated && verdict.verdict === "redundant"), exceptions: verdicts.filter(verdict => verdict.verdict === "exception"), archivedItemOfferings, summary: {},
  };
  plan.summary = { activeOfferingRecords: verdicts.length, bulkCreatedIdentified: bulkCreated.length, bulkCreatedRedundantToRetire: plan.bulkCreatedRedundant.length, bulkCreatedKept: plan.bulkCreatedNotRedundant.length, legacyRedundantRecords: plan.legacyRedundant.length, genuineExceptions: plan.exceptions.length, activeOfferingsOnArchivedItems: archivedItemOfferings.length };
  return plan;
}

// ---------------------------------------------------------------------------------------------------------------------
// PROMOTION of product-level booking settings (configuration/choices, notice days, minimum guests, quote-only mode) from legacy site
// Offerings to the canonical Item. Business decision: MNK has no special Hospitality product behaviour, so its product settings ARE the
// company defaults. Deterministic when every Offering of an Item that states a value states the SAME value; conflicts are never guessed.
// Prices, minimums and site wording are NOT product settings and are never promoted here.
// ---------------------------------------------------------------------------------------------------------------------
export type PromotionEntry = { itemId: string; itemVersion: number; status: "deterministic" | "conflict"; configuration?: Record<string, unknown>; noticeRequiredDays?: number; minimumGuests?: number; minimumQuantity?: number; mode?: "quote_only"; sourceOfferingIds: string[]; conflicts: string[] };
export const productConfiguration = (record: Record<string, unknown>) => { const rest = { ...((record.configuration || {}) as Record<string, unknown>) }; delete rest.displayName; delete rest.description; return rest; };
export function planConfigurationPromotion(input: Pick<MigrationInput, "items" | "offerings">): PromotionEntry[] {
  const out: PromotionEntry[] = [];
  for (const item of input.items.filter(candidate => candidate.record.lifecycleState !== "archived")) {
    const sources = input.offerings.filter(offering => offering.record.hospitalityMenuItemId === item.canonicalId && offering.record.lifecycleState !== "archived" && offering.record.available !== false && !offering.record.operationalAreaId);
    // A minimum quantity is promoted only where the Item has NO company default minimum (it is then the only stated value); a differing minimum stays a site exception.
    const promotesMinimum = item.record.defaultMinimumQuantity === undefined;
    const withSettings = sources.filter(offering => Object.keys(productConfiguration(offering.record)).length || offering.record.noticeRequiredDays !== undefined || offering.record.minimumGuests !== undefined || offering.record.offeringMode === "quote_only" || (promotesMinimum && offering.record.minimumQuantity !== undefined));
    if (!withSettings.length) continue;
    const conflicts: string[] = []; const distinct = (values: unknown[]) => new Set(values.map(value => JSON.stringify(value)));
    const configs = withSettings.map(offering => productConfiguration(offering.record)).filter(value => Object.keys(value).length); if (distinct(configs).size > 1) conflicts.push("configuration differs between sites");
    const notices = withSettings.map(offering => offering.record.noticeRequiredDays).filter(value => value !== undefined); if (distinct(notices).size > 1) conflicts.push("notice days differ between sites");
    const guests = withSettings.map(offering => offering.record.minimumGuests).filter(value => value !== undefined); if (distinct(guests).size > 1) conflicts.push("minimum guests differ between sites");
    const minimums = promotesMinimum ? withSettings.map(offering => offering.record.minimumQuantity).filter(value => value !== undefined) : []; if (distinct(minimums).size > 1) conflicts.push("minimum quantity differs between sites");
    const quote = sources.filter(offering => offering.record.offeringMode === "quote_only").length; if (quote && quote !== sources.length) conflicts.push("booking mode differs between sites");
    out.push({ itemId: item.canonicalId, itemVersion: Number(item.record.version || 1), status: conflicts.length ? "conflict" : "deterministic", ...(configs[0] ? { configuration: configs[0] } : {}), ...(notices[0] !== undefined ? { noticeRequiredDays: notices[0] as number } : {}), ...(guests[0] !== undefined ? { minimumGuests: guests[0] as number } : {}), ...(minimums[0] !== undefined ? { minimumQuantity: minimums[0] as number } : {}), ...(quote && quote === sources.length ? { mode: "quote_only" as const } : {}), sourceOfferingIds: withSettings.map(offering => offering.canonicalId), conflicts });
  }
  return out;
}
