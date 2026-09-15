import type { MenuItem } from "./domain";
import { stableHash } from "./fika-contracts";

export const CATALOGUE_SOURCE_SCHEMA_VERSION = 1 as const;

/**
 * The source hash is over the authoritative canonical records, ordered by
 * stable identity. It deliberately excludes package metadata so a package can
 * prove exactly which source state it materialises.
 */
export function catalogueSourceHash(items: readonly MenuItem[]) {
  return stableHash({
    schemaVersion: CATALOGUE_SOURCE_SCHEMA_VERSION,
    items: items.slice().sort((left, right) => left.canonicalId.localeCompare(right.canonicalId)),
  });
}

export function catalogueSourceVersion(sourceRevision: number, sourceHash: string) {
  return `catalogue-r${sourceRevision}-${sourceHash}`;
}
