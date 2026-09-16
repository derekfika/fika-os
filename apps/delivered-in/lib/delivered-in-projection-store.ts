import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";
import { canonicalJson, decodeReadPackage, encodeReadPackage, publishReadPackage, retrieveReadPackage, sha256, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import type { DeliveredInDayProjection } from "./delivered-in-day-projection";
import { db } from "./firebase-admin";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";

export const DELIVERED_IN_DATASET = "delivered-in/day";
export const DELIVERED_IN_INDEX_DATASET = "delivered-in/projection-index";
export const projectionManifestKey = (oplocId: string, serviceDate: string) => `${DELIVERED_IN_DATASET}/${encodeURIComponent(oplocId)}/${serviceDate}`;
export const projectionIndexManifestKey = (oplocId: string) => `${DELIVERED_IN_INDEX_DATASET}/${encodeURIComponent(oplocId)}`;
const addDays = (date: string, days: number) => { const value = new Date(`${date}T12:00:00Z`); value.setUTCDate(value.getUTCDate() + days); return value.toISOString().slice(0, 10); };
export type DeliveredInProjectionIndexEntry = { oplocId: string; serviceDate: string; weekCommencing?: string; weekEnding?: string; publicationId?: string; projectionVersion: number; packageVersion: number; contentHash: string; freshness: "current" | "stale"; completeness: "complete" | "partial" | "missing" | "unavailable"; sourceVersion: string; sourceSequence?: number; sourceLineageKey?: string; packageObjectName?: string; generatedAt: string; state?: "available" | "withdrawn"; withdrawnFromSourceVersion?: string; invalidation?: { sourceDomain: "menu-planning" | "cpu-production" | "integration-hub"; sourceEntityId: string; sourceVersion?: string; contentHash?: string; eventId: string; eventType: string; invalidatedAt: string } };
export type DeliveredInProjectionIndex = { oplocId: string; entries: DeliveredInProjectionIndexEntry[] };
export function mergeProjectionIndex(index: DeliveredInProjectionIndex, entry: DeliveredInProjectionIndexEntry): DeliveredInProjectionIndex {
  return { oplocId: index.oplocId, entries: [...index.entries.filter(candidate => candidate.serviceDate !== entry.serviceDate), entry].sort((a, b) => a.serviceDate.localeCompare(b.serviceDate)) };
}
const localRoot = () => process.env.FIKA_SNAPSHOT_DIR || path.join(process.cwd(), "local-data", "read-packages");
const hosted = () => ["staging", "production"].includes(process.env.FIKA_RUNTIME_MODE || "");
const indexUpdateQueues = new Map<string, Promise<void>>();
const projectionHeads = () => db.collection("fikaDeliveredInProjectionHeadsV1");
const projectionIndexHeads = () => db.collection("fikaDeliveredInProjectionIndexHeadsV1");
type HostedProjectionHead = { state: "current" | "withdrawn"; manifest?: ReadPackageManifest; entry: DeliveredInProjectionIndexEntry; updatedAt: string };
type HostedProjectionIndexHead = { oplocId: string; revision: number; entries: DeliveredInProjectionIndexEntry[]; updatedAt: string };
const mondayOf = (date: string) => { const value = new Date(`${date}T00:00:00Z`); const day = value.getUTCDay(); value.setUTCDate(value.getUTCDate() - (day === 0 ? 6 : day - 1)); return value.toISOString().slice(0, 10); };
const indexWeekForEntry = (entry: Pick<DeliveredInProjectionIndexEntry, "serviceDate" | "weekCommencing">) => mondayOf(entry.weekCommencing || entry.serviceDate);
const indexHeadRef = (oplocId: string, weekCommencing: string) => projectionIndexHeads().doc(stableDocumentId(`${oplocId}:${mondayOf(weekCommencing)}`));
function currentIndexWeeks() {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const first = mondayOf(today);
  return Array.from({ length: 7 }, (_, index) => addDays(first, index * 7));
}

function sourceLineageKey(projection: DeliveredInDayProjection) {
  const menu = projection.sourceLineage.menu;
  const cpu = projection.sourceLineage.cpu;
  return [menu.publicationId, menu.publicationDayId, menu.version, menu.contentHash, cpu.releaseId || cpu.sourceVersion || cpu.sourceBundleHash || "none"].join("|");
}
function sourceSequenceForProjection(projection: DeliveredInDayProjection) {
  const cpuSequence = projection.sourceLineage.cpu.sourceVersion?.match(/(?:^|[-:_])(?:change-)?(\d+)$/)?.[1];
  return cpuSequence ? Number(cpuSequence) : projection.sourceLineage.menu.version;
}
function entryLineageKey(entry: DeliveredInProjectionIndexEntry) { return entry.sourceLineageKey || `${entry.publicationId || ""}|${entry.sourceVersion}`; }
function compareIndexEntry(current: DeliveredInProjectionIndexEntry | undefined, incoming: DeliveredInProjectionIndexEntry) {
  if (!current) return "advance" as const;
  if (current.sourceSequence !== undefined && incoming.sourceSequence !== undefined && incoming.sourceSequence !== current.sourceSequence) return incoming.sourceSequence < current.sourceSequence ? "superseded" as const : "advance" as const;
  if (entryLineageKey(current) === entryLineageKey(incoming)) {
    if (incoming.state === "withdrawn") return current.state === "withdrawn" ? "idempotent" as const : "advance" as const;
    if (current.contentHash !== incoming.contentHash) throw Object.assign(new Error("Delivered-In projection lineage has conflicting package content."), { code: "DELIVERED_IN_PROJECTION_LINEAGE_CONFLICT", status: 409 });
    if (current.state === "withdrawn") return "superseded" as const;
    return current.freshness === incoming.freshness && current.completeness === incoming.completeness && current.state === incoming.state ? "idempotent" as const : "advance" as const;
  }
  if (sourceVersionIsOlder(incoming.sourceVersion, current.sourceVersion)) return "superseded" as const;
  if (current.state === "withdrawn") return "advance" as const;
  return "advance" as const;
}
export const compareDeliveredInProjectionIndexEntry = compareIndexEntry;

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
  const store = deliveredInProjectionStore();
  const result = hosted() ? await readHostedProjection(store, oplocId, serviceDate) : await retrieveReadPackage<DeliveredInDayProjection>(store, projectionManifestKey(oplocId, serviceDate));
  if (result) recordDataAccess({ app: "delivered-in", operation: "day-projection.read", source: "SNAPSHOT", documents: 1, cacheHit: false });
  return result;
}

