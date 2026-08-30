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
  const snapshots = await Promise.all(wanted.map(id => db.collection("integrationHubCanonical").doc(canonicalDocumentId(id)).get()));
  recordDataAccess({ app: "integration-hub", operation: "oploc.by-id.batch", source: "FIRESTORE", documents: snapshots.filter(snapshot => snapshot.exists).length });
  const records = snapshots.filter(snapshot => snapshot.exists).map(snapshot => snapshot.data() as CanonicalOplocRecord);
  return new Map(records.filter(isActiveCanonicalOploc).map(record => [record.canonicalId!, String(record.record?.approvedName || record.canonicalId)] as const));
}

export async function listCanonicalRecordsByTypes(types: string[]) {
  const wanted = [...new Set(types)].slice(0, 30);
  const snapshot = await db.collection("integrationHubCanonical").where("entityType", "in", wanted).get();
  recordDataAccess({ app: "integration-hub", operation: "canonical.by-type", source: "FIRESTORE", documents: snapshot.size });
  return snapshot.docs.map(document => document.data());
}
