import crypto from "node:crypto";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { planOplocMerge } from "../lib/oploc-merge";
import type { CanonicalRecord } from "../lib/types";

const apply = process.argv.includes("--apply");
const survivorOplocId = "oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701";
const formerOplocId = "oploc:07b93ebe-fe3d-4a7e-b4a9-239cc56e900f";
const actor = {
  uid: "codex:local-approved-oploc-merge",
  name: "Codex local approved OPLOC merge",
};
const reason =
  "Merged Munich RE 5th Floor into Munich RE. The former identity remains historical; source evidence continues to distinguish the fifth-floor provider location.";
const timestamp = new Date().toISOString();

const [canonicalSnapshot, mappingSnapshot] = await Promise.all([
  db.collection("integrationHubCanonical").get(),
  db.collection("integrationHubSourceMappings").get(),
]);
const records = canonicalSnapshot.docs.map(
  (document) => document.data() as CanonicalRecord,
);
const plan = planOplocMerge(records, {
  survivorOplocId,
  formerOplocId,
  formerNameAlias: "Munich RE 5th Floor",
  actorId: actor.uid,
  timestamp,
});
const mappings = mappingSnapshot.docs.map((document) => ({
  reference: document.ref,
  data: document.data(),
}));
const mappingUpdates = mappings.filter(
  ({ data }) =>
    data.oplocId === formerOplocId || data.targetCanonicalId === formerOplocId,
);
const canonicalUpdates = [
  plan.survivor,
  plan.former,
  ...plan.redirectedRecords,
];
const result = {
  mode: apply ? "apply" : "preview",
  survivorOplocId,
  formerOplocId,
  formerLifecycleState: plan.former.record.lifecycleState,
  canonicalRelationshipsRedirected: plan.redirectedRecords.map((record) => ({
    entityType: record.entityType,
    canonicalId: record.canonicalId,
  })),
  sourceMappingsRedirected: mappingUpdates.map(({ data }) => ({
    mappingId: data.mappingId,
    sourceProvider: data.sourceProvider,
    sourceEntityType: data.sourceEntityType,
    sourceIdentifier: data.sourceIdentifier,
  })),
};

if (!apply) {
  console.log(JSON.stringify(result, null, 2));
  process.exit(0);
}

const batch = db.batch();
for (const next of canonicalUpdates) {
  const previous = records.find((record) => record.canonicalId === next.canonicalId);
  if (JSON.stringify(previous) === JSON.stringify(next)) continue;
  batch.set(
    db.collection("integrationHubCanonical").doc(stableDocumentId(next.canonicalId)),
    next,
  );
  const revisionId = `canonical-revision:${stableDocumentId(`${next.canonicalId}:${String(next.record.version)}`)}`;
  batch.set(
    db
      .collection("integrationHubCanonicalRevisions")
      .doc(stableDocumentId(revisionId)),
    {
      revisionId,
      canonicalId: next.canonicalId,
      entityType: next.entityType,
      version: next.record.version,
      previous: previous || null,
      current: next,
      changes: [
        {
          path: "approvedOplocMerge",
          before: previous?.canonicalId || null,
          after: next.canonicalId,
        },
      ],
      actorId: actor.uid,
      actorName: actor.name,
      reason,
      recordedAt: timestamp,
    },
  );
  const auditId = crypto.randomUUID();
  batch.set(db.collection("integrationHubGovernanceAudit").doc(auditId), {
    auditId,
    action:
      next.canonicalId === formerOplocId
        ? "OPLOC merged into surviving Munich RE identity"
        : next.canonicalId === survivorOplocId
          ? "Surviving Munich RE OPLOC updated for approved merge"
          : "Canonical relationship redirected during approved OPLOC merge",
    entityReference: next.canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp,
    reason,
    survivorOplocId,
    formerOplocId,
  });
}
for (const { reference, data } of mappingUpdates) {
  batch.set(reference, {
    ...data,
    ...(data.oplocId === formerOplocId ? { oplocId: survivorOplocId } : {}),
    ...(data.targetCanonicalId === formerOplocId
      ? { targetCanonicalId: survivorOplocId }
      : {}),
    updatedAt: timestamp,
    updatedBy: actor.uid,
    decisionReason: reason,
  });
}
if (canonicalUpdates.length + mappingUpdates.length > 400)
  throw new Error("Merge exceeds the safe batch size; split the migration deliberately.");
await batch.commit();
console.log(JSON.stringify({ ...result, applied: true }, null, 2));
