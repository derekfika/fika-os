import type { LogisticsDayProjection } from "./types";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-client";

const DATABASE = "fika-logistics-cache";
const STORE = "day-projections";
const VERSION = 2;
type CacheRecord = { scope: string; vehicle?: string; serviceDate: string; projection: LogisticsDayProjection; savedAt: string };

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: ["scope", "serviceDate"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export function logisticsCacheKey(scope: string, serviceDate: string, vehicle = "organisation") { return [`${scope}:${vehicle}`, serviceDate] as [string, string]; }

export async function readCachedProjection(scope: string, serviceDate: string, vehicle = "organisation"): Promise<LogisticsDayProjection | undefined> {
  try {
    const db = await openCache();
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).get(logisticsCacheKey(scope, serviceDate, vehicle));
      request.onsuccess = () => { const value = (request.result as CacheRecord | undefined)?.projection; recordDataAccess({ app: "logistics", operation: "projection.cache", source: "CLIENT_CACHE", documents: value ? 1 : 0, cacheHit: Boolean(value) }); resolve(value); };
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function writeCachedProjection(scope: string, projection: LogisticsDayProjection, vehicle = "organisation") {
  try {
    const db = await openCache();
    await new Promise<void>((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put({ scope: `${scope}:${vehicle}`, vehicle, serviceDate: projection.serviceDate, projection, savedAt: new Date().toISOString() } satisfies CacheRecord);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  } catch { /* Cache is an optimisation and must never block operations. */ }
}
