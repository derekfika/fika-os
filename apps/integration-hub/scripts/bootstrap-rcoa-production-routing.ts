/**
 * One-time bootstrap of governed RCoA Production visibility records from the transitional legacy map.
 *
 *   dry run (default, no writes):   npx tsx scripts/bootstrap-rcoa-production-routing.ts --project fika-os-dev
 *   apply (explicit):               npx tsx scripts/bootstrap-rcoa-production-routing.ts --project fika-os-dev --apply
 *
 * Reads/writes `integrationHubHospitalityMenuProductionRouting` through the Firestore REST API with the caller's gcloud credentials.
 * Refuses the production project. Creates a record only where the plan says so; an existing governed record is never overwritten.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { localMnkMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { LEGACY_HOSPITALITY_MENU_ROUTING } from "../lib/connections-service";
import { planRcoaRoutingBootstrap } from "../lib/rcoa-routing-bootstrap";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const project = arg("--project");
const apply = process.argv.includes("--apply");
if (!project) throw new Error("--project is required (for example fika-os-dev).");
if (project === "fika-os") throw new Error("Refusing to run against the production project.");
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

const active = <T extends { lifecycleState: string }>(items: readonly T[]) => items.filter((item) => item.lifecycleState === "active");
const toItem = (item: (typeof localRcoaMenuCatalogue.items)[number]) => ({ sourceItemId: item.source.sourceItemId, name: item.name, category: item.category, canonicalId: item.canonicalId });

const query = await fetch(`${base}:runQuery`, { method: "POST", headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "integrationHubHospitalityMenuProductionRouting" }], limit: 1000 } }) });
const rows = (await query.json()) as Array<{ document?: { fields: Record<string, any> } }>;
const existing: Record<string, string[]> = {};
for (const row of rows) if (row.document) existing[row.document.fields.menuItemId.stringValue] = (row.document.fields.workstreams?.arrayValue?.values || []).map((value: { stringValue: string }) => value.stringValue);

const plan = planRcoaRoutingBootstrap({ legacy: LEGACY_HOSPITALITY_MENU_ROUTING, rcoaItems: active(localRcoaMenuCatalogue.items).map(toItem), mnkItems: active(localMnkMenuCatalogue.items).map(toItem), existing });
console.log(JSON.stringify({ project, mode: apply ? "APPLY" : "DRY RUN", matchedByStableKey: plan.matchedByStableKey.length, unmatchedKeys: plan.unmatchedKeys, willCreate: plan.create.map((item) => `${item.sourceItemId} -> [${item.workstreams.join(",")}]`), conflicts: plan.conflicts, alreadyGoverned: plan.alreadyGoverned.length, unclassifiedCount: plan.unclassified.length, unclassified: plan.unclassified.map((item) => `${item.sourceItemId}: ${item.reason}`), identityNotes: plan.identityNotes }, null, 2));

if (apply) {
  const now = new Date().toISOString();
  const actor = "migration:rcoa-production-routing-bootstrap";
  for (const record of plan.create) {
    const id = stableDocumentId(record.canonicalId);
    const fields = { menuItemId: { stringValue: record.canonicalId }, workstreams: { arrayValue: { values: record.workstreams.map((value) => ({ stringValue: value })) } }, version: { integerValue: "1" }, createdAt: { stringValue: now }, updatedAt: { stringValue: now }, updatedBy: { stringValue: actor } };
    // POST with documentId is create-only (409 if it already exists): a governed record can never be overwritten.
    const create = await fetch(`${base}/integrationHubHospitalityMenuProductionRouting?documentId=${encodeURIComponent(id)}`, { method: "POST", headers, body: JSON.stringify({ fields }) });
    if (!create.ok) throw new Error(`Could not create ${record.canonicalId}: ${create.status} ${await create.text()}`);
    const audit = await fetch(`${base}/integrationHubGovernanceAudit?documentId=${crypto.randomUUID()}`, { method: "POST", headers, body: JSON.stringify({ fields: { action: { stringValue: "Hospitality Menu Item production workstream routing updated" }, entityReference: { stringValue: record.canonicalId }, actorId: { stringValue: actor }, actorName: { stringValue: actor }, timestamp: { stringValue: now }, reason: { stringValue: "One-time bootstrap from the transitional legacy routing map (exact stable-key match to the MNK catalogue)." } } }) });
    if (!audit.ok) throw new Error(`Created ${record.canonicalId} but its audit event failed: ${audit.status} ${await audit.text()}`);
  }
  console.log(`Created ${plan.create.length} governed routing records in ${project}.`);
}
