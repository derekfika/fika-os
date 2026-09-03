import { encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CpuDayProjection, CpuWeekProjection } from "./cpu-projection";
import { cpuPackageStore } from "./cpu-package-store";

export type CpuProjectionPackage = CpuDayProjection | CpuWeekProjection;
export const CPU_PROJECTION_SCHEMA_VERSION = 1;
export const CPU_PROJECTION_CONTRACT = "cpu-production.projection.v1";

function isWeekProjection(projection: CpuProjectionPackage): projection is CpuWeekProjection { return "weekCommencing" in projection; }
function keyFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? `cpu-production/projection/week:${projection.weekCommencing}` : `cpu-production/projection/day/${projection.serviceDate}`; }
function keyForScope(serviceDate: string, weekCommencing?: string) { return weekCommencing ? `cpu-production/projection/week:${weekCommencing}` : `cpu-production/projection/day/${serviceDate}`; }
function datasetFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? "snapshots/cpu-production/projection-week" : "snapshots/cpu-production/projection-day"; }
function scopeFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? `week:${projection.weekCommencing}` : `day:${projection.serviceDate}`; }

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
      contractVersion: CPU_PROJECTION_CONTRACT,
      sourceVersion: `cpu-change-${projection.lastChangeSequence}`,
      scope: scopeFor(projection),
    });
    return publishReadPackage<{ projection: CpuProjectionPackage }>(store, key, encoded);
  })().finally(() => publicationInFlight.delete(key));
  publicationInFlight.set(key, publication);
  return publication;
}

function manifestMatchesProjection(manifest: ReadPackageManifest, projection: CpuProjectionPackage) {
  return manifest.dataset === datasetFor(projection)
    && manifest.packageVersion >= 1
    && manifest.schemaVersion === CPU_PROJECTION_SCHEMA_VERSION
    && manifest.contractVersion === CPU_PROJECTION_CONTRACT
    && manifest.compression === "gzip"
    && manifest.scope === scopeFor(projection)
    && manifest.sourceVersion === `cpu-change-${projection.lastChangeSequence}`
    && manifest.recordCount === projection.orders.length
    && typeof manifest.objectName === "string"
    && /^[a-f0-9]{64}$/.test(manifest.contentHash)
    && manifest.compressedSize > 0
    && manifest.uncompressedSize > 0;
}

export async function cpuProjectionPackageIsCurrent(projection: CpuProjectionPackage, store: ReadPackageStore = cpuPackageStore()) {
  try {
    const retrieved = await getCpuProjectionPackage(projection.serviceDate, isWeekProjection(projection) ? projection.weekCommencing : undefined, store);
    if (!retrieved || !manifestMatchesProjection(retrieved.manifest, projection)) return false;
    const packaged = retrieved.value.projection;
    if (packaged.serviceDate !== projection.serviceDate || packaged.revision !== projection.revision || packaged.lastChangeSequence !== projection.lastChangeSequence) return false;
    if (isWeekProjection(projection)) return isWeekProjection(packaged) && packaged.weekCommencing === projection.weekCommencing;
    return !isWeekProjection(packaged);
  } catch {
    return false;
  }
}

export async function getCpuProjectionPackage(serviceDate: string, weekCommencing?: string, store: ReadPackageStore = cpuPackageStore()) {
  const scopeKey = weekCommencing ? `week:${weekCommencing}` : serviceDate;
  const retrieved = await retrieveReadPackage<{ projection: CpuProjectionPackage }>(store, keyForScope(serviceDate, weekCommencing));
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
