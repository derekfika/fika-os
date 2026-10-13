"use client";

import { readCpuProjection, writeCpuProjection, type CpuProjectionCacheEntry } from "./cpu-indexeddb";
import { authorityMarkerOf, isTrustedCachedProjection } from "./cpu-cache-trust";

/**
 * The CPU dashboard's projection load: IndexedDB-first with a manifest head check, extracted from the page so the real cache-hit
 * paths can be tested. Behaviour is unchanged for modern (authority-bound) packages; a cached projection WITHOUT the authority
 * binding marker (a historical package, or an entry cached before the marker was recorded) is never rendered or trusted from the
 * cache: the body is fetched, where the server downgrades its unverifiable Hospitality Planned entries.
 */
type PackageIdentity = { packageVersion?: number; contentHash?: string; sourceVersion?: string };
type Projection = { lastChangeSequence?: number; revision?: number; authorityBindingVersion?: number; [key: string]: unknown };
type Entry = CpuProjectionCacheEntry<Projection>;
export type CpuDashboardLoaderDependencies = {
  fetch: typeof globalThis.fetch;
  read: (key: string, cacheScope: string) => Promise<Entry | undefined>;
  write: (entry: Entry) => Promise<void>;
};
export type CpuDashboardLoadInput = { view: "day" | "week"; date: string; scope: string };
export type CpuDashboardLoadResult = { projection?: Projection; error?: string; cacheHit?: boolean; bodyRequests: number };

const defaults = (): CpuDashboardLoaderDependencies => ({ fetch: globalThis.fetch.bind(globalThis), read: (key, cacheScope) => readCpuProjection<Projection>(key, cacheScope), write: writeCpuProjection });
const readBody = async <T>(response: Response) => await response.json().catch(() => ({})) as T;

export async function loadCpuDashboardProjection(input: CpuDashboardLoadInput, onCached?: (projection: Projection) => void, dependencies: CpuDashboardLoaderDependencies = defaults()): Promise<CpuDashboardLoadResult> {
  const isDay = input.view === "day";
  const cacheKey = `${isDay ? "day" : "week"}:${input.date}:${input.scope}`;
  const target = isDay ? `serviceDate=${encodeURIComponent(input.date)}` : `weekCommencing=${encodeURIComponent(input.date)}`;
  let bodyRequests = 0;
  const scopeResponse = await dependencies.fetch("/api/production?cacheScope=1", { cache: "no-store" });
  const scopeBody = await readBody<{ cacheScope?: string; error?: { message?: string } }>(scopeResponse);
  if (!scopeResponse.ok || !scopeBody.cacheScope) return { error: scopeBody.error?.message || "CPU cache scope could not be established.", bodyRequests };
  const cacheScope = scopeBody.cacheScope;
  const store = (projection: Projection, identity: PackageIdentity | undefined) => dependencies.write({
    key: cacheKey, schemaVersion: 1, cacheScope, fetchedAt: new Date().toISOString(), lastChangeSequence: Number(projection.lastChangeSequence || 0), revision: Number(projection.revision || 0),
    packageVersion: Number(identity?.packageVersion || 0), contentHash: identity?.contentHash, sourceVersion: identity?.sourceVersion, authorityBindingVersion: authorityMarkerOf(projection), value: projection,
  });
  const fetchBody = async () => {
    bodyRequests += 1;
    const response = await dependencies.fetch(`/api/production?projection=1&${target}&scope=${input.scope}`, { cache: "no-store" });
    return { response, body: await readBody<{ projection?: Projection; package?: PackageIdentity; error?: { message?: string } }>(response) };
  };

  const cached = await dependencies.read(cacheKey, cacheScope);
  if (cached?.value && isTrustedCachedProjection(cached)) {
    onCached?.(cached.value);
    try {
      const head = await dependencies.fetch(`/api/production?projectionHead=1&${target}`, { cache: "no-store" });
      const headBody = await readBody<{ lastChangeSequence?: number; packageVersion?: number; contentHash?: string; sourceVersion?: string }>(head);
      if (head.ok && Number(headBody.lastChangeSequence || 0) === cached.lastChangeSequence && Number(headBody.packageVersion || 0) === Number(cached.packageVersion || 0) && headBody.contentHash === cached.contentHash && headBody.sourceVersion === cached.sourceVersion) return { projection: cached.value, cacheHit: true, bodyRequests };
      const { response, body } = await fetchBody();
      if (response.ok && body.projection) { await store(body.projection, body.package); return { projection: body.projection, bodyRequests }; }
      return { projection: cached.value, bodyRequests };
    } catch { return { projection: cached.value, bodyRequests }; }
  }
  // cold, or a cached entry that is not authority-bound (never trusted from the cache)
  const { response, body } = await fetchBody();
  if (!response.ok) return { error: body.error?.message || "Could not load production.", bodyRequests };
  if (body.projection) await store(body.projection, body.package);
  return { projection: body.projection, bodyRequests };
}