async function persistVerifiedObject<T>(store: ReadPackageStore, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }) {
  await store.putImmutable(encoded.manifest.objectName, encoded.bytes, encoded.manifest.contentHash);
  const persisted = await store.get(encoded.manifest.objectName);
  if (!persisted) throw new Error(`Delivered-In package ${encoded.manifest.objectName} was not persisted.`);
  return decodeReadPackage<T>(encoded.manifest, persisted);
}

async function readHostedProjection(store: ReadPackageStore, oplocId: string, serviceDate: string) {
  const headSnapshot = await projectionHeads().doc(stableDocumentId(`${oplocId}:${serviceDate}`)).get();
  if (!headSnapshot.exists) return undefined;
  const head = headSnapshot.data() as HostedProjectionHead;
  if (head.state !== "current" || !head.manifest || head.entry.state === "withdrawn") return undefined;
  const indexSnapshot = await indexHeadRef(oplocId, indexWeekForEntry(head.entry)).get();
  recordDataAccess({ app: "delivered-in", operation: "day-projection.heads.read", source: "FIRESTORE", documents: 2, firestoreReadKind: "document" });
  const index = indexSnapshot.exists ? indexSnapshot.data() as HostedProjectionIndexHead : undefined;
  const indexed = index?.entries.find(entry => entry.serviceDate === serviceDate);
  if (!indexed || indexed.state === "withdrawn" || indexed.freshness !== "current" || indexed.completeness !== "complete" || indexed.contentHash !== head.manifest.contentHash || indexed.packageObjectName !== head.manifest.objectName || entryLineageKey(indexed) !== entryLineageKey(head.entry)) return undefined;
  const bytes = await store.get(head.manifest.objectName);
  if (!bytes) throw new Error(`Delivered-In package ${head.manifest.objectName} is unavailable.`);
  const value = decodeReadPackage<DeliveredInDayProjection>(head.manifest, bytes);
  return { manifest: head.manifest, value };
}

