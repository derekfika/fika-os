/**
 * Staging UAT of the sparse catalogue model, executed with the same governed server code that is deployed.
 * Mutations are confined to ONE clearly named probe item that is archived at the end; real catalogue items are only read.
 *
 *   FIKA_RUNTIME_MODE=staging FIREBASE_PROJECT_ID=fika-os-dev FIKA_SNAPSHOT_BUCKET=<read-packages bucket> npx tsx scripts/hospitality-staging-uat.ts [--out report.json]
 */
import { writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
if (process.env.FIREBASE_PROJECT_ID !== "fika-os-dev") throw new Error("UAT runs against fika-os-dev only.");
const out = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : undefined;
const { db } = await import("../lib/firebase-admin");
const { stableDocumentId } = await import("../lib/canonical-editor");
const { runCatalogueCommand, runBulkCatalogueUpdate } = await import("../lib/hospitality-catalogue-admin");
const { loadCataloguePayload, loadCatalogueRows } = await import("../lib/hospitality-catalogue-loader");
const { rebuildCataloguePackage, getCataloguePackage } = await import("../lib/hospitality-catalogue-package");
const { resolveHospitalityOffering, resolveSiteCatalogue } = await import("../lib/hospitality-effective-offering");
type R = import("../lib/types").CanonicalRecord;
const actor = { uid: "uat:hospitality-sparse-model", name: "Sparse model UAT (staging)", role: "integration-admin" as const, synthetic: true };
const results: Array<{ area: string; check: string; pass: boolean; detail?: unknown }> = [];
const check = (area: string, name: string, pass: boolean, detail?: unknown) => { results.push({ area, check: name, pass, ...(detail !== undefined ? { detail } : {}) }); console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name}${detail !== undefined ? " " + JSON.stringify(detail) : ""}`); };
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const exceptionsOf = async (itemId: string) => (await db.collection("integrationHubCanonical").where("record.hospitalityMenuItemId", "==", itemId).get()).docs.map(d => d.data() as R).filter(r => r.entityType === "Hospitality Menu Offering");
const activeExceptions = async (itemId: string) => (await exceptionsOf(itemId)).filter(r => r.record.lifecycleState !== "archived");

// ---------------- CATALOGUE ADMIN ----------------
const before = await loadCataloguePayload(actor as never);
const activeOplocs = before.oplocs.filter(o => o.active);
check("admin", "active canonical Items (~46)", before.counts.active === 46, { active: before.counts.active, archived: before.counts.archived });
check("admin", "site picker covers all active OPLOCs", activeOplocs.length === 19, { sites: activeOplocs.length });
const key = randomUUID().slice(0, 8);
const created = await runCatalogueCommand(actor as never, { action: "create-item", requestId: `uat-${key}-${randomUUID()}`, name: `UAT Sparse Probe ${key}`, category: "UAT", routing: "in_house", defaultPrice: { amount: 1 }, defaultMinimumQuantity: 2, oplocIds: activeOplocs.map(o => o.oplocId) });
const probe = created.itemIds[0];
check("admin", "SELECT ALL SITES stores no positive Offering fan-out", (await exceptionsOf(probe)).length === 0, { records: (await exceptionsOf(probe)).length, wouldBe: activeOplocs.length });
const rowOf = async () => (await loadCatalogueRows([probe]))[0];
let row = await rowOf(); check("admin", "probe is available at all sites with no exception", row.availableAt.length === activeOplocs.length && row.unavailableAt.length === 0);
const wise = activeOplocs.find(o => o.label === "Wise")!.oplocId;
await runBulkCatalogueUpdate(actor as never, { operationId: `uat-remove-${key}-${randomUUID()}`, itemIds: [probe], expectedVersions: { [probe]: row.version }, sites: { mode: "remove", oplocIds: [wise] } });
check("admin", "excluding ONE site creates exactly ONE sparse exception", (await activeExceptions(probe)).length === 1 && (await activeExceptions(probe))[0].record.available === false && (await activeExceptions(probe))[0].record.oplocId === wise);
row = await rowOf();
await runBulkCatalogueUpdate(actor as never, { operationId: `uat-add-${key}-${randomUUID()}`, itemIds: [probe], expectedVersions: { [probe]: row.version }, sites: { mode: "add", oplocIds: [wise] } });
const afterAdd = await exceptionsOf(probe);
check("admin", "re-adding the site retires the exception (record kept as history)", (await activeExceptions(probe)).length === 0 && afterAdd.length === 1 && afterAdd[0].record.retiredReason === "redundant-default");
row = await rowOf();
const bulk = await runBulkCatalogueUpdate(actor as never, { operationId: `uat-bulk-${key}-${randomUUID()}`, itemIds: [probe], expectedVersions: { [probe]: row.version }, expectedRoutingVersions: { [probe]: row.routing.version }, production: "cpu_hospitality", price: { amount: 2.5 }, minimum: { mode: "set", value: 6 } });
row = await rowOf();
check("admin", "bulk editing: production, default price and minimum apply; no site records created", bulk.failed === 0 && row.routing.state === "cpu_hospitality" && row.defaultPrice?.amount === 2.5 && row.defaultMinimumQuantity === 6 && (await activeExceptions(probe)).length === 0);
const stale = await runBulkCatalogueUpdate(actor as never, { operationId: `uat-stale-${key}-${randomUUID()}`, itemIds: [probe], expectedVersions: { [probe]: 1 }, minimum: { mode: "set", value: 9 } });
check("admin", "bulk editing: a stale editor fails safely and changes nothing", stale.failed === 1 && (await rowOf()).defaultMinimumQuantity === 6);
await runBulkCatalogueUpdate(actor as never, { operationId: `uat-excl2-${key}-${randomUUID()}`, itemIds: [probe], expectedVersions: { [probe]: row.version }, sites: { mode: "remove", oplocIds: [wise] } });
row = await rowOf();
await runCatalogueCommand(actor as never, { action: "set-item-status", itemId: probe, expectedVersion: row.version, status: "archived" });
const archived = await rowOf(); const afterArchive = await exceptionsOf(probe);
check("admin", "archive retires site records; archived item has no active availability", archived.status === "archived" && archived.availableAt.length === 0 && afterArchive.every(r => r.record.lifecycleState === "archived"));
await runCatalogueCommand(actor as never, { action: "set-item-status", itemId: probe, expectedVersion: archived.version, status: "active" });
const restored = await rowOf();
check("admin", "restore revives the exception exactly as it was and the item is bookable again", restored.status === "active" && restored.unavailableAt.join() === wise && restored.availableAt.length === activeOplocs.length - 1);
await runCatalogueCommand(actor as never, { action: "set-item-status", itemId: probe, expectedVersion: restored.version, status: "archived" }); // leave the probe archived (history only)

// ---------------- EFFECTIVE OFFERING (real catalogue, read-only) ----------------
const by = async (t: string) => (await db.collection("integrationHubCanonical").where("entityType", "==", t).get()).docs.map(d => d.data() as R);
const [items, offerings, prices, oplocs] = await Promise.all([by("Hospitality Menu Item"), by("Hospitality Menu Offering"), by("Hospitality Menu Price"), by("OPLOC")]);
const routing = (await db.collection("integrationHubHospitalityMenuProductionRouting").get()).docs.map(d => d.data());
const { buildCataloguePackage } = await import("../lib/hospitality-catalogue-package");
const pkg = buildCataloguePackage({ items, offerings, prices, oplocs, routing: routing as never }, today);
const site = (name: string) => oplocs.find(o => o.record.approvedName === name)!.canonicalId; const mnk = site("MNK"), rcoa = site("RCoA"), wiseId = site("Wise");
const item = (name: string) => pkg.items.find(i => i.name === name)!;
const at = (name: string, oploc: string) => resolveHospitalityOffering(pkg, item(name).id, oploc, { serviceDate: today });
const rice = item("Freshly Wrapped Rice Paper Rolls"); const m = at(rice.name, mnk), o = at(rice.name, rcoa);
check("effective", "another OPLOC inherits Item notice, minimum guests, choices and mode (Rice Paper Rolls)", m.available && o.available && JSON.stringify([(o as never as { offering: { configuration: unknown; constraints: unknown; offeringMode: string } }).offering.configuration, (o as never as { offering: { constraints: { noticeRequiredDays?: number; minimumGuests?: number } } }).offering.constraints.noticeRequiredDays, (o as never as { offering: { offeringMode: string } }).offering.offeringMode]) === JSON.stringify([(m as never as { offering: { configuration: unknown } }).offering.configuration, (m as never as { offering: { constraints: { noticeRequiredDays?: number } } }).offering.constraints.noticeRequiredDays, (m as never as { offering: { offeringMode: string } }).offering.offeringMode]), { notice: (o as never as { offering: { constraints: { noticeRequiredDays?: number } } }).offering.constraints.noticeRequiredDays, hasChoices: Boolean((o as never as { offering: { configuration?: { choices?: unknown[] } } }).offering.configuration?.choices?.length) });
const deli = item("Deli Style Sandwich Lunch"); const deliM = at(deli.name, mnk) as never as { offering: { constraints: { minimumQuantity?: number }; source: string } }, deliR = at(deli.name, rcoa) as never as { offering: { constraints: { minimumQuantity?: number }; source: string } };
check("effective", "a genuine MNK exception still overrides (Deli Style minimum at MNK differs from the company default)", deliM.offering.source === "exception" && deliM.offering.constraints.minimumQuantity !== deliR.offering.constraints.minimumQuantity, { mnkMinimum: deliM.offering.constraints.minimumQuantity, otherSiteMinimum: deliR.offering.constraints.minimumQuantity });
const bespoke = at("Bespoke Event Menu", rcoa) as never as { offering?: { offeringMode: string; quoteRequired?: boolean } };
check("effective", "quote-only product mode inherited by another OPLOC (Bespoke Event Menu)", bespoke.offering?.offeringMode === "quote_only" && bespoke.offering?.quoteRequired === true);
const unpriced = ["Loaf Cake", "Doughnut Box", "Traybake Box — Nut Free"].map(name => ({ name, rcoa: at(name, rcoa), mnk: at(name, mnk) }));
check("effective", "missing company price stays fail-closed/unbookable at other OPLOCs", unpriced.every(u => !u.rcoa.available && (u.rcoa as { reason: string }).reason === "no_price"), unpriced.map(u => `${u.name}:${(u.rcoa as { reason?: string }).reason}`));
const mnkPriced = at("Bloom Filter Coffee", mnk), otherBloom = at("Bloom Filter Coffee", rcoa);
check("effective", "MNK-only price exception still bookable at MNK; other sites stay unbookable until a company price is decided", mnkPriced.available && !otherBloom.available);
check("effective", "bookable counts (MNK / RCoA / Wise)", true, { MNK: resolveSiteCatalogue(pkg, mnk, { serviceDate: today }).length, RCoA: resolveSiteCatalogue(pkg, rcoa, { serviceDate: today }).length, Wise: resolveSiteCatalogue(pkg, wiseId, { serviceDate: today }).length });

// ---------------- PACKAGE ----------------
const published = await rebuildCataloguePackage();
const stored = (await getCataloguePackage())!;
const json = JSON.stringify(stored.value);
const exceptionItems = new Set(stored.value.exceptions.map(e => e.itemId));
check("package", "published, integrity-verified, schemaVersion 1", stored.manifest.schemaVersion === 1 && stored.manifest.contentHash === published.manifest.contentHash, { status: published.status, packageVersion: stored.manifest.packageVersion, schemaVersion: stored.manifest.schemaVersion, contentHash: stored.manifest.contentHash, objectName: stored.manifest.objectName, generatedAt: stored.manifest.generatedAt });
check("package", "size ~34 KB raw / 6-7 KB gzip", json.length > 30_000 && json.length < 40_000 && stored.manifest.compressedSize > 5_500 && stored.manifest.compressedSize < 7_500, { rawBytes: json.length, gzipBytes: stored.manifest.compressedSize });
check("package", "canonical Items appear once plus sparse exceptions, no Item x OPLOC matrix", new Set(stored.value.items.map(i => i.id)).size === stored.value.items.length && stored.value.items.length === 46 && stored.value.exceptions.length === 6 && stored.value.exceptions.length < stored.value.items.length * stored.value.oplocs.length / 100, { items: stored.value.items.length, oplocs: stored.value.oplocs.length, exceptions: stored.value.exceptions.length, naiveMatrix: stored.value.items.length * stored.value.oplocs.length, itemsWithExceptions: exceptionItems.size });
check("package", "the archived UAT probe is not in the package", !stored.value.items.some(i => i.name.startsWith("UAT Sparse Probe")));
check("package", "manifest/object hash matches the compressed bytes", createHash("sha256").update(Buffer.from((await (await import("../lib/hospitality-catalogue-package")).getCataloguePackageBytes(stored.manifest.contentHash))!.bytes)).digest("hex") === stored.manifest.contentHash);
const failed = results.filter(r => !r.pass); console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (out) writeFileSync(out, JSON.stringify({ probeItem: probe, probeId: stableDocumentId(probe), results }, null, 1));
if (failed.length) process.exitCode = 1;
