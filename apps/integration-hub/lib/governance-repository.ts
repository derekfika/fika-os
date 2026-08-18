import crypto from "node:crypto";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import type { CanonicalLifecycle, CanonicalRecord } from "./types";
import { getState } from "./repository";
import {
  BrightHrCompleteness,
  RotaCompleteness,
  governanceIssues,
  lifecycleOf,
  type CompletenessClassification,
} from "./data-governance";
import { parseCanonical } from "./schemas";
import { schemaDefinition } from "./schema-catalogue";
import { acceptedPublishedCanonicalPage } from "./canonical-boundary";
import type { Query } from "firebase-admin/firestore";
import { assertPermission } from "./authmod";
import { formatAddress } from "./address";
import {
  completenessDecisionReason,
  lifecycleDecisionReason,
  sourceMappingReason,
} from "./governed-reasons";
import { buildLegendIdentityQueues } from "./legend-identity-reconciliation";

const canonical = () => db.collection("integrationHubCanonical");
const completeness = () => db.collection("integrationHubCompletenessDecisions");
const mappings = () => db.collection("integrationHubSourceMappings");
const audit = () => db.collection("integrationHubGovernanceAudit");

export async function governanceOverview() {
  const [state, decisionsSnapshot, mappingsSnapshot] = await Promise.all([
    getState(),
    completeness().get(),
    mappings().get(),
  ]);
  const decisions = new Map(
    decisionsSnapshot.docs.map((document) => [
      String(document.data().fieldId),
      document.data(),
    ]),
  );
  const fields = [...BrightHrCompleteness, ...RotaCompleteness].map(
    (field) => ({
      ...field,
      observed: observedCount(field.fieldId, state.staging),
      ...(decisions.get(field.fieldId) || {}),
    }),
  );
  const sourceMappings = mappingsSnapshot.docs
    .map((document) => document.data())
    .sort((a, b) =>
      String(a.sourceLabel || a.sourceIdentifier).localeCompare(
        String(b.sourceLabel || b.sourceIdentifier),
      ),
    );
  const lifecycleCounts = Object.fromEntries(
    ["draft", "needs-review", "published", "archived"].map((status) => [
      status,
      state.canonical.filter((record) => lifecycleOf(record) === status).length,
    ]),
  );
  const legendQueues = buildLegendIdentityQueues({
    staging: state.staging,
    canonical: state.canonical,
    sourceMappings,
    lifecycle: lifecycleOf,
    evidence: safeLegendEvidence,
  });
  const siteLabels = [
    ...new Set(
      state.staging
        .filter((record) => record.entityType === "Legend")
        .flatMap((record) =>
          Array.isArray(record.normalised.rotaSiteReferences)
            ? record.normalised.rotaSiteReferences
                .map((reference) =>
                  String((reference as Record<string, unknown>).name || ""),
                )
                .filter(Boolean)
            : [],
        ),
    ),
  ].sort();
  const records = state.canonical.map((record) => {
    const address = record.record.addressReference
      ? state.canonical.find(
          (candidate) =>
            candidate.canonicalId === record.record.addressReference &&
            candidate.entityType === "Address",
        )
      : undefined;
    return {
      ...publicationAssessment(record, state.canonical),
      label: canonicalLabel(record),
      addressReference: record.record.addressReference,
      addressLabel: address ? formatAddress(address.record) : undefined,
      addressLifecycle: address ? lifecycleOf(address) : undefined,
      aliases: record.record.aliases || [],
      sourceMappings: sourceMappings
        .filter((mapping) => mapping.oplocId === record.canonicalId)
        .map((mapping) => ({
          mappingId: mapping.mappingId,
          sourceProvider: mapping.sourceProvider,
          sourceLabel: mapping.sourceLabel,
          mappingStatus: mapping.mappingStatus,
        })),
    };
  });
  const issues = governanceIssues(state.canonical, state.staging).map(
    (issue) => {
      const canonicalRecord = state.canonical.find(
        (record) => record.canonicalId === issue.entityReference,
      );
      const stagedRecord = state.staging.find(
        (record) => record.stagingId === issue.entityReference,
      );
      return {
        ...issue,
        ...(canonicalRecord
          ? {
              entityLabel: canonicalLabel(canonicalRecord),
              entityType: canonicalRecord.entityType,
              canonicalId: canonicalRecord.canonicalId,
            }
          : stagedRecord
            ? {
                entityLabel: String(
                  stagedRecord.normalised.displayName ||
                    stagedRecord.normalised.name ||
                    stagedRecord.stagingId,
                ),
                entityType: stagedRecord.entityType,
              }
            : {}),
      };
    },
  );
  return {
    fields,
    sourceMappings,
    lifecycleCounts,
    issues,
    queues: {
      legends: legendQueues.active,
      deferredLegends: legendQueues.deferred,
      missingRotaEvidence: legendQueues.missingRotaEvidence,
      siteLabels: siteLabels.map((label) => ({
        label,
        mapping:
          sourceMappings.find(
            (mapping) =>
              mapping.sourceProvider === "rota" &&
              mapping.sourceLabel === label,
          ) || null,
      })),
    },
    publicationReadiness: {
      explicitLifecycle: state.canonical.filter((record) =>
        Boolean(record.lifecycleStatus),
      ).length,
      legacyWithoutLifecycle: state.canonical.filter(
        (record) => !record.lifecycleStatus && !record.publicationStatus,
      ).length,
      published: lifecycleCounts.published,
      eligible: records.filter((record) => record.publicationEligible).length,
      records,
    },
  };
}

