import { FieldValue, type Firestore, type Transaction } from "firebase-admin/firestore";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const dataset = "integrationHubCacheManifests";
const schemaVersion = 1;
const ukDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });

/** Commit the read version with the catalogue mutation, including admin-only changes. */
export function markCatalogueAdminChange(transaction: Transaction, firestore: Firestore) {
  transaction.set(firestore.collection(dataset).doc("hospitality-catalogue-admin"), {
    schemaVersion,
    updatedAt: FieldValue.serverTimestamp(),
  });
}

export async function readCatalogueAdminVersion(firestore: Firestore, now = new Date()) {
  const manifests = firestore.collection(dataset);
  const snapshots = await firestore.getAll(manifests.doc("hospitality-catalogue-admin"), manifests.doc("oplocs"));
  const versions = snapshots.map(snapshot => {
    recordDataAccess({ operation: "hospitality-catalogue.admin.version", source: "FIRESTORE", dataset: dataset + "/" + snapshot.id, documents: Number(snapshot.exists), firestoreReadKind: "document" });
    const updated = snapshot.updateTime;
    return updated ? `${updated.seconds}.${updated.nanoseconds}` : "initial";
  });
  return { schemaVersion, version: [schemaVersion, ukDate.format(now), ...versions].join(":") };
}
