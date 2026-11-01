import { catalogueSourceHash } from "../catalogue-source";
import type { MenuItem } from "../domain";
import { digest } from "./digest";
import { CutoverIntegrityError, readSnapshot, snapshotFromArchive } from "./execute";
import type { EnvironmentClass } from "./guards";
import { isDishDoc, recordOf } from "./plan";
import { archivePath, COLLECTIONS, ConcurrentCatalogueChangeError, journalPath, MANIFEST_PATH, type CutoverStore, type Data } from "./store";

/** Manifest fields that legitimately differ after a restore: they move forward monotonically or record who/when. */
export const RESTORE_VOLATILE_MANIFEST_FIELDS = ["sourceRevision", "catalogueVersion", "updatedAt", "packageState", "lastMutationBy", "restoredFrom"] as const;

/** Bound to the archive AND to the live manifest revision/hash, so an approval goes stale the moment the catalogue changes. */
export const restoreIntentHash = (root: Data, live: { revision: unknown; hash: unknown }) => digest({ kind: "dish-library-v2-restore", archiveId: root.archiveId, rawRecordDigest: root.rawRecordDigest, archiveDigest: (root.referenceManifest as { archiveDigest: string }).archiveDigest, liveRevision: live.revision ?? null, liveHash: live.hash ?? null });

export type PostCutoverReport = {
  /** Dishes whose live document equals neither the sealed V2 state nor the archived V1 state, with the top-level fields that differ from the sealed state. */
  modified: Array<{ id: string; fields: string[] }>;
  /** Dishes that exist live but were not in the archive (created after the cutover). */
  createdAfterCutover: string[];
  /** Archived dishes that no longer exist live. */
  deleted: string[];
  /** Set when a completed cutover's manifest has moved on from its sealed revision/hash. */
  manifestDrift?: string;
  sealedStateKnown: boolean;
  any: boolean;
};
export class PostCutoverChangesError extends Error {
  constructor(readonly report: PostCutoverReport) { super("Restore refused: the catalogue changed after the cutover (see report). Re-run with --accept-post-cutover-changes to overwrite edits and archive newly created dishes; originals are preserved under postCutoverChanges/."); this.name = "PostCutoverChangesError"; }
}

export type RestoreOptions = {
  archiveId: string;
  actor: string;
  approvedBy: string;
  authorise: (computedRestoreHash: string) => EnvironmentClass;
  /** Explicit acknowledgement that restore overwrites post-cutover edits and archives post-cutover dishes. */
  acceptPostCutoverChanges?: boolean;
  batchSize?: number;
  now?: () => string;
  log?: (message: string) => void;
};
export type RestoreResult = { status: "restored" | "already-restored"; archiveId: string; restoreHash: string; docsRestored: number; revisionBefore: number; revisionAfter: number; sourceHashAfter: string; postCutover: { modified: number; created: number; deleted: number } };

const restoreJournalPath = (archiveId: string) => journalPath(`${archiveId}-restore`);
const changesPath = (archiveId: string, id: string) => `${archivePath(archiveId)}/postCutoverChanges/${id}`;
const fieldDiff = (live: Data, expected: Data) => {
  const liveRecord = (live.record ?? {}) as Record<string, unknown>, expectedRecord = (expected.record ?? {}) as Record<string, unknown>;
  const docKeys = [...new Set([...Object.keys(live), ...Object.keys(expected)])].filter(key => key !== "record" && digest(live[key] ?? null) !== digest(expected[key] ?? null));
  const recordKeys = [...new Set([...Object.keys(liveRecord), ...Object.keys(expectedRecord)])].filter(key => digest(liveRecord[key] ?? null) !== digest(expectedRecord[key] ?? null)).map(key => `record.${key}`);
  return [...docKeys, ...recordKeys].sort();
};

