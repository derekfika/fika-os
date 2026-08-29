import type { RollingSnapshot } from "./rolling-menu-types";
import type { PublicationDayState } from "./menu-publication";
import { clearCatalogueCache } from "./menu-catalogue-cache";

export type CachedMenuWeek = { weekId: string; weekCommencing: string; version: number; snapshot: RollingSnapshot; publicationState: Record<string, PublicationDayState>; cachedAt: number; identity: string };
const databaseName = "fika-menu-planning";
const databaseVersion = 2;
const storeName = "menuWeeks";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB is unavailable."));
    const request = indexedDB.open(databaseName, databaseVersion);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName, { keyPath: "weekId" });
      if (!db.objectStoreNames.contains("menuCatalogue")) db.createObjectStore("menuCatalogue", { keyPath: "cacheKey" });
      if (!db.objectStoreNames.contains("cacheMetadata")) db.createObjectStore("cacheMetadata");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB could not be opened."));
  });
}

export async function getCachedWeek(weekId: string, identity: string) {
  try { const db = await openDatabase(); return await new Promise<CachedMenuWeek | undefined>((resolve, reject) => { const request = db.transaction(storeName, "readonly").objectStore(storeName).get(weekId); request.onsuccess = () => resolve(request.result?.identity === identity ? request.result as CachedMenuWeek : undefined); request.onerror = () => reject(request.error); }); } catch { return undefined; }
}

export async function putCachedWeek(value: CachedMenuWeek) {
  try { const db = await openDatabase(); await new Promise<void>((resolve, reject) => { const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(value); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } catch { /* Cache failure never changes server behaviour. */ }
}

export async function clearMenuPlanningCache() {
  try { const db = await openDatabase(); await new Promise<void>((resolve, reject) => { const request = db.transaction(storeName, "readwrite").objectStore(storeName).clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } catch { /* Cache cleanup is best effort. */ }
  await clearCatalogueCache();
}
