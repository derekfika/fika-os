import type { MenuItem } from "../domain";
import { catalogueSourceHash } from "../catalogue-source";
import { digest, indexDigest } from "./digest";
import type { CutoverInputs, MappingEntry } from "./inputs";
import type { Data, StoredDoc } from "./store";

export const PLAN_SCHEMA = "dish-library-v2.cutover-plan.v1" as const;
export const DEFAULT_BATCH_SIZE = 100;
/** Fields a V2 survivor may differ in from its V1 record: tags, salad subtype, and the bookkeeping that follows from changing them. */
export const ALLOWED_V2_FIELD_CHANGES = ["tagIds", "subcategory", "revision", "audit"] as const;

export type Snapshot = { manifest?: Data; docs: StoredDoc[] };
export const isDishDoc = (doc: StoredDoc) => doc.data.kind === "dish";
export const recordOf = (data: Data) => ((data.record as MenuItem | undefined) ?? (data as unknown as MenuItem));
export const isArchived = (record: MenuItem) => record.reviewStatus === "archived";

export type OpAction = "keep" | "archive" | "merge";
/** Internal operation (carries full records); the public report only exposes ids and digests. */
export type Op = {
  id: string;
  action: OpAction;
  toId?: string;
  decisionId?: string;
  preDoc: Data;
  preDigest: string;
  preArchived: boolean;
  /** Reviewed V2 record for keep; undefined otherwise. */
  v2Record?: MenuItem;
  /** "none" leaves the document byte-identical. */
  change: "none" | "update" | "archive";
};
export type Successor = { fromId: string; toId: string; decisionId: string; basis: string };

export type ReferenceOutcome = { sources: Array<{ label: string; sha256: string; ids: number }>; totalIds: number; active: number; merged: number; unresolved: Array<{ id: string; reason: string }> };
export type PlanReport = {
  schema: typeof PLAN_SCHEMA;
  planHash: string;
  cutoverId: string;
  executable: boolean;
  blockers: string[];
  warnings: string[];
  openGates: string[];
  batchSize: number;
  preState: { manifestPresent: boolean; revision: number | null; sourceHash: string | null; manifestDishCount: number | null; manifestDigest: string | null; dishDocs: number; active: number; archived: number; otherKindDocs: number; computedSourceHash: string };
  archive: { archiveId: string; docCount: number; rootRawDigest: string; rawDigests: Record<string, string> };
  target: { active: number; archived: number; docsToWrite: number; unchanged: number; keepUpdated: number; newlyArchived: number; batches: number };
  successors: Successor[];
  unresolvedArchived: string[];
  mappedButAbsentFromStore: string[];
  references: ReferenceOutcome;
  rollingNine: Array<{ id: string; state: string }>;
  inputs: { survivorsSha256: string; mappingsSha256: string; v2RecordsDigest: string; survivors: number; mappings: number };
  ops: Array<{ id: string; action: OpAction; change: Op["change"]; preDigest: string; toId?: string }>;
};

const normName = (item: MenuItem) => item.displayName.trim().toLocaleLowerCase("en-GB");

export function unexpectedChanges(before: MenuItem, after: MenuItem): string[] {
  const allowed = new Set<string>(ALLOWED_V2_FIELD_CHANGES);
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...keys].filter(key => !allowed.has(key) && digest((before as Record<string, unknown>)[key] ?? null) !== digest((after as Record<string, unknown>)[key] ?? null)).sort();
}

