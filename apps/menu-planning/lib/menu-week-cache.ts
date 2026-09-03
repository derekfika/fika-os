import type { RollingSnapshot } from "./rolling-menu-types";
import type { PublicationDayState } from "./menu-publication";
import { clearCatalogueCache } from "./menu-catalogue-cache";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-client";
import { canonicalOplocId } from "@fika/server-shared/governed-oplocs";

export type CachedMenuWeek = { weekId: string; weekCommencing: string; version: number; snapshot: RollingSnapshot; publicationState: Record<string, PublicationDayState>; weeks?: Array<{ id: string; weekCommencing: string; entryIds: string[]; version: number }>; cachedAt: number; identity: string };
export type CachedWeekSelection = { weekId: string; weekCommencing: string; identity: string; selectedAt: number };
const databaseName = "fika-menu-planning";
const databaseVersion = 2;
const storeName = "menuWeeks";
const metadataStore = "cacheMetadata";
const selectionKey = "selectedWeek";

function normaliseCachedWeek(value: CachedMenuWeek): CachedMenuWeek {
  return { ...value, snapshot: { ...value.snapshot, entries: value.snapshot.entries.map(entry => ({ ...entry, allocations: entry.allocations.map(allocation => ({ ...allocation, ...(allocation.destinationId ? { destinationId: canonicalOplocId(allocation.destinationId) } : {}) })) })) } };
}

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
  try { const db = await openDatabase(); return await new Promise<CachedMenuWeek | undefined>((resolve, reject) => { const request = db.transaction(storeName, "readonly").objectStore(storeName).get(weekId); request.onsuccess = () => { const value = request.result?.identity === identity ? normaliseCachedWeek(request.result as CachedMenuWeek) : undefined; recordDataAccess({ app: "menu-planning", operation: "week.cache", source: "CLIENT_CACHE", documents: value ? 1 : 0, cacheHit: Boolean(value) }); resolve(value); }; request.onerror = () => reject(request.error); }); } catch { recordDataAccess({ app: "menu-planning", operation: "week.cache", source: "CLIENT_CACHE", documents: 0, cacheHit: false }); return undefined; }
}

export async function getCachedWeekSelection(identity: string) {
  if (!identity) return undefined;
  try {
    const db = await openDatabase();
    return await new Promise<CachedWeekSelection | undefined>((resolve, reject) => {
      const request = db.transaction(metadataStore, "readonly").objectStore(metadataStore).get(selectionKey);
      request.onsuccess = () => {
        const value = request.result as CachedWeekSelection | undefined;
        resolve(value?.identity === identity ? value : undefined);
      };
      request.onerror = () => reject(request.error);
    });
  } catch { return undefined; }
}

export async function putCachedWeekSelection(value: CachedWeekSelection) {
  if (!value.identity) return;
  try {
    const db = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(metadataStore, "readwrite");
      transaction.objectStore(metadataStore).put(value, selectionKey);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error("Selected menu week cache write failed."));
    });
  } catch { /* Cache failure never changes server behaviour. */ }
}

export async function putCachedWeek(value: CachedMenuWeek) {
  try { const db = await openDatabase(); await new Promise<void>((resolve, reject) => { const request = db.transaction(storeName, "readwrite").objectStore(storeName).put(normaliseCachedWeek(value)); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } catch { /* Cache failure never changes server behaviour. */ }
}

export async function clearMenuPlanningCache() {
  try { const db = await openDatabase(); await new Promise<void>((resolve, reject) => { const request = db.transaction(storeName, "readwrite").objectStore(storeName).clear(); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error); }); } catch { /* Cache cleanup is best effort. */ }
  await clearCatalogueCache();
}
