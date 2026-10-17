/**
 * Sparse-exception migration for the Hospitality catalogue: READ-ONLY by default.
 *
 *   FIKA_RUNTIME_MODE=staging FIREBASE_PROJECT_ID=fika-os-dev npx tsx scripts/hospitality-offering-sparse-migration.ts [--out report.json]
 *   ... --apply-bulk-cleanup   retire ONLY the redundant default-availability Offerings created by the all-sites bulk operation
 *   ... --apply-archive-repair retire active Offerings that still point at an archived Item
 *
 * Production is refused. The plan is recomputed from live data immediately before any write; every write is one governed,
 * version-guarded, receipt-backed transaction per record (see retireOfferingRecords). Redundant LEGACY records and genuine exceptions
 * are reported only and never written by this script.
 */
import { writeFileSync } from "node:fs";
const args = process.argv.slice(2); const flag = (name: string) => args.includes(name); const value = (name: string) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : undefined; };
if (process.env.FIREBASE_PROJECT_ID === "fika-os" || process.env.GCLOUD_PROJECT === "fika-os") throw new Error("Refusing to run against the production project.");
const { db } = await import("../lib/firebase-admin");
const { planOfferingMigration, planConfigurationPromotion, BULK_ALL_SITES_ACTOR } = await import("../lib/hospitality-offering-migration");
const { retireOfferingRecords } = await import("../lib/hospitality-catalogue-admin");
const { isActiveOplocRecord } = await import("../lib/hospitality-catalogue-oploc");
type R = import("../lib/types").CanonicalRecord;
const BULK_OPERATION_ID = "op-hospitality-all-sites-20261017";

async function load() {
  const canonical = db.collection("integrationHubCanonical");
  const by = async (type: string) => (await canonical.where("entityType", "==", type).get()).docs.map(doc => doc.data() as R);
  const [items, offerings, prices, oplocs, routing, merges] = await Promise.all([by("Hospitality Menu Item"), by("Hospitality Menu Offering"), by("Hospitality Menu Price"), by("OPLOC"),
    db.collection("integrationHubHospitalityMenuProductionRouting").get(), db.collection("integrationHubHospitalityMenuItemMerges").get()]);
  const revisions = (await db.collection("integrationHubCanonicalRevisions").where("actorId", "==", BULK_ALL_SITES_ACTOR).get()).docs.map(doc => doc.data() as { canonicalId: string; version: number; actorId: string; reason: string });
  const receipts = (await db.collection("integrationHubGovernanceAudit").where("actorId", "==", BULK_ALL_SITES_ACTOR).get()).docs.map(doc => doc.data() as { entityReference: string; action: string; actorId: string; details?: { bulkOperationId?: string; oplocIds?: string[] } });
  return { items, offerings, prices, routing: routing.docs.map(doc => doc.data() as never), merges: merges.docs.map(doc => doc.data() as never), oplocs: oplocs.map(oploc => ({ oplocId: oploc.canonicalId, active: isActiveOplocRecord(oploc) })), revisions, receipts };
}

const loaded = await load();
const plan = planOfferingMigration(loaded, BULK_OPERATION_ID);
const promotion = planConfigurationPromotion(loaded);
console.log("configuration promotion (REPORT ONLY):", JSON.stringify({ items: promotion.length, deterministic: promotion.filter(entry => entry.status === "deterministic").length, conflicts: promotion.filter(entry => entry.status === "conflict").length }));
const names = new Map<string, string>();
const report = { generatedAt: new Date().toISOString(), summary: plan.summary, bulkCreatedRedundantToRetire: plan.bulkCreatedRedundant.map(v => v.offeringId), bulkCreatedKept: plan.bulkCreatedNotRedundant, legacyRedundantCount: plan.legacyRedundant.length, genuineExceptions: plan.exceptions.map(v => ({ offeringId: v.offeringId, itemId: v.itemId, oplocId: v.oplocId, reasons: v.reasons })), archivedItemOfferings: plan.archivedItemOfferings };
console.log(JSON.stringify({ summary: plan.summary, exceptionReasons: plan.exceptions.reduce((acc: Record<string, number>, v) => { for (const r of v.reasons) acc[r] = (acc[r] || 0) + 1; return acc; }, {}) }, null, 1));
void names;
if (value("--out")) writeFileSync(value("--out")!, JSON.stringify(report, null, 1));

if (flag("--apply-bulk-cleanup")) {
  const results = await retireOfferingRecords({ uid: "migration:hospitality-sparse-cleanup", name: "Hospitality sparse-model cleanup (approved by Derek)", role: "integration-admin", synthetic: true }, { operationId: "op-retire-bulk-default-availability-20261017", reason: "redundant-default", requireCreatedBy: BULK_ALL_SITES_ACTOR, targets: plan.bulkCreatedRedundant.map(v => ({ offeringId: v.offeringId, expectedVersion: v.version })) });
  console.log("bulk cleanup:", JSON.stringify(results.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})));
  for (const r of results.filter(x => x.status === "failed")) console.log("FAILED", r.offeringId, r.message);
}
if (flag("--apply-archive-repair")) {
  const results = await retireOfferingRecords({ uid: "migration:hospitality-sparse-cleanup", name: "Hospitality sparse-model cleanup (approved by Derek)", role: "integration-admin", synthetic: true }, { operationId: "op-retire-archived-item-offerings-20261017", reason: "item-archived", targets: plan.archivedItemOfferings.map(v => ({ offeringId: v.offeringId, expectedVersion: v.version })) });
  console.log("archive repair:", JSON.stringify(results.reduce((acc: Record<string, number>, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {})));
  for (const r of results.filter(x => x.status === "failed")) console.log("FAILED", r.offeringId, r.message);
}
