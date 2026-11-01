import { catalogueSourceHash } from "../catalogue-source";
import { digest } from "./digest";
import type { EnvironmentClass } from "./guards";
import type { CutoverInputs } from "./inputs";
import { manifestAfter, materialise, type Materialised } from "./materialise";
import { buildPlan, cutoverIdFor, isDishDoc, recordOf, type PlanReport, type Snapshot } from "./plan";
import { AlreadyExistsError, archivePath, COLLECTIONS, ConcurrentCatalogueChangeError, journalPath, MANIFEST_PATH, type BatchOp, type CutoverStore, type Data } from "./store";

export class CutoverIntegrityError extends Error {
  constructor(message: string) { super(message); this.name = "CutoverIntegrityError"; }
}

const hashPattern = /^[a-f0-9]{64}$/;
const chunk = <T>(items: T[], size: number) => Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, index * size + size));

/** Read-only snapshot of the live catalogue (deliberate administrative whole-collection read). */
export async function readSnapshot(store: CutoverStore): Promise<Snapshot> {
  return { manifest: await store.get(MANIFEST_PATH), docs: await store.list(COLLECTIONS.catalogue) };
}

/** Rebuilds the exact pre-cutover snapshot from the immutable archive, verifying every digest on the way. */
export async function snapshotFromArchive(store: CutoverStore, cutoverId: string): Promise<{ snapshot: Snapshot; root: Data }> {
  const root = await store.get(archivePath(cutoverId));
  if (!root) throw new CutoverIntegrityError(`Archive ${cutoverId} does not exist.`);
  if (root.status !== "sealed" || root.kind !== "dish-library-v2-cutover-archive") throw new CutoverIntegrityError(`Archive ${cutoverId} is not a sealed cutover archive.`);
  const reference = root.referenceManifest as { dishHashes: Record<string, string>; mappingHashes: Record<string, string> };
  const children = await store.list(`${archivePath(cutoverId)}/dishes`);
  const expectedIds = (root.sourceIds as string[]).slice().sort();
  if (digest(children.map(child => child.id).sort()) !== digest(expectedIds)) throw new CutoverIntegrityError(`Archive ${cutoverId}: stored dish ids differ from the sealed id list.`);
  for (const child of children) {
    if (digest(child.data) !== reference.dishHashes[child.id]) throw new CutoverIntegrityError(`Archive ${cutoverId}: document ${child.id} fails its sealed digest.`);
    if (child.data.id !== child.id) throw new CutoverIntegrityError(`Archive ${cutoverId}: wrapper id mismatch for ${child.id}.`);
  }
  const rawDigests = Object.fromEntries(children.map(child => [child.id, digest(child.data.data)]));
  if (digest(rawDigests) !== root.rawRecordDigest) throw new CutoverIntegrityError(`Archive ${cutoverId}: raw record digest mismatch.`);
  const manifest = (root.preCutoverManifest as { raw?: Data }).raw;
  return { snapshot: { manifest, docs: children.map(child => ({ id: child.id, data: child.data.data as Data })) }, root };
}

export type ExecuteOptions = {
  /** Reviewed plan hash. Also names the cutover (archive + journal), so a resume needs no recomputation of identity. */
  approvalHash: string;
  actor: string;
  approvedBy: string;
  /** Guard callback: must throw (GuardError) unless every write precondition holds for this computed plan hash. */
  authorise: (computedPlanHash: string) => EnvironmentClass;
  batchSize?: number;
  attempt?: number;
  now?: () => string;
  log?: (message: string) => void;
};
export type ExecuteResult = { status: "completed" | "already-complete"; cutoverId: string; planHash: string; revisionBefore: number; revisionAfter: number; sourceHashAfter: string; docsWritten: number; batches: number; archiveDocs: number; successors: number; active: number; archived: number; resumedFrom: number };

