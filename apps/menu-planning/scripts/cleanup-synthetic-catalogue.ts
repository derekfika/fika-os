import { Firestore } from "@google-cloud/firestore";
import { syntheticCatalogueCandidate } from "../lib/synthetic-catalogue";
import type { MenuItem } from "../lib/domain";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const confirmed = process.argv.includes("--confirm-staging-cleanup");
if (process.env.FIKA_RUNTIME_MODE !== "staging") throw new Error("Refusing catalogue cleanup: FIKA_RUNTIME_MODE must be staging.");
if (projectId !== "fika-os-dev") throw new Error("Refusing catalogue cleanup: FIREBASE_PROJECT_ID must be exactly fika-os-dev.");

const db = new Firestore({ projectId });
const snapshot = await db.collection("fikaMenuPlanningCatalogue").where("kind", "==", "dish").get();
const candidates = snapshot.docs.flatMap(document => {
  const item = (document.data().record || document.data()) as MenuItem;
  const candidate = syntheticCatalogueCandidate(item);
  return candidate ? [{ documentId: document.id, ...candidate }] : [];
});

console.log(JSON.stringify({ projectId, mode: confirmed ? "CONFIRMED_DELETE" : "DRY_RUN", candidateCount: candidates.length, candidates }, null, 2));
if (!confirmed || !candidates.length) process.exit(0);

const auditRef = db.collection("fikaMenuPlanningCatalogueCleanup").doc();
const batch = db.batch();
batch.create(auditRef, { action: "synthetic-catalogue-cleanup", projectId, at: new Date().toISOString(), candidates });
for (const candidate of candidates) batch.delete(db.collection("fikaMenuPlanningCatalogue").doc(candidate.documentId));
await batch.commit();
console.log(JSON.stringify({ auditId: auditRef.id, deleted: candidates.length }, null, 2));
