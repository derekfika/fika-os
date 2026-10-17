import { decodeReadPackage, encodeReadPackage, publishReadPackage, retrieveReadPackage, type ImmutablePackageOperation, type ReadPackageManifest, type ReadPackageStore } from "@fika/server-shared/read-package";
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

type CpuPackageHeadSnapshot = { exists: boolean; data(): unknown };
export type CpuPackageHeadTransaction = { get(ref: unknown): Promise<CpuPackageHeadSnapshot>; set(ref: unknown, value: unknown): unknown };
export type CpuPackagePublicationDiagnostic = {
  event: "cpu.package.publication";
  stage: string;
  outcome: "started" | "read" | "absent" | "staged" | "committed" | "completed" | "verified" | "failed" | "idempotent" | "superseded";
  requestId?: string;
  dataset: string;
  scope?: string;
  project?: string;
  database: string;
  runtimeIdentity?: string;
  resourceClass: "firestore-document" | "gcs-manifest" | "gcs-immutable-object";
  resource: string;
  packageVersion: number;
  sourceSequence: number;
  errorName?: string;
  errorCode?: string | number;
  attempt?: number;
};
export type CpuPackagePublicationAdapters = {
  headRef: unknown;
  headPath: string;
  runTransaction<T>(callback: (transaction: CpuPackageHeadTransaction) => Promise<T>): Promise<T>;
  log?(diagnostic: CpuPackagePublicationDiagnostic): void;
};
export type CpuPackagePublicationContext = { requestId?: string };

function safeRequestId(value: string | undefined) { return value ? value.replace(/[^A-Za-z0-9._:-]/g, "_").slice(0, 128) : undefined; }
function safeErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return undefined;
  const code = (error as { code?: unknown; status?: unknown; statusCode?: unknown }).code ?? (error as { status?: unknown }).status ?? (error as { statusCode?: unknown }).statusCode;
  if (typeof code === "number") return code;
  return typeof code === "string" ? code.replace(/[^A-Za-z0-9_.:/-]/g, "_").slice(0, 80) : undefined;
}
function defaultPublicationLog(diagnostic: CpuPackagePublicationDiagnostic) {
  const line = JSON.stringify(diagnostic);
  if (diagnostic.outcome === "failed") console.error(line);
  else console.info(line);
}
function publicationDiagnostic(manifest: ReadPackageManifest, key: string, stage: string, outcome: CpuPackagePublicationDiagnostic["outcome"], resourceClass: CpuPackagePublicationDiagnostic["resourceClass"], resource: string, context: CpuPackagePublicationContext, error?: unknown, attempt?: number): CpuPackagePublicationDiagnostic {
  const errorName = error && typeof error === "object" && "name" in error && typeof error.name === "string" ? error.name.slice(0, 80) : undefined;
  return {
    event: "cpu.package.publication", stage, outcome,
    ...(safeRequestId(context.requestId) ? { requestId: safeRequestId(context.requestId) } : {}),
    dataset: manifest.dataset, ...(manifest.scope ? { scope: manifest.scope } : { scope: key }),
    ...(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT ? { project: process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT } : {}),
    database: "(default)",
    ...(process.env.FIKA_RUNTIME_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ? { runtimeIdentity: process.env.FIKA_RUNTIME_SERVICE_ACCOUNT || process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL } : {}),
    resourceClass, resource, packageVersion: manifest.packageVersion, sourceSequence: sequenceOf(manifest),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(errorName ? { errorName } : {}), ...(safeErrorCode(error) !== undefined ? { errorCode: safeErrorCode(error) } : {}),
  };
}

type PublicationTransactionAttempt = { number: number; writeStaged: boolean; callbackReturned: boolean };
async function runDiagnosedTransaction<T>(adapters: CpuPackagePublicationAdapters, manifest: ReadPackageManifest, key: string, context: CpuPackagePublicationContext, transactionStage: string, commitStage: string, headResource: string, callback: (transaction: CpuPackageHeadTransaction, attempt: PublicationTransactionAttempt) => Promise<T>) {
  let attemptNumber = 0;
  let finalAttempt: PublicationTransactionAttempt | undefined;
  try {
    const value = await adapters.runTransaction(async transaction => {
      const attempt = { number: ++attemptNumber, writeStaged: false, callbackReturned: false };
      finalAttempt = attempt;
      emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, transactionStage, "started", "firestore-document", headResource, context, undefined, attempt.number));
      const result = await callback(transaction, attempt);
      attempt.callbackReturned = true;
      return result;
    });
    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, transactionStage, "completed", "firestore-document", headResource, context, undefined, finalAttempt?.number));
    if (finalAttempt?.writeStaged) emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, commitStage, "committed", "firestore-document", headResource, context, undefined, finalAttempt.number));
    return { value, finalAttempt };
  } catch (error) {
    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, transactionStage, "failed", "firestore-document", headResource, context, error, finalAttempt?.number));
    if (finalAttempt?.callbackReturned && finalAttempt.writeStaged) emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, commitStage, "failed", "firestore-document", headResource, context, error, finalAttempt.number));
    throw error;
  }
}