export async function recordCompletenessDecision(
  actor: Actor,
  input: {
    fieldId: string;
    classification: CompletenessClassification;
    decisionReason: string;
  },
) {
  const definition = [...BrightHrCompleteness, ...RotaCompleteness].find(
    (field) => field.fieldId === input.fieldId,
  );
  if (!definition)
    throw Object.assign(new Error("Unknown completeness field."), {
      status: 404,
    });
  const timestamp = new Date().toISOString();
  const decisionReason = completenessDecisionReason(
    definition.description,
    input.classification,
    input.decisionReason,
  );
  const payload = {
    fieldId: input.fieldId,
    classification: input.classification,
    decisionReason,
    lastReviewedAt: timestamp,
    reviewedBy: actor.uid,
  };
  const batch = db.batch();
  batch.set(completeness().doc(hash(input.fieldId)), payload, { merge: true });
  batch.set(
    audit().doc(crypto.randomUUID()),
    auditEvent(actor, "Completeness decision", input.fieldId, decisionReason),
  );
  await batch.commit();
  return payload;
}

export async function recordSourceMapping(
  actor: Actor,
  input: {
    sourceProvider: string;
    sourceEntityType: string;
    sourceIdentifier: string;
    sourceLabel?: string;
    oplocId?: string;
    targetCanonicalId?: string;
    mappingStatus:
      | "unresolved"
      | "confirmed"
      | "rejected"
      | "deferred"
      | "historical"
      | "irrelevant";
    decisionReason: string;
  },
) {
  const isLocation =
    input.sourceEntityType === "site-label" ||
    input.sourceEntityType === "provider-location";
  const targetId = isLocation ? input.oplocId : input.targetCanonicalId;
  if (input.mappingStatus === "confirmed" && !targetId)
    throw Object.assign(
      new Error(
        isLocation
          ? "A confirmed location mapping requires an oplocId."
          : "A confirmed mapping requires a canonical target ID.",
      ),
      { status: 400 },
    );
  let targetRecord: CanonicalRecord | undefined;
  if (targetId) {
    const target = await canonical().doc(hash(targetId)).get();
    if (!target.exists)
      throw Object.assign(
        new Error("Canonical mapping target does not exist."),
        { status: 400 },
      );
    targetRecord = target.data() as CanonicalRecord;
    if (isLocation && targetRecord.entityType !== "OPLOC")
      throw Object.assign(
        new Error("Location mappings may reference OPLOC records only."),
        { status: 400 },
      );
  }
  const mappingId = `source-mapping:${hash(`${input.sourceProvider}:${input.sourceEntityType}:${input.sourceIdentifier}`).slice(0, 24)}`;
  const timestamp = new Date().toISOString();
  const decisionReason = sourceMappingReason({
    status: input.mappingStatus,
    sourceLabel: input.sourceLabel || input.sourceIdentifier,
    targetLabel: targetRecord
      ? String(
          targetRecord.record.displayName ||
            targetRecord.record.approvedName ||
            targetRecord.canonicalId,
        )
      : undefined,
    sourceKind:
      input.sourceEntityType === "person-identity"
        ? "person candidate"
        : "source location label",
    note: input.decisionReason,
  });
  const payload = {
    mappingId,
    ...input,
    decisionReason,
    ...(isLocation ? { oplocId: targetId, targetCanonicalId: undefined } : {}),
    confirmedBy: input.mappingStatus === "confirmed" ? actor.uid : null,
    confirmedAt: input.mappingStatus === "confirmed" ? timestamp : null,
    updatedBy: actor.uid,
    updatedAt: timestamp,
    version: 1,
  };
  const reference = mappings().doc(hash(mappingId));
  const previous = await reference.get();
  if (previous.exists)
    payload.version = Number(previous.data()?.version || 0) + 1;
  const batch = db.batch();
  batch.set(reference, payload);
  batch.set(
    audit().doc(crypto.randomUUID()),
    auditEvent(actor, "Source mapping decision", mappingId, decisionReason),
  );
  await batch.commit();
  return payload;
}

