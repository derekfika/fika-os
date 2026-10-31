import type { FoodDataset, FoodFileEntry } from "./manifest";

/**
 * One record per environment + identity + dataset. The verified gzip bytes are stored (not the parsed rows) so a
 * read can re-verify both hashes and detect corruption. The record also keeps its own manifest entry so a stale
 * last-known-good bundle can be re-verified after the live manifest has moved on.
 */
export type CachedBundle = {
  key: string; environment: string; identityScope: string; dataset: FoodDataset; version: string; snapshot: string;
  entry: FoodFileEntry; gzip: ArrayBuffer; storedAt: string;
};

export const cacheKey = (environment: string, identityScope: string, dataset: FoodDataset) => `${environment}|${identityScope}|${dataset}`;

export interface FoodBundleStore {
  get(key: string): Promise<CachedBundle | undefined>;
  /** Single atomic replacement of the record for `bundle.key`. Rejects on quota or storage failure. */
  put(bundle: CachedBundle): Promise<void>;
  delete(key: string): Promise<void>;
  /** Removes every record belonging to another environment or identity than the one given. */
  purgeOthers(environment: string, identityScope: string): Promise<void>;
  clearAll(): Promise<void>;
}

/** Used when IndexedDB is unavailable (private mode, blocked, tests): the session still works, it just re-downloads next visit. */
export function memoryFoodBundleStore(): FoodBundleStore & { records: Map<string, CachedBundle> } {
  const records = new Map<string, CachedBundle>();
  return {
    records,
    async get(key) { return records.get(key); },
    async put(bundle) { records.set(bundle.key, bundle); },
    async delete(key) { records.delete(key); },
    async purgeOthers(environment, identityScope) { for (const [key, value] of records) if (value.environment !== environment || value.identityScope !== identityScope) records.delete(key); },
    async clearAll() { records.clear(); },
  };
}

export const FOOD_DATA_DB = "fika-food-data-cache";
export const FOOD_DATA_DB_VERSION = 1;
const STORE = "bundles";

function openDatabase(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try { request = factory.open(FOOD_DATA_DB, FOOD_DATA_DB_VERSION); } catch (error) { return reject(error); }
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "key" }); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB unavailable"));
    request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}

/** Wraps one transaction; the database is closed afterwards so a later version bump is never blocked by this tab. */
async function withStore<T>(factory: IDBFactory, mode: IDBTransactionMode, work: (store: IDBObjectStore, done: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase(factory);
  try {
    return await new Promise<T>((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      let result: T;
      work(transaction.objectStore(STORE), value => { result = value; });
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error("IndexedDB transaction aborted"));
    });
  } finally { database.close(); }
}

export function indexedDbFoodBundleStore(factory: IDBFactory): FoodBundleStore {
  return {
    get: key => withStore<CachedBundle | undefined>(factory, "readonly", (store, done) => { const request = store.get(key); request.onsuccess = () => done(request.result as CachedBundle | undefined); }),
    put: bundle => withStore<void>(factory, "readwrite", store => { store.put(bundle); }),
    delete: key => withStore<void>(factory, "readwrite", store => { store.delete(key); }),
    purgeOthers: (environment, identityScope) => withStore<void>(factory, "readwrite", store => {
      const request = store.openCursor();
      request.onsuccess = () => {
        const cursor = request.result; if (!cursor) return;
        const value = cursor.value as Partial<CachedBundle>;
        if (value.environment !== environment || value.identityScope !== identityScope) cursor.delete();
        cursor.continue();
      };
    }),
    clearAll: () => withStore<void>(factory, "readwrite", store => { store.clear(); }),
  };
}

/** Falls back to memory when IndexedDB is missing or cannot be opened at all. */
export async function openFoodBundleStore(factory: IDBFactory | undefined = typeof indexedDB === "undefined" ? undefined : indexedDB): Promise<{ store: FoodBundleStore; persistent: boolean }> {
  if (!factory) return { store: memoryFoodBundleStore(), persistent: false };
  try { await openDatabase(factory).then(database => database.close()); return { store: indexedDbFoodBundleStore(factory), persistent: true }; }
  catch { return { store: memoryFoodBundleStore(), persistent: false }; }
}
