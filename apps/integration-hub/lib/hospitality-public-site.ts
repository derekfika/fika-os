import type { CanonicalRecord } from "./types";

export const PUBLIC_HOSPITALITY_SITE_KEYS = ["cfc", "munich-re"] as const;
export type PublicHospitalitySiteKey = typeof PUBLIC_HOSPITALITY_SITE_KEYS[number];

/** Public catalogues expose a destination only through the fixed portal key's exact confirmed mapping. */
export function resolvePublicHospitalityOploc(site: string, mappings: Array<Record<string, unknown>>, records: CanonicalRecord[]): string | undefined {
  if (!(PUBLIC_HOSPITALITY_SITE_KEYS as readonly string[]).includes(site)) return undefined;
  const candidates = mappings.filter(mapping => mapping.sourceIdentifier === site && mapping.sourceEntityType === "provider-location" && mapping.mappingStatus === "confirmed");
  if (candidates.length !== 1) return undefined;
  const target = candidates[0]!.targetCanonicalId || candidates[0]!.oplocId;
  if (typeof target !== "string" || !target) return undefined;
  const active = records.filter(record => record.canonicalId === target && record.entityType === "OPLOC" && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && record.record.lifecycleState === "active");
  return active.length === 1 ? target : undefined;
}