export async function writeDeliveredInProjection(projection: DeliveredInDayProjection, options: { invalidation?: DeliveredInInvalidation } = {}) {
  const store = deliveredInProjectionStore();
  const key = projectionManifestKey(projection.oplocId, projection.serviceDate);
  const previous = hosted() ? ((await projectionHeads().doc(stableDocumentId(`${projection.oplocId}:${projection.serviceDate}`)).get()).data() as HostedProjectionHead | undefined)?.manifest : await store.getManifest(key);
  const version = (previous?.packageVersion || 0) + 1;
  const versioned = { ...projection, projectionVersion: version };
  const encoded = encodeReadPackage(DELIVERED_IN_DATASET, version, versioned, versioned.entries.length, {
    contractVersion: versioned.contractVersion,
    sourceVersion: `${versioned.sourceLineage.menu.publicationDayId}:v${versioned.sourceLineage.menu.version}:${versioned.sourceLineage.menu.contentHash}`,
    sourceHash: versioned.sourceLineage.menu.contentHash,
    scope: `${versioned.oplocId}:${versioned.serviceDate}`,
  });
  if (hosted()) return writeHostedProjection(store, projection, versioned, encoded, options.invalidation);
  const manifest = await publishReadPackage<DeliveredInDayProjection>(store, key, encoded);
  await updateProjectionIndex(store, projection.oplocId, { oplocId: projection.oplocId, serviceDate: projection.serviceDate, weekCommencing: projection.weekCommencing, weekEnding: addDays(projection.weekCommencing || projection.serviceDate, 6), publicationId: projection.publicationId, projectionVersion: version, packageVersion: manifest.packageVersion, contentHash: manifest.contentHash, freshness: projection.state.freshness, completeness: projection.state.completeness, sourceVersion: encoded.manifest.sourceVersion || "", sourceLineageKey: sourceLineageKey(projection), packageObjectName: manifest.objectName, generatedAt: projection.generatedAt, state: "available", ...(options.invalidation ? { invalidation: { ...options.invalidation, invalidatedAt: projection.generatedAt } } : {}) });
  recordDataAccess({ app: "delivered-in", operation: "day-projection.publish", source: "SNAPSHOT", documents: 1, cacheHit: false });
  return { manifest, projection: versioned };
}

async function writeHostedProjection(store: ReadPackageStore, projection: DeliveredInDayProjection, versioned: DeliveredInDayProjection, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }, invalidation?: DeliveredInInvalidation) {
  await persistVerifiedObject<DeliveredInDayProjection>(store, encoded);
  const dayRef = projectionHeads().doc(stableDocumentId(`${projection.oplocId}:${projection.serviceDate}`));
  const incoming: DeliveredInProjectionIndexEntry = { oplocId: projection.oplocId, serviceDate: projection.serviceDate, weekCommencing: projection.weekCommencing, weekEnding: addDays(projection.weekCommencing || projection.serviceDate, 6), publicationId: projection.publicationId, projectionVersion: versioned.projectionVersion, packageVersion: encoded.manifest.packageVersion, contentHash: encoded.manifest.contentHash, freshness: projection.state.freshness, completeness: projection.state.completeness, sourceVersion: encoded.manifest.sourceVersion || "", sourceSequence: sourceSequenceForProjection(projection), sourceLineageKey: sourceLineageKey(projection), packageObjectName: encoded.manifest.objectName, generatedAt: projection.generatedAt, state: "available", ...(invalidation ? { invalidation: { ...invalidation, invalidatedAt: projection.generatedAt } } : {}) };
  const indexRef = indexHeadRef(projection.oplocId, indexWeekForEntry(incoming));
  const result = await db.runTransaction(async transaction => {
    const daySnapshot = await transaction.get(dayRef);
    const indexSnapshot = await transaction.get(indexRef);
    const dayHead = daySnapshot.exists ? daySnapshot.data() as HostedProjectionHead : undefined;
    const indexHead = indexSnapshot.exists ? indexSnapshot.data() as HostedProjectionIndexHead : { oplocId: projection.oplocId, revision: 0, entries: [], updatedAt: new Date().toISOString() };
    const dayDecision = compareIndexEntry(dayHead?.entry, incoming);
    const currentIndexed = indexHead.entries.find(entry => entry.serviceDate === projection.serviceDate);
    const indexDecision = compareIndexEntry(currentIndexed, incoming);
    if (dayDecision === "superseded" || indexDecision === "superseded") return { status: "superseded" as const, manifest: dayHead?.manifest };
    const merged = currentIndexed && indexDecision === "idempotent" ? indexHead.entries : mergeProjectionIndex({ oplocId: projection.oplocId, entries: indexHead.entries }, incoming).entries;
    const indexChanged = JSON.stringify(merged) !== JSON.stringify(indexHead.entries);
    if (dayDecision !== "idempotent" || indexChanged) transaction.set(dayRef, { state: "current", manifest: encoded.manifest, entry: incoming, updatedAt: projection.generatedAt });
    if (indexChanged) transaction.set(indexRef, { oplocId: projection.oplocId, revision: indexHead.revision + 1, entries: merged, updatedAt: projection.generatedAt });
    return { status: dayDecision === "idempotent" && !indexChanged ? "idempotent" as const : "advanced" as const, manifest: dayDecision === "idempotent" && dayHead?.manifest ? dayHead.manifest : encoded.manifest };
  });
  if (result.status === "superseded") return { manifest: result.manifest || encoded.manifest, projection: versioned };
  recordDataAccess({ app: "delivered-in", operation: "projection.atomic-promote", source: "FIRESTORE", documents: 2, estimatedFirestoreWrites: result.status === "idempotent" ? 0 : 2, firestoreReadKind: "transaction" });
  return { manifest: result.manifest, projection: versioned };
}

