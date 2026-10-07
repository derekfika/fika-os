import type { MenuItem } from "./domain";
import { stableHash } from "./fika-contracts";

export const CATALOGUE_SOURCE_SCHEMA_VERSION = 1 as const;
export const CATALOGUE_SOURCE_HASH_VERSION = 2 as const;

function orderedJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(orderedJson);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, orderedJson((value as Record<string, unknown>)[key])]));
  return value;
}

/**
 * The source hash is over the authoritative canonical records, ordered by
 * stable identity. It deliberately excludes package metadata so a package can
 * prove exactly which source state it materialises.
 */
export function catalogueSourceHash(items: readonly MenuItem[]) {
  return stableHash(orderedJson(JSON.parse(JSON.stringify({
    schemaVersion: CATALOGUE_SOURCE_SCHEMA_VERSION,
    items: items.slice().sort((left, right) => left.canonicalId.localeCompare(right.canonicalId)),
  }))));
}

export function catalogueSourceVersion(sourceRevision: number, sourceHash: string) {
  return `catalogue-r${sourceRevision}-${sourceHash}`;
}
