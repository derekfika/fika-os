"use client";

export type CachedCatalogueEntry = Record<string, unknown> & { id: string };
export type CachedCatalogue = { namespace: string; schemaVersion: number; cachedAt: number; recordCount: number; entries: CachedCatalogueEntry[]; categories: string[] };
export type CatalogueFetchResult = { entries: CachedCatalogueEntry[]; categories?: string[]; identity?: string };

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
      transaction.objectStore(metadataStore).put({ namespace, schemaVersion, cachedAt: Date.now(), recordCount: entries.length, categories }, metadataKey(namespace));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Catalogue cache write failed."));
    });
    debug("updated", { recordCount: entries.length });
  } catch (error) { debug("write-fallback", { reason: error instanceof Error ? error.message : "IndexedDB unavailable" }); }
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

export async function loadCachedCatalogue(fetcher: () => Promise<CatalogueFetchResult>, onUpdate?: (entries: CachedCatalogueEntry[]) => void) {
  const namespace = catalogueCacheNamespace();
  const cached = await getCachedCatalogue(namespace);
  const stale = cached ? Date.now() - cached.cachedAt >= CATALOGUE_CACHE_TTL_MS : false;
  if (cached) {
    if (stale) void refreshCatalogue(fetcher, namespace, onUpdate).catch(error => debug("background-fallback", { reason: error instanceof Error ? error.message : "refresh failed" }));
    return cached.entries;
  }
  return refreshCatalogue(fetcher, namespace, onUpdate);
}

const refreshInFlight = new Map<string, Promise<CachedCatalogueEntry[]>>();
async function refreshCatalogue(fetcher: () => Promise<CatalogueFetchResult>, previousNamespace?: string, onUpdate?: (entries: CachedCatalogueEntry[]) => void) {
  const key = previousNamespace || "uncached";
  const existing = refreshInFlight.get(key);
  if (existing) return existing;
  debug("revalidate");
  const refresh = fetcher().then(async result => {
    if (result.identity && typeof window !== "undefined") { try { window.sessionStorage.setItem("fika-menu-identity", result.identity); } catch { /* Storage access is optional. */ } }
    const namespace = catalogueCacheNamespace(result.identity) || previousNamespace;
    await putCachedCatalogue(result.entries, namespace, result.categories || []);
    onUpdate?.(result.entries);
    return result.entries;
  }).finally(() => { refreshInFlight.delete(key); });
  refreshInFlight.set(key, refresh);
  return refresh;
}
