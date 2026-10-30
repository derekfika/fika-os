/**
 * READ-ONLY plan for permitting the 11 existing One Angel Court wines at RCoA. Writes nothing to Firestore.
 *
 *   Select the store with FIKA_RUNTIME_MODE=staging|production and FIREBASE_PROJECT_ID=fika-os-dev|fika-os (needs application-default credentials; reads only)
 *   npx tsx scripts/rcoa-oac-wines.ts --rcoa-oploc <canonical OPLOC id> [--out plan.json]
 *   npx tsx scripts/rcoa-oac-wines.ts --list-oplocs            (find the RCoA OPLOC id)
 *
 * Identities are derived from the operator-approved OAC catalogue (lib/oac-approved-catalogue.ts), then verified against the canonical
 * records (bounded document gets and per-Item queries only). The output is the exact list of canonical IDs, versions, current scope,
 * prices and routing, plus the one governed bulk "switch on at RCoA" operation to apply through the Hub API/UI by an authorised administrator.
 * It refuses to produce commands unless every Item is active, restricted to exactly the OAC OPLOC, and RCoA is an active OPLOC.
 */
import fs from "node:fs/promises";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { approvedOacEntries, createdItemId, OAC_OPLOC_ID } from "../lib/oac-approved-catalogue";
import { isActiveOplocRecord } from "../lib/hospitality-catalogue-oploc";
import type { CanonicalRecord } from "../lib/types";

const args = process.argv.slice(2);
const flag = (name: string) => { const i = args.indexOf(`--${name}`); return i < 0 ? undefined : args[i + 1]; };
const canonical = () => db.collection("integrationHubCanonical");

export function oacWineIdentities() {
  return approvedOacEntries(() => undefined).flatMap(entry => entry.command?.action === "create-item" && entry.command.category === "Wine" ? [{ key: entry.key, name: entry.command.name, itemId: createdItemId(entry.command.requestId), price: entry.command.defaultPrice?.amount }] : []);
}

async function main() {
  const oplocs = (await canonical().where("entityType", "==", "OPLOC").get()).docs.map(doc => doc.data() as CanonicalRecord);
  if (args.includes("--list-oplocs")) { console.log(JSON.stringify(oplocs.map(o => ({ oplocId: o.canonicalId, name: o.record.approvedName, active: isActiveOplocRecord(o) })).sort((a, b) => String(a.name).localeCompare(String(b.name))), null, 2)); return; }
  const rcoa = flag("rcoa-oploc");
  if (!rcoa) throw new Error("Usage: --rcoa-oploc <canonical OPLOC id> | --list-oplocs");
  const wines = oacWineIdentities();
  if (wines.length !== 11 || new Set(wines.map(w => w.itemId)).size !== 11) throw new Error(`Expected 11 distinct wine identities, derived ${wines.length}.`);
  const problems: string[] = [];
  const rcoaRecord = oplocs.find(o => o.canonicalId === rcoa); if (!rcoaRecord || !isActiveOplocRecord(rcoaRecord)) problems.push(`RCoA OPLOC ${rcoa} is not an active canonical OPLOC.`);
  const oacRecord = oplocs.find(o => o.canonicalId === OAC_OPLOC_ID); if (!oacRecord || !isActiveOplocRecord(oacRecord)) problems.push("OAC OPLOC is not active.");
  const snapshots = await db.getAll(...wines.map(w => canonical().doc(stableDocumentId(w.itemId))));
  const rows = [];
  for (const [index, wine] of wines.entries()) {
    const item = snapshots[index].exists ? snapshots[index].data() as CanonicalRecord : undefined;
    if (!item || item.entityType !== "Hospitality Menu Item") { problems.push(`${wine.itemId} (${wine.name}) was not found as a Hospitality Menu Item.`); continue; }
    const children = (await canonical().where("record.hospitalityMenuItemId", "==", wine.itemId).get()).docs.map(doc => doc.data() as CanonicalRecord);
    const prices = children.filter(c => c.entityType === "Hospitality Menu Price" && c.record.lifecycleState === "active").map(c => ({ priceId: c.canonicalId, amount: c.record.amount, vatRate: c.record.vatRate, effectiveFrom: c.record.effectiveFrom, effectiveTo: c.record.effectiveTo ?? null }));
    const offerings = children.filter(c => c.entityType === "Hospitality Menu Offering" && c.record.lifecycleState !== "archived").map(c => ({ offeringId: c.canonicalId, oplocId: c.record.oplocId, available: c.record.available !== false, hasOwnPrice: false }));
    const routing = (await db.collection("integrationHubHospitalityMenuProductionRouting").doc(stableDocumentId(wine.itemId)).get()).data();
    const allowed = Array.isArray(item.record.allowedOplocIds) ? [...(item.record.allowedOplocIds as string[])].sort() : null;
    if (item.record.name !== wine.name) problems.push(`${wine.itemId}: name "${item.record.name}" differs from the approved "${wine.name}".`);
    if (item.record.lifecycleState === "archived" || item.lifecycleStatus === "archived") problems.push(`${wine.itemId}: Item is archived.`);
    if (!allowed || allowed.length !== 1 || allowed[0] !== OAC_OPLOC_ID) problems.push(`${wine.itemId}: allowlist is ${JSON.stringify(allowed)}, expected exactly the OAC OPLOC.`);
    if (!prices.some(p => p.amount === wine.price)) problems.push(`${wine.itemId}: active price ${JSON.stringify(prices.map(p => p.amount))} does not include the approved £${wine.price}.`);
    const rcoaException = offerings.find(o => o.oplocId === rcoa);
    if (rcoaException && !rcoaException.available) problems.push(`${wine.itemId}: an unavailable exception exists at RCoA; permission alone would not make it visible.`);
    rows.push({ itemId: wine.itemId, name: wine.name, version: Number(item.record.version), allowedOplocIds: allowed, prices, routingWorkstreams: routing?.workstreams ?? null, routingVersion: routing?.version ?? null, offeringsAtOtherSites: offerings.map(o => o.oplocId), minimum: item.record.defaultMinimumQuantity ?? null });
  }
  const ready = problems.length === 0;
  const plan = {
    schema: "fika.rcoa-oac-wines-plan.v1", readOnly: true, readAt: new Date().toISOString(), project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || null, oacOplocId: OAC_OPLOC_ID, rcoaOplocId: rcoa, problems, ready, items: rows,
    commands: ready ? [{ action: "bulk-update", operationId: `rcoa-oac-wines-${new Date().toISOString().slice(0, 10)}`, itemIds: rows.map(row => row.itemId), expectedVersions: Object.fromEntries(rows.map(row => [row.itemId, row.version])), sites: { mode: "add", oplocIds: [rcoa] } }] : [],
    commercialDecisions: ["RCoA inherits each wine's company default price and minimum; no RCoA-specific price, VAT, minimum, notice or wording override is created.", "Wines route in-house as at OAC; confirm that is correct for RCoA service.", "Confirm RCoA is content for OAC-brochure wine names, descriptions and 'per bottle' serving wording."],
  };
  const text = JSON.stringify(plan, null, 2);
  const out = flag("out"); if (out) await fs.writeFile(out, text, { flag: "wx" }); else console.log(text);
  if (!ready) process.exitCode = 2;
}
main().catch(error => { console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