export function buildPlan(snapshot: Snapshot, inputs: CutoverInputs, options: { batchSize?: number; attempt?: number } = {}): { plan: PlanReport; ops: Op[] } {
  const batchSize = options.batchSize ?? DEFAULT_BATCH_SIZE;
  const attempt = options.attempt ?? 1;
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 400) blockers.push("batch size must be an integer between 1 and 400");

  const dishDocs = snapshot.docs.filter(isDishDoc).sort((a, b) => a.id.localeCompare(b.id));
  const otherKindDocs = snapshot.docs.length - dishDocs.length;
  const docById = new Map(dishDocs.map(doc => [doc.id, doc]));
  const records = dishDocs.map(doc => recordOf(doc.data));
  const computedSourceHash = catalogueSourceHash(records);
  const manifest = snapshot.manifest;
  const revision = manifest ? Number(manifest.sourceRevision ?? manifest.catalogueVersion) : NaN;
  const manifestRevision = Number.isInteger(revision) && revision >= 0 ? revision : null;
  const manifestHash = typeof manifest?.sourceHash === "string" ? manifest.sourceHash : null;
  if (!manifest) blockers.push("catalogue manifest is missing; the pre-state revision cannot be pinned");
  else {
    if (manifestRevision === null) blockers.push("catalogue manifest has no integer sourceRevision");
    if (!manifestHash) blockers.push("catalogue manifest has no sourceHash");
    else if (manifestHash !== computedSourceHash) blockers.push(`manifest sourceHash ${manifestHash.slice(0, 12)}… does not match the documents read (${computedSourceHash.slice(0, 12)}…): inconsistent or partial snapshot`);
    if (typeof manifest.dishCount === "number" && manifest.dishCount !== dishDocs.length) blockers.push(`manifest dishCount ${manifest.dishCount} differs from ${dishDocs.length} dish documents read`);
  }

  const rawDigests: Record<string, string> = {};
  for (const doc of dishDocs) {
    if (recordOf(doc.data).canonicalId !== doc.id) blockers.push(`document ${doc.id} has canonicalId ${String(recordOf(doc.data).canonicalId)}; refusing (identity must be stable)`);
    rawDigests[doc.id] = digest(doc.data);
  }
  const rootRawDigest = indexDigest(rawDigests);

  const mappingById = new Map<string, MappingEntry>(inputs.mappings.map(entry => [entry.oldId, entry]));
  const keepIds = new Set(inputs.mappings.filter(entry => entry.action === "keep").map(entry => entry.oldId));
  const survivorSet = new Set(inputs.survivorIds);
  for (const id of survivorSet) if (!keepIds.has(id)) blockers.push(`survivor ${id} is not mapped keep`);
  for (const id of keepIds) if (!survivorSet.has(id)) blockers.push(`mapping keeps ${id} which is not in the survivors list`);
  for (const doc of dishDocs) if (!mappingById.has(doc.id)) blockers.push(`V1 document ${doc.id} has no mapping decision; fail closed`);

  for (const id of keepIds) if (!docById.has(id)) blockers.push(`keep ${id}: no such V1 document; creating new records is outside this cutover`);
  const mappedButAbsentFromStore = inputs.mappings.filter(entry => !docById.has(entry.oldId)).map(entry => entry.oldId).sort();
  const ops: Op[] = [];
  const successors: Successor[] = [];
  const unresolvedArchived: string[] = [];

  for (const doc of dishDocs) {
    const entry = mappingById.get(doc.id);
    if (!entry) continue;
    const record = recordOf(doc.data);
    const archived = isArchived(record);
    const base = { id: doc.id, action: entry.action, preDoc: doc.data, preDigest: rawDigests[doc.id], preArchived: archived };
    if (entry.action === "keep") {
      const v2 = inputs.v2Records.get(doc.id);
      if (archived) blockers.push(`keep ${doc.id}: V1 document is archived; reactivation is not part of this cutover`);
      if (!v2) { blockers.push(`keep ${doc.id}: no reviewed V2 record supplied`); continue; }
      if (v2.canonicalId !== doc.id) blockers.push(`keep ${doc.id}: V2 record has canonicalId ${v2.canonicalId}`);
      if (isArchived(v2)) blockers.push(`keep ${doc.id}: V2 record is archived`);
      if (v2.operationalScope === "HOSPITALITY_ROTATIONS") blockers.push(`keep ${doc.id}: V2 record is Hospitality-scoped`);
      const unexpected = unexpectedChanges(record, v2);
      if (unexpected.length) blockers.push(`keep ${doc.id}: V2 differs from V1 outside tags/subtype: ${unexpected.join(", ")}`);
      ops.push({ ...base, v2Record: v2, change: digest(record) === digest(v2) ? "none" : "update" });
      continue;
    }
    if (entry.action === "merge" || entry.toId) {
      const verified = entry.action === "merge" || entry.verifiedTarget === true;
      if (!entry.toId) blockers.push(`merge ${doc.id}: no toId`);
      else if (!verified) blockers.push(`archive ${doc.id}: has toId ${entry.toId} without verifiedTarget; names/hints never establish a successor`);
      else if (entry.toId === doc.id) blockers.push(`${doc.id}: successor is itself`);
      else if (!keepIds.has(entry.toId)) blockers.push(`${doc.id}: successor ${entry.toId} is not an active survivor (chains/inactive targets are forbidden)`);
      else if (!docById.has(entry.toId)) blockers.push(`${doc.id}: successor ${entry.toId} does not exist in the store`);
      else {
        successors.push({ fromId: doc.id, toId: entry.toId, decisionId: `dish-library-v2:${entry.cluster || "verified-successor"}`, basis: entry.basis || "" });
        ops.push({ ...base, action: entry.action, toId: entry.toId, decisionId: `dish-library-v2:${entry.cluster || "verified-successor"}`, change: archived ? "none" : "archive" });
        continue;
      }
      ops.push({ ...base, change: archived ? "none" : "archive" });
      continue;
    }
    ops.push({ ...base, change: archived ? "none" : "archive" });
    unresolvedArchived.push(doc.id);
  }

  // Final active set and name-collision warning (the app writer refuses duplicate active names on later edits).
  const finalActive = new Map<string, MenuItem>();
  for (const op of ops) if (op.action === "keep" && op.v2Record) finalActive.set(op.id, op.v2Record);
  const byName = new Map<string, string[]>();
  for (const [id, item] of finalActive) byName.set(normName(item), [...(byName.get(normName(item)) || []), id]);
  for (const [name, ids] of byName) if (ids.length > 1) warnings.push(`active name collision "${name}": ${ids.join(", ")}`);
  if (unresolvedArchived.length) warnings.push(`${unresolvedArchived.length} archived ids have no verified successor and stay UNRESOLVED (resolver reports archived/unresolved, never a guessed target)`);

  // Reference integrity: every referenced id must be ACTIVE after cutover or have a verified active successor.
  const successorByFrom = new Map(successors.map(item => [item.fromId, item]));
  const referenceIds = [...new Set(inputs.references.flatMap(set => set.ids))].sort();
  const unresolved: ReferenceOutcome["unresolved"] = [];
  let activeRefs = 0, mergedRefs = 0;
  for (const id of referenceIds) {
    if (finalActive.has(id)) { activeRefs++; continue; }
    const successor = successorByFrom.get(id);
    if (successor && finalActive.has(successor.toId)) { mergedRefs++; continue; }
    unresolved.push({ id, reason: docById.has(id) ? "archived without a verified successor" : "not found in the store" });
  }
  for (const item of unresolved) blockers.push(`reference ${item.id}: ${item.reason}`);
  if (!inputs.references.length) blockers.push("no reference sets supplied; reference integrity cannot be proven");
  const rollingNine = inputs.nineRollingIds.map(id => ({ id, state: finalActive.has(id) ? "active" : successorByFrom.has(id) ? "merged" : "NOT ACTIVE" }));
  for (const item of rollingNine) if (item.state !== "active") blockers.push(`rolling id ${item.id} would not be active after cutover`);

  const changed = ops.filter(op => op.change !== "none");
  const keepUpdated = changed.filter(op => op.change === "update").length;
  const newlyArchived = changed.filter(op => op.change === "archive").length;
  const batches = Math.ceil(changed.length / batchSize);
  const preActive = records.filter(record => !isArchived(record)).length;
  const v2RecordsDigest = indexDigest(Object.fromEntries([...finalActive].map(([id, item]) => [id, digest(item)])));

  const hashBasis = {
    schema: PLAN_SCHEMA,
    preState: { revision: manifestRevision, sourceHash: manifestHash, dishCount: manifest?.dishCount ?? null, manifestDigest: manifest ? digest(manifest) : null, rootRawDigest },
    inputs: { survivorsSha256: inputs.hashes.survivors, mappingsSha256: inputs.hashes.mappings, v2RecordsDigest },
    batchSize,
    ...(attempt > 1 ? { attempt } : {}),
    ops: ops.map(op => ({ id: op.id, action: op.action, change: op.change, preDigest: op.preDigest, toId: op.toId ?? null, v2: op.v2Record ? digest(op.v2Record) : null })),
    successors,
    references: referenceIds,
  };
  const planHash = digest(hashBasis);
  const cutoverId = cutoverIdFor(planHash);

  const plan: PlanReport = {
    schema: PLAN_SCHEMA,
    planHash,
    cutoverId,
    executable: blockers.length === 0,
    blockers,
    warnings,
    openGates: [
      "Owner approval of the proposed mappings (incl. the EX-004 merge) and the 8 exclusions is NOT recorded in these inputs",
      "References from 9 Nov onward (draft/future weeks, Hub order lines) must be read fresh from production and supplied via --references",
      "Issue #181 staging/email isolation must be verified before any staging rehearsal",
      "Pre-state must be re-read live (read-only) immediately before the approved run; an export is not a substitute",
    ],
    batchSize,
    preState: { manifestPresent: Boolean(manifest), revision: manifestRevision, sourceHash: manifestHash, manifestDishCount: typeof manifest?.dishCount === "number" ? manifest.dishCount : null, manifestDigest: manifest ? digest(manifest) : null, dishDocs: dishDocs.length, active: preActive, archived: dishDocs.length - preActive, otherKindDocs, computedSourceHash },
    archive: { archiveId: cutoverId, docCount: dishDocs.length, rootRawDigest, rawDigests },
    target: { active: finalActive.size, archived: dishDocs.length - finalActive.size, docsToWrite: changed.length, unchanged: ops.length - changed.length, keepUpdated, newlyArchived, batches },
    successors,
    unresolvedArchived: unresolvedArchived.sort(),
    mappedButAbsentFromStore,
    references: { sources: inputs.references.map(set => ({ label: set.label, sha256: set.sha256, ids: set.ids.length })), totalIds: referenceIds.length, active: activeRefs, merged: mergedRefs, unresolved },
    rollingNine,
    inputs: { survivorsSha256: inputs.hashes.survivors, mappingsSha256: inputs.hashes.mappings, v2RecordsDigest, survivors: inputs.survivorIds.length, mappings: inputs.mappings.length },
    ops: ops.map(op => ({ id: op.id, action: op.action, change: op.change, preDigest: op.preDigest, ...(op.toId ? { toId: op.toId } : {}) })),
  };
  return { plan, ops };
}

export const cutoverIdFor = (planHash: string) => `dish-library-v2-${planHash.slice(0, 16)}`;
