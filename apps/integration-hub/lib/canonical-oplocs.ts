import { db } from "./firebase-admin";

export type CanonicalOplocRecord = {
  canonicalId?: string;
  entityType?: string;
  lifecycleStatus?: string;
  publicationStatus?: string;
  record?: Record<string, unknown>;
};

export function isActiveCanonicalOploc(record: CanonicalOplocRecord) {
  return record.entityType === "OPLOC" && Boolean(record.canonicalId) && record.lifecycleStatus !== "archived" && record.publicationStatus !== "withdrawn" && String(record.record?.lifecycleState || "active") === "active";
}

export async function listActiveCanonicalOplocs() {
  const snapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").get();
  return snapshot.docs.map(document => document.data() as CanonicalOplocRecord).filter(isActiveCanonicalOploc);
}

export async function getActiveCanonicalOplocLabels(ids: string[]) {
  const wanted = [...new Set(ids.filter(Boolean))];
  const records: CanonicalOplocRecord[] = [];
  for (let index = 0; index < wanted.length; index += 30) {
    const chunk = wanted.slice(index, index + 30);
    if (!chunk.length) continue;
    const snapshot = await db.collection("integrationHubCanonical").where("entityType", "==", "OPLOC").where("canonicalId", "in", chunk).get();
    records.push(...snapshot.docs.map(document => document.data() as CanonicalOplocRecord));
  }
  return new Map(records.filter(isActiveCanonicalOploc).map(record => [record.canonicalId!, String(record.record?.approvedName || record.canonicalId)] as const));
}

export async function listCanonicalRecordsByTypes(types: string[]) {
  const wanted = [...new Set(types)].slice(0, 30);
  const snapshot = await db.collection("integrationHubCanonical").where("entityType", "in", wanted).get();
  return snapshot.docs.map(document => document.data());
}
