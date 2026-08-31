import type { ProjectedDay } from "../../lib/projection";

type CachedProjection = { accountScope: string; oplocId: string; serviceDate: string; cachedAt: string; projection: ProjectedDay };
const databaseName = "fika-delivered-in";
const storeName = "day-projections";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName, { keyPath: ["accountScope", "oplocId", "serviceDate"] });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB is unavailable."));
  });
}

export async function cacheDeliveredInDays(accountScope: string, oplocId: string, days: ProjectedDay[]) {
  if (typeof indexedDB === "undefined" || !accountScope || !oplocId) return;
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, "readwrite");
      for (const projection of days) transaction.objectStore(storeName).put({ accountScope, oplocId, serviceDate: projection.date, cachedAt: new Date().toISOString(), projection } satisfies CachedProjection);
      transaction.oncomplete = () => resolve(); transaction.onerror = () => reject(transaction.error || new Error("Projection cache write failed."));
    });
    database.close();
  } catch { /* Cache failure must never affect the authorized server response. */ }
}

export async function readCachedDeliveredInDay(accountScope: string, oplocId: string, serviceDate: string) {
  if (typeof indexedDB === "undefined" || !accountScope || !oplocId) return undefined;
  try {
    const database = await openDatabase();
    const value = await new Promise<CachedProjection | undefined>((resolve, reject) => { const request = database.transaction(storeName, "readonly").objectStore(storeName).get([accountScope, oplocId, serviceDate]); request.onsuccess = () => resolve(request.result as CachedProjection | undefined); request.onerror = () => reject(request.error); });
    database.close();
    return value?.projection;
  } catch { return undefined; }
}

export async function clearDeliveredInProjectionCache() {
  if (typeof indexedDB === "undefined") return;
  try { const database = await openDatabase(); await new Promise<void>((resolve, reject) => { const request = database.transaction(storeName, "readwrite").objectStore(storeName).clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); database.close(); } catch { /* best effort on sign-out/browser shutdown */ }
}
