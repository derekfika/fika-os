import crypto from "node:crypto";
import { db } from "../lib/firebase-admin";
import { generateCanonicalId } from "../lib/canonical-identities";
import { stableDocumentId } from "../lib/canonical-editor";
import {
  MunichReFifthFloorSquareSiteId,
  MunichReOplocId,
  MunichReOperationalAreas,
  MunichReOperationalAreaTypes,
} from "../lib/munich-re-operational-areas";
import { saveOperationalArea } from "../lib/operational-areas-service";
import { sha256 } from "../lib/profiler";
import { parseCanonical } from "../lib/schemas";
import type { CanonicalRecord } from "../lib/types";

const apply = process.argv.includes("--apply");
const actor = {
  uid: "codex:local-approved-operational-areas",
  name: "Codex local approved Operational Areas seed",
  role: "integration-admin" as const,
  synthetic: true as const,
};
const now = new Date().toISOString();
const reason =
  "Seeded the approved Munich RE Operational Areas as subordinate contexts within the surviving Munich RE OPLOC. This does not create new OPLOCs, Sites or staffing entities.";

const snapshot = await db.collection("integrationHubCanonical").get();
const records = snapshot.docs.map(
  (document) => document.data() as CanonicalRecord,
);
const oploc = records.find(
  (record) =>
    record.canonicalId === MunichReOplocId &&
    record.entityType === "OPLOC" &&
    record.record.lifecycleState === "active",
);
if (!oploc) throw new Error("The surviving Munich RE OPLOC is not active.");

const typeCreates = MunichReOperationalAreaTypes.filter(
  (definition) =>
    !records.some(
      (record) =>
        record.entityType === "Operational Area Type" &&
        normalise(String(record.record.name || "")) === normalise(definition.name),
    ),
);
const knownTypes = new Map(
  records
    .filter((record) => record.entityType === "Operational Area Type")
    .map((record) => [normalise(String(record.record.name || "")), record.canonicalId]),
);
for (const definition of typeCreates)
  knownTypes.set(normalise(definition.name), generateCanonicalId("Operational Area Type"));
const existingAreas = records.filter(
  (record) =>
    record.entityType === "Operational Area" &&
    record.record.oplocId === MunichReOplocId,
);
const areasToCreate = MunichReOperationalAreas.filter(
  (definition) =>
    !existingAreas.some(
      (area) => normalise(String(area.record.name || "")) === normalise(definition.name),
    ),
);
const fifthArea = [...existingAreas]
  .map((record) => ({ name: String(record.record.name || ""), canonicalId: record.canonicalId }))
  .find((area) => normalise(area.name) === normalise("5th Floor Coffee Bar"));
const preview = {
  mode: apply ? "apply" : "preview",
  oplocId: MunichReOplocId,
  typesToCreate: typeCreates.map((definition) => definition.name),
  areasToCreate: areasToCreate.map((definition) => definition.name),
  fifthFloorSourceMappingWillBeAttached: Boolean(
    fifthArea || areasToCreate.some((area) => area.name === "5th Floor Coffee Bar"),
  ),
  thirdFloorSquareMappingDeliberatelyUnchanged: true,
};
if (!apply) {
  console.log(JSON.stringify(preview, null, 2));
  process.exit(0);
}

if (typeCreates.length) {
  const batch = db.batch();
  for (const definition of typeCreates) {
    const canonicalId = knownTypes.get(normalise(definition.name))!;
    const record = {
      schemaVersion: "0.1.0",
      version: 1,
      createdAt: now,
      createdBy: actor.uid,
      updatedAt: now,
      updatedBy: actor.uid,
      active: true,
      externalIdentities: [],
      provenanceIds: [],
      ownership: { providerOwned: {}, fikaOwned: { developmentModel: true } },
      entityType: "Operational Area Type" as const,
      canonicalId,
      name: definition.name,
      description: definition.description,
      lifecycleState: "active" as const,
    };
    const parsed = parseCanonical("Operational Area Type", record);
    if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
    const next: CanonicalRecord = { canonicalId, entityType: "Operational Area Type", record, dataHash: sha256(JSON.stringify(record)), lifecycleStatus: "needs-review" };
    const revisionId = `canonical-revision:${stableDocumentId(`${canonicalId}:1`)}`;
    batch.set(db.collection("integrationHubCanonical").doc(stableDocumentId(canonicalId)), next);
    batch.set(db.collection("integrationHubCanonicalRevisions").doc(stableDocumentId(revisionId)), { revisionId, canonicalId, entityType: "Operational Area Type", version: 1, previous: null, current: next, changes: [{ path: "operationalAreaType", before: null, after: record }], actorId: actor.uid, actorName: actor.name, reason, recordedAt: now });
    const auditId = crypto.randomUUID();
    batch.set(db.collection("integrationHubGovernanceAudit").doc(auditId), { auditId, action: "Operational Area Type created", entityReference: canonicalId, actorId: actor.uid, actorName: actor.name, timestamp: now, reason });
  }
  await batch.commit();
}

for (const definition of areasToCreate) {
  await saveOperationalArea(actor, {
    oplocId: MunichReOplocId,
    name: definition.name,
    areaTypeId: knownTypes.get(normalise(definition.areaTypeName))!,
    floorLevel: definition.floorLevel,
    description: definition.description,
    lifecycleState: "active",
  });
}

const after = await db.collection("integrationHubCanonical").get();
const fifth = after.docs
  .map((document) => document.data() as CanonicalRecord)
  .find(
    (record) =>
      record.entityType === "Operational Area" &&
      record.record.oplocId === MunichReOplocId &&
      normalise(String(record.record.name || "")) === normalise("5th Floor Coffee Bar"),
  );
if (!fifth) throw new Error("The fifth-floor Operational Area could not be found after seeding.");
const mappings = await db.collection("integrationHubSourceMappings").get();
const fifthMapping = mappings.docs.find(
  (document) => document.data().sourceIdentifier === MunichReFifthFloorSquareSiteId,
);
if (!fifthMapping) throw new Error("The existing fifth-floor Square source mapping could not be found.");
if (fifthMapping.data().targetCanonicalId !== fifth.canonicalId) {
  await fifthMapping.ref.set(
    {
      ...fifthMapping.data(),
      targetCanonicalId: fifth.canonicalId,
      oplocId: MunichReOplocId,
      updatedAt: now,
      updatedBy: actor.uid,
      decisionReason: `${reason} The source label explicitly identifies the fifth floor.`,
    },
    { merge: false },
  );
  const auditId = crypto.randomUUID();
  await db.collection("integrationHubGovernanceAudit").doc(auditId).set({
    auditId,
    action: "Provider source mapping linked to Operational Area",
    entityReference: fifth.canonicalId,
    actorId: actor.uid,
    actorName: actor.name,
    timestamp: now,
    reason: `${reason} The Square source label explicitly identifies Munich RE 5th Floor.`,
    sourceIdentifier: MunichReFifthFloorSquareSiteId,
    oplocId: MunichReOplocId,
  });
}
console.log(JSON.stringify({ ...preview, applied: true, fifthFloorOperationalAreaId: fifth.canonicalId }, null, 2));

function normalise(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}