function logImmutableOperation(adapters: CpuPackagePublicationAdapters, manifest: ReadPackageManifest, key: string, objectResource: string, context: CpuPackagePublicationContext, operation: ImmutablePackageOperation) {
  const stage = operation.stage === "existence" ? "immutable-object-existence" : "immutable-object-create";
  const outcome = operation.outcome === "exists" ? "read" : operation.outcome === "completed" ? "completed" : operation.outcome;
  emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, stage, outcome, "gcs-immutable-object", objectResource, context, operation.error));
}
function emitPublicationDiagnostic(adapters: Pick<CpuPackagePublicationAdapters, "log"> | undefined, diagnostic: CpuPackagePublicationDiagnostic) {
  try { (adapters?.log || defaultPublicationLog)(diagnostic); } catch { /* Diagnostics must not change package publication semantics. */ }
}
function defaultHostedPublicationAdapters(key: string): CpuPackagePublicationAdapters {
  const ref = cpuProjectionPackageHeads().doc(packageHeadId(key));
  return {
    headRef: ref, headPath: ref.path,
    runTransaction: callback => db.runTransaction(transaction => callback(transaction as unknown as CpuPackageHeadTransaction)),
  };
}

/** Hosted publisher exposed with adapters so stage failures can be tested without cloud access. */
export async function publishHostedCpuPackage(store: ReadPackageStore, key: string, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }, sourceHash: string, adapters = defaultHostedPublicationAdapters(key), context: CpuPackagePublicationContext = {}) {
  const { manifest } = encoded;
  const headResource = adapters.headPath;
  const objectResource = manifest.objectName;
  let prepared: { action: "superseded"; manifest?: ReadPackageManifest } | { action: "idempotent"; manifest?: ReadPackageManifest } | { action: "publish" };
  emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "package-head-read", "started", "firestore-document", headResource, context));
  try {
    const transaction = await runDiagnosedTransaction(adapters, manifest, key, context, "package-head-transaction", "pending-head-commit", headResource, async (transaction, attempt) => {
      emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "package-head-read", "started", "firestore-document", headResource, context, undefined, attempt.number));
      let snapshot: CpuPackageHeadSnapshot;
      try { snapshot = await transaction.get(adapters.headRef); }
      catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "package-head-read", "failed", "firestore-document", headResource, context, error, attempt.number)); throw error; }
      emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "package-head-read", snapshot.exists ? "read" : "absent", "firestore-document", headResource, context, undefined, attempt.number));
      const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
      const currentSequence = Math.max(Number(head?.sourceSequence ?? -1), Number(head?.pending?.sourceSequence ?? -1));
      const incomingSequence = sequenceOf(manifest);
      if (incomingSequence < currentSequence) {
        if (head?.state === "current" && head.manifest) return { action: "superseded" as const, manifest: head.manifest };
        throw Object.assign(new Error("CPU package materialisation is superseded and has no current package."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
      }
      if (head?.state === "current" && incomingSequence === head.sourceSequence) {
        if (head.sourceHash !== sourceHash) throw packageConflict(incomingSequence);
        return { action: "idempotent" as const, manifest: head.manifest };
      }
      if (head?.pending && incomingSequence === head.pending.sourceSequence && (head.pending.sourceHash !== sourceHash || head.pending.manifest.contentHash !== manifest.contentHash)) throw packageConflict(incomingSequence);
      transaction.set(adapters.headRef, { state: "pending", sourceSequence: head?.sourceSequence ?? -1, sourceHash: head?.sourceHash || "", ...(head?.manifest ? { manifest: head.manifest } : {}), pending: { sourceSequence: incomingSequence, sourceHash, manifest }, updatedAt: new Date().toISOString() });
      attempt.writeStaged = true;
      emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "pending-head-write", "staged", "firestore-document", headResource, context, undefined, attempt.number));
      return { action: "publish" as const };
    });
    prepared = transaction.value;
  } catch (error) {
    throw error;
  }
  if (prepared.action === "superseded") {
    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "package-head-read", "superseded", "firestore-document", headResource, context));
    if (!prepared.manifest) throw Object.assign(new Error("CPU package materialisation is superseded before a current package exists."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
    return prepared.manifest;
  }
  if (prepared.action === "idempotent") {
    const currentManifest = prepared.manifest!;
    emitPublicationDiagnostic(adapters, publicationDiagnostic(currentManifest, key, "package-head-read", "idempotent", "firestore-document", headResource, context));
    let bytes: Uint8Array | undefined;
    try { bytes = await store.get(currentManifest.objectName); }
    catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(currentManifest, key, "idempotent-integrity-readback", "failed", "gcs-immutable-object", currentManifest.objectName, context, error)); throw error; }
    if (!bytes) { const error = new Error(`Read package ${currentManifest.objectName} was not persisted.`); emitPublicationDiagnostic(adapters, publicationDiagnostic(currentManifest, key, "idempotent-integrity-readback", "failed", "gcs-immutable-object", currentManifest.objectName, context, error)); throw error; }
    try {
      const saved = decodeReadPackage<{ projection: CpuProjectionPackage }>(currentManifest, bytes);
      if (cpuProjectionContentHash(saved.projection) !== sourceHash) throw packageConflict(sequenceOf(currentManifest));
    } catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(currentManifest, key, "idempotent-integrity-readback", "failed", "gcs-immutable-object", currentManifest.objectName, context, error)); throw error; }
    emitPublicationDiagnostic(adapters, publicationDiagnostic(currentManifest, key, "idempotent-integrity-readback", "verified", "gcs-immutable-object", currentManifest.objectName, context));
    return currentManifest;
  }
  try {
    try { await store.putImmutable(objectResource, encoded.bytes, manifest.contentHash, operation => logImmutableOperation(adapters, manifest, key, objectResource, context, operation)); }
    catch (error) { throw error; }
    let persisted: Uint8Array | undefined;
    try { persisted = await store.get(objectResource); }
    catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "integrity-readback", "failed", "gcs-immutable-object", objectResource, context, error)); throw error; }
    if (!persisted) { const error = new Error(`Read package ${objectResource} was not persisted.`); emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "integrity-readback", "failed", "gcs-immutable-object", objectResource, context, error)); throw error; }
    try { decodeReadPackage<{ projection: CpuProjectionPackage }>(manifest, persisted); }
    catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "integrity-readback", "failed", "gcs-immutable-object", objectResource, context, error)); throw error; }
    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "integrity-readback", "verified", "gcs-immutable-object", objectResource, context));

    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "current-head-promotion-read", "started", "firestore-document", headResource, context));
    let promoted: ReadPackageManifest;
    try {
      const promotion = await runDiagnosedTransaction(adapters, manifest, key, context, "current-head-promotion-transaction", "current-head-promotion-commit", headResource, async (transaction, attempt) => {
        emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "current-head-promotion-read", "started", "firestore-document", headResource, context, undefined, attempt.number));
        let snapshot: CpuPackageHeadSnapshot;
        try { snapshot = await transaction.get(adapters.headRef); }
        catch (error) { emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "current-head-promotion-read", "failed", "firestore-document", headResource, context, error, attempt.number)); throw error; }
        emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "current-head-promotion-read", snapshot.exists ? "read" : "absent", "firestore-document", headResource, context, undefined, attempt.number));
        const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
        const incomingSequence = sequenceOf(manifest);
        if (head?.state === "current" && head.sourceSequence === incomingSequence) {
          if (head.sourceHash !== sourceHash || head.manifest?.contentHash !== manifest.contentHash) throw packageConflict(incomingSequence);
          return head.manifest!;
        }
        if (Number(head?.pending?.sourceSequence ?? -1) !== incomingSequence || head?.pending?.sourceHash !== sourceHash || head.pending.manifest.contentHash !== manifest.contentHash) {
          if (head?.state === "current" && head.manifest) return head.manifest;
          throw Object.assign(new Error("CPU package materialisation was superseded before promotion."), { code: "CPU_PACKAGE_SUPERSEDED", status: 409 });
        }
        transaction.set(adapters.headRef, { state: "current", sourceSequence: incomingSequence, sourceHash, manifest, updatedAt: new Date().toISOString() });
        attempt.writeStaged = true;
        emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "current-head-promotion-write", "staged", "firestore-document", headResource, context, undefined, attempt.number));
        return manifest;
      });
      promoted = promotion.value;
    } catch (error) {
      throw error;
    }
    return promoted;
  } catch (error) {
    emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "failure-cleanup-read", "started", "firestore-document", headResource, context));
    try {
      await runDiagnosedTransaction(adapters, manifest, key, context, "failure-cleanup-transaction", "failure-cleanup-commit", headResource, async (transaction, attempt) => {
        emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "failure-cleanup-read", "started", "firestore-document", headResource, context, undefined, attempt.number));
        let snapshot: CpuPackageHeadSnapshot;
        try { snapshot = await transaction.get(adapters.headRef); }
        catch (cleanupReadError) { emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "failure-cleanup-read", "failed", "firestore-document", headResource, context, cleanupReadError, attempt.number)); throw cleanupReadError; }
        emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "failure-cleanup-read", snapshot.exists ? "read" : "absent", "firestore-document", headResource, context, undefined, attempt.number));
        const head = snapshot.exists ? snapshot.data() as CpuPackageHead : undefined;
        if (head?.pending?.sourceSequence === sequenceOf(manifest) && head.pending.sourceHash === sourceHash && head.pending.manifest.contentHash === manifest.contentHash) {
          transaction.set(adapters.headRef, { ...head, state: "failed", failure: { message: error instanceof Error ? error.message : "CPU package materialisation failed.", at: new Date().toISOString() }, updatedAt: new Date().toISOString() });
          attempt.writeStaged = true;
          emitPublicationDiagnostic(adapters, publicationDiagnostic(manifest, key, "failure-cleanup-write", "staged", "firestore-document", headResource, context, undefined, attempt.number));
        }
      });
    } catch (cleanupError) {
      // The original publication error remains authoritative; cleanup diagnostics are emitted by the transaction helper.
    }
    throw error;
  }
}

