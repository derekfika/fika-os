import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CatalogueEntry } from "./catalogue";
import { cataloguePackageStore, dataset, manifestKey, recordSnapshotAccess } from "./catalogue-package-store";
import type { ReadPackageStore } from "@fika/server-shared/read-package";
import { getCatalogueManifest, getPublishedCatalogueManifest } from "./catalogue-manifest";

export type CatalogueReadPackage = { entries: CatalogueEntry[]; categories: string[] };
let publicationInFlight: Promise<ReadPackageManifest> | undefined;

async function rebuildCataloguePackage(store: ReadPackageStore) {
  const { listCatalogueEntries } = await import("./catalogue");
  const entries = await listCatalogueEntries();
  return publishCataloguePackage(entries, store);
}

export async function publishCataloguePackage(entries: CatalogueEntry[], targetStore: ReadPackageStore = cataloguePackageStore()): Promise<ReadPackageManifest> {
  if (publicationInFlight) return publicationInFlight;
  publicationInFlight = (async () => {
    const previous = await targetStore.getManifest(manifestKey);
    const version = Math.max(previous?.packageVersion || 0, (await getPublishedCatalogueManifest()).catalogueVersion || 0) + 1;
    const value: CatalogueReadPackage = { entries, categories: [...new Set(entries.map(entry => entry.category))].sort() };
    const encoded = encodeReadPackage(dataset, version, value, entries.length, { contractVersion: "menu-planning.catalogue.v1", sourceVersion: `catalogue-v${version}` });
    return publishReadPackage<CatalogueReadPackage>(targetStore, manifestKey, encoded);
  })().finally(() => { publicationInFlight = undefined; });
  return publicationInFlight;
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
    if (sourceManifest.catalogueVersion > retrieved.manifest.packageVersion) {
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
