import { decodeCompositionBundle, compositionCacheEntry, compositionVersion, parseCompositionManifest, type CompositionBundle, type CompositionManifest } from "./compositions";
import type { CachedBundle, FoodBundleStore } from "./cache";
import { FoodDataError } from "./manifest";

export type CompositionLoadResult = { manifest: CompositionManifest; bundle: CompositionBundle; version: string; source: "downloaded" | "cache"; persisted: boolean; warning?: string };
export type CompositionLoaderDeps = { fetch: typeof fetch; store: FoodBundleStore; environment: string; now?: () => Date };
const keyFor = (environment: string, identity: string) => `${environment}|${identity}|recipe-compositions-v2`;

export function createCompositionLoader(deps: CompositionLoaderDeps) {
  const now = deps.now || (() => new Date());
  let pending: Promise<CompositionLoadResult> | undefined;
  let lastCacheKey: string | undefined;
  async function load(): Promise<CompositionLoadResult> {
    const response = await deps.fetch("/api/food-data/compositions/manifest", { credentials: "include", cache: "no-store" });
    if (response.status === 401 || response.status === 403 || response.status === 404) {
      if (lastCacheKey) { try { await deps.store.delete(lastCacheKey); } catch { /* Cached values are never returned after a refused access check. */ } }
      throw new FoodDataError(response.status === 404 ? "Recipe compositions are not available in this environment." : "Sign in with an active staff account to view recipe compositions.", response.status === 404 ? "FOOD_DATA_DISABLED" : response.status === 401 ? "FOOD_DATA_UNAUTHENTICATED" : "FOOD_DATA_FORBIDDEN", response.status);
    }
    if (!response.ok) throw new FoodDataError("Recipe compositions are temporarily unavailable.", "FOOD_DATA_UNAVAILABLE", response.status);
    const body = await response.json() as { identityScope?: unknown; manifest?: unknown };
    if (typeof body.identityScope !== "string" || !body.identityScope) throw new FoodDataError("Composition response is missing its identity scope.", "FOOD_DATA_MANIFEST_INVALID", 502);
    const identity = body.identityScope;
    const manifest = parseCompositionManifest(body.manifest);
    const version = compositionVersion(manifest);
    const key = keyFor(deps.environment, identity);
    lastCacheKey = key;
    let cached: CachedBundle | undefined;
    try { cached = await deps.store.get(key); } catch { /* Use network if local storage is unavailable. */ }
    if (cached && cached.key === key && cached.environment === deps.environment && cached.identityScope === identity && cached.version === version) {
      try { return { manifest, bundle: await decodeCompositionBundle(new Uint8Array(cached.gzip), manifest), version, source: "cache", persisted: true }; }
      catch { try { await deps.store.delete(key); } catch { /* Retry from the source. */ } }
    }
    try {
      const downloaded = await deps.fetch(`/api/food-data/compositions/bundle?version=${encodeURIComponent(version)}`, { credentials: "include", cache: "no-store" });
      if (!downloaded.ok) throw new FoodDataError(`Recipe composition download failed (${downloaded.status}).`, downloaded.status === 409 ? "FOOD_DATA_VERSION_CHANGED" : "FOOD_DATA_UNAVAILABLE", downloaded.status);
      const bytes = new Uint8Array(await downloaded.arrayBuffer());
      const bundle = await decodeCompositionBundle(bytes, manifest);
      let persisted = true;
      try {
        const record: CachedBundle = { key, environment: deps.environment, identityScope: identity, dataset: "recipes", version, snapshot: manifest.exportDate, entry: compositionCacheEntry(manifest), gzip: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, storedAt: now().toISOString() };
        await deps.store.put(record);
      } catch { persisted = false; }
      return { manifest, bundle, version, source: "downloaded", persisted, ...(persisted ? {} : { warning: "This browser could not save the composition snapshot. It will be downloaded again next visit." }) };
    } catch (error) {
      throw error;
    }
  }
  return { load(): Promise<CompositionLoadResult> { return pending ??= load().finally(() => { pending = undefined; }); } };
}
