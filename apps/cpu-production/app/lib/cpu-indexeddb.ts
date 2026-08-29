export const CPU_CACHE_SCHEMA_VERSION = 1;
const DATABASE_NAME = "fika-cpu-cache";
const DATABASE_VERSION = 1;
const PROJECTION_STORE = "projectionCache";

export type CpuProjectionCacheEntry<T = unknown> = {
  key: string;
  schemaVersion: number;
  cacheScope: string;
  fetchedAt: string;
  lastChangeSequence: number;
  revision: number;
  value: T;
};

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("IndexedDB unavailable"));
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (database.objectStoreNames.contains(PROJECTION_STORE)) database.deleteObjectStore(PROJECTION_STORE);
      database.createObjectStore(PROJECTION_STORE, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB open failed"));
  });
}

export async function readCpuProjection<T>(key: string, cacheScope: string) {
  try {
    const database = await openDatabase();
    return await new Promise<CpuProjectionCacheEntry<T> | undefined>((resolve, reject) => {
      const request = database.transaction(PROJECTION_STORE, "readonly").objectStore(PROJECTION_STORE).get(key);
      request.onsuccess = () => {
        const entry = request.result as CpuProjectionCacheEntry<T> | undefined;
        resolve(entry?.schemaVersion === CPU_CACHE_SCHEMA_VERSION && entry.cacheScope === cacheScope ? entry : undefined);
      };
      request.onerror = () => reject(request.error || new Error("IndexedDB read failed"));
    });
  } catch {
    return undefined;
  }
}

export async function writeCpuProjection<T>(entry: CpuProjectionCacheEntry<T>) {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(PROJECTION_STORE, "readwrite").objectStore(PROJECTION_STORE).put(entry);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("IndexedDB write failed"));
    });
  } catch {
    // Cache failures are deliberately non-fatal; the server remains authoritative.
  }
}

export async function invalidateCpuProjection(key: string) {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(PROJECTION_STORE, "readwrite").objectStore(PROJECTION_STORE).delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("IndexedDB delete failed"));
    });
  } catch {
    // Cache failures do not affect authoritative mutations.
  }
}

export async function clearCpuCache() {
  try {
    const database = await openDatabase();
    await new Promise<void>((resolve, reject) => {
      const request = database.transaction(PROJECTION_STORE, "readwrite").objectStore(PROJECTION_STORE).clear();
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error("IndexedDB clear failed"));
    });
  } catch {
    // Cache failures do not affect sign-out or account transitions.
  }
}
