import { decodeReadPackage, encodeReadPackage, publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { CpuDayProjection, CpuWeekProjection } from "./cpu-projection";
import { cpuPackageStore } from "./cpu-package-store";
import { cpuProjectionContentHash, cpuProjectionPackageHeads, cpuProjections } from "./cpu-projection-repository";
import { db } from "./firebase-admin";

export type CpuProjectionPackage = CpuDayProjection | CpuWeekProjection;
export const CPU_PROJECTION_SCHEMA_VERSION = 1;
export const CPU_PROJECTION_CONTRACT = "cpu-production.projection.v1";

function isWeekProjection(projection: CpuProjectionPackage): projection is CpuWeekProjection { return "weekCommencing" in projection; }
function keyFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? `cpu-production/projection/week:${projection.weekCommencing}` : `cpu-production/projection/day/${projection.serviceDate}`; }
function keyForScope(serviceDate: string, weekCommencing?: string) { return weekCommencing ? `cpu-production/projection/week:${weekCommencing}` : `cpu-production/projection/day/${serviceDate}`; }
function datasetFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? "snapshots/cpu-production/projection-week" : "snapshots/cpu-production/projection-day"; }
function scopeFor(projection: CpuProjectionPackage) { return isWeekProjection(projection) ? `week:${projection.weekCommencing}` : `day:${projection.serviceDate}`; }

let publicationInFlight = new Map<string, Promise<ReadPackageManifest>>();

type CpuPackageHead = {
  state: "pending" | "current" | "failed";
  sourceSequence: number;
  sourceHash: string;
  manifest?: ReadPackageManifest;
  pending?: { sourceSequence: number; sourceHash: string; manifest: ReadPackageManifest };
  failure?: { message: string; at: string };
};

function hostedPackageRuntime() { return ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || ""); }
function packageHeadId(key: string) { return key.replace(/[^A-Za-z0-9:_-]+/g, "_"); }
function sequenceOf(manifest: ReadPackageManifest | undefined) { return Number(manifest?.sourceVersion?.replace("cpu-change-", "") || 0); }
function packageConflict(sequence: number) { return Object.assign(new Error(`CPU package sequence ${sequence} has conflicting content.`), { code: "CPU_PACKAGE_SEQUENCE_CONFLICT", status: 409 }); }

