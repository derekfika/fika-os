/** Read metadata only. Saved RollingEntry identity, label, slot and quantities remain authoritative. */
export type DishReference = {
  entryId: string;
  requestedId?: string;
  state: "active" | "archived" | "merged" | "unresolved";
  classification?: { category: string; subcategory?: string };
  successor?: { id: string; name: string; category: string; subcategory?: string };
  reason?: "missing_id" | "not_found" | "archive_unavailable" | "mapping_unverified" | "integrity_failed";
  provenance: {
    catalogueRevision?: number;
    catalogueSourceHash?: string;
    archiveId?: string;
    archiveDigest?: string;
    mappingVersion?: number;
    mappingDigest?: string;
  };
};

export type DishReferences = {
  schemaVersion: "menu-planning.dish-references.v1";
  weekId: string;
  weekVersion: number;
  byEntryId: Record<string, DishReference>;
};

/** Future cutover writers bind this descriptor to the target catalogue manifest. No reader creates it. */
export type HistoricalDishReferenceDescriptor = {
  archiveId: string;
  /** Digest of the canonical old-ID -> immutable archived-document digest index. */
  archiveDigest: string;
  mappingVersion: number;
  /** Digest of the canonical old-ID -> immutable successor-document digest index. */
  mappingDigest: string;
};

/**
 * Stored as `referenceManifest` on the immutable CatalogueArchives/{archiveId} root.
 * `catalogueRevision`/`catalogueSourceHash` are the cutover revision the archive was sealed at. They are a monotonic lower bound,
 * not an equality requirement: the live manifest may legitimately advance after cutover (routine catalogue edits) while the
 * descriptor is retained. Binding to the archive is by the digests; a live revision below this one fails closed.
 */
export type HistoricalDishReferenceManifest = HistoricalDishReferenceDescriptor & {
  schemaVersion: 1;
  catalogueRevision: number;
  catalogueSourceHash: string;
  dishHashes: Record<string, string>;
  mappingHashes: Record<string, string>;
};

/** Stored under CatalogueArchives/{archiveId}/successors/{fromId}; names never establish this mapping. */
export type HistoricalDishSuccessor = {
  fromId: string;
  toId: string;
  decisionId: string;
  decidedBy: string;
  decidedAt: string;
};
