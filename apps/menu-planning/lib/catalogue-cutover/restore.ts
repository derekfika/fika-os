import { catalogueSourceHash } from "../catalogue-source";
import { digest } from "./digest";
import { CutoverIntegrityError, readSnapshot, snapshotFromArchive } from "./execute";
import type { EnvironmentClass } from "./guards";
import { isDishDoc, recordOf } from "./plan";
import { COLLECTIONS, ConcurrentCatalogueChangeError, journalPath, MANIFEST_PATH, type CutoverStore, type Data } from "./store";

/** Manifest fields that legitimately differ after a restore: they move forward monotonically or record who/when. */
export const RESTORE_VOLATILE_MANIFEST_FIELDS = ["sourceRevision", "catalogueVersion", "updatedAt", "packageState", "lastMutationBy", "restoredFrom"] as const;

export const restoreIntentHash = (root: Data) => digest({ kind: "dish-library-v2-restore", archiveId: root.archiveId, rawRecordDigest: root.rawRecordDigest, archiveDigest: (root.referenceManifest as { archiveDigest: string }).archiveDigest });

export type RestoreOptions = {
  archiveId: string;
  actor: string;
  approvedBy: string;
  authorise: (computedRestoreHash: string) => EnvironmentClass;
  batchSize?: number;
  now?: () => string;
  log?: (message: string) => void;
};
export type RestoreResult = { status: "restored" | "already-restored"; archiveId: string; restoreHash: string; docsRestored: number; revisionBefore: number; revisionAfter: number; sourceHashAfter: string };

const restoreJournalPath = (archiveId: string) => journalPath(`${archiveId}-restore`);

