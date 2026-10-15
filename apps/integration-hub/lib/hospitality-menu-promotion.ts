import { parseCanonical } from "./schemas";
import { sha256 } from "./profiler";
import type { CanonicalRecord } from "./types";

/**
 * Promotes a Hospitality platform's brochure (RCoA, Angel Court, CFC, Munich Re, ...) into canonical Hospitality Menu Items so each item can be
 * governed (Production visibility) in Hub. Deterministic and idempotent: identity is the brochure's own canonical id
 * `hospitality-menu-item:<platform>:<stable platform-specific source key>`; the source key is also kept in `ownership.providerOwned.sourceItemId`.
 * Promotion NEVER creates routing records, so promoted items show Unclassified until someone decides.
 *
 * `providerMappings` is deliberately EMPTY. The booking price validator (`hospitality-price-trust.ts`) prefers a canonical item that carries a
 * provider mapping for the portal, and canonical Menu Items hold no price or option groups (the schema is strict; prices live on Offering/Price
 * records). Mapping a platform now would make its bookings fail with "catalogue price unavailable". Without a mapping, bookings keep pricing and
 * validating from the versioned server brochure exactly as before, and routing binds by the derived canonical id.
 */
export type BrochureItem = {
  canonicalId: string;
  source: { provider: string; sourcePath: string; sourceItemId: string };
  name: string;
  description?: string;
  category: string;
  dietaryInformation: readonly string[];
  allergenInformation: readonly string[];
  lifecycleState: string;
};

export const promotionActor = (platform: string) => `migration:${platform}-brochure-promotion`;

export function buildCanonicalMenuItem(item: BrochureItem, now: string, platform = "rcoa"): CanonicalRecord {
  const actor = promotionActor(platform);
  const record = {
    schemaVersion: "0.1.0",
    version: 1,
    createdAt: now,
    createdBy: actor,
    updatedAt: now,
    updatedBy: actor,
    active: true,
    externalIdentities: [],
    provenanceIds: [`portal-catalogue:${item.source.provider}`],
    ownership: { providerOwned: { sourcePath: item.source.sourcePath, sourceItemId: item.source.sourceItemId }, fikaOwned: {} },
    entityType: "Hospitality Menu Item" as const,
    canonicalId: item.canonicalId,
    name: item.name,
    ...(item.description ? { description: item.description } : {}),
    category: item.category,
    lifecycleState: item.lifecycleState as "active" | "archived",
    dietaryInformation: [...item.dietaryInformation],
    allergenInformation: [...item.allergenInformation],
    providerMappings: [],
  };
  const parsed = parseCanonical("Hospitality Menu Item", record);
  if (!parsed.success) throw new Error(`${item.canonicalId} is not schema-valid: ${parsed.error.issues[0]?.message || "unknown error"}`);
  return { canonicalId: item.canonicalId, entityType: "Hospitality Menu Item", record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "published", publicationStatus: "published", publishedAt: now };
}

export type PromotionExisting = { canonicalId: string; name: string; category: string; sourceItemId?: string };
export type PromotionPlan = { create: BrochureItem[]; reused: string[]; conflicts: Array<{ canonicalId: string; reason: string }>; skipped: Array<{ canonicalId: string; reason: string }> };

/** Idempotent plan: create what is missing, reuse what is already the same identity, report (never overwrite) anything that differs. */
export function planBrochurePromotion(items: readonly BrochureItem[], existing: ReadonlyMap<string, PromotionExisting>): PromotionPlan {
  const plan: PromotionPlan = { create: [], reused: [], conflicts: [], skipped: [] };
  const seen = new Set<string>();
  for (const item of items) {
    if (item.lifecycleState !== "active") { plan.skipped.push({ canonicalId: item.canonicalId, reason: "not an active brochure item" }); continue; }
    if (seen.has(item.canonicalId)) { plan.conflicts.push({ canonicalId: item.canonicalId, reason: "duplicate canonical id in the brochure" }); continue; }
    seen.add(item.canonicalId);
    const found = existing.get(item.canonicalId);
    if (!found) { plan.create.push(item); continue; }
    if (found.name !== item.name || found.category !== item.category || (found.sourceItemId && found.sourceItemId !== item.source.sourceItemId))
      plan.conflicts.push({ canonicalId: item.canonicalId, reason: `existing record differs (${found.name} / ${found.category})` });
    else plan.reused.push(item.canonicalId);
  }
  return plan;
}
