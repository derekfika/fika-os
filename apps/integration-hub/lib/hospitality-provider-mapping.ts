import { hospitalityCatalogues } from "@fika/server-shared/hospitality-catalogue";
import type { CanonicalRecord } from "./types";

export type ProviderItemLink = {
  itemId: string; expectedVersion: number; provider: string; sourceItemId: string; sourceVersion?: string;
};
const providers = {
  "cfc-hospitality-brochure": "cfc",
  "munich-re-generic-brochure": "munich-re",
} as const;
const fail = (message: string, status = 422): never => { throw Object.assign(new Error(message), { status }); };
const active = (item: CanonicalRecord) => item.entityType === "Hospitality Menu Item" && item.lifecycleStatus !== "archived" && item.publicationStatus !== "withdrawn" && item.record.lifecycleState === "active";
const mappings = (item: CanonicalRecord) => Array.isArray(item.record.providerMappings) ? item.record.providerMappings as Array<Record<string, unknown>> : [];

/** Explicit stable-ID association only. This never selects an Item, price, route or recipe by name. */
export function planProviderItemLink(items: CanonicalRecord[], input: ProviderItemLink) {
  const site = providers[input.provider as keyof typeof providers];
  if (!site) return fail("Only the governed CFC and Munich RE catalogue providers can be linked here.");
  const rows = hospitalityCatalogues[site].items.filter(row => row.source.provider === input.provider && row.source.sourceItemId === input.sourceItemId && row.lifecycleState === "active");
  if (rows.length !== 1) return fail("Choose one active, known provider source item.");
  const target = items.find(item => item.canonicalId === input.itemId);
  if (!target || !active(target)) return fail("Choose an active canonical Hospitality Item.", 409);
  if (!Number.isInteger(input.expectedVersion) || Number(target.record.version) !== input.expectedVersion) return fail("The catalogue Item changed elsewhere. Reload before linking.", 409);
  const same = (mapping: Record<string, unknown>) => mapping.provider === input.provider && mapping.sourceItemId === input.sourceItemId;
  const holders = items.filter(item => active(item) && mappings(item).some(same));
  if (holders.some(item => item.canonicalId !== target.canonicalId)) return fail("This provider source item is already linked to another active canonical Item.", 409);
  const prior = mappings(target);
  if (prior.filter(same).length > 1) return fail("The existing source mapping is duplicated; resolve its integrity before linking.", 409);
  if (prior.some(same)) return { item: target, unchanged: true, providerMappings: prior };
  return { item: target, unchanged: false, providerMappings: [...prior, { provider: input.provider, sourceItemId: input.sourceItemId, ...(input.sourceVersion ? { sourceVersion: input.sourceVersion } : {}) }] };
}