async function verifiedArchiveWrite(store: CutoverStore, items: Array<{ path: string; data: Data }>, label: string) {
  const existing = await store.getMany(items.map(item => item.path));
  const missing: BatchOp[] = [];
  items.forEach((item, index) => {
    const found = existing[index];
    if (!found) missing.push({ op: "create", path: item.path, data: item.data });
    else if (digest(found) !== digest(item.data)) throw new CutoverIntegrityError(`${label}: ${item.path} already exists with different content; archive is immutable.`);
  });
  for (const part of chunk(missing, 400)) {
    try { await store.writeBatch(part); } catch (error) { if (!(error instanceof AlreadyExistsError)) throw error; throw new CutoverIntegrityError(`${label}: concurrent archive write detected.`); }
  }
  const back = await store.getMany(items.map(item => item.path));
  items.forEach((item, index) => { if (!back[index] || digest(back[index]) !== digest(item.data)) throw new CutoverIntegrityError(`${label}: readback verification failed for ${item.path}.`); });
}

/** Final live-vs-expected equivalence; the single source of truth for "the cutover is complete and correct". */
export async function assertLiveEquivalence(store: CutoverStore, mat: Materialised, plan: PlanReport) {
  const live = await readSnapshot(store);
  const dishes = live.docs.filter(isDishDoc);
  if (dishes.length !== mat.finalDocs.size) throw new CutoverIntegrityError(`Readback: ${dishes.length} dish documents, expected ${mat.finalDocs.size}.`);
  for (const doc of dishes) {
    const expected = mat.finalDocs.get(doc.id);
    if (!expected || digest(expected) !== digest(doc.data)) throw new CutoverIntegrityError(`Readback: ${doc.id} does not equal its expected post-cutover document.`);
  }
  const records = dishes.map(doc => recordOf(doc.data));
  const hash = catalogueSourceHash(records);
  const manifest = live.manifest;
  if (!manifest || manifest.sourceRevision !== mat.seal.revisionAfter || manifest.sourceHash !== mat.seal.hashAfter || hash !== mat.seal.hashAfter) throw new CutoverIntegrityError("Readback: manifest revision/hash do not equal the expected sealed state.");
  if (digest(manifest.historicalDishReferences) !== digest(mat.descriptor)) throw new CutoverIntegrityError("Readback: manifest historicalDishReferences differs from the archive descriptor.");
  const active = records.filter(record => record.reviewStatus !== "archived").length;
  if (active !== plan.target.active) throw new CutoverIntegrityError(`Readback: ${active} active dishes, expected ${plan.target.active}.`);
  return { active, archived: records.length - active };
}

