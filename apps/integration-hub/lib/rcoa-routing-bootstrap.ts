import { RCOA_MENU_ITEM_PREFIX } from "./rcoa-cpu-routing";

/**
 * One-time bootstrap: copy the transitional legacy routing decisions onto the equivalent RCoA canonical Menu Items as GOVERNED
 * records. Identity is the stable source key matched EXACTLY against the MNK catalogue (never display names, categories or row order).
 * Only keys the legacy map actually classifies receive a record; every other RCoA item stays Unclassified (no record). Existing
 * governed records are never overwritten.
 */
export type BootstrapCatalogueItem = { sourceItemId: string; name: string; category?: string; canonicalId?: string };
export type RcoaRoutingBootstrapPlan = {
  matchedByStableKey: string[];
  unmatchedKeys: string[];
  create: Array<{ canonicalId: string; sourceItemId: string; name: string; workstreams: string[] }>;
  conflicts: Array<{ canonicalId: string; existing: string[]; legacy: string[] }>;
  alreadyGoverned: string[];
  unclassified: Array<{ sourceItemId: string; name: string; reason: string }>;
  identityNotes: Array<{ sourceItemId: string; note: string }>;
};

export function planRcoaRoutingBootstrap(input: {
  legacy: Readonly<Record<string, readonly string[]>>;
  rcoaItems: readonly BootstrapCatalogueItem[];
  mnkItems: readonly BootstrapCatalogueItem[];
  existing: Readonly<Record<string, readonly string[]>>;
}): RcoaRoutingBootstrapPlan {
  const mnk = new Map(input.mnkItems.map((item) => [item.sourceItemId, item]));
  const plan: RcoaRoutingBootstrapPlan = { matchedByStableKey: [], unmatchedKeys: [], create: [], conflicts: [], alreadyGoverned: [], unclassified: [], identityNotes: [] };
  for (const item of input.rcoaItems) {
    const canonicalId = item.canonicalId || `${RCOA_MENU_ITEM_PREFIX}${item.sourceItemId}`;
    const counterpart = mnk.get(item.sourceItemId);
    if (!counterpart) {
      plan.unmatchedKeys.push(item.sourceItemId);
      plan.unclassified.push({ sourceItemId: item.sourceItemId, name: item.name, reason: "no exact stable-key match in the MNK catalogue (explicit manual decision needed)" });
      continue;
    }
    plan.matchedByStableKey.push(item.sourceItemId);
    if (counterpart.name !== item.name) plan.identityNotes.push({ sourceItemId: item.sourceItemId, note: `name differs: MNK "${counterpart.name}" vs RCoA "${item.name}"` });
    if (counterpart.category && item.category && counterpart.category !== item.category) plan.identityNotes.push({ sourceItemId: item.sourceItemId, note: `category differs: MNK "${counterpart.category}" vs RCoA "${item.category}"` });
    const legacy = input.legacy[item.sourceItemId];
    const existing = input.existing[canonicalId];
    if (existing) {
      if (legacy && JSON.stringify([...existing].sort()) !== JSON.stringify([...legacy].sort())) plan.conflicts.push({ canonicalId, existing: [...existing], legacy: [...legacy] });
      else plan.alreadyGoverned.push(canonicalId);
      continue;
    }
    if (legacy?.length) plan.create.push({ canonicalId, sourceItemId: item.sourceItemId, name: item.name, workstreams: [...legacy] });
    else plan.unclassified.push({ sourceItemId: item.sourceItemId, name: item.name, reason: "exact MNK match, but the legacy map holds no decision for it" });
  }
  return plan;
}
