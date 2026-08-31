import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CpuDayProjection, CpuWeekProjection } from "./cpu-projection";
import { cpuPackageStore } from "./cpu-package-store";

export type CpuProjectionPackage = CpuDayProjection | CpuWeekProjection;
export const CPU_PROJECTION_SCHEMA_VERSION = 1;

function isWeekProjection(projection: CpuProjectionPackage) { return "weekCommencing" in projection; }
function keyFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? `cpu-production/projection/week:${projection.weekCommencing}` : `cpu-production/projection/day/${projection.serviceDate}`; }
function keyForScope(serviceDate: string, weekCommencing?: string) { return weekCommencing ? `cpu-production/projection/week:${weekCommencing}` : `cpu-production/projection/day/${serviceDate}`; }
function datasetFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? "snapshots/cpu-production/projection-week" : "snapshots/cpu-production/projection-day"; }

let publicationInFlight = new Map<string, Promise<ReadPackageManifest>>();

export async function publishCpuProjectionPackage(projection: CpuProjectionPackage): Promise<ReadPackageManifest> {
    const key = keyFor(projection);
  const existing = publicationInFlight.get(key);
  if (existing) return existing;
  const publication = (async () => {
    const store = cpuPackageStore();
    const previous = await store.getManifest(key);
    const version = (previous?.packageVersion || 0) + 1;
    const value = { projection };
    const encoded = encodeReadPackage(datasetFor(projection), version, value, projection.orders.length, {
      contractVersion: "cpu-production.projection.v1",
      sourceVersion: `cpu-change-${projection.lastChangeSequence}`,
      scope: isWeekProjection(projection) ? `week:${projection.weekCommencing}` : `day:${projection.serviceDate}`,
    });
    return publishReadPackage<{ projection: CpuProjectionPackage }>(store, key, encoded);
  })().finally(() => publicationInFlight.delete(key));
  publicationInFlight.set(key, publication);
  return publication;
}

export async function getCpuProjectionPackage(serviceDate: string, weekCommencing?: string) {
  const scopeKey = weekCommencing ? `week:${weekCommencing}` : serviceDate;
  const retrieved = await retrieveReadPackage<{ projection: CpuProjectionPackage }>(cpuPackageStore(), keyForScope(serviceDate, weekCommencing));
  if (!retrieved) return undefined;
  recordDataAccess({ app: "cpu-production", operation: "cpu-projection.package", source: "SNAPSHOT", documents: retrieved.manifest.recordCount, cacheHit: false });
  return retrieved;
}

export async function getCpuProjectionManifest(serviceDate: string, weekCommencing?: string) {
  return cpuPackageStore().getManifest(keyForScope(serviceDate, weekCommencing));
}

export function recordCpuPackageFallback(reason: string) {
  recordDataAccess({ app: "cpu-production", operation: `cpu-projection.package-fallback.${reason}`, source: "UNKNOWN", documents: 0 });
}
