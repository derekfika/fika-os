import type { LogisticsDayProjection } from "./types";

const DATABASE = "fika-logistics-cache";
const STORE = "day-projections";
const VERSION = 1;
type CacheRecord = { scope: string; serviceDate: string; projection: LogisticsDayProjection; savedAt: string };

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ["scope", "serviceDate"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export function logisticsCacheKey(scope: string, serviceDate: string) { return [scope, serviceDate] as [string, string]; }

export async function readCachedProjection(scope: string, serviceDate: string): Promise<LogisticsDayProjection | undefined> {
  try {
    const db = await openCache();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(logisticsCacheKey(scope, serviceDate));
      request.onsuccess = () => resolve((request.result as CacheRecord | undefined)?.projection);
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function writeCachedProjection(scope: string, projection: LogisticsDayProjection) {
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ scope, serviceDate: projection.serviceDate, projection, savedAt: new Date().toISOString() } satisfies CacheRecord);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { /* Cache is an optimisation and must never block operations. */ }
}