export async function confirmedSourceMappings(provider: string) {
  const snapshot = await mappings()
    .where("sourceProvider", "==", provider)
    .where("mappingStatus", "==", "confirmed")
    .get();
  return snapshot.docs.map((document) => document.data());
}

export async function resolveLegacyLifecycle(actor: Actor) {
  const snapshot = await canonical().get();
  const existing = snapshot.docs.map(
    (document) => document.data() as CanonicalRecord,
  );
  const timestamp = new Date().toISOString();
  const writes = planLegacyLifecycleResolution(existing, actor, timestamp);
  for (let index = 0; index < writes.length; index += 200) {
    const batch = db.batch();
    for (const next of writes.slice(index, index + 200)) {
      batch.set(canonical().doc(hash(next.canonicalId)), next);
      batch.set(
        audit().doc(crypto.randomUUID()),
        auditEvent(
          actor,
          next.lifecycleStatus === "published"
            ? "Legacy canonical lifecycle resolved and published"
            : "Legacy canonical lifecycle resolved for review",
          next.canonicalId,
          "Applied an explicit lifecycle to a previously approved canonical record. Accepted, schema-valid records without substantive blockers were published; other definitions and structurally blocked records remain unpublished.",
        ),
      );
    }
    await batch.commit();
  }
  return {
    examined: writes.length,
    published: writes.filter((record) => record.lifecycleStatus === "published")
      .length,
    retainedForReview: writes.filter(
      (record) => record.lifecycleStatus !== "published",
    ).length,
  };
}

