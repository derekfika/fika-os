"use client";

export type CachedCatalogueEntry = Record<string, unknown> & { id: string };
export type CatalogueManifest = { schemaVersion: number; catalogueVersion: number; updatedAt?: string; dishCount?: number };
export type CachedCatalogue = { namespace: string; schemaVersion: number; cachedAt: number; manifestCheckedAt?: number; recordCount: number; entries: CachedCatalogueEntry[]; categories: string[]; manifest?: CatalogueManifest };
export type CatalogueFetchResult = { entries: CachedCatalogueEntry[]; categories?: string[]; identity?: string; manifest?: CatalogueManifest };
export const catalogueManifestMatches = (cached?: CatalogueManifest, current?: CatalogueManifest) => Boolean(cached && current && cached.schemaVersion === current.schemaVersion && cached.catalogueVersion === current.catalogueVersion);

const databaseName = "fika-menu-planning";
const databaseVersion = 2;
const recordStore = "menuCatalogue";
const metadataStore = "cacheMetadata";
const metadataKey = (namespace: string) => `catalogue:${namespace}`;
const schemaVersion = 1;
export const CATALOGUE_CACHE_TTL_MS = 10 * 60_000;

function debug(event: string, details: Record<string, unknown> = {}) {
  try { if (typeof window !== "undefined" && window.sessionStorage.getItem("MENU_PLANNING_CACHE_DEBUG") === "1") console.info("Menu Planning catalogue cache", { event, ...details }); } catch { /* Storage access is optional. */ }
}

function sessionValue(key: string) { try { return typeof window === "undefined" ? null : window.sessionStorage.getItem(key); } catch { return null; } }

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("menuWeeks")) db.createObjectStore("menuWeeks", { keyPath: "weekId" });
      if (!db.objectStoreNames.contains(recordStore)) db.createObjectStore(recordStore, { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains(metadataStore)) db.createObjectStore(metadataStore);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened."));
  });
}

export function catalogueCacheNamespace(identity?: string) {
  if (typeof window === "undefined") return undefined;
  const knownIdentity = identity || sessionValue("fika-menu-identity") || "";
  return knownIdentity ? `${window.location.origin}|${knownIdentity}|catalogue-v${schemaVersion}` : undefined;
}

async function readCache(namespace: string): Promise<CachedCatalogue | undefined> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([recordStore, metadataStore], "readonly");
    const metaRequest = transaction.objectStore(metadataStore).get(metadataKey(namespace));
    const prefix = `${namespace}|`;
    const recordsRequest = transaction.objectStore(recordStore).getAll(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
    transaction.oncomplete = () => {
      const metadata = metaRequest.result as Omit<CachedCatalogue, "entries"> | undefined;
      const entries = (recordsRequest.result as Array<CachedCatalogueEntry & { cacheKey: string }>).map(({ cacheKey: _cacheKey, ...entry }) => entry);
      if (!metadata || metadata.schemaVersion !== schemaVersion || !entries.length && metadata.recordCount !== 0) return resolve(undefined);
      resolve({ ...metadata, entries } as CachedCatalogue);
    };
    transaction.onerror = () => reject(transaction.error || new Error("Catalogue cache read failed."));
  });
}

export async function getCachedCatalogue(namespace = catalogueCacheNamespace()) {
  if (!namespace) return undefined;
  try {
    const value = await readCache(namespace);
    if (!value) { debug("miss", { namespace }); return undefined; }
    const stale = Date.now() - value.cachedAt >= CATALOGUE_CACHE_TTL_MS;
    debug(stale ? "stale" : "hit", { cachedAt: value.cachedAt, recordCount: value.entries.length });
    return value;
  } catch (error) {
    debug("fallback", { reason: error instanceof Error ? error.message : "IndexedDB unavailable" });
    return undefined;
  }
}

export async function putCachedCatalogue(entries: CachedCatalogueEntry[], namespace = catalogueCacheNamespace(), categories: string[] = []) {
  if (!namespace) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([recordStore, metadataStore], "readwrite");
      const records = transaction.objectStore(recordStore);
      const prefix = `${namespace}|`;
      records.delete(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      entries.forEach(entry => records.put({ ...entry, cacheKey: `${namespace}|${entry.id}` }));
      transaction.objectStore(metadataStore).put({ namespace, schemaVersion, cachedAt: Date.now(), manifestCheckedAt: Date.now(), recordCount: entries.length, categories }, metadataKey(namespace));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Catalogue cache write failed."));
    });
    debug("updated", { recordCount: entries.length });
  } catch (error) { debug("write-fallback", { reason: error instanceof Error ? error.message : "IndexedDB unavailable" }); }
}

async function putCatalogueMetadata(namespace: string, patch: Partial<CachedCatalogue>) {
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(metadataStore, "readwrite");
      const store = transaction.objectStore(metadataStore);
      const request = store.get(metadataKey(namespace));
      request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...patch }, metadataKey(namespace)); };
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Catalogue metadata update failed."));
    });
  } catch { /* Manifest diagnostics never invalidate a usable cache. */ }
}