export async function publishMonotonicCpuPackage(store: ReadPackageStore, key: string, encoded: { manifest: ReadPackageManifest; bytes: Uint8Array }, sourceHash: string, adapters?: CpuPackagePublicationAdapters, context: CpuPackagePublicationContext = {}) {
  if (hostedPackageRuntime()) return publishHostedCpuPackage(store, key, encoded, sourceHash, adapters || defaultHostedPublicationAdapters(key), context);
  const previous = await store.getManifest(key);
  const incomingSequence = sequenceOf(encoded.manifest);
  if (previous && incomingSequence < sequenceOf(previous)) return previous;
  if (previous && incomingSequence === sequenceOf(previous) && previous.sourceHash && previous.sourceHash !== sourceHash) throw packageConflict(incomingSequence);
  if (previous && incomingSequence === sequenceOf(previous) && previous.sourceHash === sourceHash) {
    const bytes = await store.get(previous.objectName);
    if (!bytes) throw new Error(`Read package ${previous.objectName} was not persisted.`);
    const saved = decodeReadPackage<{ projection: CpuProjectionPackage }>(previous, bytes);
    if (cpuProjectionContentHash(saved.projection) !== sourceHash) throw packageConflict(incomingSequence);
    return previous;
  }
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

export async function publishCpuProjectionPackage(projection: CpuProjectionPackage, context: CpuPackagePublicationContext = {}, dependencies: { store?: ReadPackageStore; adapters?: CpuPackagePublicationAdapters } = {}): Promise<ReadPackageManifest> {
    const key = keyFor(projection);
  const existing = publicationInFlight.get(key);
  if (existing) return existing;
  const publication = (async () => {
      const store = dependencies.store || cpuPackageStore();
    const manifestProbe = { dataset: datasetFor(projection), scope: scopeFor(projection), packageVersion: 0, sourceVersion: `cpu-change-${projection.lastChangeSequence}` } as ReadPackageManifest;
    const resource = `manifests/${key}.json`;
    emitPublicationDiagnostic(dependencies.adapters, publicationDiagnostic(manifestProbe, key, "manifest-retrieval", "started", "gcs-manifest", resource, context));
    let previous: ReadPackageManifest | undefined;
    try { previous = await store.getManifest(key); }
    catch (error) { emitPublicationDiagnostic(dependencies.adapters, publicationDiagnostic(manifestProbe, key, "manifest-retrieval", "failed", "gcs-manifest", resource, context, error)); throw error; }
    emitPublicationDiagnostic(dependencies.adapters, publicationDiagnostic(previous || manifestProbe, key, "manifest-retrieval", previous ? "read" : "absent", "gcs-manifest", resource, context));
    const version = (previous?.packageVersion || 0) + 1;
    const value = { projection };
    const encoded = encodeReadPackage(datasetFor(projection), version, value, projection.orders.length, {
      contractVersion: CPU_PROJECTION_CONTRACT,
      sourceVersion: `cpu-change-${projection.lastChangeSequence}`,
      sourceHash: cpuProjectionContentHash(projection),
      scope: scopeFor(projection),
    });
    return publishMonotonicCpuPackage(store, key, encoded, cpuProjectionContentHash(projection), dependencies.adapters, context);
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