export function planLegacyLifecycleResolution(
  existing: CanonicalRecord[],
  actor: Pick<Actor, "uid">,
  timestamp: string,
) {
  const missingLifecycle = new Set(
    existing
      .filter((record) => !record.lifecycleStatus && !record.publicationStatus)
      .map((record) => record.canonicalId),
  );
  const pending = existing.filter(
    (record) =>
      missingLifecycle.has(record.canonicalId) ||
      (record.lifecycleStatus === "needs-review" &&
        !record.publicationStatus),
  );
  const replacements = new Map<string, CanonicalRecord>();
  for (const current of pending) {
    replacements.set(current.canonicalId, {
      ...current,
      lifecycleStatus: "needs-review",
    });
  }
  let progressed = true;
  while (progressed) {
    progressed = false;
    const projected = existing.map(
      (record) => replacements.get(record.canonicalId) || record,
    );
    for (const [canonicalId, candidate] of replacements) {
      if (candidate.lifecycleStatus === "published") continue;
      const resolved = resolveApprovedCanonicalLifecycle(
        candidate,
        projected,
        timestamp,
      );
      if (resolved.lifecycleStatus === "published") {
        replacements.set(canonicalId, resolved);
        progressed = true;
      }
    }
  }
  const currentById = new Map(
    existing.map((record) => [record.canonicalId, record]),
  );
  return [...replacements.values()]
    .filter((candidate) => {
      const current = currentById.get(candidate.canonicalId);
      return (
        missingLifecycle.has(candidate.canonicalId) ||
        (candidate.lifecycleStatus === "published" &&
          current?.lifecycleStatus !== "published")
      );
    })
    .map((candidate) => {
      const record = {
        ...candidate.record,
        version: Number(candidate.record.version || 0) + 1,
        updatedAt: timestamp,
        updatedBy: actor.uid,
      };
      return {
        ...candidate,
        record,
        dataHash: hash(JSON.stringify(record)),
      };
    });
}

export function resolveApprovedCanonicalLifecycle(
  current: CanonicalRecord,
  all: CanonicalRecord[],
  timestamp: string,
) {
  if (
    current.publicationStatus ||
    (current.lifecycleStatus && current.lifecycleStatus !== "needs-review")
  )
    return current;
  const candidate: CanonicalRecord = {
    ...current,
    lifecycleStatus: "needs-review",
  };
  const projected = all.map((record) =>
    record.canonicalId === candidate.canonicalId ? candidate : record,
  );
  if (!projected.some((record) => record.canonicalId === candidate.canonicalId))
    projected.push(candidate);
  const assessment = publicationAssessment(candidate, projected);
  const substantiveBlockers = assessment.blockers.filter(
    (blocker) => blocker !== "Governed human decision provenance is missing",
  );
  if (
    assessment.definitionStatus !== "accepted-canon" ||
    substantiveBlockers.length
  )
    return candidate;
  return {
    ...candidate,
    lifecycleStatus: "published" as const,
    publicationStatus: "published" as const,
    publishedAt: timestamp,
  };
}

