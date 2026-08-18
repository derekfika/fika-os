import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import {
  planLegendReemploymentMerge,
  type LegendReemploymentMerge,
} from "../lib/legend-reemployment-merge";
import { sha256 } from "../lib/profiler";
import type { CanonicalRecord } from "../lib/types";

const actor = {
  uid: "codex:local-approved-merge",
  name: "Codex local governed repair",
};
const reason =
  "Derek approved merging duplicate BrightHR Legend records created by termination and return, while preserving separate Employment history.";
const groups: LegendReemploymentMerge[] = [
  {
    survivorCanonicalId: "legend:bb1b9ce35a6b3c6d3586",
    memberCanonicalIds: [
      "legend:bb1b9ce35a6b3c6d3586",
      "legend:9a50dee87c8a93b306ee",
    ],
    profileSourceCanonicalId: "legend:bb1b9ce35a6b3c6d3586",
  },
  {
    survivorCanonicalId: "legend:a0596f226a438b9c33c2",
    memberCanonicalIds: [
      "legend:a0596f226a438b9c33c2",
      "legend:788218d0db496bbbcc38",
    ],
    profileSourceCanonicalId: "legend:a0596f226a438b9c33c2",
  },
  {
    survivorCanonicalId: "legend:0a1897207bbc2d843ad8",
    memberCanonicalIds: [
      "legend:0a1897207bbc2d843ad8",
      "legend:8365f82a1ed516237586",
    ],
    profileSourceCanonicalId: "legend:8365f82a1ed516237586",
  },
];

const [canonicalSnapshot, mappingSnapshot] = await Promise.all([
  db.collection("integrationHubCanonical").get(),
  db.collection("integrationHubSourceMappings").get(),
]);
const records = canonicalSnapshot.docs.map(
  (document) => document.data() as CanonicalRecord,
);
const mappings = mappingSnapshot.docs.map((document) => ({
  reference: document.ref,
  data: document.data(),
}));
const memberIds = new Set(groups.flatMap((group) => group.memberCanonicalIds));
const memberRecords = records.filter((record) => memberIds.has(record.canonicalId));

const backupRoot = path.resolve(
  process.env.INTEGRATION_HUB_DATA_ROOT || "../../local-data/integration-hub",
  "approved-repairs",
);
fs.mkdirSync(backupRoot, { recursive: true });
const now = new Date().toISOString();
const backupPath = path.join(
  backupRoot,
  `legend-reemployment-before-${now.replaceAll(":", "-")}.json`,
);
fs.writeFileSync(
  backupPath,
  JSON.stringify(
    {
      capturedAt: now,
      reason,
      records: memberRecords,
      relatedRecords: records.filter((record) =>
        memberIds.has(String(record.record.legendId || "")),
      ),
      sourceMappings: mappings
        .map((mapping) => mapping.data)
        .filter((mapping) =>
          memberIds.has(String(mapping.targetCanonicalId || "")),
        ),
    },
    null,
    2,
  ),
);

const duplicateIds = new Set(
  groups.flatMap((group) =>
    group.memberCanonicalIds.filter(
      (canonicalId) => canonicalId !== group.survivorCanonicalId,
    ),
  ),
);
if (
  [...duplicateIds].every(
    (canonicalId) =>
      records.find((record) => record.canonicalId === canonicalId)
        ?.lifecycleStatus === "archived",
  )
) {
  console.log(
    JSON.stringify({ alreadyApplied: true, backupPath, groups: groups.length }),
  );
  process.exit(0);
}

const plans = groups.map((group) =>
  planLegendReemploymentMerge(records, group, actor, now),
);
const nextById = new Map<string, CanonicalRecord>();
for (const plan of plans) {
  nextById.set(plan.survivor.canonicalId, plan.survivor);
  for (const record of plan.archived) nextById.set(record.canonicalId, record);
  for (const record of plan.employments) nextById.set(record.canonicalId, record);
}

const survivorByMember = new Map<string, string>();
for (const group of groups)
  for (const canonicalId of group.memberCanonicalIds)
    survivorByMember.set(canonicalId, group.survivorCanonicalId);

for (const record of records) {
  const currentLegendId = String(record.record.legendId || "");
  const survivorId = survivorByMember.get(currentLegendId);
  if (!survivorId || survivorId === currentLegendId) continue;
  const nextRecord = structuredClone(record.record);
  nextRecord.legendId = survivorId;
  nextRecord.version = Number(record.record.version || 0) + 1;
  nextRecord.updatedAt = now;
  nextRecord.updatedBy = actor.uid;
  nextById.set(record.canonicalId, {
    ...record,
    record: nextRecord,
    dataHash: sha256(JSON.stringify(nextRecord)),
  });
}

const batch = db.batch();
for (const next of nextById.values()) {
  const previous = records.find(
    (record) => record.canonicalId === next.canonicalId,
  );
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
          path: "governedReemploymentMerge",
          before: previous?.canonicalId || null,
          after: next.canonicalId,
        },
      ],
      actorId: actor.uid,
      actorName: actor.name,
      reason,
      recordedAt: now,
    },
  );
  const auditId = crypto.randomUUID();
  batch.set(db.collection("integrationHubGovernanceAudit").doc(auditId), {
    auditId,
    action:
      next.entityType === "Employment"
        ? "Employment history preserved during approved Legend merge"
        : next.lifecycleStatus === "archived"
          ? "Duplicate Legend archived after approved re-employment merge"
          : "Approved re-employment Legend merge applied",
    entityReference: next.canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: now,
    reason,
    memberCanonicalIds: groups.find((group) =>
      group.memberCanonicalIds.includes(
        next.entityType === "Employment"
          ? String(next.record.legendId)
          : next.canonicalId,
      ),
    )?.memberCanonicalIds,
  });
}

for (const mapping of mappings) {
  const currentTarget = String(mapping.data.targetCanonicalId || "");
  const survivorId = survivorByMember.get(currentTarget);
  if (!survivorId || survivorId === currentTarget) continue;
  batch.set(
    mapping.reference,
    {
      ...mapping.data,
      targetCanonicalId: survivorId,
      updatedAt: now,
      updatedBy: actor.uid,
      decisionReason: reason,
    },
  );
}

await batch.commit();
console.log(
  JSON.stringify(
    {
      applied: true,
      groups: groups.length,
      survivors: plans.map((plan) => plan.survivor.canonicalId),
      archivedLegends: plans.flatMap((plan) => plan.archived).length,
      employmentRecords: plans.flatMap((plan) => plan.employments).length,
      relatedRecordsRepointed: [...nextById.values()].filter(
        (record) =>
          !memberIds.has(record.canonicalId) && record.entityType !== "Employment",
      ).length,
      sourceMappingsRepointed: mappings.filter((mapping) => {
        const target = String(mapping.data.targetCanonicalId || "");
        const survivor = survivorByMember.get(target);
        return Boolean(survivor && survivor !== target);
      }).length,
      backupPath,
    },
    null,
    2,
  ),
);
