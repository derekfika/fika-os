import type { Audit, MenuItem } from "../domain";
import { catalogueSourceHash } from "../catalogue-source";
import type { HistoricalDishReferenceDescriptor, HistoricalDishReferenceManifest, HistoricalDishSuccessor } from "../dish-reference-contract";
import { digest, indexDigest } from "./digest";
import { recordOf, type Op, type PlanReport, type Snapshot } from "./plan";
import type { Data } from "./store";

export const MAPPING_VERSION = 1;
export type Batch = { index: number; ids: string[]; revisionAfter: number; hashAfter: string };
export type Materialised = {
  cutoverId: string;
  at: string;
  actor: string;
  approvedBy: string;
  /** Changed documents only: pre (raw V1) and post (stamped) data plus the post digest. */
  changes: Map<string, { pre: Data; target: Data; targetDigest: string }>;
  batches: Batch[];
  seal: { revisionAfter: number; hashAfter: string };
  archiveDocs: Map<string, Data>;
  successorDocs: Map<string, Data>;
  referenceManifest: HistoricalDishReferenceManifest;
  descriptor: HistoricalDishReferenceDescriptor;
  root: Data;
  /** Complete expected final dish documents (changed and unchanged). */
  finalDocs: Map<string, Data>;
};
export type MaterialiseOptions = { cutoverId: string; at: string; actor: string; approvedBy: string; environment: { project?: string; kind: string }; preManifest: Data; revision: number };

const sameAudit = (a: Audit, b: Audit) => digest(a) === digest(b);
function mergeAudit(first: Audit[] = [], second: Audit[] = []) {
  const out = [...first];
  for (const entry of second) if (!out.some(existing => sameAudit(existing, entry))) out.push(entry);
  return out;
}
const withRecord = (doc: Data, record: MenuItem): Data => doc.record ? { ...doc, record: record as unknown as Data } : (record as unknown as Data);

/** Deterministic stamping: the same plan + same journal timestamp always yields the same bytes (needed for resume and for the immutable archive root). */
export function stampTarget(op: Op, opts: Pick<MaterialiseOptions, "cutoverId" | "at" | "actor">): Data | undefined {
  if (op.change === "none") return undefined;
  const pre = recordOf(op.preDoc);
  const line = (action: string, reason: string): Audit => ({ action, at: opts.at, by: opts.actor, reason });
  if (op.change === "update") {
    const v2 = op.v2Record!;
    const record: MenuItem = { ...v2, revision: Math.max(pre.revision, v2.revision) + 1, audit: [...mergeAudit(pre.audit, v2.audit), line("dish-library-v2-cutover:activated", opts.cutoverId)] };
    return withRecord(op.preDoc, record);
  }
  const reason = op.toId ? `${opts.cutoverId}: merged into ${op.toId}` : opts.cutoverId;
  const record: MenuItem = { ...pre, reviewStatus: "archived", revision: pre.revision + 1, audit: [...(pre.audit || []), line(op.toId ? "dish-library-v2-cutover:merged-and-archived" : "dish-library-v2-cutover:archived", reason)] };
  return withRecord(op.preDoc, record);
}

export function manifestAfter(previous: Data, input: { revision: number; hash: string; dishCount: number; at: string; actor: string; cutoverId: string; status: "in-progress" | "complete"; descriptor?: HistoricalDishReferenceDescriptor }): Data {
  const next: Data = {
    ...previous,
    schemaVersion: 1,
    sourceHashVersion: 2,
    catalogueVersion: input.revision,
    sourceRevision: input.revision,
    sourceHash: input.hash,
    updatedAt: input.at,
    dishCount: input.dishCount,
    packageState: { status: "pending", sourceRevision: input.revision, sourceHash: input.hash, requestedAt: input.at, updatedAt: input.at, attempts: 0 },
    lastMutationBy: input.actor,
    cutover: { id: input.cutoverId, status: input.status },
  };
  if (input.descriptor) next.historicalDishReferences = input.descriptor as unknown as Data;
  return next;
}