export async function transitionCanonicalLifecycle(
  actor: Actor,
  input: {
    canonicalId: string;
    expectedVersion: number;
    target: CanonicalLifecycle;
    reason: string;
  },
) {
  const reference = canonical().doc(hash(input.canonicalId));
  const result = await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    if (!snapshot.exists)
      throw Object.assign(new Error("Canonical record not found."), {
        status: 404,
      });
    const current = snapshot.data() as CanonicalRecord;
    const from = lifecycleOf(current);
    if (current.entityType === "Address")
      assertPermission(
        actor,
        input.target === "published" ? "address.publish" : "address.lifecycle",
      );
    if (!allowedTransition(from, input.target))
      throw Object.assign(
        new Error(
          `Lifecycle transition ${from} to ${input.target} is not allowed.`,
        ),
        { status: 409 },
      );
    if (Number(current.record.version || 0) !== input.expectedVersion)
      throw Object.assign(
        new Error("Record version changed. Reload before changing lifecycle."),
        { status: 409 },
      );
    if (input.target === "published") {
      const definition = schemaDefinition(current.entityType);
      if (!definition || definition.definitionStatus !== "accepted-canon")
        throw Object.assign(
          new Error(
            `${current.entityType} is not an Accepted Canon entity type and cannot be published.`,
          ),
          { status: 409 },
        );
      const validated = parseCanonical(current.entityType, current.record);
      if (!validated.success)
        throw Object.assign(
          new Error("Record does not conform to its registered schema."),
          { status: 409 },
        );
      const assessment = publicationAssessment(
        current,
        (await getState()).canonical,
      );
      if (!assessment.publicationEligible)
        throw Object.assign(
          new Error(`Publication blocked: ${assessment.blockers.join("; ")}`),
          { status: 409 },
        );
    }
    const timestamp = new Date().toISOString();
    const next: CanonicalRecord = {
      ...current,
      lifecycleStatus: input.target,
      publicationStatus:
        input.target === "published"
          ? "published"
          : input.target === "archived"
            ? "withdrawn"
            : undefined,
      publishedAt:
        input.target === "published" ? timestamp : current.publishedAt,
      archivedAt: input.target === "archived" ? timestamp : undefined,
      record: {
        ...current.record,
        version: input.expectedVersion + 1,
        updatedAt: timestamp,
        updatedBy: actor.uid,
      },
    };
    const reason = lifecycleDecisionReason(
      String(
        current.record.displayName ||
          current.record.approvedName ||
          current.record.capabilityName ||
          (current.entityType === "Address"
            ? formatAddress(current.record)
            : "") ||
          current.canonicalId,
      ),
      from,
      input.target,
      input.reason,
    );
    transaction.set(reference, next);
    transaction.set(
      audit().doc(crypto.randomUUID()),
      auditEvent(
        actor,
        `Lifecycle ${from} -> ${input.target}`,
        input.canonicalId,
        reason,
      ),
    );
    return next;
  });
  return result;
}

export async function queryPublishedCanonical(input: {
  entityType?: string;
  locationType?: "Site" | "Venue";
  limit: number;
  after?: string;
}) {
  const query: Query = canonical().where("lifecycleStatus", "==", "published");
  const snapshot = await query.get();
  return acceptedPublishedCanonicalPage(
    snapshot.docs.map((document) => document.data() as CanonicalRecord),
    input,
  );
}

export function publicationAssessment(
  record: CanonicalRecord,
  all: CanonicalRecord[],
) {
  const definition = schemaDefinition(record.entityType);
  const blockers: string[] = [];
  const lifecycle = lifecycleOf(record);
  const alreadyPublished = lifecycle === "published";
  if (!definition || definition.definitionStatus !== "accepted-canon")
    blockers.push(
      `Entity definition is ${definition?.definitionStatus || "unregistered"}, not accepted-canon`,
    );
  const parsed = parseCanonical(record.entityType, record.record);
  if (!parsed.success)
    blockers.push("Record does not conform to its registered schema");
  if (!alreadyPublished && lifecycle !== "needs-review")
    blockers.push(`Lifecycle must be needs-review, currently ${lifecycle}`);
  if (
    record.entityType === "Legend" &&
    (record.record.jobTitle !== undefined ||
      record.record.employmentState !== undefined)
  )
    blockers.push(
      "Legacy Employment fields must be separated from the core Legend before publication",
    );
  if (
    record.entityType === "Address" &&
    record.record.approvalState !== "approved"
  )
    blockers.push(
      "Address requires a separate governed approval before publication",
    );
  const ownership = record.record.ownership as
    { fikaOwned?: { humanDecisions?: unknown[] } } | undefined;
  if (
    [
      "OPLOC",
      "Address",
      "Legend",
      "Operational Assignment",
      "Operational Capability",
      "Capability Enablement",
    ].includes(record.entityType) &&
    (!Array.isArray(ownership?.fikaOwned?.humanDecisions) ||
      ownership.fikaOwned.humanDecisions.length === 0)
  )
    blockers.push("Governed human decision provenance is missing");
  for (const reference of readinessReferences(record.record)) {
    const target = all.find((candidate) => candidate.canonicalId === reference);
    if (!target) blockers.push(`Broken reference ${reference}`);
    else if (lifecycleOf(target) !== "published")
      blockers.push(
        record.record.addressReference === reference
          ? "The linked Address must be published first. Use 'Publish linked address and continue' in the OPLOC editor."
          : `Referenced record ${reference} is not published`,
      );
  }
  return {
    canonicalId: record.canonicalId,
    entityType: record.entityType,
    definitionStatus: definition?.definitionStatus || "unregistered",
    lifecycleState: lifecycle,
    schemaVersion: String(record.record.schemaVersion || ""),
    schemaValid: parsed.success,
    alreadyPublished,
    publicationEligible: !alreadyPublished && blockers.length === 0,
    blockers,
  };
}
function readinessReferences(record: Record<string, unknown>) {
  return Object.entries(record)
    .filter(([key]) =>
      [
        "legendId",
        "oplocId",
        "capabilityId",
        "mergedIntoOplocId",
        "addressReference",
      ].includes(key),
    )
    .flatMap(([, value]) => (value ? [String(value)] : []));
}

