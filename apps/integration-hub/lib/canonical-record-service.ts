import crypto from "node:crypto";
import type { Transaction } from "firebase-admin/firestore";
import { db } from "./firebase-admin";
import type { Actor } from "./auth";
import {
  buildCanonicalRecord,
  diff,
  editorPreview,
  stableDocumentId,
  type CanonicalEditorInput,
  type EditableEntityType,
} from "./canonical-editor";
import { parseCanonical } from "./schemas";
import type { CanonicalRecord, FieldProvenance } from "./types";
import { sha256 } from "./profiler";
import {
  addressDuplicateCandidates,
  exactAddressCandidate,
  formatAddress,
  legacyAddressEvidence,
  likelyAddressCandidates,
} from "./address";
import { assertPermission } from "./authmod";
import { generateCanonicalId } from "./canonical-identities";
import {
  addressApprovalReason,
  canonicalChangeReason,
  sourceMappingReason,
} from "./governed-reasons";
import { validateOperationalAssignmentConnection } from "./connection-rules";

const canonical = () => db.collection("integrationHubCanonical");
const revisions = () => db.collection("integrationHubCanonicalRevisions");
const audit = () => db.collection("integrationHubGovernanceAudit");
const mappings = () => db.collection("integrationHubSourceMappings");

export type RelationshipOption = {
  canonicalId: string;
  entityType: string;
  label: string;
  lifecycleStatus: string;
  schemaValid: boolean;
  reusable?: boolean;
  recordVersion: number;
  approvalState?: string;
  address?: Record<string, unknown>;
  fieldLocks: string[];
};
export type LegacySiteOption = {
  canonicalId: string;
  label: string;
  address?: string;
  addressEvidence?: ReturnType<typeof legacyAddressEvidence>;
  sourceIdentities: { provider: string; externalId: string }[];
  mappingStatus: string;
  mappedOplocId?: string;
  mappedOplocLabel?: string;
};

