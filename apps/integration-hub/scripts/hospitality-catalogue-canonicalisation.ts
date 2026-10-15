/**
 * Hospitality catalogue canonicalisation: inventory, plan and (separately approved) apply.
 *
 *   npx tsx scripts/hospitality-catalogue-canonicalisation.ts --snapshot catalogue.json [--out report.json]
 *   npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project fika-os-dev [--dump catalogue.json] [--out report.json]
 *   npx tsx scripts/hospitality-catalogue-canonicalisation.ts --live --project fika-os-dev --apply --plan-hash <hash>
 *
 * Default behaviour is READ-ONLY. `--snapshot` reads a JSON file; `--live` reads Firestore (queries only).
 * `--apply` writes, and is refused unless ALL of these hold:
 *   - `--plan-hash` equals the hash of the plan just recomputed from the live data (so only the reviewed plan can run);
 *   - FIKA_CATALOGUE_CANONICALISATION_APPROVED equals that same hash (an explicit, separate approval step);
 *   - the in-memory dry run satisfies every merge invariant;
 *   - the project is not production unless --allow-production is also given.
 * Every group is applied in its own transaction and is idempotent, so an interrupted run can be repeated safely.
 * Review groups are never applied.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { applyOperations, buildCanonicalisationPlan, inventory, routingReviewRows, verifyMergeInvariants, type CatalogueSnapshot, type MergeOperation } from "../lib/hospitality-catalogue-canonicalisation";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(name);
const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
const PRODUCTION_PROJECT = "fika-os";

async function loadLive(project: string): Promise<CatalogueSnapshot> {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const app = getApps()[0] || initializeApp({ projectId: project });
  const db = getFirestore(app);
  const byType = async (entityType: string) => (await db.collection("integrationHubCanonical").where("entityType", "==", entityType).get()).docs.map(document => document.data() as never);
  const [items, offerings, prices, routing, merges] = await Promise.all([
    byType("Hospitality Menu Item"), byType("Hospitality Menu Offering"), byType("Hospitality Menu Price"),
    db.collection("integrationHubHospitalityMenuProductionRouting").get(), db.collection("integrationHubHospitalityMenuItemMerges").get(),
  ]);
  return { items, offerings, prices, routing: routing.docs.map(document => ({ ...(document.data() as { menuItemId: string; workstreams: string[]; version?: number; supersededBy?: string }) })), merges: merges.docs.map(document => document.data() as { sourceMenuItemId: string; survivorMenuItemId: string }) };
}

async function applyPlan(project: string, operations: MergeOperation[], groupId: string) {
  const { getApps, initializeApp } = await import("firebase-admin/app");
  const { getFirestore } = await import("firebase-admin/firestore");
  const { stableDocumentId } = await import("../lib/canonical-editor");
  const { parseCanonical } = await import("../lib/schemas");
  const { sha256 } = await import("../lib/profiler");
  const db = getFirestore(getApps()[0] || initializeApp({ projectId: project }));
  const canonical = db.collection("integrationHubCanonical"); const routing = db.collection("integrationHubHospitalityMenuProductionRouting");
  const merges = db.collection("integrationHubHospitalityMenuItemMerges"); const audit = db.collection("integrationHubGovernanceAudit");
  const actor = "migration:hospitality-catalogue-canonicalisation"; const now = new Date().toISOString();
  await db.runTransaction(async transaction => {
    const docs = new Map<string, FirebaseFirestore.DocumentSnapshot>();
    const read = async (ref: FirebaseFirestore.DocumentReference) => { if (!docs.has(ref.path)) docs.set(ref.path, await transaction.get(ref)); return docs.get(ref.path)!; };
    // All reads first.
    for (const operation of operations) {
      if (operation.op === "update-survivor") await read(canonical.doc(stableDocumentId(operation.itemId)));
      if (operation.op === "repoint-offering") await read(canonical.doc(stableDocumentId(operation.offeringId)));
      if (operation.op === "archive-item") await read(canonical.doc(stableDocumentId(operation.itemId)));
      if (operation.op === "copy-routing") await read(routing.doc(stableDocumentId(operation.toItemId)));
      if (operation.op === "supersede-routing") await read(routing.doc(stableDocumentId(operation.itemId)));
    }
    const rewrite = (snapshot: FirebaseFirestore.DocumentSnapshot, entityType: "Hospitality Menu Item" | "Hospitality Menu Offering", change: (record: Record<string, unknown>) => Record<string, unknown>) => {
      const current = snapshot.data(); if (!current) throw new Error(`Missing ${entityType} ${snapshot.id}.`);
      const record = change({ ...current.record, version: Number(current.record.version || 0) + 1, updatedAt: now, updatedBy: actor });
      const parsed = parseCanonical(entityType, record); if (!parsed.success) throw new Error(`${entityType} ${current.canonicalId} would be invalid: ${parsed.error.issues[0]?.message}`);
      transaction.set(snapshot.ref, { ...current, record, dataHash: sha256(JSON.stringify(record)) });
    };
    for (const operation of operations) {
      if (operation.op === "update-survivor") rewrite(await read(canonical.doc(stableDocumentId(operation.itemId))), "Hospitality Menu Item", record => ({ ...record, providerMappings: operation.providerMappings }));
      else if (operation.op === "repoint-offering") {
        const snapshot = await read(canonical.doc(stableDocumentId(operation.offeringId)));
        if (snapshot.data()?.record.hospitalityMenuItemId === operation.toItemId) continue; // already applied
        rewrite(snapshot, "Hospitality Menu Offering", record => ({ ...record, hospitalityMenuItemId: operation.toItemId, ...(operation.configurationPatch ? { configuration: { ...(record.configuration as object | undefined), ...operation.configurationPatch } } : {}) }));
      }
      else if (operation.op === "archive-item") { const snapshot = await read(canonical.doc(stableDocumentId(operation.itemId))); if (snapshot.data()?.record.lifecycleState !== "archived") rewrite(snapshot, "Hospitality Menu Item", record => ({ ...record, lifecycleState: "archived" })); }
      else if (operation.op === "copy-routing") { const snapshot = await read(routing.doc(stableDocumentId(operation.toItemId))); if (!snapshot.exists) transaction.set(snapshot.ref, { menuItemId: operation.toItemId, workstreams: operation.workstreams, version: 1, createdAt: now, updatedAt: now, updatedBy: actor, inheritedFrom: operation.fromItemId }); }
      else if (operation.op === "supersede-routing") { const snapshot = await read(routing.doc(stableDocumentId(operation.itemId))); if (snapshot.exists) transaction.set(snapshot.ref, { supersededBy: operation.supersededBy, supersededAt: now }, { merge: true }); }
      else if (operation.op === "record-merge") transaction.set(merges.doc(stableDocumentId(operation.sourceItemId)), { sourceMenuItemId: operation.sourceItemId, survivorMenuItemId: operation.survivorItemId, mergedAt: now, mergedBy: actor }, { merge: true });
    }
    transaction.create(audit.doc(`canonicalisation-${groupId}-${Date.now()}`), { action: "Hospitality Menu Items canonicalised", entityReference: groupId, actorId: actor, timestamp: now, reason: "Approved catalogue canonicalisation: site copies merged into one canonical Menu Item.", operations: operations.length });
  });
}

const project = value("--project");
let snapshot: CatalogueSnapshot;
if (flag("--live")) {
  if (!project) throw new Error("--live requires --project.");
  snapshot = await loadLive(project);
  if (value("--dump")) writeFileSync(value("--dump")!, JSON.stringify(snapshot, null, 1));
} else if (value("--snapshot")) {
  const raw = JSON.parse(readFileSync(value("--snapshot")!, "utf8")) as CatalogueSnapshot;
  snapshot = { ...raw, routing: raw.routing ?? [] };
} else throw new Error("Provide --snapshot <file> or --live --project <id>.");

const plan = buildCanonicalisationPlan(snapshot);
const after = applyOperations(snapshot, plan.groups.flatMap(group => group.operations));
const invariantProblems = verifyMergeInvariants(snapshot, after);
const report = { generatedAt: new Date().toISOString(), summary: plan.summary, planHash: plan.planHash, invariantProblems, inventory: inventory(snapshot), mergeGroups: plan.groups, reviewGroups: plan.review, unmatched: plan.unmatched, routingRowsBefore: routingReviewRows(snapshot).length, routingRowsAfter: routingReviewRows(after).length };
if (value("--out")) writeFileSync(value("--out")!, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ summary: report.summary, planHash: report.planHash, invariantProblems, routingRowsBefore: report.routingRowsBefore, routingRowsAfter: report.routingRowsAfter, reviewGroups: plan.review.length }, null, 2));

if (flag("--apply")) {
  if (!flag("--live") || !project) throw new Error("--apply requires --live and --project.");
  if (project === PRODUCTION_PROJECT && !flag("--allow-production")) throw new Error("Refusing to modify the production project without --allow-production.");
  if (value("--plan-hash") !== plan.planHash) throw new Error(`--plan-hash does not match the freshly computed plan (${plan.planHash}). Re-review before applying.`);
  if (process.env.FIKA_CATALOGUE_CANONICALISATION_APPROVED !== plan.planHash) throw new Error("FIKA_CATALOGUE_CANONICALISATION_APPROVED must equal the plan hash: the migration needs a separate explicit approval.");
  if (invariantProblems.length) throw new Error(`Dry run violates invariants: ${invariantProblems.join("; ")}`);
  for (const group of plan.groups) { await applyPlan(project, group.operations, group.id); console.log(`applied ${group.id} (${group.name})`); }
}
