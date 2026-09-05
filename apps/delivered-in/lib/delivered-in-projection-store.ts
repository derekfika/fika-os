import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { publishReadPackage, retrieveReadPackage, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";

export const DELIVERED_IN_DATASET = "delivered-in/day";
export const DELIVERED_IN_INDEX_DATASET = "delivered-in/projection-index";
export const projectionManifestKey = (oplocId: string, serviceDate: string) => `${DELIVERED_IN_DATASET}/${encodeURIComponent(oplocId)}/${serviceDate}`;
export const projectionIndexManifestKey = (oplocId: string) => `${DELIVERED_IN_INDEX_DATASET}/${encodeURIComponent(oplocId)}`;
const addDays = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
export type DeliveredInProjectionIndexEntry = { oplocId: string; serviceDate: string; weekCommencing?: string; weekEnding?: string; publicationId?: string; projectionVersion: number; packageVersion: number; contentHash: string; freshness: "current" | "stale"; completeness: "complete" | "partial" | "missing" | "unavailable"; sourceVersion: string; generatedAt: string; state?: "available" | "withdrawn"; invalidation?: { sourceDomain: "menu-planning" | "cpu-production" | "integration-hub"; sourceEntityId: string; sourceVersion?: string; contentHash?: string; eventId: string; eventType: string; invalidatedAt: string } };
export type DeliveredInProjectionIndex = { oplocId: string; entries: DeliveredInProjectionIndexEntry[] };
export function mergeProjectionIndex(index: DeliveredInProjectionIndex, entry: DeliveredInProjectionIndexEntry): DeliveredInProjectionIndex {
  return { oplocId: index.oplocId, entries: [...index.entries.filter(candidate => candidate.serviceDate !== entry.serviceDate), entry].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)) };
}
const localRoot = () => process.env.FIKA_SNAPSHOT_DIR || path.join(process.cwd(), "local-data", "read-packages");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");