async function updateProjectionIndex(store: ReadPackageStore, oplocId: string, entry: DeliveredInProjectionIndexEntry) {
  if (hosted()) return updateHostedProjectionIndex(oplocId, entry);
  const key = projectionIndexManifestKey(oplocId);
  const prior = indexUpdateQueues.get(key) || Promise.resolve();
  const update = prior.catch(() => undefined).then(async () => {
    const previous = await retrieveReadPackage<DeliveredInProjectionIndex>(store, key).catch(() => undefined);
    const index = mergeProjectionIndex({ oplocId, entries: previous?.value.entries || [] }, entry);
    const version = (previous?.manifest.packageVersion || 0) + 1;
    const { encodeReadPackage } = await import("@fika/server-shared/read-package");
    await publishReadPackage<DeliveredInProjectionIndex>(store, key, encodeReadPackage(DELIVERED_IN_INDEX_DATASET, version, index, index.entries.length, { contractVersion: "delivered-in.projection-index.v1", scope: oplocId }));
    recordDataAccess({ app: "delivered-in", operation: "projection-index.publish", source: "SNAPSHOT", documents: 1, cacheHit: false });
  });
  indexUpdateQueues.set(key, update);
  try { await update; } finally { if (indexUpdateQueues.get(key) === update) indexUpdateQueues.delete(key); }
}

async function updateHostedProjectionIndex(oplocId: string, entry: DeliveredInProjectionIndexEntry) {
  const ref = indexHeadRef(oplocId, indexWeekForEntry(entry));
  const dayRef = projectionHeads().doc(stableDocumentId(`${oplocId}:${entry.serviceDate}`));
  const result = await db.runTransaction(async transaction => {
    const snapshot = await transaction.get(ref);
    const daySnapshot = await transaction.get(dayRef);
    const current = snapshot.exists ? snapshot.data() as HostedProjectionIndexHead : { oplocId, revision: 0, entries: [], updatedAt: new Date().toISOString() };
    const existing = current.entries.find(candidate => candidate.serviceDate === entry.serviceDate);
    const decision = compareIndexEntry(existing, entry);
    if (decision === "superseded" || decision === "idempotent") return { writes: 0 };
    transaction.set(ref, { oplocId, revision: current.revision + 1, entries: mergeProjectionIndex({ oplocId, entries: current.entries }, entry).entries, updatedAt: entry.generatedAt });
    const withdrawWrite = entry.state === "withdrawn" && daySnapshot.exists;
    if (withdrawWrite) transaction.set(dayRef, { ...(daySnapshot.data() as HostedProjectionHead), state: "withdrawn", updatedAt: entry.generatedAt });
    return { writes: withdrawWrite ? 2 : 1 };
  });
  recordDataAccess({ app: "delivered-in", operation: "projection-index.atomic-promote", source: "FIRESTORE", documents: 2, estimatedFirestoreWrites: result.writes, firestoreReadKind: "transaction" });
}

