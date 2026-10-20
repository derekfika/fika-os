/**
 * Browser-side catalogue loader (client-safe: no server imports, all I/O injected so it is unit-testable).
 *
 * Normal startup = ONE small manifest request + one IndexedDB read. The gzip package is downloaded only when the content hash changes.
 * There is NO Firestore fan-out: the browser never reads Firestore for the catalogue.
 *
 * Cache safety (the stale-IndexedDB class of bug): every cached record carries clientSchemaVersion, packageSchemaVersion, contentHash and
 * generatedAt. A schema mismatch, a malformed record, or any IndexedDB failure is discarded/ignored and the cache is replaced; incompatible
 * old structures are never hydrated into new code. If the manifest cannot be reached a valid cache is returned but flagged `unverified`
 * (never silently presented as current).
 */
import { CATALOGUE_PACKAGE_CONTRACT, CATALOGUE_PACKAGE_SCHEMA_VERSION, type CataloguePackage } from "./hospitality-effective-offering";

// A new, app-owned IndexedDB namespace avoids VersionError/blocking collisions
// with the Hub admin cache and any older client schema left in a browser.
export const CATALOGUE_CLIENT_SCHEMA_VERSION = 3;
export const CATALOGUE_CLIENT_CACHE_DB = `fika-hospitality-booking-catalogue-v${CATALOGUE_CLIENT_SCHEMA_VERSION}`;
export type CatalogueManifest = { dataset: string; packageVersion: number; schemaVersion: number; contractVersion: string; objectName: string; compression: "gzip"; contentHash: string; compressedSize: number; uncompressedSize: number; recordCount: number; generatedAt: string };
export type CachedCatalogue = { id: "current"; clientSchemaVersion: number; packageSchemaVersion: number; contentHash: string; payloadHash: string; packageVersion: number; generatedAt: string; catalogue: CataloguePackage };
export type CatalogueCacheStore = { read(): Promise<unknown>; write(record: CachedCatalogue): Promise<void>; clear(): Promise<void> };
export type CatalogueLoadDeps = {
  fetchManifest(): Promise<CatalogueManifest>;
  fetchPackageBytes(contentHash: string): Promise<Uint8Array>;
  sha256Hex(bytes: Uint8Array): Promise<string>;
  gunzipText(bytes: Uint8Array): Promise<string>;
  store: CatalogueCacheStore;
};
const supportedContract = (version: number, contract: string) => (version === 1 && contract === "fika.hospitality-catalogue-package.v1") || (version === CATALOGUE_PACKAGE_SCHEMA_VERSION && contract === CATALOGUE_PACKAGE_CONTRACT);

export type CatalogueLoadResult = { catalogue: CataloguePackage; source: "cache" | "network" | "cache-unverified"; contentHash: string; generatedAt: string; downloaded: boolean; notes: string[] };

const isPackage = (value: unknown): value is CataloguePackage => {
  if (!value || typeof value !== "object") return false;
  const pkg = value as CataloguePackage;
  return supportedContract(pkg.schemaVersion, pkg.contract) &&
    Array.isArray(pkg.items) && pkg.items.every(item => item && typeof item.id === "string" && typeof item.name === "string" && Array.isArray(item.defaultPrices) && (item.allowedOplocIds === undefined || (pkg.schemaVersion >= 2 && Array.isArray(item.allowedOplocIds) && item.allowedOplocIds.length > 0 && item.allowedOplocIds.every(id => typeof id === "string")))) &&
    Array.isArray(pkg.exceptions) && pkg.exceptions.every(exception => exception && typeof exception.id === "string" && typeof exception.itemId === "string" && typeof exception.oplocId === "string" && Array.isArray(exception.prices)) &&
    Array.isArray(pkg.oplocs) && pkg.oplocs.every(oploc => oploc && typeof oploc.id === "string" && typeof oploc.label === "string");
};
export function validCachedRecord(value: unknown): value is CachedCatalogue {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<CachedCatalogue>;
  return record.id === "current" && record.clientSchemaVersion === CATALOGUE_CLIENT_SCHEMA_VERSION && record.packageSchemaVersion === record.catalogue?.schemaVersion &&
    typeof record.contentHash === "string" && /^[0-9a-f]{64}$/.test(record.contentHash) && typeof record.payloadHash === "string" && /^[0-9a-f]{64}$/.test(record.payloadHash) &&
    Number.isInteger(record.packageVersion) && Number(record.packageVersion) > 0 && typeof record.generatedAt === "string" && Number.isFinite(Date.parse(record.generatedAt)) && isPackage(record.catalogue);
}

function validateManifest(value: CatalogueManifest) {
  return ["integration-hub/hospitality-catalogue", "hospitality-booking/catalogue"].includes(value?.dataset) && value.compression === "gzip" && supportedContract(value.schemaVersion, value.contractVersion) && Number.isInteger(value.packageVersion) && value.packageVersion > 0 &&
    /^[0-9a-f]{64}$/.test(value.contentHash) && value.objectName.includes(value.contentHash) && Number.isInteger(value.compressedSize) && value.compressedSize > 0 &&
    typeof value.generatedAt === "string" && Number.isFinite(Date.parse(value.generatedAt));
}