/** Rolls the catalogue back to the archived pre-cutover documents and manifest content (revision stays monotonic). Idempotent and resumable. */
export async function restoreCutover(store: CutoverStore, options: RestoreOptions): Promise<RestoreResult> {
  const log = options.log ?? (() => undefined);
  const { snapshot, root } = await snapshotFromArchive(store, options.archiveId);
  const now = options.now ?? (() => new Date().toISOString());
  const preManifest = snapshot.manifest!;
  const archived = new Map(snapshot.docs.map(doc => [doc.id, doc.data]));
  const preHash = String(preManifest.sourceHash);
  const batchSize = options.batchSize ?? 100;

  const live = await readSnapshot(store);
  const liveDishes = new Map(live.docs.filter(isDishDoc).map(doc => [doc.id, doc.data]));
  const liveManifest = live.manifest;
  if (!liveManifest || !Number.isInteger(liveManifest.sourceRevision)) throw new CutoverIntegrityError("Restore refused: live catalogue manifest has no integer revision.");
  const startRevision = liveManifest.sourceRevision as number;
  const restoreHash = restoreIntentHash(root, { revision: liveManifest.sourceRevision, hash: liveManifest.sourceHash });

  // Sealed V2 state: stamped targets for changed docs, raw for the rest.
  const postDocs = new Map((await store.list(`${archivePath(options.archiveId)}/postCutover`)).map(doc => [doc.id, doc.data.data as Data]));
  const postDigests = (root.postCutoverDigests ?? undefined) as Record<string, string> | undefined;
  const sealedStateKnown = Boolean(postDigests);
  const sideRecords = new Map((await store.list(`${archivePath(options.archiveId)}/postCutoverChanges`)).map(doc => [doc.id, doc.data]));
  const modified: PostCutoverReport["modified"] = [];
  const createdAfterCutover: string[] = [];
  const deleted: string[] = [];
  const toArchive: string[] = [];
  for (const [id, data] of liveDishes) {
    if (!archived.has(id)) {
      createdAfterCutover.push(id);
      const handled = sideRecords.get(id)?.kind === "created" && recordOf(data).reviewStatus === "archived";
      if (!handled) toArchive.push(id);
      continue;
    }
    const liveDigest = digest(data);
    if (liveDigest === digest(archived.get(id))) continue;
    if (postDigests && liveDigest === postDigests[id]) continue;
    modified.push({ id, fields: fieldDiff(data, postDocs.get(id) ?? archived.get(id)!) });
  }
  for (const id of archived.keys()) if (!liveDishes.has(id)) deleted.push(id);
  const inFlight = liveManifest.cutover && (liveManifest.cutover as { status?: string }).status === "restoring";
  const journal = await store.get(journalPath(options.archiveId));
  const manifestDrift = journal?.status === "complete" && !liveManifest.restoredFrom && !inFlight && (liveManifest.sourceRevision !== journal.finalRevision || liveManifest.sourceHash !== journal.finalHash)
    ? `manifest is at revision ${String(liveManifest.sourceRevision)}, the cutover sealed revision ${String(journal.finalRevision)}` : undefined;
  // Already-handled created dishes are not "new" changes for acceptance purposes.
  const newlyCreated = toArchive;
  const report: PostCutoverReport = { modified, createdAfterCutover: newlyCreated, deleted, ...(manifestDrift ? { manifestDrift } : {}), sealedStateKnown, any: modified.length + newlyCreated.length + deleted.length > 0 || Boolean(manifestDrift) };
  if (report.any) log(`Post-cutover changes since ${options.archiveId}:\n${JSON.stringify(report, null, 2)}`);
  if (!sealedStateKnown) log("Archive predates sealed-state digests; edits cannot be distinguished from the sealed V2 state, so every non-V1 document is reported as modified.");

  const environment = options.authorise(restoreHash);
  if (report.any && !options.acceptPostCutoverChanges) throw new PostCutoverChangesError(report);
  const diffs = [...archived.keys()].sort().filter(id => !liveDishes.has(id) || digest(liveDishes.get(id)) !== digest(archived.get(id)));

  const working = new Map([...liveDishes].map(([id, data]) => [id, recordOf(data)]));
  const archivedExtras = (id: string): MenuItem => { const record = recordOf(liveDishes.get(id)!); return { ...record, reviewStatus: "archived", revision: record.revision + 1, audit: [...(record.audit || []), { action: "dish-library-v2-restore:archived-post-cutover", at: now(), by: options.actor, reason: options.archiveId }] }; };
  const extraDocs = new Map<string, Data>();
  for (const id of toArchive) { const data = liveDishes.get(id)!; extraDocs.set(id, data.record ? { ...data, record: archivedExtras(id) as unknown as Data } : (archivedExtras(id) as unknown as Data)); }
  const writes = [...diffs.map(id => ({ id, data: archived.get(id)! })), ...toArchive.sort().map(id => ({ id, data: extraDocs.get(id)! }))];
  const createdTotal = createdAfterCutover.length;
  const batches = Array.from({ length: Math.ceil(writes.length / batchSize) }, (_, index) => writes.slice(index * batchSize, index * batchSize + batchSize)).map((items, index) => {
    for (const item of items) working.set(item.id, recordOf(item.data));
    return { index, items, revisionAfter: startRevision + index + 1, hashAfter: catalogueSourceHash([...working.values()]) };
  });
  const finalRevision = startRevision + batches.length + 1;
  const finalHash = catalogueSourceHash([...working.values()]);
  if (createdTotal === 0 && finalHash !== preHash) throw new CutoverIntegrityError(`Restore refused: restored documents hash to ${finalHash.slice(0, 12)}…, not the archived ${preHash.slice(0, 12)}….`);

  const restoredFrom = (liveManifest.restoredFrom as { archiveId?: string } | undefined)?.archiveId;
  if (!writes.length && liveManifest.sourceHash === finalHash && !liveManifest.cutover && restoredFrom === options.archiveId) {
    log(`Archive ${options.archiveId} is already restored; nothing written.`);
    return { status: "already-restored", archiveId: options.archiveId, restoreHash, docsRestored: 0, revisionBefore: startRevision, revisionAfter: startRevision, sourceHashAfter: finalHash, postCutover: { modified: 0, created: 0, deleted: 0 } };
  }

  const base = { restoreOf: options.archiveId, actor: options.actor, approvedBy: options.approvedBy, environment: { ...(store.project ? { project: store.project } : {}), kind: environment }, restoreHash, startRevision, acceptedPostCutoverChanges: report.any };
  const mark = async (status: string, extra: Data = {}) => { await store.writeBatch([{ op: "set", path: restoreJournalPath(options.archiveId), data: { ...base, status, ...extra, updatedAt: now() } }]); };
  await mark("started");

  // Preserve every overwritten/created post-cutover document before touching it (never overwrite an existing side record).
  const side: Array<{ path: string; data: Data }> = [];
  for (const entry of modified) if (!sideRecords.has(entry.id)) side.push({ path: changesPath(options.archiveId, entry.id), data: { id: entry.id, kind: "edited", fields: entry.fields, live: liveDishes.get(entry.id)! } });
  for (const id of toArchive) if (!sideRecords.has(id)) side.push({ path: changesPath(options.archiveId, id), data: { id, kind: "created", live: liveDishes.get(id)! } });
  for (let start = 0; start < side.length; start += 400) await store.writeBatch(side.slice(start, start + 400).map(item => ({ op: "create" as const, path: item.path, data: item.data })));

  for (const batch of batches) {
    const expectedRevision = batch.index === 0 ? startRevision : batches[batch.index - 1].revisionAfter;
    try {
      await store.runTransaction(async tx => {
        const manifest = await tx.get(MANIFEST_PATH);
        if (!manifest || manifest.sourceRevision !== expectedRevision) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${expectedRevision}; aborting restore before batch ${batch.index}. Re-run restore to get a fresh approval hash.`);
        for (const item of batch.items) tx.set(`${COLLECTIONS.catalogue}/${item.id}`, item.data);
        const at = now();
        tx.set(MANIFEST_PATH, { ...manifest, sourceRevision: batch.revisionAfter, catalogueVersion: batch.revisionAfter, sourceHash: batch.hashAfter, updatedAt: at, packageState: { status: "pending", sourceRevision: batch.revisionAfter, sourceHash: batch.hashAfter, requestedAt: at, updatedAt: at, attempts: 0 }, lastMutationBy: options.actor, cutover: { id: options.archiveId, status: "restoring" } });
      });
    } catch (error) {
      if (error instanceof ConcurrentCatalogueChangeError) await mark("aborted", { abortReason: error.message }).catch(() => undefined);
      throw error;
    }
    log(`Restore batch ${batch.index + 1}/${batches.length} committed (${batch.items.length} documents).`);
  }

  const sealFrom = batches.at(-1)?.revisionAfter ?? startRevision;
  await store.runTransaction(async tx => {
    const manifest = await tx.get(MANIFEST_PATH);
    if (!manifest || manifest.sourceRevision !== sealFrom) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${sealFrom}; aborting restore before seal.`);
    const at = now();
    // Start from the archived raw manifest so every non-volatile field is reproduced exactly.
    tx.set(MANIFEST_PATH, { ...preManifest, sourceRevision: finalRevision, catalogueVersion: finalRevision, sourceHash: finalHash, updatedAt: at, packageState: { status: "pending", sourceRevision: finalRevision, sourceHash: finalHash, requestedAt: at, updatedAt: at, attempts: 0 }, lastMutationBy: options.actor, restoredFrom: { archiveId: options.archiveId, at, by: options.actor, approvedBy: options.approvedBy, postCutoverChangesAccepted: report.any, createdArchived: createdTotal } });
  });

  const after = await readSnapshot(store);
  const afterDishes = after.docs.filter(isDishDoc);
  const bad = [...archived.keys()].filter(id => digest(afterDishes.find(doc => doc.id === id)?.data) !== digest(archived.get(id)));
  const extrasNotArchived = afterDishes.filter(doc => !archived.has(doc.id) && recordOf(doc.data).reviewStatus !== "archived").map(doc => doc.id);
  if (bad.length || extrasNotArchived.length || after.manifest?.sourceHash !== finalHash || catalogueSourceHash(afterDishes.map(doc => recordOf(doc.data))) !== finalHash) {
    await mark("integrity-failed", { abortReason: `readback mismatch: ${[...bad, ...extrasNotArchived].slice(0, 5).join(", ")}` }).catch(() => undefined);
    throw new CutoverIntegrityError("Restore readback does not reproduce the archived pre-cutover state.");
  }
  await mark("restored", { revisionAfter: finalRevision, docsRestored: diffs.length });
  const cutoverJournal = await store.get(journalPath(options.archiveId));
  if (cutoverJournal) await store.writeBatch([{ op: "set", path: journalPath(options.archiveId), data: { ...cutoverJournal, status: "restored", restoredAt: now(), restoredBy: options.actor } }]);
  log(`Restored ${diffs.length} documents from ${options.archiveId}; manifest revision ${finalRevision}.`);
  return { status: "restored", archiveId: options.archiveId, restoreHash, docsRestored: diffs.length, revisionBefore: startRevision, revisionAfter: finalRevision, sourceHashAfter: finalHash, postCutover: { modified: modified.length, created: toArchive.length, deleted: deleted.length } };
}
