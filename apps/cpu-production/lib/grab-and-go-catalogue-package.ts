import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { GRAB_AND_GO_CATALOGUE_CONTRACT, GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION, parseGrabAndGoCatalogue, type GrabAndGoCatalogue, type GrabAndGoProductContract } from "@fika/server-shared/grab-and-go-catalogue";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { cpuPackageStore } from "./cpu-package-store";

export const GRAB_AND_GO_CATALOGUE_DATASET = "snapshots/cpu-production/grab-and-go-catalogue";
export const GRAB_AND_GO_CATALOGUE_MANIFEST_KEY = "cpu-production/grab-and-go/catalogue";
let publicationInFlight: Promise<ReadPackageManifest> | undefined;

export async function publishGrabAndGoCatalogue(products: GrabAndGoProductContract[], store: ReadPackageStore = cpuPackageStore()) {
  const value = parseGrabAndGoCatalogue({ schemaVersion: GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION, products });
  const previous = await store.getManifest(GRAB_AND_GO_CATALOGUE_MANIFEST_KEY);
  const version = (previous?.packageVersion || 0) + 1;
  const encoded = encodeReadPackage(GRAB_AND_GO_CATALOGUE_DATASET, version, value, value.products.length, { schemaVersion: GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION, contractVersion: GRAB_AND_GO_CATALOGUE_CONTRACT, sourceVersion: `grab-and-go-catalogue-v${version}`, scope: "global" });
  return publishReadPackage<GrabAndGoCatalogue>(store, GRAB_AND_GO_CATALOGUE_MANIFEST_KEY, encoded);
}

export async function getGrabAndGoCataloguePackage(store: ReadPackageStore = cpuPackageStore()): Promise<{ value: GrabAndGoCatalogue; manifest: ReadPackageManifest }> {
  const retrieved = await retrieveReadPackage<GrabAndGoCatalogue>(store, GRAB_AND_GO_CATALOGUE_MANIFEST_KEY);
  if (!retrieved) throw Object.assign(new Error("The CPU-owned Grab & Go catalogue package is unavailable."), { status: 503, code: "GRAB_AND_GO_CATALOGUE_UNAVAILABLE" });
  if (retrieved.manifest.schemaVersion !== GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION || retrieved.manifest.contractVersion !== GRAB_AND_GO_CATALOGUE_CONTRACT || retrieved.manifest.scope !== "global") throw Object.assign(new Error("The CPU-owned Grab & Go catalogue package is unsupported."), { status: 502, code: "GRAB_AND_GO_CATALOGUE_UNSUPPORTED" });
  const value = parseGrabAndGoCatalogue(retrieved.value);
  recordDataAccess({ app: "cpu-production", operation: "grab-and-go.catalogue.package", source: "SNAPSHOT", dataset: GRAB_AND_GO_CATALOGUE_DATASET, documents: value.products.length, cacheHit: false });
  return { manifest: retrieved.manifest, value };
}

export async function getGrabAndGoCatalogueManifest(store: ReadPackageStore = cpuPackageStore()) {
  const manifest = await store.getManifest(GRAB_AND_GO_CATALOGUE_MANIFEST_KEY);
  if (!manifest) throw Object.assign(new Error("The CPU-owned Grab & Go catalogue manifest is unavailable."), { status: 503, code: "GRAB_AND_GO_CATALOGUE_UNAVAILABLE" });
  if (manifest.schemaVersion !== GRAB_AND_GO_CATALOGUE_SCHEMA_VERSION || manifest.contractVersion !== GRAB_AND_GO_CATALOGUE_CONTRACT || manifest.scope !== "global") throw Object.assign(new Error("The CPU-owned Grab & Go catalogue manifest is unsupported."), { status: 502, code: "GRAB_AND_GO_CATALOGUE_UNSUPPORTED" });
  recordDataAccess({ app: "cpu-production", operation: "grab-and-go.catalogue.manifest", source: "SNAPSHOT", dataset: GRAB_AND_GO_CATALOGUE_DATASET, documents: manifest.recordCount, cacheHit: false });
  return manifest;
}

export function publishGrabAndGoCatalogueOnce(products: GrabAndGoProductContract[], store?: ReadPackageStore) {
  if (!publicationInFlight) publicationInFlight = publishGrabAndGoCatalogue(products, store).finally(() => { publicationInFlight = undefined; });
  return publicationInFlight;
}