async function publishHostedCpuPackage(store: ReadPackageStore, key: string, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }, sourceHash: string) {
  const ref = cpuProjectionPackageHeads().doc(packageHeadId(key));
  const prepared = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
    const currentSequence = Math.max(Number(head?.sourceSequence ?? -1), Number(head?.pending?.sourceSequence ?? -1));
    const incomingSequence = sequenceOf(encoded.manifest);
    if (incomingSequence < currentSequence) {
      if (head?.state === "current" && head.manifest) return { action: "superseded" as const, manifest: head.manifest };
      throw Object.assign(new Error("CPU package materialisation is superseded and has no current package."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
    }
    if (head?.state === "current" && incomingSequence === head.sourceSequence) {
      if (head.sourceHash !== sourceHash || head.manifest?.contentHash !== encoded.manifest.contentHash) throw packageConflict(incomingSequence);
      return { action: "idempotent" as const, manifest: head.manifest };
    }
    if (head?.pending && incomingSequence === head.pending.sourceSequence && (head.pending.sourceHash !== sourceHash || head.pending.manifest.contentHash !== encoded.manifest.contentHash)) throw packageConflict(incomingSequence);
    transaction.set(ref, { state: "pending", sourceSequence: head?.sourceSequence ?? -1, sourceHash: head?.sourceHash || "", ...(head?.manifest ? { manifest: head.manifest } : {}), pending: { sourceSequence: incomingSequence, sourceHash, manifest: encoded.manifest }, updatedAt: new Date().toISOString() });
    return { action: "publish" as const };
  });
  if (prepared.action === "superseded") {
    if (!prepared.manifest) throw Object.assign(new Error("CPU package materialisation was superseded before a current package existed."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
    return prepared.manifest;
  }
  if (prepared.action === "idempotent") return prepared.manifest!;
  try {
    await store.putImmutable(encoded.manifest.objectName, encoded.bytes, encoded.manifest.contentHash);
    const persisted = await store.get(encoded.manifest.objectName);
    if (!persisted) throw new Error(`Read package ${encoded.manifest.objectName} was not persisted.`);
    decodeReadPackage<{ projection: CpuProjectionPackage }>(encoded.manifest, persisted);
    const promoted = await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
      const incomingSequence = sequenceOf(encoded.manifest);
      if (head?.state === "current" && head.sourceSequence === incomingSequence) {
        if (head.sourceHash !== sourceHash || head.manifest?.contentHash !== encoded.manifest.contentHash) throw packageConflict(incomingSequence);
        return head.manifest!;
      }
      if (Number(head?.pending?.sourceSequence ?? -1) !== incomingSequence || head?.pending?.sourceHash !== sourceHash || head.pending.manifest.contentHash !== encoded.manifest.contentHash) {
        if (head?.state === "current" && head.manifest) return head.manifest;
        throw Object.assign(new Error("CPU package materialisation was superseded before promotion."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
      }
      transaction.set(ref, { state: "current", sourceSequence: incomingSequence, sourceHash, manifest: encoded.manifest, updatedAt: new Date().toISOString() });
      return encoded.manifest;
    });
    return promoted;
  } catch (error) {
    await db.runTransaction(async transaction => {
      const snapshot = await transaction.get(ref);
      const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
      if (head?.pending?.sourceSequence === sequenceOf(encoded.manifest) && head.pending.sourceHash === sourceHash && head.pending.manifest.contentHash === encoded.manifest.contentHash) {
        transaction.set(ref, { ...head, state: "failed", failure: { message: error instanceof Error ? error.message : "CPU package materialisation failed.", at: new Date().toISOString() }, updatedAt: new Date().toISOString() });
      }
    });
    throw error;
  }
}

export async function publishMonotonicCpuPackage(store: ReadPackageStore, key: string, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }, sourceHash: string) {
  if (hostedPackageRuntime()) return publishHostedCpuPackage(store, key, encoded, sourceHash);
  const previous = await store.getManifest(key);
  const incomingSequence = sequenceOf(encoded.manifest);
  if (previous && incomingSequence < sequenceOf(previous)) return previous;
  if (previous && incomingSequence === sequenceOf(previous) && previous.sourceHash && previous.sourceHash !== sourceHash) throw packageConflict(incomingSequence);
  return publishReadPackage(store, key, encoded);
}

async function currentHostedPackage(store: ReadPackageStore, key: string, projection: CpuProjectionPackage) {
  const retrieved = await getCurrentHostedCpuPackage<{ projection: CpuProjectionPackage }>(store, key);
  if (!retrieved) return undefined;
  const authoritative = await cpuProjections().doc(isWeekProjection(projection) ? `week:${projection.weekCommencing}` : projection.serviceDate).get();
  const stored = authoritative.data() as { lastChangeSequence?: number; projectionContentHash?: string } | undefined;
  const sourceSequence = Number(retrieved.manifest.sourceVersion?.replace("cpu-change-", "") || 0);
  if (!authoritative.exists || Number(stored?.lastChangeSequence || 0) !== sourceSequence || stored?.projectionContentHash !== retrieved.manifest.sourceHash) return undefined;
  if (cpuProjectionContentHash(retrieved.value.projection) !== retrieved.manifest.sourceHash || retrieved.value.projection.lastChangeSequence !== Number(retrieved.manifest.sourceVersion?.replace("cpu-change-", "") || 0)) return undefined;
  return retrieved;
}

export async function getCurrentHostedCpuPackage<T>(store: ReadPackageStore, key: string) {
  const snapshot = await cpuProjectionPackageHeads().doc(packageHeadId(key)).get();
  if (!snapshot.exists) return undefined;
  const head = snapshot.data() as CpuPackageHead;
  if (head.state !== "current" || !head.manifest) return undefined;
  const bytes = await store.get(head.manifest.objectName);
  if (!bytes) throw new Error(`Read package ${head.manifest.objectName} is unavailable.`);
  const value = decodeReadPackage<T>(head.manifest, bytes);
  return { manifest: head.manifest, value };
}

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
      sourceHash: cpuProjectionContentHash(projection),
      scope: scopeFor(projection),
    });
    return publishMonotonicCpuPackage(store, key, encoded, cpuProjectionContentHash(projection));
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
    && manifest.sourceHash === cpuProjectionContentHash(projection)
    && manifest.recordCount === projection.orders.length
    && typeof manifest.objectName === "string"
    && /^[a-f0-9]{64}$/.test(manifest.contentHash)
    && manifest.compressedSize > 0
    && manifest.uncompressedSize > 0;
}

export async function cpuProjectionPackageIsCurrent(projection: CpuProjectionPackage, store?: ReadPackageStore) {
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

export async function getCpuProjectionPackage(serviceDate: string, weekCommencing?: string, store?: ReadPackageStore) {
  const scopeKey = weekCommencing ? `week:${weekCommencing}` : serviceDate;
  const packageStore = store || cpuPackageStore();
  const key = keyForScope(serviceDate, weekCommencing);
  const retrieved = !store && hostedPackageRuntime() ? await currentHostedPackage(packageStore, key, weekCommencing ? { serviceDate: weekCommencing, weekCommencing } as CpuWeekProjection : { serviceDate } as CpuDayProjection) : await retrieveReadPackage<{ projection: CpuProjectionPackage }>(packageStore, key);
  if (!retrieved) return undefined;
  recordDataAccess({ app: "cpu-production", operation: "cpu-projection.package", source: "SNAPSHOT", documents: retrieved.manifest.recordCount, cacheHit: false });
  return retrieved;
}

export async function getCpuProjectionManifest(serviceDate: string, weekCommencing?: string) {
  if (hostedPackageRuntime()) {
    const snapshot = await cpuProjectionPackageHeads().doc(packageHeadId(keyForScope(serviceDate, weekCommencing))).get();
    const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
    if (head?.state !== "current" || !head.manifest) return undefined;
    const authoritative = await cpuProjections().doc(weekCommencing ? `week:${weekCommencing}` : serviceDate).get();
    const stored = authoritative.data() as { lastChangeSequence?: number; projectionContentHash?: string } | undefined;
    return authoritative.exists && Number(stored?.lastChangeSequence || 0) === head.sourceSequence && stored?.projectionContentHash === head.sourceHash ? head.manifest : undefined;
  }
  return cpuPackageStore().getManifest(keyForScope(serviceDate, weekCommencing));
}

export function recordCpuPackageFallback(reason: string) {
  recordDataAccess({ app: "cpu-production", operation: `cpu-projection.package-fallback.${reason}`, source: "UNKNOWN", documents: 0 });
}
