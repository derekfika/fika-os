/**
 * READ-ONLY snapshot / compare for the product-settings promotion.
 *   FIKA_RUNTIME_MODE=staging FIREBASE_PROJECT_ID=fika-os-dev npx tsx scripts/hospitality-promotion-verify.ts snapshot <file>
 *   FIKA_RUNTIME_MODE=staging FIREBASE_PROJECT_ID=fika-os-dev npx tsx scripts/hospitality-promotion-verify.ts compare <beforeFile> [--out report.json]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
if (process.env.FIREBASE_PROJECT_ID === "fika-os") throw new Error("Refusing production.");
const [mode, file] = process.argv.slice(2); const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
const { db } = await import("../lib/firebase-admin");
const { buildCataloguePackage } = await import("../lib/hospitality-catalogue-package");
const { resolveSiteCatalogue } = await import("../lib/hospitality-effective-offering");
type R = import("../lib/types").CanonicalRecord;
const by = async (type: string) => (await db.collection("integrationHubCanonical").where("entityType", "==", type).get()).docs.map(doc => doc.data() as R);
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function capture() {
  const [items, offerings, prices, oplocs] = await Promise.all([by("Hospitality Menu Item"), by("Hospitality Menu Offering"), by("Hospitality Menu Price"), by("OPLOC")]);
  const routing = (await db.collection("integrationHubHospitalityMenuProductionRouting").get()).docs.map(doc => doc.data());
  const pkg = buildCataloguePackage({ items, offerings, prices, oplocs, routing: routing as never }, today);
  const effective: Record<string, Record<string, unknown>> = {};
  for (const oploc of pkg.oplocs) effective[oploc.id] = Object.fromEntries(resolveSiteCatalogue(pkg, oploc.id, { serviceDate: today }).map(({ offeringId: _id, source: _source, ...rest }) => [rest.itemId, rest]));
  const json = JSON.stringify(pkg); const gz = gzipSync(Buffer.from(json), { level: 9 });
  return { today, package: { items: pkg.items.length, exceptions: pkg.exceptions.length, oplocs: pkg.oplocs.length, rawBytes: json.length, gzipBytes: gz.length, contentHash: createHash("sha256").update(gz).digest("hex") }, oplocNames: Object.fromEntries(oplocs.map(o => [o.canonicalId, String(o.record.approvedName)])), itemNames: Object.fromEntries(items.map(i => [i.canonicalId, String(i.record.name)])), effective,
    prices: Object.fromEntries(prices.map(p => [p.canonicalId, p.record])), routing: Object.fromEntries(routing.map((r: Record<string, unknown>) => [String(r.menuItemId), r])),
    manualOffering: Object.fromEntries(offerings.filter(o => !String(o.record.createdBy).startsWith("migration:")).map(o => [o.canonicalId, o])), activeOfferingRecords: offerings.filter(o => o.record.lifecycleState !== "archived").length, itemDefaults: Object.fromEntries(items.filter(i => i.record.lifecycleState !== "archived").map(i => [i.canonicalId, { minimum: i.record.defaultMinimumQuantity, notice: i.record.defaultNoticeRequiredDays, guests: i.record.defaultMinimumGuests, mode: i.record.defaultOfferingMode, configuration: Boolean(i.record.configuration) }])) };
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

if (mode === "snapshot") { const snapshot = await capture(); writeFileSync(file, JSON.stringify(snapshot)); console.log(JSON.stringify({ package: snapshot.package, activeOfferingRecords: snapshot.activeOfferingRecords })); }
else if (mode === "compare") {
  const before = JSON.parse(readFileSync(file, "utf8")) as Awaited<ReturnType<typeof capture>>; const after = await capture();
  const mnk = Object.entries(after.oplocNames).find(([, name]) => name === "MNK")![0];
  const problems: string[] = []; const ignored = ["price", "constraints.minimumQuantity", "name", "description"];
  // 1. MNK effective behaviour unchanged (every field of every offering)
  let mnkChecked = 0; for (const itemId of new Set([...Object.keys(before.effective[mnk]), ...Object.keys(after.effective[mnk])])) { mnkChecked++; if (!same(before.effective[mnk][itemId], after.effective[mnk][itemId])) problems.push(`MNK behaviour changed: ${after.itemNames[itemId] ?? itemId}`); }
  // 2. every other OPLOC inherits the canonical product behaviour (same product-level fields as MNK) wherever the item is bookable there
  let compared = 0, gained = 0, mismatched = 0; const productView = (o: any) => ({ mode: o.offeringMode, notice: o.constraints?.noticeRequiredDays, guests: o.constraints?.minimumGuests, configuration: (({ displayName: _n, description: _d, ...rest }) => rest)(o.configuration || {}), dietary: o.dietaryInformation, allergens: o.allergenInformation, category: o.category });
  for (const [oploc, items] of Object.entries(after.effective)) { if (oploc === mnk) continue; for (const [itemId, offering] of Object.entries(items) as Array<[string, any]>) { const reference = after.effective[mnk][itemId] as any; if (!reference) continue; compared++; if (!same(productView(offering), productView(reference))) { mismatched++; problems.push(`${after.oplocNames[oploc]} differs from MNK product behaviour: ${after.itemNames[itemId]}`); } const was = before.effective[oploc]?.[itemId] as any; if (was && !same(productView(was), productView(offering))) gained++; } }
  // 3. prices, routing and manual overrides byte-identical
  if (!same(before.prices, after.prices)) problems.push("Price records changed"); if (!same(before.routing, after.routing)) problems.push("Routing records changed"); if (!same(before.manualOffering, after.manualOffering)) problems.push("A manually created Offering record changed");
  const report = { before: before.package, after: after.package, activeOfferingRecords: { before: before.activeOfferingRecords, after: after.activeOfferingRecords }, mnkOfferingsCompared: mnkChecked, otherSitesCompared: compared, otherSiteBehaviourChangedByPromotion: gained, otherSiteMismatchesWithMnk: mismatched, pricesIdentical: same(before.prices, after.prices), routingIdentical: same(before.routing, after.routing), manualOverridesIdentical: same(before.manualOffering, after.manualOffering), problems };
  if (out) writeFileSync(out, JSON.stringify(report, null, 1)); console.log(JSON.stringify(report, null, 1));
  void ignored;
} else throw new Error("usage: snapshot <file> | compare <beforeFile> [--out file]");
