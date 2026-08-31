import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CatalogueEntry } from "./catalogue";
import { listCatalogueEntries } from "./catalogue";
import { cataloguePackageStore, dataset, manifestKey, recordSnapshotAccess } from "./catalogue-package-store";
import { getPublishedCatalogueManifest } from "./catalogue-manifest";

export type CatalogueReadPackage = { entries: CatalogueEntry[]; categories: string[] };
let publicationInFlight: Promise<ReadPackageManifest> | undefined;

export async function publishCataloguePackage(entries: CatalogueEntry[]): Promise<ReadPackageManifest> {
  if (publicationInFlight) return publicationInFlight;
  publicationInFlight = (async () => {
    const store = cataloguePackageStore();
    const previous = await store.getManifest(manifestKey);
    const version = Math.max(previous?.packageVersion || 0, (await getPublishedCatalogueManifest()).catalogueVersion || 0) + 1;
    const value: CatalogueReadPackage = { entries, categories: [...new Set(entries.map(entry => entry.category))].sort() };
    const encoded = encodeReadPackage(dataset, version, value, entries.length, { contractVersion: "menu-planning.catalogue.v1", sourceVersion: `catalogue-v${version}` });
    return publishReadPackage<CatalogueReadPackage>(store, manifestKey, encoded);
  })().finally(() => { publicationInFlight = undefined; });
  return publicationInFlight;
}

export async function getCatalogueReadPackage(): Promise<{ value: CatalogueReadPackage; manifest: ReadPackageManifest }> {
  const store = cataloguePackageStore();
  let retrieved = await retrieveReadPackage<CatalogueReadPackage>(store, manifestKey);
  if (!retrieved) {
    const entries = await listCatalogueEntries();
    const manifest = await publishCataloguePackage(entries);
    retrieved = await retrieveReadPackage<CatalogueReadPackage>(store, manifestKey);
    if (!retrieved) throw Object.assign(new Error(`Catalogue package v${manifest.packageVersion} is unavailable.`), { status: 503, code: "CATALOGUE_PACKAGE_MISSING" });
  }
  const startedAt = Date.now();
  recordSnapshotAccess("catalogue.snapshot", retrieved.manifest);
  recordDataAccess({ app: "menu-planning", operation: "catalogue.snapshot.metadata", source: "SNAPSHOT", documents: retrieved.manifest.recordCount, cacheHit: false, durationMs: Date.now() - startedAt });
  return retrieved;
}