function localStore(): ReadPackageStore {
  const file = (name: string) => path.join(localRoot(), name);
  return {
    async putImmutable(name, bytes) { const target = file(name); await mkdir(path.dirname(target), { recursive: true }); try { await readFile(target); } catch { await writeFile(target, bytes); } },
    async get(name) { try { return await readFile(file(name)); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async has(name) { return Boolean(await this.get(name)); },
    async getManifest(key) { try { return JSON.parse(await readFile(file(`manifests/${key.replaceAll("/", "_")}.json`), "utf8")) as ReadPackageManifest; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } },
    async putManifest(key, manifest) { const target = file(`manifests/${key.replaceAll("/", "_")}.json`); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, JSON.stringify(manifest, null, 2)); },
  };
}

function cloudStore(): ReadPackageStore {
  const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
  const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;
  if (!projectId || !bucketName) throw Object.assign(new Error("Delivered-In projection package storage is not configured."), { status: 503, code: "DELIVERED_IN_PACKAGE_STORAGE_NOT_CONFIGURED" });
  const app = getApps()[0] || initializeApp({ projectId, storageBucket: bucketName });
  const bucket = getStorage(app).bucket(bucketName);
  return {
    async putImmutable(name, bytes, contentHash) { const object = bucket.file(name); const [exists] = await object.exists(); if (!exists) await object.save(Buffer.from(bytes), { resumable: false, metadata: { contentType: "application/json", contentEncoding: "gzip", metadata: { contentHash } } }); },
    async get(name) { try { const [bytes] = await bucket.file(name).download({ decompress: false }); return bytes; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async has(name) { const [exists] = await bucket.file(name).exists(); return exists; },
    async getManifest(key) { try { const [bytes] = await bucket.file(`manifests/${key}.json`).download(); return JSON.parse(bytes.toString("utf8")) as ReadPackageManifest; } catch (error) { if ((error as { code?: number }).code === 404) return undefined; throw error; } },
    async putManifest(key, manifest) { await bucket.file(`manifests/${key}.json`).save(JSON.stringify(manifest), { resumable: false, metadata: { contentType: "application/json" } }); },
  };
}

export function deliveredInProjectionStore() { return hosted() ? cloudStore() : localStore(); }

export async function readDeliveredInProjection(oplocId: string, serviceDate: string) {
  const result = await retrieveReadPackage<DeliveredInDayProjection>(deliveredInProjectionStore(), projectionManifestKey(oplocId, serviceDate));
  if (result) recordDataAccess({ app: "delivered-in", operation: "day-projection.read", source: "SNAPSHOT", documents: 1, cacheHit: false });
  return result;
}

export async function writeDeliveredInProjection(projection: DeliveredInDayProjection, options: { invalidation?: DeliveredInInvalidation } = {}) {
  const store = deliveredInProjectionStore();
  const key = projectionManifestKey(projection.oplocId, projection.serviceDate);
  const previous = await store.getManifest(key);
  const version = (previous?.packageVersion || 0) + 1;
  const versioned = { ...projection, projectionVersion: version };
  const { encodeReadPackage } = await import("@fika/server-shared/read-package");
  const encoded = encodeReadPackage(DELIVERED_IN_DATASET, version, versioned, versioned.entries.length, {
    contractVersion: versioned.contractVersion,
    sourceVersion: `${versioned.sourceLineage.menu.publicationDayId}:v${versioned.sourceLineage.menu.version}:${versioned.sourceLineage.menu.contentHash}`,
    scope: `${versioned.oplocId}:${versioned.serviceDate}`,
  });
  const manifest = await publishReadPackage<DeliveredInDayProjection>(store, key, encoded);
  await updateProjectionIndex(store, projection.oplocId, { oplocId: projection.oplocId, serviceDate: projection.serviceDate, weekCommencing: projection.weekCommencing, weekEnding: addDays(projection.weekCommencing || projection.serviceDate, 6), publicationId: projection.publicationId, projectionVersion: version, packageVersion: manifest.packageVersion, contentHash: manifest.contentHash, freshness: projection.state.freshness, completeness: projection.state.completeness, sourceVersion: encoded.manifest.sourceVersion || "", generatedAt: projection.generatedAt, state: "available", ...(options.invalidation ? { invalidation: { ...options.invalidation, invalidatedAt: projection.generatedAt } } : {}) });
  recordDataAccess({ app: "delivered-in", operation: "day-projection.publish", source: "SNAPSHOT", documents: 1, cacheHit: false });
  return { manifest, projection: versioned };
}

async function updateProjectionIndex(store: ReadPackageStore, oplocId: string, entry: DeliveredInProjectionIndexEntry) {
  const key = projectionIndexManifestKey(oplocId);
  const previous = await retrieveReadPackage<DeliveredInProjectionIndex>(store, key).catch(() => undefined);
  const index = mergeProjectionIndex({ oplocId, entries: previous?.value.entries || [] }, entry);
  const version = (previous?.manifest.packageVersion || 0) + 1;
  const { encodeReadPackage } = await import("@fika/server-shared/read-package");
  await publishReadPackage<DeliveredInProjectionIndex>(store, key, encodeReadPackage(DELIVERED_IN_INDEX_DATASET, version, index, index.entries.length, { contractVersion: "delivered-in.projection-index.v1", scope: oplocId }));
  recordDataAccess({ app: "delivered-in", operation: "projection-index.publish", source: "SNAPSHOT", documents: 1, cacheHit: false });
}

export async function readDeliveredInProjectionIndex(oplocId: string) {
  const result = await retrieveReadPackage<DeliveredInProjectionIndex>(deliveredInProjectionStore(), projectionIndexManifestKey(oplocId));
  if (result) recordDataAccess({ app: "delivered-in", operation: "projection-index.read", source: "SNAPSHOT", documents: result.value.entries.length, cacheHit: false });
  return result;
}

export async function withdrawDeliveredInProjectionDay(oplocId: string, serviceDate: string, sourceVersion = "withdrawn") {
  const store = deliveredInProjectionStore();
  const current = await retrieveReadPackage<DeliveredInProjectionIndex>(store, projectionIndexManifestKey(oplocId)).catch(() => undefined);
  const existing = current?.value.entries.find(entry => entry.serviceDate === serviceDate);
  await updateProjectionIndex(store, oplocId, { oplocId, serviceDate, projectionVersion: existing?.projectionVersion || 0, packageVersion: existing?.packageVersion || 0, contentHash: existing?.contentHash || "", freshness: "current", completeness: "missing", sourceVersion, generatedAt: new Date().toISOString(), state: "withdrawn" });
}

export type DeliveredInInvalidation = { sourceDomain: "menu-planning" | "cpu-production" | "integration-hub"; sourceEntityId: string; publicationId?: string; eventId: string; eventType: "changed" | "amended" | "withdrawn" | "superseded"; serviceDate: string; oplocId: string; sourceVersion?: string; contentHash?: string };
function versionNumber(value?: string) {
  // Source versions commonly carry a content hash after the revision (for
  // example `publication-day:v2:<hash>`), so reading only trailing digits
  // loses amendment ordering. Prefer an explicit vN/change-N marker.
  const match = value?.match(/(?:^|[:_-])v(\d+)(?:[:_-]|$)/i) || value?.match(/(?:^|[:_-])change-(\d+)(?:[:_-]|$)/i) || value?.match(/(\d+)$/);
  return match ? Number(match[1]) : undefined;
}
function sourceVersionIsOlder(incoming: string | undefined, existing: string | undefined) {
  if (!incoming || !existing || incoming === existing) return false;
  const next = versionNumber(incoming); const prior = versionNumber(existing);
  return next !== undefined && prior !== undefined && next < prior;
}
function sourceVersionIsNewer(incoming: string | undefined, existing: string | undefined) {
  if (!incoming || !existing || incoming === existing) return false;
  const next = versionNumber(incoming); const prior = versionNumber(existing);
  return next !== undefined && prior !== undefined && next > prior;
}
export async function markDeliveredInProjectionStale(change: DeliveredInInvalidation): Promise<"stale" | "duplicate" | "older" | "missing" | "withdrawn"> {
  const store = deliveredInProjectionStore();
  const current = await retrieveReadPackage<DeliveredInProjectionIndex>(store, projectionIndexManifestKey(change.oplocId)).catch(() => undefined);
  const existing = current?.value.entries.find(entry => entry.serviceDate === change.serviceDate);
  if (!existing) return "missing";
  const prior = existing.invalidation;
  if (existing.state === "withdrawn" && prior?.eventType === "withdrawn" && change.eventType === "withdrawn") return "withdrawn";
  if (prior?.eventId === change.eventId) return "duplicate";
  if (prior && prior.sourceDomain === change.sourceDomain && prior.sourceEntityId === change.sourceEntityId && sourceVersionIsOlder(change.sourceVersion, prior.sourceVersion)) return "older";
  // A first late-arriving amendment must also be compared with the version
  // that produced the currently indexed package; otherwise an old amendment
  // can incorrectly make a newer package look authoritative.
  if (!prior && change.sourceDomain === "menu-planning" && sourceVersionIsOlder(change.sourceVersion, existing.sourceVersion)) return "older";
  if (existing.state === "withdrawn" && (prior?.eventType === "withdrawn" || prior?.eventType === "superseded")) {
    if (!sourceVersionIsNewer(change.sourceVersion, prior.sourceVersion)) return "withdrawn";
  }
  const invalidatedAt = new Date().toISOString();
  if (change.eventType === "withdrawn" || change.eventType === "superseded") {
    await updateProjectionIndex(store, change.oplocId, { ...existing, freshness: "current", completeness: "missing", state: "withdrawn", sourceVersion: change.sourceVersion || existing.sourceVersion, generatedAt: invalidatedAt, invalidation: { ...change, invalidatedAt } });
    return "withdrawn";
  }
  await updateProjectionIndex(store, change.oplocId, { ...existing, freshness: "stale", state: "available", invalidation: { ...change, invalidatedAt } });
  return "stale";
}