function observedCount(
  fieldId: string,
  staging: Awaited<ReturnType<typeof getState>>["staging"],
) {
  const bright = staging.filter((record) => record.raw.provider === "brighthr");
  const map: Record<string, string> = {
    "brighthr:employee-id": "externalIdentities",
    "brighthr:display-name": "displayName",
    "brighthr:work-email": "workEmail",
    "brighthr:employment-status": "employmentState",
    "brighthr:termination-date": "terminationDate",
    "brighthr:job-title": "jobTitle",
    "brighthr:work-location": "workLocationReferences",
    "brighthr:absence-type": "absenceType",
    "rota:legend-name": "displayName",
    "rota:site-label": "rotaSiteReferences",
    "rota:weeks": "rotaSiteReferences",
    "rota:appearances": "rotaSiteReferences",
    "rota:latest-week": "rotaLatestWeek",
  };
  const key = map[fieldId];
  if (!key) return 0;
  return bright.filter((record) =>
    Array.isArray(record.normalised[key])
      ? (record.normalised[key] as unknown[]).length > 0
      : record.normalised[key] !== undefined && record.normalised[key] !== "",
  ).length;
}
function allowedTransition(from: CanonicalLifecycle, to: CanonicalLifecycle) {
  return new Set([
    "draft:needs-review",
    "needs-review:draft",
    "needs-review:published",
    "published:archived",
    "archived:needs-review",
  ]).has(`${from}:${to}`);
}
function hash(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function safeLegendEvidence(record: Record<string, unknown>) {
  return {
    displayName: record.displayName,
    workEmail: record.workEmail,
    jobTitle: record.jobTitle,
    employmentState: record.employmentState,
    externalIdentities: Array.isArray(record.externalIdentities)
      ? record.externalIdentities
          .map((identity) =>
            identity && typeof identity === "object"
              ? {
                  provider: String(
                    (identity as Record<string, unknown>).provider || "",
                  ),
                  externalId: String(
                    (identity as Record<string, unknown>).externalId || "",
                  ),
                }
              : null,
          )
          .filter(Boolean)
      : [],
    rotaSiteReferences: Array.isArray(record.rotaSiteReferences)
      ? record.rotaSiteReferences
      : [],
    workLocationReferences: Array.isArray(record.workLocationReferences)
      ? record.workLocationReferences
      : [],
  };
}
function canonicalLabel(record: CanonicalRecord) {
  return String(
    record.record.approvedName ||
      record.record.displayName ||
      record.record.name ||
      record.record.capabilityName ||
      (record.entityType === "Address" ? formatAddress(record.record) : "") ||
      record.canonicalId,
  );
}
function auditEvent(
  actor: Actor,
  action: string,
  entityReference: string,
  reason: string,
) {
  return {
    auditId: crypto.randomUUID(),
    action,
    entityReference,
    reason,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: new Date().toISOString(),
  };
}