export async function readDeliveredInProjectionIndex(oplocId: string, requestedWeek?: string) {
  const result = hosted() ? await readHostedProjectionIndex(oplocId, requestedWeek) : await retrieveReadPackage<DeliveredInProjectionIndex>(deliveredInProjectionStore(), projectionIndexManifestKey(oplocId));
  if (result) recordDataAccess({ app: "delivered-in", operation: "projection-index.read", source: "SNAPSHOT", documents: result.value.entries.length, cacheHit: false });
  return result;
}

export async function withdrawDeliveredInProjectionDay(oplocId: string, serviceDate: string, sourceVersion = "withdrawn", lineage: { sourceSequence?: number; sourceLineageKey?: string } = {}) {
  const store = deliveredInProjectionStore();
  const current = await readDeliveredInProjectionIndex(oplocId).catch(() => undefined);
  const existing = current?.value.entries.find(entry => entry.serviceDate === serviceDate);
  await updateProjectionIndex(store, oplocId, { oplocId, serviceDate, weekCommencing: existing?.weekCommencing || mondayOf(serviceDate), weekEnding: addDays(existing?.weekCommencing || mondayOf(serviceDate), 6), publicationId: existing?.publicationId, projectionVersion: existing?.projectionVersion || 0, packageVersion: existing?.packageVersion || 0, contentHash: existing?.contentHash || "", freshness: "current", completeness: "missing", sourceVersion, ...(existing?.sourceSequence !== undefined ? { sourceSequence: existing.sourceSequence } : lineage.sourceSequence !== undefined ? { sourceSequence: lineage.sourceSequence } : {}), ...(existing?.sourceLineageKey ? { sourceLineageKey: existing.sourceLineageKey } : lineage.sourceLineageKey ? { sourceLineageKey: lineage.sourceLineageKey } : {}), ...(existing?.sourceVersion ? { withdrawnFromSourceVersion: existing.sourceVersion } : {}), generatedAt: new Date().toISOString(), state: "withdrawn" });
}

async function readHostedProjectionIndex(oplocId: string, requestedWeek?: string) {
  const weeks = requestedWeek ? [mondayOf(requestedWeek)] : currentIndexWeeks();
  const snapshots = await Promise.all(weeks.map(week => indexHeadRef(oplocId, week).get()));
  recordDataAccess({ app: "delivered-in", operation: "projection-index.heads.read", source: "FIRESTORE", documents: weeks.length, firestoreReadKind: "document" });
  const heads = snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as HostedProjectionIndexHead);
  if (!heads.length) return undefined;
  const entries = heads.flatMap(head => head.entries).sort((a, b) => a.serviceDate.localeCompare(b.serviceDate));
  const revision = heads.reduce((sum, head) => sum + head.revision, 0);
  const updatedAt = heads.map(head => head.updatedAt).sort().at(-1) || new Date(0).toISOString();
  const contentHash = sha256(canonicalJson(entries));
  const manifest: ReadPackageManifest = { dataset: DELIVERED_IN_INDEX_DATASET, packageVersion: revision, schemaVersion: 1, contractVersion: "delivered-in.projection-index.v1", objectName: `firestore-head/${stableDocumentId(`${oplocId}:${weeks.join(",")}`)}`, compression: "gzip", contentHash, compressedSize: 0, uncompressedSize: 0, recordCount: entries.length, generatedAt: updatedAt, scope: oplocId };
  return { manifest, value: { oplocId, entries } };
}

export async function markDeliveredInProjectionDayUnavailable(input: { oplocId: string; serviceDate: string; weekCommencing: string; publicationId?: string; sourceVersion?: string }) {
  const store = deliveredInProjectionStore();
  const current = await readDeliveredInProjectionIndex(input.oplocId).catch(() => undefined);
  const existing = current?.value.entries.find(entry => entry.serviceDate === input.serviceDate);
  await updateProjectionIndex(store, input.oplocId, {
    oplocId: input.oplocId,
    serviceDate: input.serviceDate,
    weekCommencing: input.weekCommencing,
    weekEnding: addDays(input.weekCommencing, 6),
    publicationId: input.publicationId || existing?.publicationId,
    projectionVersion: existing?.projectionVersion || 0,
    packageVersion: existing?.packageVersion || 0,
    contentHash: existing?.contentHash || "",
    freshness: "stale",
    completeness: "unavailable",
    sourceVersion: input.sourceVersion || existing?.sourceVersion || "recovery-unavailable",
    generatedAt: new Date().toISOString(),
    state: "available",
  });
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
  const current = await readDeliveredInProjectionIndex(change.oplocId).catch(() => undefined);
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