export async function canonicalEditorContext() {
  const [recordsSnapshot, mappingsSnapshot] = await Promise.all([
    canonical().get(),
    mappings().get(),
  ]);
  const records = recordsSnapshot.docs.map(
    (document) => document.data() as CanonicalRecord,
  );
  const sourceMappings = mappingsSnapshot.docs.map((document) =>
    document.data(),
  );
  const relationships = records
    .filter(
      (record) =>
        ["OPLOC", "Address", "Legend", "Operational Capability"].includes(
          record.entityType,
        ) &&
        record.lifecycleStatus !== "archived" &&
        (record.entityType !== "OPLOC" || record.record.lifecycleState === "active"),
    )
    .map((record) => ({
      canonicalId: record.canonicalId,
      entityType: record.entityType,
      label: humanLabel(record),
      lifecycleStatus: record.lifecycleStatus || "needs-review",
      schemaValid: parseCanonical(record.entityType, record.record).success,
      recordVersion: Number(record.record.version || 0),
      fieldLocks: currentFieldLocks(record),
      ...(record.entityType === "Address"
        ? {
            reusable:
              record.lifecycleStatus === "published" &&
              record.publicationStatus === "published",
            approvalState: String(record.record.approvalState || "pending"),
            address: safeAddress(record.record),
          }
        : {}),
    }))
    .filter((option) => option.entityType === "Address" || option.schemaValid)
    .sort(
      (left, right) =>
        left.label.localeCompare(right.label) ||
        left.canonicalId.localeCompare(right.canonicalId),
    );
  const legacySites = records
    .filter((record) => record.entityType === "Site")
    .map((record) => {
      const mapping = sourceMappings.find(
        (candidate) =>
          candidate.sourceProvider === "integration-hub-legacy" &&
          candidate.sourceEntityType === "provider-location" &&
          candidate.sourceIdentifier === record.canonicalId,
      );
      const sourceIdentities = (
        Array.isArray(record.record.externalIdentities)
          ? record.record.externalIdentities
          : []
      )
        .filter((identity): identity is Record<string, unknown> =>
          Boolean(identity && typeof identity === "object"),
        )
        .map((identity) => ({
          provider: String(identity.provider || "unknown"),
          externalId: String(identity.externalId || ""),
        }));
      const addressEvidence = legacyAddressEvidence(record);
      const mappedOploc = mapping?.oplocId
        ? records.find(
            (candidate) =>
              candidate.canonicalId === String(mapping.oplocId) &&
              candidate.entityType === "OPLOC",
          )
        : undefined;
      return {
        canonicalId: record.canonicalId,
        label: humanLabel(record),
        ...(record.record.address
          ? { address: String(record.record.address) }
          : {}),
        ...(addressEvidence ? { addressEvidence } : {}),
        sourceIdentities,
        mappingStatus: String(mapping?.mappingStatus || "unresolved"),
        ...(mapping?.oplocId ? { mappedOplocId: String(mapping.oplocId) } : {}),
        ...(mappedOploc ? { mappedOplocLabel: humanLabel(mappedOploc) } : {}),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  const generatedIds = Object.fromEntries(
    (
      [
        "OPLOC",
        "Address",
        "Legend",
        "Employment",
        "Operational Assignment",
        "Operational Capability",
        "Capability Enablement",
      ] as EditableEntityType[]
    ).map((entityType) => [entityType, generateCanonicalId(entityType)]),
  );
  return { relationships, legacySites, generatedIds };
}

export async function previewCanonicalChange(
  actor: Actor,
  input: CanonicalEditorInput,
) {
  const [current, inlineCurrent, addressSnapshot] = await Promise.all([
    readCanonical(input.canonicalId),
    input.inlineAddress
      ? readCanonical(input.inlineAddress.canonicalId)
      : Promise.resolve(null),
    input.entityType === "Address" || input.inlineAddress
      ? canonical().where("entityType", "==", "Address").get()
      : Promise.resolve(null),
  ]);
  assertExpectedVersion(current, input.expectedVersion);
  if (!isGovernedPublishedEdit(input, current)) assertMutable(current);
  let resolvedInput = withInlineAddressReference(input);
  let inlinePreview: ReturnType<typeof editorPreview> | undefined;
  let inlineRecord: CanonicalRecord | undefined;
  let duplicateCandidates: ReturnType<typeof addressDuplicateCandidates> = [];
  let reusedAddress:
    { canonicalId: string; label: string; willPublish: boolean } | undefined;
  if (input.inlineAddress) {
    const previous =
      inlineCurrent?.lifecycleStatus === "published" ? null : inlineCurrent;
    if (previous) {
      assertExpectedVersion(previous, input.inlineAddress.expectedVersion);
      assertMutable(previous);
    }
    const addressInput = withCanonicalReason(
      inlineAddressCommand(input),
      previous,
    );
    const proposed = editorPreview(
      addressInput,
      actor,
      previous?.record,
    ).proposed;
    const addresses = addressSnapshot!.docs.map(
      (document) => document.data() as CanonicalRecord,
    );
    const candidates = addressDuplicateCandidates(
      proposed,
      addresses,
      previous ? input.inlineAddress.canonicalId : undefined,
    );
    const exact =
      inlineCurrent?.lifecycleStatus === "published" &&
      exactAddressCandidate(
        addressDuplicateCandidates(proposed, [inlineCurrent]),
      )
        ? { canonicalId: inlineCurrent.canonicalId }
        : uniqueExactAddressCandidate(candidates);
    if (exact) {
      inlineRecord =
        addresses.find((record) => record.canonicalId === exact.canonicalId) ||
        inlineCurrent ||
        undefined;
      if (!inlineRecord)
        throw conflict(
          "The exact Address match is no longer available. Reload and try again.",
        );
      reusedAddress = {
        canonicalId: inlineRecord.canonicalId,
        label: humanLabel(inlineRecord),
        willPublish: inlineRecord.lifecycleStatus !== "published",
      };
      resolvedInput = {
        ...input,
        values: { ...input.values, addressReference: inlineRecord.canonicalId },
        inlineAddress: undefined,
      };
    } else {
      inlinePreview = editorPreview(addressInput, actor, previous?.record);
      inlineRecord = wrapPreview(addressInput, inlinePreview.proposed);
      duplicateCandidates = likelyAddressCandidates(candidates);
    }
  } else if (input.entityType === "Address") {
    const proposed = editorPreview(input, actor, current?.record).proposed;
    const addresses = addressSnapshot!.docs.map(
      (document) => document.data() as CanonicalRecord,
    );
    const candidates = addressDuplicateCandidates(
      proposed,
      addresses,
      input.canonicalId,
    );
    const exact = uniqueExactAddressCandidate(candidates);
    if (exact) {
      const target = addresses.find(
        (record) => record.canonicalId === exact.canonicalId,
      )!;
      reusedAddress = {
        canonicalId: target.canonicalId,
        label: humanLabel(target),
        willPublish: target.lifecycleStatus !== "published",
      };
    }
    duplicateCandidates = likelyAddressCandidates(candidates);
  }
  const effectiveInput = withCanonicalReason(resolvedInput, current);
  assertAddressPermissions(
    actor,
    effectiveInput,
    current,
    inlineCurrent,
    false,
    Boolean(input.inlineAddress),
  );
  const preview = editorPreview(effectiveInput, actor, current?.record);
  const publishedAmendment = isGovernedPublishedEdit(input, current);
  assertLocks(current, preview.changes);
  await validateRelationships(effectiveInput, async (reference) =>
    inlineRecord?.canonicalId === reference
      ? inlineRecord
      : canonical()
          .doc(stableDocumentId(reference))
          .get()
          .then((snapshot) =>
            snapshot.exists ? (snapshot.data() as CanonicalRecord) : null,
          ),
  );
  if (input.legacySourceCanonicalId)
    await validateLegacySource(
      effectiveInput,
      async (reference) =>
        (await canonical().doc(stableDocumentId(reference)).get()).data() as
          CanonicalRecord | undefined,
      async (reference) =>
        (await mappings().doc(mappingDocumentId(reference)).get()).data(),
    );
  return {
    ...preview,
    ...(publishedAmendment
      ? {
          operation: "amend",
          lifecycleAfterSave: "published",
          publicationAfterSave: "published",
        }
      : {}),
    generatedReason: effectiveInput.decisionReason,
    duplicateCandidates,
    ...(reusedAddress ? { reusedAddress } : {}),
    ...(inlinePreview
      ? {
          inlineAddress: {
            ...inlinePreview,
            generatedReason: withCanonicalReason(
              inlineAddressCommand(input),
              inlineCurrent,
            ).decisionReason,
            duplicateCandidates,
          },
        }
      : {}),
    additionalWrites: [
      ...preview.additionalWrites,
      ...(publishedAmendment
        ? [
            `Create a governed ${input.entityType} amendment and revision while preserving publication`,
          ]
        : []),
      ...(inlinePreview
        ? [
            inlineCurrent
              ? "Update, automatically approve and publish the Address in the same transaction"
              : "Create, automatically approve and publish the Address in the same transaction",
            "Store its stable Address ID in OPLOC addressReference",
            "Create separate Address revision and audit history",
          ]
        : []),
      ...(reusedAddress
        ? [
            `Reuse ${reusedAddress.label}${reusedAddress.willPublish ? " and publish it before linking" : ""}`,
          ]
        : []),
      ...(addressReferenceChanged(current, effectiveInput)
        ? [
            "Audit the OPLOC Address relationship change and preserve the previous reference in revision history",
          ]
        : []),
    ],
  };
}

export async function saveCanonicalChange(
  actor: Actor,
  input: CanonicalEditorInput,
) {
  const documentReference = canonical().doc(
    stableDocumentId(input.canonicalId),
  );
  return db.runTransaction(async (transaction) => {
    const currentSnapshot = await transaction.get(documentReference);
    const current = currentSnapshot.exists
      ? (currentSnapshot.data() as CanonicalRecord)
      : null;
    const possibleOplocRetry =
      input.entityType === "OPLOC" &&
      Boolean(current) &&
      input.expectedVersion === 0 &&
      Boolean(input.inlineAddress);
    const governedPublishedEdit = isGovernedPublishedEdit(input, current);
    if (governedPublishedEdit && input.expectedVersion !== 0)
      assertExpectedVersion(current, input.expectedVersion);
    else if (!possibleOplocRetry) {
      assertExpectedVersion(current, input.expectedVersion);
      assertMutable(current);
    }
    let inlineCurrent: CanonicalRecord | null = null;
    if (input.inlineAddress) {
      const snapshot = await transaction.get(
        canonical().doc(stableDocumentId(input.inlineAddress.canonicalId)),
      );
      inlineCurrent = snapshot.exists
        ? (snapshot.data() as CanonicalRecord)
        : null;
    }
    const addressSnapshot =
      input.entityType === "Address" || input.inlineAddress
        ? await transaction.get(
            canonical().where("entityType", "==", "Address"),
          )
        : null;
    const allAddresses =
      addressSnapshot?.docs.map(
        (document) => document.data() as CanonicalRecord,
      ) || [];

    let inlineResult: ReturnType<typeof buildRecordChange> | undefined;
    let linkedAddress: CanonicalRecord | undefined;
    let existingAddressPublication:
      ReturnType<typeof buildAutomaticAddressPublication> | undefined;
    let resolvedInput = withInlineAddressReference(input);
    if (input.inlineAddress) {
      const freshAddressInput = withCanonicalReason(
        inlineAddressCommand(input),
        inlineCurrent?.lifecycleStatus === "published" ? null : inlineCurrent,
      );
      const proposed = buildCanonicalRecord(
        freshAddressInput,
        actor,
        inlineCurrent?.lifecycleStatus === "published"
          ? undefined
          : inlineCurrent?.record,
      );
      if (inlineCurrent?.lifecycleStatus === "published") {
        if (
          !exactAddressCandidate(
            addressDuplicateCandidates(proposed, [inlineCurrent]),
          )
        )
          throw conflict(
            "This Address identity already exists with different address information. Reload before saving.",
          );
        linkedAddress = inlineCurrent;
      } else {
        assertExpectedVersion(
          inlineCurrent,
          input.inlineAddress.expectedVersion,
        );
        assertMutable(inlineCurrent);
        inlineResult = buildRecordChange(
          actor,
          freshAddressInput,
          inlineCurrent,
        );
        const duplicates = addressDuplicateCandidates(
          inlineResult.record,
          allAddresses,
          input.inlineAddress.canonicalId,
        );
        const exact = uniqueExactAddressCandidate(duplicates);
        if (exact) {
          linkedAddress = allAddresses.find(
            (record) => record.canonicalId === exact.canonicalId,
          )!;
          inlineResult = undefined;
        } else {
          const likely = likelyAddressCandidates(duplicates);
          if (likely.length && !input.inlineAddress.allowDistinctDuplicate)
            throw conflict(
              "A likely Address match exists. Use the existing Address or explicitly confirm that this is genuinely different.",
            );
          linkedAddress = inlineResult.next;
        }
      }
      if (linkedAddress.lifecycleStatus !== "published") {
        existingAddressPublication = buildAutomaticAddressPublication(
          actor,
          linkedAddress,
          "Automatically approved and published a valid Address while linking it to an OPLOC.",
        );
        linkedAddress = existingAddressPublication.next;
      }
      resolvedInput = {
        ...input,
        values: {
          ...input.values,
          addressReference: linkedAddress.canonicalId,
        },
        inlineAddress: undefined,
      };
    }
    const effectiveInput = withCanonicalReason(resolvedInput, current);
    const evidence = await readTransactionEvidence(transaction, effectiveInput);
    if (linkedAddress)
      evidence.relationships.set(linkedAddress.canonicalId, linkedAddress);
    assertAddressPermissions(
      actor,
      effectiveInput,
      current,
      inlineCurrent,
      true,
      Boolean(input.inlineAddress),
    );
    validateLoadedRelationships(effectiveInput, evidence.relationships);
    if (effectiveInput.entityType === "Operational Assignment") {
      const legend = evidence.relationships.get(
        String(effectiveInput.values.legendId || ""),
      );
      if (!legend)
        throw badRequest("Choose an available Legend before saving the assignment.");
      validateOperationalAssignmentConnection({
        command: effectiveInput,
        current,
        legend,
        employments: evidence.employments,
        assignments: evidence.assignments,
      });
    }
    if (effectiveInput.legacySourceCanonicalId)
      validateLoadedLegacySource(
        effectiveInput,
        evidence.legacySource,
        evidence.mapping,
      );
    if (possibleOplocRetry) {
      if (isIdempotentOplocRetry(current!, effectiveInput))
        return {
          record: current!,
          addressRecord: linkedAddress,
          changes: [],
          publicationOccurred: false,
          idempotentRetry: true,
        };
      throw conflict(
        "This OPLOC identity was already saved with different information. Reload before saving again.",
      );
    }

    const result = buildRecordChange(actor, effectiveInput, current);
    if (effectiveInput.entityType === "Address") {
      if (
        current?.lifecycleStatus === "published" &&
        input.expectedVersion === 0
      ) {
        if (
          exactAddressCandidate(
            addressDuplicateCandidates(result.record, [current]),
          )
        )
          return {
            record: current,
            changes: [],
            publicationOccurred: false,
            reusedAddress: true,
          };
        throw conflict(
          "This Address identity already exists with different address information. Reload before saving.",
        );
      }
      const duplicates = addressDuplicateCandidates(
        result.record,
        allAddresses,
        effectiveInput.canonicalId,
      );
      const exact = uniqueExactAddressCandidate(duplicates);
      if (exact) {
        let reused = allAddresses.find(
          (record) => record.canonicalId === exact.canonicalId,
        )!;
        let publicationOccurred = false;
        if (reused.lifecycleStatus !== "published") {
          const publication = buildAutomaticAddressPublication(
            actor,
            reused,
            "Automatically approved and published an exact reusable Address match.",
          );
          writeAutomaticAddressPublication(
            transaction,
            actor,
            reused,
            publication,
          );
          reused = publication.next;
          publicationOccurred = true;
        }
        return {
          record: reused,
          changes: [],
          publicationOccurred,
          reusedAddress: true,
        };
      }
      if (
        likelyAddressCandidates(duplicates).length &&
        !effectiveInput.allowDistinctDuplicate
      )
        throw conflict(
          "A likely Address match exists. Use the existing Address or explicitly confirm that this is genuinely different.",
        );
    }
    const { changes, next, now } = result;
    assertLocks(current, changes);
    writeRecordChange(transaction, actor, effectiveInput, current, result);
    if (inlineResult) {
      assertLocks(inlineCurrent, inlineResult.changes);
      writeRecordChange(
        transaction,
        actor,
        withCanonicalReason(inlineAddressCommand(input), inlineCurrent),
        inlineCurrent,
        inlineResult,
      );
    }
    if (existingAddressPublication)
      writeAutomaticAddressPublication(
        transaction,
        actor,
        allAddresses.find(
          (record) =>
            record.canonicalId === existingAddressPublication!.next.canonicalId,
        )!,
        existingAddressPublication,
      );
    if (effectiveInput.legacySourceCanonicalId)
      transaction.set(
        mappings().doc(
          mappingDocumentId(effectiveInput.legacySourceCanonicalId),
        ),
        sourceMapping(
          actor,
          effectiveInput.legacySourceCanonicalId,
          effectiveInput.canonicalId,
          effectiveInput.decisionReason,
          now,
          Number(evidence.mapping?.version || 0) + 1,
        ),
      );
    return {
      record: next,
      ...(linkedAddress ? { addressRecord: linkedAddress } : {}),
      changes,
      publicationOccurred: effectiveInput.entityType === "Address",
    };
  });
}

export async function approveAddress(
  actor: Actor,
  input: { canonicalId: string; expectedVersion: number; note?: string },
) {
  assertPermission(actor, "address.approve");
  assertPermission(actor, "address.publish");
  const reference = canonical().doc(stableDocumentId(input.canonicalId));
  return db.runTransaction(async (transaction) => {
    const [snapshot, addressSnapshot] = await Promise.all([
      transaction.get(reference),
      transaction.get(canonical().where("entityType", "==", "Address")),
    ]);
    if (!snapshot.exists) throw badRequest("Address record does not exist.");
    const current = snapshot.data() as CanonicalRecord;
    if (current.entityType !== "Address")
      throw badRequest("Only an Address may use the Address approval action.");
    assertExpectedVersion(current, input.expectedVersion);
    if (current.lifecycleStatus === "published")
      return { record: current, changes: [], publicationOccurred: false };
    if (!parseCanonical("Address", current.record).success)
      throw badRequest("The Address must be schema-valid before approval.");
    const duplicates = addressDuplicateCandidates(
      current.record,
      addressSnapshot.docs.map(
        (document) => document.data() as CanonicalRecord,
      ),
      current.canonicalId,
    );
    if (
      exactAddressCandidate(duplicates) ||
      likelyAddressCandidates(duplicates).length
    )
      throw conflict(
        "This Address has an exact or likely duplicate that requires review before publication.",
      );
    const publication = buildAutomaticAddressPublication(
      actor,
      current,
      addressApprovalReason(
        formatAddress(current.record) || "selected address",
        input.note,
      ),
    );
    writeAutomaticAddressPublication(transaction, actor, current, publication);
    return {
      record: publication.next,
      changes: publication.changes,
      publicationOccurred: true,
    };
  });
}

export function addressPublicationAssessment(records: CanonicalRecord[]) {
  const addresses = records.filter(
    (record) =>
      record.entityType === "Address" &&
      record.lifecycleStatus !== "published" &&
      record.lifecycleStatus !== "archived",
  );
  const incomplete: Array<{
    canonicalId: string;
    label: string;
    reason: string;
  }> = [];
  const duplicates: Array<{
    canonicalId: string;
    label: string;
    candidates: ReturnType<typeof addressDuplicateCandidates>;
  }> = [];
  const publishable: CanonicalRecord[] = [];
  for (const record of addresses) {
    const parsed = parseCanonical("Address", record.record);
    if (!parsed.success || record.record.lifecycleState !== "active") {
      incomplete.push({
        canonicalId: record.canonicalId,
        label: humanLabel(record),
        reason: parsed.success
          ? "Address is not active."
          : parsed.error.issues[0]?.message || "Address is incomplete.",
      });
      continue;
    }
    const candidates = addressDuplicateCandidates(
      record.record,
      records,
      record.canonicalId,
    );
    const blockingCandidates = candidates.filter(
      (candidate) => candidate.exact || candidate.confidence >= 0.8,
    );
    if (blockingCandidates.length) {
      duplicates.push({
        canonicalId: record.canonicalId,
        label: humanLabel(record),
        candidates: blockingCandidates,
      });
      continue;
    }
    publishable.push(record);
  }
  return { publishable, incomplete, duplicates };
}

export async function assessExistingAddressPublication() {
  const snapshot = await canonical().where("entityType", "==", "Address").get();
  const assessment = addressPublicationAssessment(
    snapshot.docs.map((document) => document.data() as CanonicalRecord),
  );
  return {
    publishable: assessment.publishable.map((record) => ({
      canonicalId: record.canonicalId,
      label: humanLabel(record),
    })),
    incomplete: assessment.incomplete,
    duplicates: assessment.duplicates,
  };
}

export async function publishValidExistingAddresses(actor: Actor) {
  assertPermission(actor, "address.approve");
  assertPermission(actor, "address.publish");
  const assessment = await assessExistingAddressPublication();
  const published: string[] = [];
  for (const item of assessment.publishable) {
    const current = await readCanonical(item.canonicalId);
    if (!current || current.lifecycleStatus === "published") continue;
    await approveAddress(actor, {
      canonicalId: current.canonicalId,
      expectedVersion: Number(current.record.version),
      note: "Administrator bulk publication of a schema-valid, complete and non-duplicate Address.",
    });
    published.push(current.canonicalId);
  }
  return {
    published,
    publishedCount: published.length,
    skippedIncomplete: assessment.incomplete,
    skippedDuplicates: assessment.duplicates,
  };
}

export async function previewLegacySiteDecision(input: {
  legacySourceCanonicalId: string;
  oplocId?: string;
  mappingStatus: "confirmed" | "rejected" | "deferred" | "unresolved";
  decisionReason: string;
}) {
  const source = await readCanonical(input.legacySourceCanonicalId);
  const target = input.oplocId ? await readCanonical(input.oplocId) : null;
  validateLegacyDecision(input, source, target);
  const generatedReason = sourceMappingReason({
    status: input.mappingStatus,
    sourceLabel: humanLabel(source!),
    targetLabel: target ? humanLabel(target) : undefined,
    sourceKind: "source location",
    note: input.decisionReason,
  });
  return {
    operation: "legacy-site-decision",
    source: safeLegacyEvidence(source!),
    mappingStatus: input.mappingStatus,
    target: target
      ? {
          canonicalId: target.canonicalId,
          label: humanLabel(target),
          entityType: target.entityType,
        }
      : null,
    generatedReason,
    additionalWrites: [
      "Preserve legacy Site candidate unchanged",
      "Version the deterministic source mapping",
      "Create an audit event",
    ],
    publicationAfterSave: "unchanged",
  };
}

export async function saveLegacySiteDecision(
  actor: Actor,
  input: {
    legacySourceCanonicalId: string;
    oplocId?: string;
    mappingStatus: "confirmed" | "rejected" | "deferred" | "unresolved";
    decisionReason: string;
  },
) {
  const mappingRef = mappings().doc(
    mappingDocumentId(input.legacySourceCanonicalId),
  );
  return db.runTransaction(async (transaction) => {
    const reads = [
      transaction.get(
        canonical().doc(stableDocumentId(input.legacySourceCanonicalId)),
      ),
      transaction.get(mappingRef),
    ];
    if (input.oplocId)
      reads.push(
        transaction.get(canonical().doc(stableDocumentId(input.oplocId))),
      );
    const [sourceSnapshot, mappingSnapshot, targetSnapshot] =
      await Promise.all(reads);
    const source = sourceSnapshot.exists
      ? (sourceSnapshot.data() as CanonicalRecord)
      : null;
    const target = targetSnapshot?.exists
      ? (targetSnapshot.data() as CanonicalRecord)
      : null;
    validateLegacyDecision(input, source, target);
    const currentMapping = mappingSnapshot.exists
      ? mappingSnapshot.data()
      : undefined;
    if (
      currentMapping?.mappingStatus === "confirmed" &&
      currentMapping.oplocId !== input.oplocId
    )
      throw conflict(
        "This legacy Site already has a confirmed OPLOC mapping. Review that decision before replacing it.",
      );
    const now = new Date().toISOString();
    const decisionReason = sourceMappingReason({
      status: input.mappingStatus,
      sourceLabel: humanLabel(source!),
      targetLabel: target ? humanLabel(target) : undefined,
      sourceKind: "source location",
      note: input.decisionReason,
    });
    const payload = {
      mappingId: mappingId(input.legacySourceCanonicalId),
      sourceProvider: "integration-hub-legacy",
      sourceEntityType: "provider-location",
      sourceIdentifier: input.legacySourceCanonicalId,
      sourceLabel: humanLabel(source!),
      ...(input.oplocId ? { oplocId: input.oplocId } : {}),
      mappingStatus: input.mappingStatus,
      decisionReason,
      confirmedBy: input.mappingStatus === "confirmed" ? actor.uid : null,
      confirmedAt: input.mappingStatus === "confirmed" ? now : null,
      updatedBy: actor.uid,
      updatedAt: now,
      version: Number(currentMapping?.version || 0) + 1,
    };
    transaction.set(mappingRef, payload);
    transaction.set(audit().doc(crypto.randomUUID()), {
      auditId: crypto.randomUUID(),
      action: "Legacy Site decision",
      entityReference: input.legacySourceCanonicalId,
      actorId: actor.uid,
      actorName: actor.name,
      timestamp: now,
      reason: decisionReason,
      exactDiff: [
        {
          field: "mapping",
          previousValue: currentMapping || null,
          newValue: payload,
        },
      ],
      publicationOccurred: false,
    });
    return {
      mapping: payload,
      sourcePreserved: true,
      publicationOccurred: false,
    };
  });
}

export function assertExpectedVersion(
  current: CanonicalRecord | null,
  expectedVersion?: number,
) {
  if (!current && expectedVersion !== undefined && expectedVersion !== 0)
    throw conflict(
      "The record no longer matches the version used to open the editor.",
    );
  if (current && Number(current.record.version || 0) !== expectedVersion)
    throw conflict(
      "This canonical record changed after the editor opened. Reload the latest version; your form values have not been discarded.",
    );
}

async function readCanonical(canonicalId: string) {
  const snapshot = await canonical().doc(stableDocumentId(canonicalId)).get();
  return snapshot.exists ? (snapshot.data() as CanonicalRecord) : null;
}
async function readTransactionEvidence(
  transaction: Transaction,
  input: CanonicalEditorInput,
) {
  const referenceIds = relationshipIds(input);
  const referenceSnapshots = await Promise.all(
    referenceIds.map((reference) =>
      transaction.get(canonical().doc(stableDocumentId(reference))),
    ),
  );
  let legacySource: CanonicalRecord | undefined,
    mapping: FirebaseFirestore.DocumentData | undefined;
  let assignments: CanonicalRecord[] = [],
    employments: CanonicalRecord[] = [];
  if (input.entityType === "Operational Assignment") {
    const [assignmentSnapshot, employmentSnapshot] = await Promise.all([
      transaction.get(
        canonical().where("entityType", "==", "Operational Assignment"),
      ),
      transaction.get(canonical().where("entityType", "==", "Employment")),
    ]);
    assignments = assignmentSnapshot.docs.map(
      (document) => document.data() as CanonicalRecord,
    );
    employments = employmentSnapshot.docs.map(
      (document) => document.data() as CanonicalRecord,
    );
  }
  if (input.legacySourceCanonicalId) {
    const [sourceSnapshot, mappingSnapshot] = await Promise.all([
      transaction.get(
        canonical().doc(stableDocumentId(input.legacySourceCanonicalId)),
      ),
      transaction.get(
        mappings().doc(mappingDocumentId(input.legacySourceCanonicalId)),
      ),
    ]);
    legacySource = sourceSnapshot.exists
      ? (sourceSnapshot.data() as CanonicalRecord)
      : undefined;
    mapping = mappingSnapshot.exists ? mappingSnapshot.data() : undefined;
  }
  return {
    relationships: new Map(
      referenceIds.map((reference, index) => [
        reference,
        referenceSnapshots[index]?.exists
          ? (referenceSnapshots[index]!.data() as CanonicalRecord)
          : null,
      ]),
    ),
    legacySource,
    mapping,
    assignments,
    employments,
  };
}
function relationshipIds(input: CanonicalEditorInput) {
  if (input.entityType === "OPLOC")
    return [
      String(input.values.addressReference || ""),
      ...(input.values.mergedIntoOplocId
        ? [String(input.values.mergedIntoOplocId)]
        : []),
    ].filter(Boolean);
  if (input.entityType === "Operational Assignment")
    return [
      String(input.values.legendId || ""),
      String(input.values.oplocId || ""),
    ].filter(Boolean);
  if (input.entityType === "Employment")
    return [String(input.values.legendId || "")].filter(Boolean);
  if (input.entityType === "Capability Enablement")
    return [
      String(input.values.capabilityId || ""),
      String(input.values.oplocId || ""),
    ].filter(Boolean);
  return [];
}
async function validateRelationships(
  input: CanonicalEditorInput,
  get: (reference: string) => Promise<CanonicalRecord | null>,
) {
  const references = new Map<string, CanonicalRecord | null>();
  for (const id of relationshipIds(input)) references.set(id, await get(id));
  validateLoadedRelationships(input, references);
}
function validateLoadedRelationships(
  input: CanonicalEditorInput,
  references: Map<string, CanonicalRecord | null>,
) {
  if (input.entityType === "OPLOC") {
    if (input.values.addressReference)
      assertReference(
        references,
        String(input.values.addressReference),
        "Address",
      );
    if (input.values.mergedIntoOplocId)
      assertReference(
        references,
        String(input.values.mergedIntoOplocId),
        "OPLOC",
      );
  }
  if (input.entityType === "Operational Assignment") {
    assertReference(references, String(input.values.legendId || ""), "Legend");
    assertReference(references, String(input.values.oplocId || ""), "OPLOC");
  }
  if (input.entityType === "Employment")
    assertReference(references, String(input.values.legendId || ""), "Legend");
  if (input.entityType === "Capability Enablement") {
    assertReference(
      references,
      String(input.values.capabilityId || ""),
      "Operational Capability",
    );
    assertReference(references, String(input.values.oplocId || ""), "OPLOC");
  }
}
function assertReference(
  references: Map<string, CanonicalRecord | null>,
  id: string,
  expectedType: EditableEntityType,
) {
  const record = references.get(id);
  if (!record)
    throw badRequest(
      `${expectedType} reference ${id || "(missing)"} does not exist.`,
    );
  if (record.entityType !== expectedType)
    throw badRequest(`${id} is ${record.entityType}, not ${expectedType}.`);
  if (record.lifecycleStatus === "archived")
    throw badRequest(`${expectedType} reference ${id} is archived.`);
  if (!parseCanonical(record.entityType, record.record).success)
    throw badRequest(`${expectedType} reference ${id} is not schema-valid.`);
}
function assertMutable(current: CanonicalRecord | null) {
  if (
    current?.lifecycleStatus === "published" ||
    current?.lifecycleStatus === "archived"
  )
    throw conflict(
      `A ${current.lifecycleStatus} record requires a governed lifecycle or amendment workflow before direct editing.`,
    );
}
export function isGovernedPublishedEdit(
  input: CanonicalEditorInput,
  current: CanonicalRecord | null,
) {
  return (
    current?.lifecycleStatus === "published" &&
    (input.entityType === "Address" ||
      input.entityType === "OPLOC" ||
      input.entityType === "Employment" ||
      input.entityType === "Operational Assignment")
  );
}
function assertLocks(
  current: CanonicalRecord | null,
  changes: { field: string }[],
) {
  const ownership = current?.record.ownership as
    { fikaOwned?: { fieldLocks?: unknown[] } } | undefined;
  const locks = new Set(
    Array.isArray(ownership?.fikaOwned?.fieldLocks)
      ? ownership!.fikaOwned!.fieldLocks!.map(String)
      : [],
  );
  const blocked = changes
    .map((change) => change.field)
    .filter((field) => locks.has(field));
  if (blocked.length)
    throw conflict(`Locked fields cannot be changed: ${blocked.join(", ")}.`);
}
async function validateLegacySource(
  input: CanonicalEditorInput,
  getSource: (reference: string) => Promise<CanonicalRecord | undefined>,
  getMapping: (
    reference: string,
  ) => Promise<FirebaseFirestore.DocumentData | undefined>,
) {
  const source = await getSource(input.legacySourceCanonicalId!);
  const mapping = await getMapping(input.legacySourceCanonicalId!);
  validateLoadedLegacySource(input, source, mapping);
}
function validateLoadedLegacySource(
  input: CanonicalEditorInput,
  source?: CanonicalRecord,
  mapping?: FirebaseFirestore.DocumentData,
) {
  if (input.entityType !== "OPLOC")
    throw badRequest("Legacy Site evidence may create or map an OPLOC only.");
  if (!source || source.entityType !== "Site")
    throw badRequest(
      "The selected legacy source is not a preserved Site candidate.",
    );
  if (
    mapping?.mappingStatus === "confirmed" &&
    mapping.oplocId !== input.canonicalId
  )
    throw conflict("This legacy Site already maps to a different OPLOC.");
}
function validateLegacyDecision(
  input: {
    legacySourceCanonicalId: string;
    oplocId?: string;
    mappingStatus: string;
    decisionReason: string;
  },
  source: CanonicalRecord | null,
  target: CanonicalRecord | null,
) {
  if (!source || source.entityType !== "Site")
    throw badRequest(
      "The selected legacy source is not a preserved Site candidate.",
    );
  if (input.mappingStatus === "confirmed") {
    if (!target)
      throw badRequest(
        "A confirmed legacy decision requires an existing OPLOC.",
      );
    if (target.entityType !== "OPLOC")
      throw badRequest("Legacy location evidence may map only to an OPLOC.");
  } else if (input.oplocId)
    throw badRequest(
      `${input.mappingStatus} decisions must not retain an OPLOC target.`,
    );
}
function sourceMapping(
  actor: Actor,
  sourceId: string,
  oplocId: string,
  reason: string,
  now: string,
  version: number,
) {
  return {
    mappingId: mappingId(sourceId),
    sourceProvider: "integration-hub-legacy",
    sourceEntityType: "provider-location",
    sourceIdentifier: sourceId,
    sourceLabel: sourceId,
    oplocId,
    mappingStatus: "confirmed",
    decisionReason: reason,
    confirmedBy: actor.uid,
    confirmedAt: now,
    updatedBy: actor.uid,
    updatedAt: now,
    version,
  };
}
function mappingId(sourceId: string) {
  return `source-mapping:${stableDocumentId(`integration-hub-legacy:provider-location:${sourceId}`).slice(0, 24)}`;
}
function mappingDocumentId(sourceId: string) {
  return stableDocumentId(mappingId(sourceId));
}
function humanLabel(record: CanonicalRecord) {
  return record.entityType === "Address"
    ? formatAddress(record.record) || record.canonicalId
    : String(
        record.record.approvedName ||
          record.record.displayName ||
          record.record.capabilityName ||
          record.record.name ||
          record.canonicalId,
      );
}
function safeLegacyEvidence(record: CanonicalRecord) {
  return {
    canonicalId: record.canonicalId,
    label: humanLabel(record),
    address: record.record.address,
    externalIdentities: record.record.externalIdentities,
  };
}
function provenance(
  actor: Actor,
  timestamp: string,
  reason: string,
  previousValue: unknown,
  newValue: unknown,
): FieldProvenance {
  return {
    source: "manual-correction",
    actorId: actor.uid,
    timestamp,
    reason,
    previousValue,
    newValue,
  };
}
function businessChanges(changes: ReturnType<typeof diff>) {
  return changes.filter(
    (change) =>
      !["version", "updatedAt", "updatedBy", "ownership"].includes(
        change.field,
      ),
  );
}
function badRequest(message: string) {
  return Object.assign(new Error(message), { status: 400 });
}
function conflict(message: string) {
  return Object.assign(new Error(message), { status: 409 });
}

function withInlineAddressReference(
  input: CanonicalEditorInput,
): CanonicalEditorInput {
  if (!input.inlineAddress) return input;
  if (input.entityType !== "OPLOC")
    throw badRequest(
      "Inline Address creation is available only from the OPLOC workflow.",
    );
  return {
    ...input,
    values: {
      ...input.values,
      addressReference: input.inlineAddress.canonicalId,
    },
  };
}

function inlineAddressCommand(
  input: CanonicalEditorInput,
): CanonicalEditorInput {
  if (!input.inlineAddress)
    throw badRequest("Inline Address input is missing.");
  return {
    entityType: "Address",
    canonicalId: input.inlineAddress.canonicalId,
    expectedVersion: input.inlineAddress.expectedVersion,
    values: input.inlineAddress.values,
    decisionReason: input.inlineAddress.decisionReason,
    allowDistinctDuplicate: input.inlineAddress.allowDistinctDuplicate,
  };
}

function wrapPreview(
  input: CanonicalEditorInput,
  record: Record<string, unknown>,
): CanonicalRecord {
  const address = input.entityType === "Address";
  return {
    canonicalId: input.canonicalId,
    entityType: input.entityType,
    record,
    dataHash: sha256(JSON.stringify(record)),
    lifecycleStatus: address ? "published" : "needs-review",
    ...(address
      ? {
          publicationStatus: "published" as const,
          publishedAt: String(record.updatedAt),
        }
      : {}),
    fieldProvenance: {},
  };
}

function buildRecordChange(
  actor: Actor,
  input: CanonicalEditorInput,
  current: CanonicalRecord | null,
) {
  const record = buildCanonicalRecord(input, actor, current?.record);
  if (input.entityType === "Address" && record.lifecycleState !== "active")
    throw badRequest("Only an active Address can be automatically published.");
  const changes = diff(current?.record || {}, record);
  const parsed = parseCanonical(input.entityType, record);
  if (!parsed.success)
    throw badRequest(
      `Canonical validation failed: ${parsed.error.issues[0]?.path.join(".") || "record"} ${parsed.error.issues[0]?.message || "is invalid"}.`,
    );
  const now = String(record.updatedAt);
  const fieldProvenance = structuredClone(current?.fieldProvenance || {});
  for (const change of businessChanges(changes))
    fieldProvenance[change.field] = [
      ...(fieldProvenance[change.field] || []),
      provenance(
        actor,
        now,
        input.decisionReason,
        change.previousValue,
        change.newValue,
      ),
    ];
  const address = input.entityType === "Address";
  const publishedAmendment = isGovernedPublishedEdit(input, current);
  const next: CanonicalRecord = {
    canonicalId: input.canonicalId,
    entityType: input.entityType,
    record,
    dataHash: sha256(JSON.stringify(record)),
    lifecycleStatus:
      address || publishedAmendment ? "published" : "needs-review",
    ...(address || publishedAmendment
      ? {
          publicationStatus: "published" as const,
          publishedAt: publishedAmendment ? current?.publishedAt || now : now,
        }
      : {}),
    fieldProvenance,
  };
  return { record, changes, next, now };
}

function writeRecordChange(
  transaction: Transaction,
  actor: Actor,
  input: CanonicalEditorInput,
  current: CanonicalRecord | null,
  result: ReturnType<typeof buildRecordChange>,
) {
  const revisionId = `canonical-revision:${stableDocumentId(`${input.canonicalId}:${String(result.record.version)}`)}`;
  transaction.set(
    canonical().doc(stableDocumentId(input.canonicalId)),
    result.next,
  );
  transaction.set(revisions().doc(stableDocumentId(revisionId)), {
    revisionId,
    canonicalId: input.canonicalId,
    entityType: input.entityType,
    version: result.record.version,
    previous: current || null,
    current: result.next,
    changes: result.changes,
    actorId: actor.uid,
    actorName: actor.name,
    reason: input.decisionReason,
    recordedAt: result.now,
  });
  const auditId = crypto.randomUUID();
  const automaticAddressPublication = input.entityType === "Address";
  const publishedAmendment = isGovernedPublishedEdit(input, current);
  transaction.set(audit().doc(auditId), {
    auditId,
    action: automaticAddressPublication
      ? "Address automatically approved and published"
      : publishedAmendment
        ? `Published ${input.entityType} amended`
        : current
          ? "Canonical record changed"
          : "Canonical record created",
    entityReference: input.canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: result.now,
    reason: input.decisionReason,
    exactDiff: result.changes,
    publicationOccurred: automaticAddressPublication,
  });
}

function assertAddressPermissions(
  actor: Actor,
  input: CanonicalEditorInput,
  current: CanonicalRecord | null,
  inlineCurrent: CanonicalRecord | null,
  saving: boolean,
  createsInlineAddress = false,
) {
  const addressTarget =
    input.entityType === "Address" ? current : inlineCurrent;
  if (
    input.entityType === "Address" ||
    input.inlineAddress ||
    createsInlineAddress
  ) {
    assertPermission(actor, "address.view");
    assertPermission(actor, addressTarget ? "address.edit" : "address.create");
    if (saving) {
      assertPermission(actor, "address.approve");
      assertPermission(actor, "address.publish");
    }
  }
  if (input.entityType === "OPLOC" && input.values.addressReference && saving) {
    assertPermission(
      actor,
      current?.record.addressReference &&
        current.record.addressReference !== input.values.addressReference
        ? "oploc.replace-address"
        : "oploc.link-address",
    );
  }
}

function addressReferenceChanged(
  current: CanonicalRecord | null,
  input: CanonicalEditorInput,
) {
  return (
    input.entityType === "OPLOC" &&
    String(current?.record.addressReference || "") !==
      String(input.values.addressReference || "")
  );
}

function safeAddress(record: Record<string, unknown>) {
  return Object.fromEntries(
    [
      "addressLine1",
      "addressLine2",
      "addressLine3",
      "locality",
      "region",
      "postalCode",
      "countryCode",
      "lifecycleState",
      "approvalState",
    ]
      .filter((key) => record[key] !== undefined)
      .map((key) => [key, record[key]]),
  );
}

function withCanonicalReason(
  input: CanonicalEditorInput,
  current: CanonicalRecord | null,
) {
  const label = String(
    input.values.approvedName ||
      input.values.displayName ||
      input.values.capabilityName ||
      (input.entityType === "Address" ? formatAddress(input.values) : "") ||
      (current ? humanLabel(current) : input.entityType),
  );
  return {
    ...input,
    decisionReason: canonicalChangeReason({
      entityType: input.entityType,
      operation: current ? "updated" : "created",
      label,
      note: input.decisionReason,
    }),
  };
}
function currentFieldLocks(record: CanonicalRecord) {
  const ownership = record.record.ownership as
    { fikaOwned?: { fieldLocks?: unknown[] } } | undefined;
  return Array.isArray(ownership?.fikaOwned?.fieldLocks)
    ? ownership!.fikaOwned!.fieldLocks!.map(String)
    : [];
}
function appendHumanDecision(
  record: Record<string, unknown>,
  actor: Actor,
  reason: string,
  timestamp: string,
) {
  const ownership = record.ownership as {
    providerOwned: Record<string, unknown>;
    fikaOwned: Record<string, unknown>;
  };
  const decisions = Array.isArray(ownership.fikaOwned.humanDecisions)
    ? ownership.fikaOwned.humanDecisions
    : [];
  ownership.fikaOwned.humanDecisions = [
    ...decisions,
    { actorId: actor.uid, timestamp, reason },
  ];
}

export function buildAutomaticAddressPublication(
  actor: Actor,
  current: CanonicalRecord,
  reason: string,
) {
  if (current.entityType !== "Address")
    throw badRequest("Only an Address can be automatically published.");
  if (current.record.lifecycleState !== "active")
    throw badRequest("Only an active Address can be automatically published.");
  const now = new Date().toISOString();
  const record = {
    ...structuredClone(current.record),
    version: Number(current.record.version) + 1,
    updatedAt: now,
    updatedBy: actor.uid,
    approvalState: "approved",
    approvedBy: actor.uid,
    approvedAt: now,
    decisionReason: reason,
  };
  appendHumanDecision(record, actor, reason, now);
  const parsed = parseCanonical("Address", record);
  if (!parsed.success)
    throw badRequest(
      `Address publication failed validation: ${parsed.error.issues[0]?.message || "invalid record"}.`,
    );
  const changes = diff(current.record, record);
  const fieldProvenance = structuredClone(current.fieldProvenance || {});
  for (const change of businessChanges(changes))
    fieldProvenance[change.field] = [
      ...(fieldProvenance[change.field] || []),
      provenance(actor, now, reason, change.previousValue, change.newValue),
    ];
  const next: CanonicalRecord = {
    ...current,
    record,
    dataHash: sha256(JSON.stringify(record)),
    lifecycleStatus: "published",
    publicationStatus: "published",
    publishedAt: now,
    fieldProvenance,
  };
  return { next, changes, now, reason };
}

function writeAutomaticAddressPublication(
  transaction: Transaction,
  actor: Actor,
  current: CanonicalRecord,
  publication: ReturnType<typeof buildAutomaticAddressPublication>,
) {
  const revisionId = `canonical-revision:${stableDocumentId(`${current.canonicalId}:${String(publication.next.record.version)}`)}`;
  const auditId = crypto.randomUUID();
  transaction.set(
    canonical().doc(stableDocumentId(current.canonicalId)),
    publication.next,
  );
  transaction.set(revisions().doc(stableDocumentId(revisionId)), {
    revisionId,
    canonicalId: current.canonicalId,
    entityType: "Address",
    version: publication.next.record.version,
    previous: current,
    current: publication.next,
    changes: publication.changes,
    actorId: actor.uid,
    actorName: actor.name,
    reason: publication.reason,
    recordedAt: publication.now,
  });
  transaction.set(audit().doc(auditId), {
    auditId,
    action: "Address automatically approved and published",
    entityReference: current.canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: publication.now,
    reason: publication.reason,
    exactDiff: publication.changes,
    publicationOccurred: true,
  });
}

export function isIdempotentOplocRetry(
  current: CanonicalRecord,
  input: CanonicalEditorInput,
) {
  const values = input.values;
  const aliases = Array.isArray(values.aliases)
    ? values.aliases
        .map(String)
        .map((value) => value.trim())
        .filter(Boolean)
        .sort()
    : [];
  const currentAliases = Array.isArray(current.record.aliases)
    ? current.record.aliases
        .map((value) =>
          typeof value === "object" && value
            ? String((value as Record<string, unknown>).alias || "")
            : String(value),
        )
        .filter(Boolean)
        .sort()
    : [];
  return (
    current.entityType === "OPLOC" &&
    current.record.approvedName === String(values.approvedName || "").trim() &&
    current.record.primaryLocationType === values.primaryLocationType &&
    current.record.lifecycleState === (values.lifecycleState || "active") &&
    String(current.record.addressReference || "") ===
      String(values.addressReference || "") &&
    JSON.stringify(currentAliases) === JSON.stringify(aliases)
  );
}

function uniqueExactAddressCandidate(
  candidates: ReturnType<typeof addressDuplicateCandidates>,
) {
  const exact = candidates.filter((candidate) => candidate.exact);
  if (exact.length > 1)
    throw conflict(
      "Multiple canonical Addresses have the same normalised value. Administrator duplicate review is required before linking.",
    );
  return exact[0];
}