export async function loadHospitalityCatalogue(deps: CatalogueLoadDeps): Promise<CatalogueLoadResult> {
  const notes: string[] = [];
  let cached: CachedCatalogue | undefined;
  try {
    const raw = await deps.store.read();
    if (raw !== undefined && raw !== null) {
      if (validCachedRecord(raw) && raw.payloadHash === await deps.sha256Hex(new TextEncoder().encode(JSON.stringify(raw.catalogue)))) cached = raw;
      else { notes.push("Ignored an incompatible or damaged cache record and replaced it."); await deps.store.clear().catch(() => undefined); }
    }
  } catch { notes.push("The local cache could not be read; fetching a fresh catalogue."); await deps.store.clear().catch(() => undefined); }

  let manifest: CatalogueManifest;
  try { manifest = await deps.fetchManifest(); }
  catch (error) {
    if (cached) return { catalogue: cached.catalogue, source: "cache-unverified", contentHash: cached.contentHash, generatedAt: cached.generatedAt, downloaded: false, notes: [...notes, "The catalogue version could not be checked; showing the last downloaded catalogue, which may be out of date."] };
    throw error;
  }
  if (!validateManifest(manifest)) throw Object.assign(new Error("The published catalogue manifest is invalid or uses an unsupported contract."), { code: "CATALOGUE_SCHEMA_MISMATCH" });
  if (cached && cached.contentHash === manifest.contentHash) return { catalogue: cached.catalogue, source: "cache", contentHash: cached.contentHash, generatedAt: cached.generatedAt, downloaded: false, notes };

  let bytes: Uint8Array;
  try { bytes = await deps.fetchPackageBytes(manifest.contentHash); }
  catch (error) {
    if (cached) return { catalogue: cached.catalogue, source: "cache-unverified", contentHash: cached.contentHash, generatedAt: cached.generatedAt, downloaded: false, notes: [...notes, "The current catalogue package could not be downloaded; showing the last downloaded catalogue, which may be out of date."] };
    throw error;
  }
  if (bytes.byteLength !== manifest.compressedSize) throw Object.assign(new Error("The downloaded catalogue package size does not match its manifest."), { code: "CATALOGUE_INTEGRITY_FAILURE" });
  if ((await deps.sha256Hex(bytes)) !== manifest.contentHash) throw Object.assign(new Error("The downloaded catalogue failed its integrity check."), { code: "CATALOGUE_INTEGRITY_FAILURE" });
  const parsed = JSON.parse(await deps.gunzipText(bytes)) as unknown;
  if (!isPackage(parsed) || parsed.schemaVersion !== manifest.schemaVersion || parsed.contract !== manifest.contractVersion) throw Object.assign(new Error("The downloaded catalogue has an unexpected structure."), { code: "CATALOGUE_SCHEMA_MISMATCH" });
  const payloadHash = await deps.sha256Hex(new TextEncoder().encode(JSON.stringify(parsed)));
  const record: CachedCatalogue = { id: "current", clientSchemaVersion: CATALOGUE_CLIENT_SCHEMA_VERSION, packageSchemaVersion: parsed.schemaVersion, contentHash: manifest.contentHash, payloadHash, packageVersion: manifest.packageVersion, generatedAt: manifest.generatedAt, catalogue: parsed };
  try { await deps.store.clear(); await deps.store.write(record); } catch { notes.push("The catalogue could not be saved locally; it will be downloaded again next time."); }
  return { catalogue: parsed, source: "network", contentHash: manifest.contentHash, generatedAt: manifest.generatedAt, downloaded: true, notes };
}

// ---- real browser dependencies (IndexedDB, fetch, Web Crypto, DecompressionStream) --------------------------------------------------
function openDatabase() {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB unavailable"));
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(CATALOGUE_CLIENT_CACHE_DB, 1);
    // A schema bump rebuilds the store: structures from an older version are dropped, never migrated in place.
    request.onupgradeneeded = () => { const database = request.result; for (const name of Array.from(database.objectStoreNames)) database.deleteObjectStore(name); database.createObjectStore("package", { keyPath: "id" }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error || new Error("IndexedDB unavailable")); request.onblocked = () => reject(new Error("IndexedDB upgrade blocked"));
  });
}
function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return openDatabase().then(database => new Promise<T>((resolve, reject) => {
    const transaction = database.transaction("package", mode);
    const request = work(transaction.objectStore("package"));
    transaction.oncomplete = () => { database.close(); resolve(request.result); };
    transaction.onabort = transaction.onerror = () => { const error = transaction.error || request.error || new Error("Catalogue cache transaction failed."); database.close(); reject(error); };
  }));
}
export const indexedDbCatalogueStore: CatalogueCacheStore = {
  read: () => run("readonly", store => store.get("current")),
  write: async record => { await run("readwrite", store => store.put(record)); },
  clear: async () => { await run("readwrite", store => store.clear()); },
};

export function browserCatalogueDeps(base = "/api/hospitality-catalogue/package", init: RequestInit = {}): CatalogueLoadDeps {
  return {
    store: indexedDbCatalogueStore,
    async fetchManifest() { const response = await fetch(base, { cache: "no-cache", ...init }); if (!response.ok) throw new Error("The catalogue version could not be checked."); return await response.json() as CatalogueManifest; },
    async fetchPackageBytes(contentHash) { const response = await fetch(`${base}/${contentHash}`, init); if (!response.ok) throw new Error("The catalogue could not be downloaded."); return new Uint8Array(await response.arrayBuffer()); },
    async sha256Hex(bytes) { const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource); return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, "0")).join(""); },
    async gunzipText(bytes) { const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream("gzip")); return await new Response(stream).text(); },
  };
}
