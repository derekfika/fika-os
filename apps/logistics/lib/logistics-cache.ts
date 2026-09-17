import type { LogisticsDayProjection } from "./types";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-client";

const DATABASE = "fika-logistics-cache";
const STORE = "day-projections";
export const LOGISTICS_CACHE_VERSION = 2;
type CacheRecord = { scope: string; vehicle?: string; serviceDate: string; projection: LogisticsDayProjection; savedAt: string };
const PROJECTION_STATES = new Set(["CURRENT", "STALE", "PARTIAL", "UNAVAILABLE", "MISSING", "VALID_EMPTY"]);

export function isUsableCachedProjection(value: unknown, serviceDate: string): value is LogisticsDayProjection {
  if (!value || typeof value !== "object") return false;
  const projection = value as Partial<LogisticsDayProjection>;
  return projection.serviceDate === serviceDate
    && typeof projection.revision === "number" && Number.isFinite(projection.revision)
    && typeof projection.lastChangeSequence === "number" && Number.isSafeInteger(projection.lastChangeSequence)
    && projection.lastChangeSequence >= 0
    && Array.isArray(projection.planningQueue)
    && Array.isArray(projection.deliveryLoads)
    && Array.isArray(projection.runs)
    && Array.isArray(projection.exceptions)
    && Boolean(projection.summary && typeof projection.summary === "object")
    && (!projection.state || PROJECTION_STATES.has(projection.state));
}

export function upgradeLogisticsCacheSchema(database: Pick<IDBDatabase, "objectStoreNames" | "createObjectStore">) {
  if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE, { keyPath: ["scope", "serviceDate"] });
}

function openCache(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DATABASE, LOGISTICS_CACHE_VERSION);
    request.onupgradeneeded = () => upgradeLogisticsCacheSchema(request.result);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export function logisticsCacheKey(scope: string, serviceDate: string, vehicle = "organisation") { return [`${scope}:${vehicle}`, serviceDate] as [string, string]; }

export async function readCachedProjection(scope: string, serviceDate: string, vehicle = "organisation"): Promise<LogisticsDayProjection | undefined> {
  try {
    const db = await openCache();
    return await new Promise((resolve, reject) => {
      const key = logisticsCacheKey(scope, serviceDate, vehicle);
      const request = db.transaction(STORE).objectStore(STORE).get(key);
      request.onsuccess = () => {
        const value = (request.result as CacheRecord | undefined)?.projection;
        const usable = isUsableCachedProjection(value, serviceDate);
        recordDataAccess({ app: "logistics", operation: "projection.cache", source: "CLIENT_CACHE", documents: usable ? 1 : 0, cacheHit: usable });
        if (!usable && value) {
          try { db.transaction(STORE, "readwrite").objectStore(STORE).delete(key); } catch { /* A corrupt cache is ignored even if eviction fails. */ }
        }
        resolve(usable ? value : undefined);
      };
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
