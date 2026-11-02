/** Shared derived-cache schema. Never use the catalogue package version as an IDB version. */
export const MENU_CACHE_DATABASE = "fika-menu-planning";
export const MENU_CACHE_VERSION = 3;
const stores = { menuWeeks: "weekId", menuCatalogue: "cacheKey", cacheMetadata: undefined } as const;
let openTimeoutMs = 3000;
let lastFailureAt = 0;
export function setMenuCacheOpenTimeoutForTests(ms: number) { openTimeoutMs = ms; lastFailureAt = 0; }

export function openMenuCacheDatabase(): Promise<IDBDatabase> {
  if (lastFailureAt && Date.now() - lastFailureAt < 30000) return Promise.reject(new Error("Menu cache temporarily unavailable after an open failure."));
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); lastFailureAt = Date.now();
      // Deliberate, rate-limited browser diagnostic. No identity, payload or credentials.
      if (typeof window !== "undefined") console.warn("Menu Planning cache fallback", { database: MENU_CACHE_DATABASE, schemaVersion: MENU_CACHE_VERSION, reason: error.name });
      reject(error);
    };
    const timer = setTimeout(() => fail(new Error("IndexedDB open timed out.")), openTimeoutMs);
    let request: IDBOpenDBRequest;
    try { request = indexedDB.open(MENU_CACHE_DATABASE, MENU_CACHE_VERSION); }
    catch (error) { fail(error instanceof Error ? error : new Error("IndexedDB open failed.")); return; }
    request.onblocked = () => fail(new Error("IndexedDB upgrade blocked by another tab."));
    request.onerror = () => fail(request.error || new Error("IndexedDB open failed."));
    request.onupgradeneeded = event => {
      if (settled) { request.transaction?.abort(); return; }
      const db = request.result;
      // Preserve the established v3 identity/schema invalidation for old *derived* records.
      // Both consumers run this same upgrade, independent of which one opens first.
      for (const [name, keyPath] of Object.entries(stores)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, keyPath ? { keyPath } : undefined);
        else if (event.oldVersion < MENU_CACHE_VERSION) request.transaction!.objectStore(name).clear();
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { db.close(); return; }
      settled = true; clearTimeout(timer); lastFailureAt = 0;
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}