/** Rolls the catalogue back to the exact archived pre-cutover documents and manifest content (revision stays monotonic). Idempotent. */
export async function restoreCutover(store: CutoverStore, options: RestoreOptions): Promise<RestoreResult> {
  const log = options.log ?? (() => undefined);
  const { snapshot, root } = await snapshotFromArchive(store, options.archiveId);
  const restoreHash = restoreIntentHash(root);
  const environment = options.authorise(restoreHash);
  const now = options.now ?? (() => new Date().toISOString());
  const preManifest = snapshot.manifest!;
  const archived = new Map(snapshot.docs.map(doc => [doc.id, doc.data]));
  const preHash = String(preManifest.sourceHash);
  const batchSize = options.batchSize ?? 100;

  const live = await readSnapshot(store);
  const liveDishes = new Map(live.docs.filter(isDishDoc).map(doc => [doc.id, doc.data]));
  const extra = [...liveDishes.keys()].filter(id => !archived.has(id));
  if (extra.length) throw new CutoverIntegrityError(`Restore refused: ${extra.length} live dish documents are not in the archive (${extra.slice(0, 5).join(", ")}…); they would survive the restore and the pre-state could not be reproduced exactly.`);
  const diffs = [...archived.keys()].sort().filter(id => !liveDishes.has(id) || digest(liveDishes.get(id)) !== digest(archived.get(id)));
  const liveManifest = live.manifest;
  if (!liveManifest || !Number.isInteger(liveManifest.sourceRevision)) throw new CutoverIntegrityError("Restore refused: live catalogue manifest has no integer revision.");
  const startRevision = liveManifest.sourceRevision as number;
  const restoredFrom = (liveManifest.restoredFrom as { archiveId?: string } | undefined)?.archiveId;
  const manifestAligned = liveManifest.sourceHash === preHash && !liveManifest.cutover && restoredFrom === options.archiveId;

  if (!diffs.length && manifestAligned) {
    log(`Archive ${options.archiveId} is already restored; nothing written.`);
    return { status: "already-restored", archiveId: options.archiveId, restoreHash, docsRestored: 0, revisionBefore: startRevision, revisionAfter: startRevision, sourceHashAfter: preHash };
  }

  const stamp = (revision: number, hash: string, at: string) => ({ revision, hash, at });
  const working = new Map([...liveDishes].map(([id, data]) => [id, recordOf(data)]));
  const batches = Array.from({ length: Math.ceil(diffs.length / batchSize) }, (_, index) => diffs.slice(index * batchSize, index * batchSize + batchSize)).map((ids, index) => {
    for (const id of ids) working.set(id, recordOf(archived.get(id)!));
    return { index, ids, revisionAfter: startRevision + index + 1, hashAfter: catalogueSourceHash([...working.values()]) };
  });
  const finalRevision = startRevision + batches.length + 1;
  const finalHash = catalogueSourceHash([...working.values()]);
  if (finalHash !== preHash) throw new CutoverIntegrityError(`Restore refused: restored documents hash to ${finalHash.slice(0, 12)}…, not the archived ${preHash.slice(0, 12)}….`);

  const base = { restoreOf: options.archiveId, actor: options.actor, approvedBy: options.approvedBy, environment: { ...(store.project ? { project: store.project } : {}), kind: environment }, restoreHash, startRevision };
  await store.writeBatch([{ op: "set", path: restoreJournalPath(options.archiveId), data: { ...base, status: "started", updatedAt: now() } }]);

  const mark = async (status: string, extra: Data = {}) => {
    await store.writeBatch([{ op: "set", path: restoreJournalPath(options.archiveId), data: { ...base, status, ...extra, updatedAt: now() } }]);
  };
  for (const batch of batches) {
    const expectedRevision = batch.index === 0 ? startRevision : batches[batch.index - 1].revisionAfter;
    try {
      await store.runTransaction(async tx => {
        const manifest = await tx.get(MANIFEST_PATH);
        if (!manifest || manifest.sourceRevision !== expectedRevision) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${expectedRevision}; aborting restore before batch ${batch.index}.`);
        for (const id of batch.ids) tx.set(`${COLLECTIONS.catalogue}/${id}`, archived.get(id)!);
        const at = now();
        tx.set(MANIFEST_PATH, { ...manifest, sourceRevision: batch.revisionAfter, catalogueVersion: batch.revisionAfter, sourceHash: batch.hashAfter, updatedAt: at, packageState: { status: "pending", sourceRevision: batch.revisionAfter, sourceHash: batch.hashAfter, requestedAt: at, updatedAt: at, attempts: 0 }, lastMutationBy: options.actor, cutover: { id: options.archiveId, status: "restoring" } });
      });
    } catch (error) {
      if (error instanceof ConcurrentCatalogueChangeError) await mark("aborted", { abortReason: error.message }).catch(() => undefined);
      throw error;
    }
    log(`Restore batch ${batch.index + 1}/${batches.length} committed (${batch.ids.length} documents).`);
  }

  const sealFrom = batches.at(-1)?.revisionAfter ?? startRevision;
  await store.runTransaction(async tx => {
    const manifest = await tx.get(MANIFEST_PATH);
    if (!manifest || manifest.sourceRevision !== sealFrom) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${sealFrom}; aborting restore before seal.`);
    const at = now();
    const { revision, hash } = stamp(finalRevision, finalHash, at);
    // Start from the archived raw manifest so every non-volatile field is reproduced exactly (no cutover / historical descriptor unless the archived manifest had one).
    tx.set(MANIFEST_PATH, { ...preManifest, sourceRevision: revision, catalogueVersion: revision, sourceHash: hash, updatedAt: at, packageState: { status: "pending", sourceRevision: revision, sourceHash: hash, requestedAt: at, updatedAt: at, attempts: 0 }, lastMutationBy: options.actor, restoredFrom: { archiveId: options.archiveId, at, by: options.actor, approvedBy: options.approvedBy } });
  });

  const after = await readSnapshot(store);
  const afterDishes = after.docs.filter(isDishDoc);
  const bad = afterDishes.filter(doc => !archived.has(doc.id) || digest(doc.data) !== digest(archived.get(doc.id))).map(doc => doc.id);
  if (bad.length || afterDishes.length !== archived.size || after.manifest?.sourceHash !== preHash || catalogueSourceHash(afterDishes.map(doc => recordOf(doc.data))) !== preHash) {
    await mark("integrity-failed", { abortReason: `readback mismatch: ${bad.slice(0, 5).join(", ")}` }).catch(() => undefined);
    throw new CutoverIntegrityError("Restore readback does not reproduce the archived pre-cutover state.");
  }
  await mark("restored", { revisionAfter: finalRevision, docsRestored: diffs.length });
  // The cutover journal records the rollback so a stale re-run of the same approval is refused.
  const cutoverJournal = await store.get(journalPath(options.archiveId));
  if (cutoverJournal) await store.writeBatch([{ op: "set", path: journalPath(options.archiveId), data: { ...cutoverJournal, status: "restored", restoredAt: now(), restoredBy: options.actor } }]);
  log(`Restored ${diffs.length} documents from ${options.archiveId}; manifest revision ${finalRevision}.`);
  return { status: "restored", archiveId: options.archiveId, restoreHash, docsRestored: diffs.length, revisionBefore: startRevision, revisionAfter: finalRevision, sourceHashAfter: preHash };
}
