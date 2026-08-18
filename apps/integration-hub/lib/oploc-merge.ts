import { sha256 } from "./profiler";
import type { CanonicalRecord } from "./types";

export type OplocMergeInput = {
  survivorOplocId: string;
  formerOplocId: string;
  formerNameAlias: string;
  actorId: string;
  timestamp: string;
};

export type OplocMergePlan = {
  survivor: CanonicalRecord;
  former: CanonicalRecord;
  redirectedRecords: CanonicalRecord[];
};

/**
 * Resolves a historical OPLOC identity without making the historical record
 * selectable as an active operating location.
 */
export function resolveOplocId(records: CanonicalRecord[], canonicalId: string) {
  const byId = new Map(records.map((record) => [record.canonicalId, record]));
  const visited = new Set<string>();
  let currentId = canonicalId;
  while (true) {
    if (visited.has(currentId))
      throw new Error("An OPLOC merge chain cannot contain a cycle.");
    visited.add(currentId);
    const record = byId.get(currentId);
    if (!record || record.entityType !== "OPLOC") return currentId;
    if (record.record.lifecycleState !== "merged") return currentId;
    const successor = String(record.record.mergedIntoOplocId || "");
    if (!successor) throw new Error(`Merged OPLOC ${currentId} has no survivor.`);
    currentId = successor;
  }
}

/** Builds a deterministic, non-destructive merge. The caller persists audit
 * records and revisions alongside this plan. */
export function planOplocMerge(
  records: CanonicalRecord[],
  input: OplocMergeInput,
): OplocMergePlan {
  if (input.survivorOplocId === input.formerOplocId)
    throw new Error("An OPLOC cannot merge into itself.");
  const survivor = requiredOploc(records, input.survivorOplocId);
  const former = requiredOploc(records, input.formerOplocId);
  if (survivor.record.lifecycleState !== "active")
    throw new Error("The surviving OPLOC must be active.");
  if (
    former.record.lifecycleState === "merged" &&
    former.record.mergedIntoOplocId === input.survivorOplocId
  )
    return { survivor, former, redirectedRecords: [] };
  if (former.record.lifecycleState !== "active")
    throw new Error("Only an active OPLOC can be merged.");

  assertRedirectsRemainUnambiguous(records, input);
  const aliases = Array.isArray(survivor.record.aliases)
    ? structuredClone(survivor.record.aliases)
    : [];
  if (!aliases.some((entry) => normalise(String((entry as Record<string, unknown>).alias || "")) === normalise(input.formerNameAlias))) {
    aliases.push({
      alias: input.formerNameAlias,
      sourceReference: input.formerOplocId,
      recordedAt: input.timestamp,
    });
  }
  const nextSurvivor = revise(survivor, {
    ...survivor.record,
    aliases,
  }, input);
  const nextFormer = revise(former, {
    ...former.record,
    active: false,
    lifecycleState: "merged",
    mergedIntoOplocId: input.survivorOplocId,
  }, input);
  const redirectedRecords = records
    .filter((record) => record.canonicalId !== former.canonicalId)
    .flatMap((record) => {
      const next = redirectOplocReferences(
        record.record,
        input.formerOplocId,
        input.survivorOplocId,
      );
      return next === record.record ? [] : [revise(record, next, input)];
    });
  return { survivor: nextSurvivor, former: nextFormer, redirectedRecords };
}

function requiredOploc(records: CanonicalRecord[], canonicalId: string) {
  const record = records.find((candidate) => candidate.canonicalId === canonicalId);
  if (!record || record.entityType !== "OPLOC")
    throw new Error(`Expected OPLOC ${canonicalId}.`);
  return record;
}

function redirectOplocReferences(
  record: Record<string, unknown>,
  formerOplocId: string,
  survivorOplocId: string,
) {
  const next = structuredClone(record);
  let changed = false;
  for (const key of ["oplocId", "operationalLocationId"] as const) {
    if (next[key] === formerOplocId) {
      next[key] = survivorOplocId;
      changed = true;
    }
  }
  return changed ? next : record;
}

function revise(
  record: CanonicalRecord,
  nextRecord: Record<string, unknown>,
  input: OplocMergeInput,
): CanonicalRecord {
  const recordWithAudit = {
    ...nextRecord,
    version: Number(record.record.version || 0) + 1,
    updatedAt: input.timestamp,
    updatedBy: input.actorId,
  };
  return {
    ...record,
    record: recordWithAudit,
    dataHash: sha256(JSON.stringify(recordWithAudit)),
  };
}

function assertRedirectsRemainUnambiguous(
  records: CanonicalRecord[],
  input: OplocMergeInput,
) {
  const requirementKeys = new Set<string>();
  const assignmentKeys = new Set<string>();
  for (const record of records) {
    const candidate = redirectOplocReferences(
      record.record,
      input.formerOplocId,
      input.survivorOplocId,
    );
    if (record.entityType === "Site Staffing Requirement") {
      const key = [candidate.oplocId, candidate.staffingRoleId, candidate.effectiveFrom, candidate.effectiveTo || ""].join("|");
      if (requirementKeys.has(key))
        throw new Error("The merge would create duplicate staffing requirements; resolve them before merging.");
      requirementKeys.add(key);
    }
    if (record.entityType === "Site Role Assignment") {
      const key = [candidate.legendId, candidate.oplocId, candidate.staffingRoleId, candidate.effectiveFrom, candidate.effectiveTo || "", candidate.lifecycleState || "active"].join("|");
      if (assignmentKeys.has(key))
        throw new Error("The merge would create duplicate site-role assignments; resolve them before merging.");
      assignmentKeys.add(key);
    }
  }
}

function normalise(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}
