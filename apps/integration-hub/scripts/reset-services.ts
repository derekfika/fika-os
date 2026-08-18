import { db } from "../lib/firebase-admin";
import type { CanonicalRecord } from "../lib/types";

const apply = process.argv.includes("--apply");
const serviceTypes = new Set(["Service Definition", "Service Arrangement"]);
const canonical = db.collection("integrationHubCanonical");
const revisions = db.collection("integrationHubCanonicalRevisions");
const audit = db.collection("integrationHubGovernanceAudit");
const mappings = db.collection("integrationHubSourceMappings");

const [canonicalSnapshot, revisionsSnapshot, auditSnapshot, mappingsSnapshot, legacySnapshot] = await Promise.all([
  canonical.get(), revisions.get(), audit.get(), mappings.get(), db.collection("integrationHub").get(),
]);
const serviceRecords = canonicalSnapshot.docs.filter(document => serviceTypes.has(String((document.data() as CanonicalRecord).entityType)));
const serviceIds = new Set(serviceRecords.map(document => String((document.data() as CanonicalRecord).canonicalId)));
const externalReferences = [
  ...canonicalSnapshot.docs.filter(document => !serviceRecords.includes(document)).flatMap(document => findReferences(document.data(), serviceIds, `integrationHubCanonical/${document.id}`)),
  ...mappingsSnapshot.docs.flatMap(document => findReferences(document.data(), serviceIds, `integrationHubSourceMappings/${document.id}`)),
  ...legacySnapshot.docs.flatMap(document => findReferences(document.data(), serviceIds, `integrationHub/${document.id}`)),
];

const serviceRevisions = revisionsSnapshot.docs.filter(document => {
  const value = document.data() as { canonicalId?: unknown; entityType?: unknown };
  return serviceIds.has(String(value.canonicalId || "")) || serviceTypes.has(String(value.entityType || ""));
});
const serviceAudit = auditSnapshot.docs.filter(document => serviceIds.has(String((document.data() as { entityReference?: unknown }).entityReference || "")));

const summary = {
  mode: apply ? "apply" : "dry-run",
  serviceDefinitions: serviceRecords.filter(document => (document.data() as CanonicalRecord).entityType === "Service Definition").length,
  serviceArrangements: serviceRecords.filter(document => (document.data() as CanonicalRecord).entityType === "Service Arrangement").length,
  serviceRevisions: serviceRevisions.length,
  serviceAuditEntries: serviceAudit.length,
  externalReferences,
};
if (externalReferences.length) {
  console.error(JSON.stringify({ ...summary, error: "Service reset stopped because another record references a Service canonical ID." }, null, 2));
  process.exit(1);
}
if (!apply) {
  console.log(JSON.stringify(summary, null, 2));
  process.exit(0);
}

await deleteInChunks([...serviceRecords, ...serviceRevisions, ...serviceAudit]);
console.log(JSON.stringify({ ...summary, deleted: serviceRecords.length + serviceRevisions.length + serviceAudit.length }, null, 2));

async function deleteInChunks(documents: FirebaseFirestore.QueryDocumentSnapshot[]) {
  for (let index = 0; index < documents.length; index += 450) {
    const batch = db.batch();
    documents.slice(index, index + 450).forEach(document => batch.delete(document.ref));
    await batch.commit();
  }
}

function findReferences(value: unknown, ids: Set<string>, path: string): string[] {
  if (typeof value === "string") return ids.has(value) ? [path] : [];
  if (!value || typeof value !== "object") return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => findReferences(item, ids, `${path}[${index}]`));
  return Object.entries(value as Record<string, unknown>).flatMap(([key, item]) => findReferences(item, ids, `${path}.${key}`));
}
