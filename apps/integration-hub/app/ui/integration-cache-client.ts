import { CACHE_DATASETS, CACHE_STORES, INTEGRATION_CACHE_DB, INTEGRATION_CACHE_SCHEMA_VERSION, type CacheDataset, type CacheManifest } from "@/lib/integration-cache-shared";

type CacheEnvelope = { id: string; dataset: CacheDataset; schemaVersion: number; environment: string; identityScope: string; updatedAt: string; records: unknown[] };
const environmentKey = () => `${window.location.protocol}//${window.location.host}`;

function openCache() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(INTEGRATION_CACHE_DB, INTEGRATION_CACHE_SCHEMA_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      for (const store of CACHE_STORES) if (!database.objectStoreNames.contains(store)) database.createObjectStore(store, { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}

async function read<T>(store: string, id: string): Promise<T | undefined> {
  const database = await openCache();
  return new Promise((resolve, reject) => { const request = database.transaction(store, "readonly").objectStore(store).get(id); request.onsuccess = () => resolve(request.result as T | undefined); request.onerror = () => reject(request.error); });
}
async function readAll<T>(store: string): Promise<T[]> {
  const database = await openCache();
  return new Promise((resolve, reject) => { const request = database.transaction(store, "readonly").objectStore(store).getAll(); request.onsuccess = () => resolve(request.result as T[]); request.onerror = () => reject(request.error); });
}
async function write(store: string, value: unknown) {
  const database = await openCache();
  return new Promise<void>((resolve, reject) => { const request = database.transaction(store, "readwrite").objectStore(store).put(value); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); });
}

export async function readCachedDataset<T>(dataset: CacheDataset, identityScope: string) {
  const store = dataset === "oplocs" ? "canonicalOplocs" : dataset === "legends" ? "legends" : dataset === "serviceDefinitions" ? "serviceDefinitions" : dataset === "equipmentAssets" ? "equipmentAssets" : "referenceEntities";
  const records = await readAll<CacheEnvelope>(store);
  const matching = records.filter(record => record.dataset === dataset && record.schemaVersion === INTEGRATION_CACHE_SCHEMA_VERSION && record.environment === environmentKey() && record.identityScope === identityScope);
  return matching.length ? matching.map(record => record.records[0] as T) : undefined;
}

export async function writeCachedDataset(dataset: CacheDataset, identityScope: string, records: unknown[], updatedAt: string) {
  const store = dataset === "oplocs" ? "canonicalOplocs" : dataset === "legends" ? "legends" : dataset === "serviceDefinitions" ? "serviceDefinitions" : dataset === "equipmentAssets" ? "equipmentAssets" : "referenceEntities";
  const database = await openCache();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(store, "readwrite");
    const objectStore = transaction.objectStore(store);
    objectStore.getAll().onsuccess = event => {
      for (const old of (event.target as IDBRequest<CacheEnvelope[]>).result.filter(record => record.dataset === dataset && record.identityScope === identityScope)) objectStore.delete(old.id);
      for (const record of records) {
        const value = record as { canonicalId?: unknown; id?: unknown };
        const id = String(value.canonicalId || value.id || crypto.randomUUID());
        objectStore.put({ id, dataset, schemaVersion: INTEGRATION_CACHE_SCHEMA_VERSION, environment: environmentKey(), identityScope, updatedAt, records: [record] });
      }
    };
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
}

type CacheMetadata = { id: string; manifests?: CacheManifest[]; overview?: unknown; overviewIdentityScope?: string };
export async function readCachedManifests() { return ((await read<CacheMetadata>("cacheMetadata", "manifests"))?.manifests || []).filter(value => (CACHE_DATASETS as readonly string[]).includes(value.dataset)); }
export async function writeCachedManifests(manifests: CacheManifest[]) { const current = await read<CacheMetadata>("cacheMetadata", "manifests"); await write("cacheMetadata", { ...current, id: "manifests", manifests }); }
export async function readCachedOverview<T>(identityScope: string) { const value = await read<CacheMetadata>("cacheMetadata", "connectionsOverview"); return value?.overviewIdentityScope === identityScope ? value.overview as T | undefined : undefined; }
export async function writeCachedOverview(identityScope: string, overview: unknown) { await write("cacheMetadata", { id: "connectionsOverview", overviewIdentityScope: identityScope, overview }); }

export async function clearIdentityScopedCache(identityScope: string) {
  const database = await openCache();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction([...CACHE_STORES], "readwrite");
    for (const store of CACHE_STORES.filter(value => value !== "cacheMetadata" && value !== "applications")) {
      const request = transaction.objectStore(store).getAll();
      request.onsuccess = () => request.result.filter((record: CacheEnvelope) => record.identityScope === identityScope).forEach((record: CacheEnvelope) => transaction.objectStore(store).delete(record.id));
    }
    transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error);
  });
}

export async function clearIdentityScopedCaches() {
  if (typeof indexedDB === "undefined") return;
  const database = await openCache().catch(() => undefined);
  if (!database) return;
  await new Promise<void>((resolve) => {
    const transaction = database.transaction(["cacheMetadata", "canonicalOplocs", "legends", "serviceDefinitions", "equipmentAssets", "referenceEntities"], "readwrite");
    for (const store of ["canonicalOplocs", "legends", "serviceDefinitions", "equipmentAssets", "referenceEntities"]) transaction.objectStore(store).clear();
    transaction.objectStore("cacheMetadata").clear();
    transaction.oncomplete = () => resolve(); transaction.onerror = () => resolve();
  });
}

export async function revalidateCachedManifests(datasets: CacheDataset[]) {
  const query = datasets.map(dataset => `dataset=${encodeURIComponent(dataset)}`).join("&");
  const response = await fetch(`/api/cache/manifests?${query}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Reference cache manifest could not be checked.");
  const body = await response.json() as { manifests: CacheManifest[] };
  await writeCachedManifests(body.manifests);
  return body.manifests;
}