export async function executeCutover(store: CutoverStore, inputs: CutoverInputs, options: ExecuteOptions): Promise<ExecuteResult> {
  const log = options.log ?? (() => undefined);
  if (!hashPattern.test(options.approvalHash)) throw new Error("--approval-hash must be the 64-hex plan hash.");
  if (!options.actor.trim() || !options.approvedBy.trim()) throw new Error("actor and approvedBy are required and are recorded in the archive.");
  const cutoverId = cutoverIdFor(options.approvalHash);
  const journalDoc = await store.get(journalPath(cutoverId));
  const rootDoc = await store.get(archivePath(cutoverId));
  if (rootDoc && !journalDoc) throw new CutoverIntegrityError(`Archive ${cutoverId} exists without a journal; manual review required.`);
  if (journalDoc && (journalDoc.planHash !== options.approvalHash)) throw new CutoverIntegrityError("Journal plan hash differs from the approval hash.");
  if (journalDoc?.status === "restored") throw new CutoverIntegrityError(`Cutover ${cutoverId} was rolled back. Re-running requires a fresh plan with a new --attempt.`);
  if (journalDoc && ["activating", "complete"].includes(String(journalDoc.status)) && !rootDoc) throw new CutoverIntegrityError("Journal says activation began but the archive root is missing.");

  const base = rootDoc ? (await snapshotFromArchive(store, cutoverId)).snapshot : await readSnapshot(store);
  const batchSize = typeof journalDoc?.batchSize === "number" ? journalDoc.batchSize : options.batchSize;
  const attempt = typeof journalDoc?.attempt === "number" ? journalDoc.attempt : options.attempt;
  const { plan, ops } = buildPlan(base, inputs, { batchSize, attempt });
  const environment = options.authorise(plan.planHash);
  if (plan.planHash !== options.approvalHash) throw new CutoverIntegrityError("Computed plan hash differs from the approval hash; state or inputs changed since approval.");
  if (!plan.executable) throw new CutoverIntegrityError(`Plan is blocked: ${plan.blockers.join("; ")}`);

  const at = typeof journalDoc?.at === "string" ? journalDoc.at : (options.now ?? (() => new Date().toISOString()))();
  const actor = typeof journalDoc?.actor === "string" ? journalDoc.actor : options.actor;
  const approvedBy = typeof journalDoc?.approvedBy === "string" ? journalDoc.approvedBy : options.approvedBy;
  const mat = materialise(base, plan, ops, { cutoverId, at, actor, approvedBy, environment: { project: store.project, kind: environment }, preManifest: base.manifest!, revision: plan.preState.revision! });
  const preRevision = plan.preState.revision!;
  const result = (status: ExecuteResult["status"], resumedFrom: number, counts: { active: number; archived: number }): ExecuteResult => ({ status, cutoverId, planHash: plan.planHash, revisionBefore: preRevision, revisionAfter: mat.seal.revisionAfter, sourceHashAfter: mat.seal.hashAfter, docsWritten: mat.changes.size, batches: mat.batches.length, archiveDocs: mat.archiveDocs.size, successors: mat.successorDocs.size, active: counts.active, archived: counts.archived, resumedFrom });

  if (journalDoc?.status === "complete") {
    const counts = await assertLiveEquivalence(store, mat, plan);
    log(`Cutover ${cutoverId} already complete and verified; nothing written.`);
    return result("already-complete", mat.batches.length, counts);
  }

  const journalBase: Data = { cutoverId, kind: "dish-library-v2-cutover-journal", planHash: plan.planHash, at, actor, approvedBy, environment: { ...(store.project ? { project: store.project } : {}), kind: environment }, preRevision, preHash: plan.preState.sourceHash, batchSize: plan.batchSize, attempt: attempt ?? 1, totalBatches: mat.batches.length, finalRevision: mat.seal.revisionAfter, finalHash: mat.seal.hashAfter };
  const writeJournal = async (extra: Data) => store.writeBatch([{ op: "set", path: journalPath(cutoverId), data: { ...journalBase, ...extra, updatedAt: (options.now ?? (() => new Date().toISOString()))() } }]);

  if (!journalDoc) {
    await store.writeBatch([{ op: "create", path: journalPath(cutoverId), data: { ...journalBase, status: "started", progress: { batchesDone: 0, lastRevision: preRevision }, updatedAt: at } }]);
    log(`Journal ${cutoverId} created.`);
  }

  // 1. Archive first: raw copies + successors, readback-verified, then the sealed immutable root (+ journal) atomically.
  if (!rootDoc) {
    await verifiedArchiveWrite(store, [...mat.archiveDocs].map(([id, data]) => ({ path: `${archivePath(cutoverId)}/dishes/${id}`, data })), "archive dishes");
    await verifiedArchiveWrite(store, [...mat.successorDocs].map(([id, data]) => ({ path: `${archivePath(cutoverId)}/successors/${id}`, data })), "archive successors");
    for (const [id, wrapper] of mat.archiveDocs) if (digest(wrapper.data) !== plan.archive.rawDigests[id]) throw new CutoverIntegrityError(`Archive raw digest mismatch for ${id}.`);
    await store.writeBatch([
      { op: "create", path: archivePath(cutoverId), data: mat.root },
      { op: "set", path: journalPath(cutoverId), data: { ...journalBase, status: "archived", progress: { batchesDone: 0, lastRevision: preRevision }, updatedAt: at } },
    ]);
    log(`Archive ${cutoverId} sealed: ${mat.archiveDocs.size} documents, ${mat.successorDocs.size} successors.`);
  }

  // 2. Guarded activation. Every batch re-checks the catalogue manifest revision/hash it expects; any change aborts and leaves the journal resumable.
  const latestJournal = (await store.get(journalPath(cutoverId)))!;
  const done = Number((latestJournal.progress as { batchesDone?: number } | undefined)?.batchesDone ?? 0);
  for (const batch of mat.batches.slice(done)) {
    const expectedRevision = batch.index === 0 ? preRevision : mat.batches[batch.index - 1].revisionAfter;
    const expectedHash = batch.index === 0 ? plan.preState.sourceHash : mat.batches[batch.index - 1].hashAfter;
    try {
      await store.runTransaction(async tx => {
        const manifest = await tx.get(MANIFEST_PATH);
        const journal = await tx.get(journalPath(cutoverId));
        if (!manifest || manifest.sourceRevision !== expectedRevision || manifest.sourceHash !== expectedHash) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${expectedRevision}; aborting before batch ${batch.index}.`);
        if (Number((journal?.progress as { batchesDone?: number } | undefined)?.batchesDone ?? -1) !== batch.index) throw new ConcurrentCatalogueChangeError(`Journal progress is not at batch ${batch.index}; another runner may be active.`);
        const current = await Promise.all(batch.ids.map(id => tx.get(`${COLLECTIONS.catalogue}/${id}`)));
        batch.ids.forEach((id, index) => {
          const change = mat.changes.get(id)!;
          if (!current[index] || digest(current[index]) !== digest(change.pre)) throw new ConcurrentCatalogueChangeError(`Document ${id} changed since the archive was taken.`);
        });
        for (const id of batch.ids) tx.set(`${COLLECTIONS.catalogue}/${id}`, mat.changes.get(id)!.target);
        tx.set(MANIFEST_PATH, manifestAfter(manifest, { revision: batch.revisionAfter, hash: batch.hashAfter, dishCount: plan.preState.dishDocs, at: mat.at, actor, cutoverId, status: "in-progress" }));
        tx.set(journalPath(cutoverId), { ...journalBase, status: "activating", progress: { batchesDone: batch.index + 1, lastRevision: batch.revisionAfter }, updatedAt: mat.at });
      });
    } catch (error) {
      if (error instanceof ConcurrentCatalogueChangeError) {
        const current = await store.get(journalPath(cutoverId)).catch(() => undefined);
        await writeJournal({ status: "aborted", abortReason: error.message, progress: (current?.progress as Data) ?? { batchesDone: done, lastRevision: preRevision } }).catch(() => undefined);
      }
      throw error;
    }
    log(`Batch ${batch.index + 1}/${mat.batches.length} committed (${batch.ids.length} documents, revision ${batch.revisionAfter}).`);
  }

  // 3. Seal: attach the historical-reference descriptor to the manifest only after every document is in place.
  const lastBatch = mat.batches.at(-1);
  const sealFrom = { revision: lastBatch?.revisionAfter ?? preRevision, hash: lastBatch?.hashAfter ?? plan.preState.sourceHash! };
  await store.runTransaction(async tx => {
    const manifest = await tx.get(MANIFEST_PATH);
    const journal = await tx.get(journalPath(cutoverId));
    if (journal?.status === "complete") return;
    if (!manifest || manifest.sourceRevision !== sealFrom.revision || manifest.sourceHash !== sealFrom.hash) throw new ConcurrentCatalogueChangeError(`Catalogue manifest is at revision ${String(manifest?.sourceRevision)}, expected ${sealFrom.revision}; aborting before seal.`);
    tx.set(MANIFEST_PATH, manifestAfter(manifest, { revision: mat.seal.revisionAfter, hash: mat.seal.hashAfter, dishCount: plan.preState.dishDocs, at: mat.at, actor, cutoverId, status: "complete", descriptor: mat.descriptor }));
    tx.set(journalPath(cutoverId), { ...journalBase, status: "complete", progress: { batchesDone: mat.batches.length, lastRevision: mat.seal.revisionAfter }, updatedAt: mat.at });
  });

  // 4. Final readback against the expected state (not against the plan).
  let counts: { active: number; archived: number };
  try { counts = await assertLiveEquivalence(store, mat, plan); } catch (error) { await writeJournal({ status: "integrity-failed", abortReason: String((error as Error).message), progress: { batchesDone: mat.batches.length, lastRevision: mat.seal.revisionAfter } }).catch(() => undefined); throw error; }
  await writeJournal({ status: "complete", progress: { batchesDone: mat.batches.length, lastRevision: mat.seal.revisionAfter }, readback: { ok: true, active: counts.active, archived: counts.archived } });
  log(`Cutover ${cutoverId} complete: ${counts.active} active / ${counts.archived} archived at revision ${mat.seal.revisionAfter}.`);
  return result("completed", done, counts);
}