export async function putCachedCatalogueItem(entry: CachedCatalogueEntry, namespace = catalogueCacheNamespace()) {
  const current = await getCachedCatalogue(namespace);
  if (!current) return;
  await putCachedCatalogue([...current.entries.filter(item => item.id !== entry.id), entry], namespace, current.categories);
}

export async function removeCachedCatalogueItem(id: string, namespace = catalogueCacheNamespace()) {
  const current = await getCachedCatalogue(namespace);
  if (current) await putCachedCatalogue(current.entries.filter(entry => entry.id !== id), namespace, current.categories);
}

export async function invalidateCatalogueCache(namespace = catalogueCacheNamespace()) {
  if (!namespace) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction([recordStore, metadataStore], "readwrite");
      const records = transaction.objectStore(recordStore).openCursor();
      records.onsuccess = () => { const cursor = records.result; if (!cursor) return; if (String(cursor.value.cacheKey).startsWith(`${namespace}|`)) cursor.delete(); cursor.continue(); };
      transaction.objectStore(metadataStore).delete(metadataKey(namespace));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Catalogue cache invalidation failed."));
    });
    debug("invalidated", { namespace });
  } catch { /* Cache invalidation is best effort. */ }
}

export async function clearCatalogueCache() {
  try { const db = await openDatabase(); await new Promise<void>((resolve, reject) => { const transaction = db.transaction([recordStore, metadataStore], "readwrite"); transaction.objectStore(recordStore).clear(); transaction.objectStore(metadataStore).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); } catch { /* Cache cleanup is best effort. */ }
}

export async function loadCachedCatalogue(fetcher: () => Promise<CatalogueFetchResult>, onUpdate?: (entries: CachedCatalogueEntry[]) => void, manifestFetcher?: () => Promise<CatalogueManifest>) {
  const namespace = catalogueCacheNamespace();
  const cached = await getCachedCatalogue(namespace);
  if (cached) {
    const checkDue = !cached.manifest || !cached.manifestCheckedAt || Date.now() - cached.manifestCheckedAt >= CATALOGUE_CACHE_TTL_MS;
    if (namespace && manifestFetcher && checkDue) void revalidateCatalogue(cached, namespace, fetcher, manifestFetcher, onUpdate);
    else if (!manifestFetcher && Date.now() - cached.cachedAt >= CATALOGUE_CACHE_TTL_MS) void refreshCatalogue(fetcher, namespace, onUpdate).catch(error => debug("background-fallback", { reason: error instanceof Error ? error.message : "refresh failed" }));
    return cached.entries;
  }
  return refreshCatalogue(fetcher, namespace, onUpdate);
}

const refreshInFlight = new Map<string, Promise<CachedCatalogueEntry[]>>();
const manifestInFlight = new Map<string, Promise<void>>();
async function revalidateCatalogue(cached: CachedCatalogue, namespace: string, fetcher: () => Promise<CatalogueFetchResult>, manifestFetcher: () => Promise<CatalogueManifest>, onUpdate?: (entries: CachedCatalogueEntry[]) => void) {
  const existing = manifestInFlight.get(namespace);
  if (existing) return existing;
  const check = manifestFetcher().then(async manifest => {
    await putCatalogueMetadata(namespace, { manifest, manifestCheckedAt: Date.now() });
    if (!catalogueManifestMatches(cached.manifest, manifest)) await refreshCatalogue(fetcher, namespace, onUpdate);
  }).catch(error => { debug("manifest-fallback", { reason: error instanceof Error ? error.message : "manifest unavailable" }); return putCatalogueMetadata(namespace, { manifestCheckedAt: Date.now() }); }).finally(() => { manifestInFlight.delete(namespace); });
  manifestInFlight.set(namespace, check);
  return check;
}
async function refreshCatalogue(fetcher: () => Promise<CatalogueFetchResult>, previousNamespace?: string, onUpdate?: (entries: CachedCatalogueEntry[]) => void) {
  const key = previousNamespace || "uncached";
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  debug("revalidate");
  const refresh = fetcher().then(async result => {
    if (result.identity && typeof window !== "undefined") { try { window.sessionStorage.setItem("fika-menu-identity", result.identity); } catch { /* Storage access is optional. */ } }
    const namespace = catalogueCacheNamespace(result.identity) || previousNamespace;
    await putCachedCatalogue(result.entries, namespace, result.categories || []);
    if (namespace && result.manifest) await putCatalogueMetadata(namespace, { manifest: result.manifest, manifestCheckedAt: Date.now() });
    onUpdate?.(result.entries);
    return result.entries;
  }).finally(() => { refreshInFlight.delete(key); });
  refreshInFlight.set(key, refresh);
  return refresh;
}