export function materialise(snapshot: Snapshot, plan: PlanReport, ops: Op[], opts: MaterialiseOptions): Materialised {
  const dishDocs = new Map(snapshot.docs.filter(doc => doc.data.kind === "dish").map(doc => [doc.id, doc.data] as const));
  const changes = new Map<string, { pre: Data; target: Data; targetDigest: string }>();
  for (const op of ops) {
    const target = stampTarget(op, opts);
    if (target) changes.set(op.id, { pre: op.preDoc, target, targetDigest: digest(target) });
  }
  const changedOps = ops.filter(op => op.change !== "none");
  // Activations first so the active catalogue never shrinks before its replacements are in place; then archives/merges.
  const ordered = [...changedOps.filter(op => op.change === "update"), ...changedOps.filter(op => op.change === "archive")].sort((a, b) => (a.change === b.change ? a.id.localeCompare(b.id) : a.change === "update" ? -1 : 1));
  const working = new Map([...dishDocs].map(([id, data]) => [id, recordOf(data)]));
  const batches: Batch[] = [];
  for (let start = 0; start < ordered.length; start += plan.batchSize) {
    const slice = ordered.slice(start, start + plan.batchSize);
    for (const op of slice) working.set(op.id, recordOf(changes.get(op.id)!.target));
    batches.push({ index: batches.length, ids: slice.map(op => op.id), revisionAfter: opts.revision + batches.length + 1, hashAfter: catalogueSourceHash([...working.values()]) });
  }
  const seal = { revisionAfter: opts.revision + batches.length + 1, hashAfter: catalogueSourceHash([...working.values()]) };

  const archiveDocs = new Map<string, Data>();
  const dishHashes: Record<string, string> = {};
  for (const [id, data] of [...dishDocs].sort(([a], [b]) => a.localeCompare(b))) {
    const wrapper: Data = { id, archivedAt: opts.at, data };
    archiveDocs.set(id, wrapper);
    dishHashes[id] = digest(wrapper);
  }
  const successorDocs = new Map<string, Data>();
  const mappingHashes: Record<string, string> = {};
  for (const successor of [...plan.successors].sort((a, b) => a.fromId.localeCompare(b.fromId))) {
    const doc: HistoricalDishSuccessor = { fromId: successor.fromId, toId: successor.toId, decisionId: successor.decisionId, decidedBy: opts.approvedBy, decidedAt: opts.at };
    successorDocs.set(successor.fromId, doc as unknown as Data);
    mappingHashes[successor.fromId] = digest(doc);
  }
  const descriptor: HistoricalDishReferenceDescriptor = { archiveId: opts.cutoverId, archiveDigest: indexDigest(dishHashes), mappingVersion: MAPPING_VERSION, mappingDigest: indexDigest(mappingHashes) };
  const referenceManifest: HistoricalDishReferenceManifest = { ...descriptor, schemaVersion: 1, catalogueRevision: seal.revisionAfter, catalogueSourceHash: seal.hashAfter, dishHashes, mappingHashes };

  const root: Data = {
    schemaVersion: 1,
    kind: "dish-library-v2-cutover-archive",
    status: "sealed",
    archiveId: opts.cutoverId,
    cutoverId: opts.cutoverId,
    createdAt: opts.at,
    createdBy: opts.actor,
    approvedBy: opts.approvedBy,
    environment: { ...(opts.environment.project ? { project: opts.environment.project } : {}), kind: opts.environment.kind },
    planHash: plan.planHash,
    preCutoverManifest: { revision: plan.preState.revision, sourceHash: plan.preState.sourceHash, dishCount: plan.preState.manifestDishCount, rawDigest: plan.preState.manifestDigest, raw: opts.preManifest },
    sourceIds: [...dishDocs.keys()].sort(),
    counts: { total: dishDocs.size, active: plan.preState.active, archived: plan.preState.archived, otherKindDocsNotArchived: plan.preState.otherKindDocs, successors: successorDocs.size },
    rawRecordDigest: plan.archive.rootRawDigest,
    backup: { kind: "firestore-subcollection", dishesPath: `${opts.cutoverId}/dishes`, successorsPath: `${opts.cutoverId}/successors` },
    rollback: { command: "restore", archiveId: opts.cutoverId, note: "Restores every archived raw document and the pre-cutover manifest content; the manifest revision stays monotonic." },
    /** Digest of every dish document as it must look when the cutover is complete (restore compares live state with this). */
    postCutoverDigests: Object.fromEntries([...dishDocs].sort(([a], [b]) => a.localeCompare(b)).map(([id, data]) => [id, digest(changes.get(id)?.target ?? data)])),
    referenceManifest: referenceManifest as unknown as Data,
  };

  const finalDocs = new Map<string, Data>();
  for (const [id, data] of dishDocs) finalDocs.set(id, changes.get(id)?.target ?? data);
  return { cutoverId: opts.cutoverId, at: opts.at, actor: opts.actor, approvedBy: opts.approvedBy, changes, batches, seal, archiveDocs, successorDocs, referenceManifest, descriptor, root, finalDocs };
}
