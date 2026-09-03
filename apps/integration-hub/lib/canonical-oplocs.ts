import crypto from "node:crypto";
import { db } from "./firebase-admin";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export type CanonicalOplocRecord = {
  canonicalId?: string;
  entityType?: string;
  lifecycleStatus?: string;
  publicationStatus?: string;
  record?: Record<string, unknown>;
};

export function canonicalDocumentId(canonicalId: string) {
  return crypto.createHash("sha256").update(canonicalId).digest("hex");
}

export function isActiveCanonicalOploc(record: CanonicalOplocRecord) {
  return record.entityType === "OPLOC" && Boolean(record.canonicalId) && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active";
}

export async function listActiveCanonicalOplocs() {
  const snapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get();
  recordDataAccess({ app: "integration-hub", operation: "oploc.list", source: "FIRESTORE", documents: snapshot.size });
  return snapshot.docs.map(document => document.data() as CanonicalOplocRecord).filter(isActiveCanonicalOploc);
}

export async function getActiveCanonicalOplocLabels(ids: string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const labels = new Map<string, string>();
  let reads = 0;
  for (const id of wanted) {
    let current = id;
    const visited = new Set<string>();
    for (let depth = 0; depth < 10; depth += 1) {
      if (visited.has(current)) throw new Error(`The OPLOC redirect chain contains a cycle at ${current}.`);
      visited.add(current);
      const snapshot = await db.collection("integrationHubCanonical").doc(canonicalDocumentId(current)).get();
      reads += 1;
      if (!snapshot.exists) break;
      const record = snapshot.data() as CanonicalOplocRecord;
      if (isActiveCanonicalOploc(record)) { labels.set(id, String(record.record?.approvedName || record.canonicalId)); break; }
      if (record.entityType !== "OPLOC" || record.record?.lifecycleState !== "merged") break;
      current = String(record.record.mergedIntoOplocId || "");
      if (!current) break;
    }
  }
  recordDataAccess({ app: "integration-hub", operation: "oploc.by-id.batch", source: "FIRESTORE", documents: reads });
  return labels;
}

export async function listCanonicalRecordsByTypes(types: string[], perTypeLimit = 500) {
  const wanted = [...new Set(types)].slice(0, 30);
  const limit = Math.max(1, Math.min(perTypeLimit, 1000));
  const snapshots = await Promise.all(wanted.map(type => db.collection("integrationHubCanonical").where("entityType", "==", type).limit(limit + 1).get()));
  const overflow = snapshots.find(snapshot => snapshot.size > limit);
  if (overflow) throw Object.assign(new Error("Canonical reference dataset exceeds the bounded read limit; use an explicit package or reconciliation path."), { status: 503, code: "CANONICAL_REFERENCE_READ_LIMIT" });
  const documents = snapshots.reduce((total, snapshot) => total + snapshot.size, 0);
  recordDataAccess({ app: "integration-hub", operation: "canonical.by-type.bounded", source: "FIRESTORE", documents });
  return snapshots.flatMap(snapshot => snapshot.docs.map(document => document.data()));
}
