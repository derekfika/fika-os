import { decodeBundle, type FoodBundle } from "./bundle";
import { cacheKey, type CachedBundle, type FoodBundleStore } from "./cache";
import { FOOD_DATASETS, FoodDataError, datasetVersion, parseManifest, type FoodDataset, type FoodManifest } from "./manifest";

export type DatasetSource = "downloaded" | "cache" | "cache-stale";
export type DatasetResult =
  | { ok: true; dataset: FoodDataset; bundle: FoodBundle; version: string; source: DatasetSource; persisted: boolean; warning?: string }
  | { ok: false; dataset: FoodDataset; error: string; code: string };
export type FoodDataSession = { identityScope: string; manifest: FoodManifest; results: Record<FoodDataset, DatasetResult> };

export type FoodDataMetrics = { manifestRequests: number; bundleDownloads: Record<FoodDataset, number>; cacheReads: number; cacheWrites: number; cacheFailures: number };
export type FoodDataLoaderDeps = { fetch: typeof fetch; store: FoodBundleStore; environment: string; now?: () => Date };

const message = (error: unknown) => error instanceof Error ? error.message : "Unexpected error";
const codeOf = (error: unknown) => error instanceof FoodDataError ? error.code : "FOOD_DATA_UNAVAILABLE";

/**
 * Orchestrates manifest check → per-dataset cache lookup → download only when the version differs.
 * Authorisation is decided by the server on every load: the manifest request must succeed before any cached
 * rows are decoded, so revoked access shows nothing and clears the local copy.
 */
export function createFoodDataLoader(deps: FoodDataLoaderDeps) {
  const metrics: FoodDataMetrics = { manifestRequests: 0, bundleDownloads: { ingredients: 0, recipes: 0 }, cacheReads: 0, cacheWrites: 0, cacheFailures: 0 };
  const inflight = new Map<string, Promise<DatasetResult>>();
  let inflightLoad: Promise<FoodDataSession> | undefined;
  const now = deps.now || (() => new Date());

  async function safe<T>(work: () => Promise<T>): Promise<T | undefined> { try { return await work(); } catch { metrics.cacheFailures++; return undefined; } }

  async function fetchManifest() {
    metrics.manifestRequests++;
    let response: Response;
    try { response = await deps.fetch("/api/food-data/manifest", { credentials: "include", cache: "no-store" }); }
    catch { throw new FoodDataError("Food Data could not be reached, so access could not be confirmed.", "FOOD_DATA_UNAVAILABLE", 0); }
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      // Access revoked, session ended or feature off: drop the local copy rather than keep sensitive data around.
      await safe(() => deps.store.clearAll());
      const code = response.status === 404 ? "FOOD_DATA_DISABLED" : response.status === 401 ? "FOOD_DATA_UNAUTHENTICATED" : "FOOD_DATA_FORBIDDEN";
      throw new FoodDataError(response.status === 404 ? "Food Data is not enabled in this environment." : response.status === 401 ? "Sign in to view Food Data." : "Food Data isn’t available to this account.", code, response.status);
    }
    if (!response.ok) throw new FoodDataError("Food Data is temporarily unavailable.", "FOOD_DATA_UNAVAILABLE", response.status);
    const body = await response.json() as { identityScope?: unknown; manifest?: unknown };
    if (typeof body.identityScope !== "string" || !body.identityScope) throw new FoodDataError("Food Data response is missing its identity scope.", "FOOD_DATA_MANIFEST_INVALID", 502);
    return { identityScope: body.identityScope, manifest: parseManifest(body.manifest) };
  }

  async function loadDataset(identityScope: string, manifest: FoodManifest, dataset: FoodDataset): Promise<DatasetResult> {
    const key = cacheKey(deps.environment, identityScope, dataset);
    const version = datasetVersion(manifest, dataset);
    const entry = manifest.files[dataset];
    metrics.cacheReads++;
    const cached = await safe(() => deps.store.get(key));
    if (cached && cached.environment === deps.environment && cached.identityScope === identityScope && cached.dataset === dataset && cached.version === version) {
      try { return { ok: true, dataset, bundle: await decodeBundle(dataset, new Uint8Array(cached.gzip), cached.entry, cached.snapshot), version, source: "cache", persisted: true }; }
      catch { await safe(() => deps.store.delete(key)); /* corrupt or tampered: fall through and download */ }
    }
    try {
      metrics.bundleDownloads[dataset]++;
      let response: Response;
      try { response = await deps.fetch(`/api/food-data/bundle/${dataset}?version=${encodeURIComponent(version)}`, { credentials: "include", cache: "no-store" }); }
      catch { throw new FoodDataError(`The ${dataset} download could not be completed.`, "FOOD_DATA_UNAVAILABLE", 0); }
      if (!response.ok) throw new FoodDataError(`The ${dataset} download failed (${response.status}).`, response.status === 409 ? "FOOD_DATA_VERSION_CHANGED" : "FOOD_DATA_UNAVAILABLE", response.status);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const bundle = await decodeBundle(dataset, bytes, entry, manifest.snapshot);
      // Replace only after the new bytes verified; a failed write keeps the old record and the session still works.
      const record: CachedBundle = { key, environment: deps.environment, identityScope, dataset, version, snapshot: manifest.snapshot, entry, gzip: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, storedAt: now().toISOString() };
      let persisted = true;
      try { await deps.store.put(record); metrics.cacheWrites++; } catch { persisted = false; metrics.cacheFailures++; }
      return { ok: true, dataset, bundle, version, source: "downloaded", persisted, ...(persisted ? {} : { warning: "This browser could not save a local copy (storage full or unavailable). Data will be downloaded again next visit." }) };
    } catch (error) {
      // Transient failure: the server just confirmed access, so the last-known-good version may be shown, clearly labelled.
      if (cached && cached.identityScope === identityScope && cached.environment === deps.environment && cached.dataset === dataset && !(error instanceof FoodDataError && error.code === "FOOD_DATA_INTEGRITY_FAILED")) {
        try { return { ok: true, dataset, bundle: await decodeBundle(dataset, new Uint8Array(cached.gzip), cached.entry, cached.snapshot), version: cached.version, source: "cache-stale", persisted: true, warning: `A newer ${dataset} snapshot is available but could not be downloaded. Showing the previously saved snapshot of ${cached.snapshot}.` }; }
        catch { await safe(() => deps.store.delete(key)); }
      }
      return { ok: false, dataset, error: message(error), code: codeOf(error) };
    }
  }

  async function load(): Promise<FoodDataSession> {
    const { identityScope, manifest } = await fetchManifest();
    await safe(() => deps.store.purgeOthers(deps.environment, identityScope));
    const entries = await Promise.all(FOOD_DATASETS.map(dataset => {
      const flightKey = `${cacheKey(deps.environment, identityScope, dataset)}|${datasetVersion(manifest, dataset)}`;
      const existing = inflight.get(flightKey); if (existing) return existing;
      const promise = loadDataset(identityScope, manifest, dataset).finally(() => inflight.delete(flightKey));
      inflight.set(flightKey, promise); return promise;
    }));
    return { identityScope, manifest, results: { ingredients: entries[0], recipes: entries[1] } };
  }

  return {
    metrics,
    /** Concurrent callers (e.g. React strict-mode double mounts) share one manifest check and one download. */
    load(): Promise<FoodDataSession> { return inflightLoad ??= load().finally(() => { inflightLoad = undefined; }); },
    async clear() { await safe(() => deps.store.clearAll()); },
  };
}
export type FoodDataLoader = ReturnType<typeof createFoodDataLoader>;
