/**
 * Promote a Hospitality platform's brochure into canonical Hospitality Menu Items (reusable Items only: no Offerings, Prices or routing).
 *
 *   dry run (default, no writes):   npx tsx scripts/promote-hospitality-menu-items.ts --platform angel-court --project fika-os-dev
 *   apply (explicit):               npx tsx scripts/promote-hospitality-menu-items.ts --platform angel-court --project fika-os-dev --apply
 *
 * Platforms: rcoa | angel-court | cfc | munich-re. Firestore REST with the caller's gcloud credentials. Refuses the production project.
 * Create-only (POST with documentId => 409 if it exists): an existing canonical record is never overwritten. Deterministic and idempotent:
 * a re-run reuses identical records. It creates NO routing records, so every promoted item shows as Unclassified in Hub.
 */
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import { localAngelCourtMenuCatalogue, localCfcMenuCatalogue, localMunichReMenuCatalogue, localRcoaMenuCatalogue } from "@fika/server-shared/hospitality-catalogue";
import { buildCanonicalMenuItem, planBrochurePromotion, promotionActor, type BrochureItem, type PromotionExisting } from "../lib/hospitality-menu-promotion";

const arg = (name: string) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : undefined; };
const project = arg("--project");
const apply = process.argv.includes("--apply");
const platform = arg("--platform") || "";
const catalogues = { rcoa: localRcoaMenuCatalogue, "angel-court": localAngelCourtMenuCatalogue, cfc: localCfcMenuCatalogue, "munich-re": localMunichReMenuCatalogue } as const;
const catalogue = catalogues[platform as keyof typeof catalogues];
if (!catalogue) throw new Error("--platform must be one of: " + Object.keys(catalogues).join(", "));
if (!project) throw new Error("--project is required (for example fika-os-dev).");
if (project === "fika-os") throw new Error("Refusing to run against the production project.");
const token = execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).trim();
const base = `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };

type FsValue = Record<string, unknown>;
const toValue = (value: unknown): FsValue => {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { booleanValue: value };
  if (typeof value === "number") return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (Array.isArray(value)) return { arrayValue: value.length ? { values: value.map(toValue) } : {} };
  return { mapValue: { fields: Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).map(([k, v]) => [k, toValue(v)])) } };
};
const str = (value: any) => value?.stringValue as string | undefined;

// existing Hospitality Menu Items (bounded: a catalogue of ~100)
const response = await fetch(`${base}:runQuery`, { method: "POST", headers, body: JSON.stringify({ structuredQuery: { from: [{ collectionId: "integrationHubCanonical" }], where: { fieldFilter: { field: { fieldPath: "entityType" }, op: "EQUAL", value: { stringValue: "Hospitality Menu Item" } } }, limit: 1000 } }) });
const rows = (await response.json()) as Array<{ document?: { fields: Record<string, any> } }>;
const existing = new Map<string, PromotionExisting>();
for (const row of rows) {
  if (!row.document) continue;
  const fields = row.document.fields;
  const record = fields.record?.mapValue?.fields || {};
  existing.set(str(fields.canonicalId)!, { canonicalId: str(fields.canonicalId)!, name: str(record.name) || "", category: str(record.category) || "", sourceItemId: str(record.ownership?.mapValue?.fields?.providerOwned?.mapValue?.fields?.sourceItemId) });
}
const items = catalogue.items as unknown as BrochureItem[];
const plan = planBrochurePromotion(items, existing);
console.log(JSON.stringify({ project, platform, mode: apply ? "APPLY" : "DRY RUN", brochureItems: items.length, existingHospitalityMenuItems: existing.size, willCreate: plan.create.length, reused: plan.reused.length, conflicts: plan.conflicts, skipped: plan.skipped }, null, 2));

if (apply) {
  if (plan.conflicts.length) throw new Error("Conflicts must be resolved before applying; nothing was written.");
  const now = new Date().toISOString();
  for (const item of plan.create) {
    const record = buildCanonicalMenuItem(item, now, platform);
    const fields = (toValue(record) as { mapValue: { fields: Record<string, FsValue> } }).mapValue.fields;
    const create = await fetch(`${base}/integrationHubCanonical?documentId=${encodeURIComponent(stableDocumentId(item.canonicalId))}`, { method: "POST", headers, body: JSON.stringify({ fields }) });
    if (!create.ok) throw new Error(`Could not create ${item.canonicalId}: ${create.status} ${await create.text()}`);
    const audit = await fetch(`${base}/integrationHubGovernanceAudit?documentId=${crypto.randomUUID()}`, { method: "POST", headers, body: JSON.stringify({ fields: { action: toValue("Portal Hospitality Menu Item promoted"), entityReference: toValue(item.canonicalId), actorId: toValue(promotionActor(platform)), timestamp: toValue(now), reason: toValue("Promoted from the checked-in brochure so its items can be governed in Hub. No offerings, prices or routing created.") } }) });
    if (!audit.ok) throw new Error(`Created ${item.canonicalId} but its audit event failed: ${audit.status} ${await audit.text()}`);
  }
  console.log(`Created ${plan.create.length}, reused ${plan.reused.length} in ${project}.`);
}
