import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { catalogueEntriesForItems, type CatalogueEntry } from "./catalogue";
import { cataloguePackageStore, dataset, manifestKey, recordSnapshotAccess } from "./catalogue-package-store";
import type { ReadPackageStore } from "@fika/server-shared/read-package";
import { ensureCatalogueSourceIdentity, getCatalogueManifest, markCataloguePackageCurrent, markCataloguePackageFailed, type CatalogueManifest } from "./catalogue-manifest";
import { catalogueSourceHash, catalogueSourceVersion } from "./catalogue-source";
import { listCanonicalMenuItems } from "./canonical-menu-repository";

export type CatalogueReadPackage = { entries: CatalogueEntry[]; categories: string[] };
const publicationInFlight = new Map<string, Promise<ReadPackageManifest>>();
const storeIds = new WeakMap<object, number>();
let nextStoreId = 1;
const packageStoreId = (store: ReadPackageStore) => {
  const object = store as object;
  const existing = storeIds.get(object);
  if (existing) return existing;
  const id = nextStoreId++;
  storeIds.set(object, id);
  return id;
};

async function rebuildCataloguePackage(store: ReadPackageStore) {
  const source = await getCatalogueManifest();
  const result = await materialiseCataloguePackage(undefined, source, store);
  if (result.status !== "current" || !result.manifest) throw result.error || Object.assign(new Error("The Menu Planning catalogue package could not be rebuilt for the authoritative source."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
  return result.manifest;
}

export async function publishCataloguePackage(entries: CatalogueEntry[], targetStore: ReadPackageStore = cataloguePackageStore(), expectedSource?: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">): Promise<ReadPackageManifest> {
  const source = expectedSource || await getCatalogueManifest();
  if (source.sourceRevision === undefined || !source.sourceHash) throw Object.assign(new Error("The Menu Planning catalogue source revision is unavailable."), { status: 503, code: "CATALOGUE_SOURCE_UNAVAILABLE" });
  const sourceRevision = source.sourceRevision;
  const sourceHash = source.sourceHash;
  const key = `${packageStoreId(targetStore)}:${sourceRevision}:${sourceHash}`;
  const existing = publicationInFlight.get(key);
  if (existing) return existing;
  const publication = (async () => {
    const version = sourceRevision;
    const value: CatalogueReadPackage = { entries, categories: [...new Set(entries.map(entry => entry.category))].sort() };
    const encoded = encodeReadPackage(dataset, version, value, entries.length, { contractVersion: "menu-planning.catalogue.v1", sourceVersion: catalogueSourceVersion(sourceRevision, sourceHash), sourceHash });
    return publishReadPackage<CatalogueReadPackage>(targetStore, manifestKey, encoded);
  })();
  publicationInFlight.set(key, publication);
  try { return await publication; } finally { publicationInFlight.delete(key); }
}

export type CataloguePackageMaterialisation = { status: "current" | "failed" | "stale"; manifest?: ReadPackageManifest; error?: unknown };

function packageManifestHasSourceIdentity(manifest: ReadPackageManifest, source: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">) {
  return source.sourceRevision !== undefined && Boolean(source.sourceHash)
    && manifest.packageVersion === source.sourceRevision
    && manifest.sourceHash === source.sourceHash
    && manifest.sourceVersion === catalogueSourceVersion(source.sourceRevision, source.sourceHash!);
}

export function cataloguePackageMatchesSource(packageManifest: ReadPackageManifest, sourceManifest: Pick<CatalogueManifest, "sourceRevision" | "sourceHash" | "packageState">) {
  const sourceRevision = sourceManifest.sourceRevision;
  const sourceHash = sourceManifest.sourceHash;
  const expectedSourceVersion = sourceRevision !== undefined && sourceHash ? catalogueSourceVersion(sourceRevision, sourceHash) : undefined;
  return sourceManifest.packageState?.status === "current" && sourceManifest.packageState.sourceRevision === sourceRevision && sourceManifest.packageState.sourceHash === sourceHash && sourceRevision !== undefined && Boolean(sourceHash) && packageManifest.packageVersion === sourceRevision && packageManifest.sourceHash === sourceHash && packageManifest.sourceVersion === expectedSourceVersion;
}

async function exactMaterialisationInput(sourceInput?: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">) {
  const items = await listCanonicalMenuItems({ fresh: true });
  const actualSourceHash = catalogueSourceHash(items);
  const current = await getCatalogueManifest();
  const sourceRevision = current.sourceRevision || current.catalogueVersion || sourceInput?.sourceRevision || 1;
  const sourceHash = current.sourceHash || actualSourceHash;
  const sourceIdentity = { sourceRevision, sourceHash };
  if (!current.sourceHash) await ensureCatalogueSourceIdentity(sourceIdentity, items.length);
  if (sourceInput && (sourceInput.sourceRevision !== sourceRevision || sourceInput.sourceHash !== sourceHash)) throw Object.assign(new Error("The Menu Planning catalogue changed while its package was being materialised."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
  if (actualSourceHash !== sourceHash) throw Object.assign(new Error("The Menu Planning catalogue changed while its package was being materialised."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
  return { entries: catalogueEntriesForItems(items), sourceIdentity };
}

/** Publish a package only from fresh authoritative records bound to the target source identity. */
export async function materialiseCataloguePackage(_entries: CatalogueEntry[] | undefined, source: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">, targetStore: ReadPackageStore = cataloguePackageStore()): Promise<CataloguePackageMaterialisation> {
  const sourceIdentity = source.sourceRevision !== undefined && source.sourceHash ? { sourceRevision: source.sourceRevision, sourceHash: source.sourceHash } : undefined;
  try {
    const exact = await exactMaterialisationInput(sourceIdentity);
    const manifest = await publishCataloguePackage(exact.entries, targetStore, exact.sourceIdentity);
    if (!packageManifestHasSourceIdentity(manifest, exact.sourceIdentity)) throw Object.assign(new Error("The materialised Menu Planning catalogue package does not match its source revision."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
    const current = await markCataloguePackageCurrent(exact.sourceIdentity, manifest);
    return current ? { status: "current", manifest } : { status: "stale", manifest };
  } catch (error) {
    if ((error as { code?: string }).code === "CATALOGUE_PACKAGE_STALE") return { status: "stale", error };
    if (sourceIdentity) await markCataloguePackageFailed(sourceIdentity, error);
    return { status: "failed", error };
  }
}

export async function getCatalogueReadPackage(store: ReadPackageStore = cataloguePackageStore()): Promise<{ value: CatalogueReadPackage; manifest: ReadPackageManifest }> {
  try {
    const retrieved = await retrieveReadPackage<CatalogueReadPackage>(store, manifestKey);
    if (!retrieved) {
      recordDataAccess({ app: "menu-planning", operation: "catalogue.package-recovery", source: "SNAPSHOT", documents: 0, cacheHit: false });
      await rebuildCataloguePackage(store);
      const recovered = await retrieveReadPackage<CatalogueReadPackage>(store, manifestKey);
      if (!recovered) throw Object.assign(new Error("The Menu Planning catalogue package could not be rebuilt."), { status: 503, code: "CATALOGUE_PACKAGE_UNAVAILABLE" });
      return recovered;
    }
    const sourceManifest = await getCatalogueManifest();
    const sourceMatches = cataloguePackageMatchesSource(retrieved.manifest, sourceManifest);
    if (sourceManifest.catalogueVersion > retrieved.manifest.packageVersion || !sourceMatches) {
      recordDataAccess({ app: "menu-planning", operation: "catalogue.package-refresh", source: "SNAPSHOT", documents: 0, cacheHit: false });
      await rebuildCataloguePackage(store);
      const refreshed = await retrieveReadPackage<CatalogueReadPackage>(store, manifestKey);
      if (!refreshed) throw Object.assign(new Error("The Menu Planning catalogue package could not be refreshed."), { status: 503, code: "CATALOGUE_PACKAGE_UNAVAILABLE" });
      return refreshed;
    }
    const startedAt = Date.now();
    recordSnapshotAccess("catalogue.snapshot", retrieved.manifest);
    recordDataAccess({ app: "menu-planning", operation: "catalogue.snapshot.metadata", source: "SNAPSHOT", documents: retrieved.manifest.recordCount, cacheHit: false, durationMs: Date.now() - startedAt });
    return retrieved;
  } catch (error) {
    if ((error as { code?: string }).code !== "CATALOGUE_PACKAGE_UNAVAILABLE") recordDataAccess({ app: "menu-planning", operation: "catalogue.package-integrity-failure", source: "SNAPSHOT", documents: 0, cacheHit: false });
    throw error;
  }
}
