"use client";

import { filterCpuProjectionForScope } from "../../lib/cpu-dashboard-adapter";
import type { CpuDayProjection } from "../../lib/cpu-projection";
import type { ProductionScope } from "../../lib/production-scope";
import { readCpuProjection, writeCpuProjection, type CpuProjectionCacheEntry } from "./cpu-indexeddb";

type PackageIdentity = { packageVersion?: number; contentHash?: string; sourceVersion?: string };
type ProjectionResponse = { projection?: CpuDayProjection; package?: PackageIdentity; error?: { message?: string } };
type LoadedProjectionResponse = ProjectionResponse & { projection: CpuDayProjection };
type ProjectionHead = { lastChangeSequence?: number; packageVersion?: number; contentHash?: string; sourceVersion?: string };
type ProjectionCacheEntry = CpuProjectionCacheEntry<CpuDayProjection>;
type LoaderDependencies = {
  fetch: typeof globalThis.fetch;
  read: (key: string, cacheScope: string) => Promise<ProjectionCacheEntry | undefined>;
  write: (entry: ProjectionCacheEntry) => Promise<void>;
};

export const CPU_ALLERGEN_FRESHNESS_ERROR = "Current production data could not be verified. Refresh and try again before reviewing or signing.";

function defaultDependencies(): LoaderDependencies {
  return {
    fetch: globalThis.fetch.bind(globalThis),
    read: (key, cacheScope) => readCpuProjection<CpuDayProjection>(key, cacheScope),
    write: writeCpuProjection,
  };
}

function hasAuthoritativeIdentity(head: ProjectionHead, cached: ProjectionCacheEntry) {
  return Number.isFinite(head.lastChangeSequence)
    && Number.isFinite(head.packageVersion)
    && typeof head.contentHash === "string"
    && head.contentHash.length > 0
    && typeof head.sourceVersion === "string"
    && head.sourceVersion.length > 0
    && Number.isFinite(cached.lastChangeSequence)
    && Number.isFinite(cached.packageVersion)
    && typeof cached.contentHash === "string"
    && cached.contentHash.length > 0
    && typeof cached.sourceVersion === "string"
    && cached.sourceVersion.length > 0;
}

async function json<T>(response: Response) {
  return await response.json().catch(() => ({})) as T;
}

async function loadPublishedDay(serviceDate: string, scope: ProductionScope, dependencies: LoaderDependencies): Promise<LoadedProjectionResponse> {
  const query = `serviceDate=${encodeURIComponent(serviceDate)}&scope=${scope}`;
  const response = await dependencies.fetch(`/api/production?projection=1&${query}`, { cache: "no-store" });
  const body = await json<ProjectionResponse>(response);
  if (response.ok && body.projection) return body as LoadedProjectionResponse;
  if (response.status !== 503) throw new Error(body.error?.message || "Could not load the CPU production projection.");

  // A missing or corrupt day package can be repaired only through the
  // explicit bounded CPU reconciliation path. Normal projection reads remain
  // package-first and fail closed.
  const reconciliation = await dependencies.fetch(`/api/production?projection=1&reconcile=1&${query}`, { cache: "no-store" });
  const reconciled = await json<ProjectionResponse>(reconciliation);
  if (!reconciliation.ok || !reconciled.projection) throw new Error(reconciled.error?.message || body.error?.message || "Could not load the CPU production projection.");
  return reconciled as LoadedProjectionResponse;
}

/** Loads the same bounded day projection used by the main CPU dashboard. */
export async function loadCpuAllergenProjection(serviceDate: string, scope: ProductionScope = "delivered_in", dependencies: LoaderDependencies = defaultDependencies()) {
  const scopeResponse = await dependencies.fetch("/api/production?cacheScope=1", { cache: "no-store" });
  const scopeBody = await json<{ cacheScope?: string; error?: { message?: string } }>(scopeResponse);
  if (!scopeResponse.ok || !scopeBody.cacheScope) throw new Error(scopeBody.error?.message || "CPU cache scope could not be established.");

  const cacheKey = `day:${serviceDate}`;
  const cacheScope = scopeBody.cacheScope;
  const cached = await dependencies.read(cacheKey, cacheScope);
  if (cached?.value) {
    try {
      const headResponse = await dependencies.fetch(`/api/production?projectionHead=1&serviceDate=${encodeURIComponent(serviceDate)}`, { cache: "no-store" });
      if (!headResponse.ok) throw new Error(CPU_ALLERGEN_FRESHNESS_ERROR);
      const head = await json<ProjectionHead>(headResponse);
      const unchanged = hasAuthoritativeIdentity(head, cached)
        && head.lastChangeSequence === cached.lastChangeSequence
        && head.packageVersion === cached.packageVersion
        && head.contentHash === cached.contentHash
        && head.sourceVersion === cached.sourceVersion;
      if (unchanged) return { projection: filterCpuProjectionForScope(cached.value, scope), cacheHit: true, package: { packageVersion: cached.packageVersion, contentHash: cached.contentHash, sourceVersion: cached.sourceVersion } };

      const refreshedBody = await loadPublishedDay(serviceDate, scope, dependencies);
      await dependencies.write({ key: cacheKey, schemaVersion: 1, cacheScope, fetchedAt: new Date().toISOString(), lastChangeSequence: refreshedBody.projection.lastChangeSequence, revision: refreshedBody.projection.revision, packageVersion: refreshedBody.package?.packageVersion, contentHash: refreshedBody.package?.contentHash, sourceVersion: refreshedBody.package?.sourceVersion, value: refreshedBody.projection });
      return { projection: filterCpuProjectionForScope(refreshedBody.projection, scope), cacheHit: false, package: refreshedBody.package };
    } catch (cause) {
      throw cause instanceof Error && cause.message === CPU_ALLERGEN_FRESHNESS_ERROR
        ? cause
        : new Error(CPU_ALLERGEN_FRESHNESS_ERROR, { cause });
    }
  }

  const body = await loadPublishedDay(serviceDate, scope, dependencies);
  await dependencies.write({ key: cacheKey, schemaVersion: 1, cacheScope, fetchedAt: new Date().toISOString(), lastChangeSequence: body.projection.lastChangeSequence, revision: body.projection.revision, packageVersion: body.package?.packageVersion, contentHash: body.package?.contentHash, sourceVersion: body.package?.sourceVersion, value: body.projection });
  return { projection: filterCpuProjectionForScope(body.projection, scope), cacheHit: false, package: body.package };
}
