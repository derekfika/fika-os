import type { ReadPackageManifest } from "@fika/server-shared/read-package";
import type { GrabAndGoCatalogue } from "@fika/server-shared/grab-and-go-catalogue";

type CachedCatalogue = { namespace: string; cachedAt: number; manifest: ReadPackageManifest; catalogue: GrabAndGoCatalogue };
const databaseName = "fika-delivered-in";
const databaseVersion = 2;
const storeName = "grab-and-go-catalogue";
const schemaVersion = 1;

function namespace(accountScope: string) { return typeof window === "undefined" || !accountScope ? "" : `${window.location.origin}|${accountScope}|grab-and-go-v${schemaVersion}`; }
function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => { const db = request.result; if (!db.objectStoreNames.contains("day-projections")) db.createObjectStore("day-projections", { keyPath: ["accountScope", "oplocId", "serviceDate"] }); if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "namespace" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB is unavailable."));
  });
}

export function grabAndGoCatalogueManifestMatches(cached: ReadPackageManifest | undefined, current: ReadPackageManifest | undefined) { return Boolean(cached && current && cached.dataset === current.dataset && cached.packageVersion === current.packageVersion && cached.schemaVersion === current.schemaVersion && cached.contractVersion === current.contractVersion && cached.contentHash === current.contentHash); }

export async function readCachedGrabAndGoCatalogue(accountScope: string) {
  const key = namespace(accountScope); if (!key) return undefined;
  try {
    const database = await openDatabase();
    const value = await new Promise<CachedCatalogue | undefined>((resolve, reject) => { const request = database.transaction(storeName, "readonly").objectStore(storeName).get(key); request.onsuccess = () => resolve(request.result as CachedCatalogue | undefined); request.onerror = () => reject(request.error); });
    database.close();
    if (!value || value.namespace !== key || value.catalogue?.schemaVersion !== schemaVersion || !Array.isArray(value.catalogue.products)) return undefined;
    return value;
  } catch { return undefined; }
}

export async function cacheGrabAndGoCatalogue(accountScope: string, catalogue: GrabAndGoCatalogue, manifest: ReadPackageManifest) {
  const key = namespace(accountScope); if (!key) return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => { const transaction = database.transaction(storeName, "readwrite"); transaction.objectStore(storeName).put({ namespace: key, cachedAt: Date.now(), catalogue, manifest } satisfies CachedCatalogue); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error || new Error("Grab & Go catalogue cache write failed.")); });
    database.close();
  } catch { /* Browser cache is an optional performance layer. */ }
}

export async function clearGrabAndGoCatalogueCache() {
  try { const database = await openDatabase(); await new Promise<void>((resolve, reject) => { const transaction = database.transaction(storeName, "readwrite"); transaction.objectStore(storeName).clear(); transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error); }); database.close(); } catch { /* Best effort on logout/browser shutdown. */ }
}
