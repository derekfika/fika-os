import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CatalogueEntry } from "./catalogue";
import { cataloguePackageStore, dataset, manifestKey, recordSnapshotAccess } from "./catalogue-package-store";
import type { ReadPackageStore } from "@fika/server-shared/read-package";
import { ensureCatalogueSourceIdentity, getCatalogueManifest, markCataloguePackageCurrent, markCataloguePackageFailed, type CatalogueManifest } from "./catalogue-manifest";
import { catalogueSourceHash, catalogueSourceVersion } from "./catalogue-source";

export type CatalogueReadPackage = { entries: CatalogueEntry[]; categories: string[] };
let publicationInFlight: Promise<ReadPackageManifest> | undefined;

async function rebuildCataloguePackage(store: ReadPackageStore) {
  const { listCatalogueEntries } = await import("./catalogue");
  const entries = await listCatalogueEntries();
  const source = await getCatalogueManifest();
  let sourceRevision = source.sourceRevision || source.catalogueVersion || 1;
  let sourceHash = source.sourceHash;
  if (!sourceHash) {
    const { listCanonicalMenuItems } = await import("./canonical-menu-repository");
    sourceHash = catalogueSourceHash(await listCanonicalMenuItems());
    await ensureCatalogueSourceIdentity({ sourceRevision, sourceHash }, entries.length);
  }
  const sourceIdentity = { sourceRevision, sourceHash };
  try {
    const manifest = await publishCataloguePackage(entries, store, sourceIdentity);
    if (!packageManifestHasSourceIdentity(manifest, sourceIdentity)) throw Object.assign(new Error("The materialised Menu Planning catalogue package does not match its source revision."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
    const current = await markCataloguePackageCurrent(sourceIdentity, manifest);
    if (!current) throw Object.assign(new Error("The Menu Planning catalogue changed while its package was being materialised."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
    return manifest;
  } catch (error) {
    await markCataloguePackageFailed(sourceIdentity, error);
    throw error;
  }
}

export async function publishCataloguePackage(entries: CatalogueEntry[], targetStore: ReadPackageStore = cataloguePackageStore(), expectedSource?: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">): Promise<ReadPackageManifest> {
  if (publicationInFlight) return publicationInFlight;
  publicationInFlight = (async () => {
    const source = expectedSource || await getCatalogueManifest();
    if (source.sourceRevision === undefined || !source.sourceHash) throw Object.assign(new Error("The Menu Planning catalogue source revision is unavailable."), { status: 503, code: "CATALOGUE_SOURCE_UNAVAILABLE" });
    const version = source.sourceRevision;
    const value: CatalogueReadPackage = { entries, categories: [...new Set(entries.map(entry => entry.category))].sort() };
    const encoded = encodeReadPackage(dataset, version, value, entries.length, { contractVersion: "menu-planning.catalogue.v1", sourceVersion: catalogueSourceVersion(source.sourceRevision, source.sourceHash), sourceHash: source.sourceHash });
    return publishReadPackage<CatalogueReadPackage>(targetStore, manifestKey, encoded);
  })().finally(() => { publicationInFlight = undefined; });
  return publicationInFlight;
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

/** Publish a package for a known source state and leave failures observable in the source manifest. */
export async function materialiseCataloguePackage(entries: CatalogueEntry[], source: Pick<CatalogueManifest, "sourceRevision" | "sourceHash">, targetStore: ReadPackageStore = cataloguePackageStore()): Promise<CataloguePackageMaterialisation> {
  const sourceRevision = source.sourceRevision;
  const sourceHash = source.sourceHash;
  if (sourceRevision === undefined || !sourceHash) throw Object.assign(new Error("The Menu Planning catalogue source revision is unavailable."), { status: 503, code: "CATALOGUE_SOURCE_UNAVAILABLE" });
  const sourceIdentity = { sourceRevision, sourceHash };
  try {
    const manifest = await publishCataloguePackage(entries, targetStore, sourceIdentity);
    if (!packageManifestHasSourceIdentity(manifest, sourceIdentity)) throw Object.assign(new Error("The materialised Menu Planning catalogue package does not match its source revision."), { status: 503, code: "CATALOGUE_PACKAGE_STALE" });
    const current = await markCataloguePackageCurrent(sourceIdentity, manifest);
    return current ? { status: "current", manifest } : { status: "stale", manifest };
  } catch (error) {
    await markCataloguePackageFailed(sourceIdentity, error);
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
