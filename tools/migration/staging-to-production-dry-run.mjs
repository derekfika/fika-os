#!/usr/bin/env node
/**
 * FIKA OS selective staging -> production data migration: DRY RUN ONLY.
 *
 * - READ-ONLY against both projects (Firestore REST `list` / `aggregation` only). It has no write code path; `--execute` is refused.
 * - Deterministic: the classification below is the single source of truth for what may cross. Anything not named MIGRATE is skipped.
 * - Create-only semantics are assumed for the later execution (never overwrite): a destination document that already exists is
 *   reported as IDENTICAL (same content) or CONFLICT (different content) and is never touched.
 *
 * Usage: node tools/migration/staging-to-production-dry-run.mjs [--source fika-os-dev] [--target fika-os] [--out report.json]
 * Auth: the active `gcloud` account (read-only access to both projects is enough).
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createHash } from "node:crypto";

const arg = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
if (process.argv.includes("--execute")) { console.error("REFUSED: this tool is dry-run only. Execution is not implemented until the dry run is approved."); process.exit(2); }
const SOURCE = arg("source", "fika-os-dev");
const TARGET = arg("target", "fika-os");
const OUT = arg("out", "migration-dry-run-report.json");

const gcloud = process.platform === "win32" ? "gcloud.cmd" : "gcloud";
const token = spawnSync(gcloud, ["auth", "print-access-token"], { encoding: "utf8", shell: process.platform === "win32" }).stdout.trim();
if (!token) { console.error("No gcloud access token."); process.exit(1); }
const api = (project) => `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
async function call(url, init = {}) {
  const response = await fetch(url, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers || {}) } });
  const body = await response.json().catch(() => ({}));
  return { ok: response.ok, status: response.status, body };
}
async function listAll(project, path) {
  const docs = []; let pageToken;
  for (;;) {
    const r = await call(`${api(project)}/${path}?pageSize=300${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`);
    if (!r.ok) return { error: r.body?.error?.message?.slice(0, 160) || `HTTP ${r.status}`, docs };
    docs.push(...(r.body.documents || [])); pageToken = r.body.nextPageToken; if (!pageToken) return { docs };
  }
}
async function rootCollections(project) {
  const ids = []; let pageToken;
  for (;;) {
    const r = await call(`${api(project)}:listCollectionIds`, { method: "POST", body: JSON.stringify({ pageSize: 300, ...(pageToken ? { pageToken } : {}) }) });
    if (!r.ok) return { error: r.body?.error?.message?.slice(0, 160) || `HTTP ${r.status}` };
    ids.push(...(r.body.collectionIds || [])); pageToken = r.body.nextPageToken; if (!pageToken) return { ids };
  }
}
const val = (v) => { if (!v) return undefined; const [k, x] = Object.entries(v)[0]; if (k === "mapValue") return Object.fromEntries(Object.entries(x.fields || {}).map(([a, b]) => [a, val(b)])); if (k === "arrayValue") return (x.values || []).map(val); if (k === "integerValue") return Number(x); if (k === "nullValue") return null; return x; };
const fields = (doc) => Object.fromEntries(Object.entries(doc.fields || {}).map(([k, v]) => [k, val(v)]));
const idOf = (doc) => doc.name.split("/documents/")[1];
const hash = (doc) => createHash("sha256").update(JSON.stringify(doc.fields || {})).digest("hex").slice(0, 16);

// ---------------------------------------------------------------------------------------------------------------------------
// Classification. DEFAULT for any collection not listed is DO_NOT_MIGRATE (unknown collections are never copied).
// ---------------------------------------------------------------------------------------------------------------------------
const TEST_DISH = /^(dish:Thursday Dish Revised|menu-item:local:fika-autouat-|sandwich:deli-style-sandwich-lunch:test-)/i;
const HUB_MIGRATE_TYPES = new Set(["OPLOC", "Address", "Hospitality Menu Item", "Hospitality Menu Offering", "Hospitality Menu Price", "Hospitality Brochure Import"]);
const HUB_DEV_STAFFING = new Set(["Site Role Assignment", "Site Staffing Requirement", "Staffing Role"]);
const MISTAKEN_MAPPING = (f) => f.sourceProvider === "mnk-booking-platform" && f.sourceEntityType === "site-label" && ["angel-court", "one angel court"].includes(String(f.sourceIdentifier));

/** returns { action: MIGRATE|DO_NOT_MIGRATE|REVIEW, reason } for a doc of a root collection. `ctx` carries cross-collection sets. */
function classify(collection, doc, f, ctx) {
  const id = idOf(doc).split("/").slice(1).join("/");
  switch (collection) {
    case "integrationHubCanonical":
      if (HUB_MIGRATE_TYPES.has(f.entityType)) return { action: "MIGRATE", reason: `governed master/reference record (${f.entityType})` };
      if (HUB_DEV_STAFFING.has(f.entityType)) return { action: "DO_NOT_MIGRATE", reason: "development-model staffing record created by the local Codex staffing import" };
      if (["Service Arrangement", "Service Definition", "Operational Area", "Operational Area Type", "Equipment Type", "Equipment Asset"].includes(f.entityType)) return { action: "REVIEW", reason: "governed operational configuration created as development model; business must confirm for production (Delivered-In access depends on Service Arrangements)" };
      if (["Employment", "Legend"].includes(f.entityType)) return { action: "REVIEW", reason: "BrightHR-derived personal/HR record in needs-review; not required by the launch apps; privacy review first" };
      if (["Product Category", "Site", "Hospitality Brochure Candidate"].includes(f.entityType)) return { action: "REVIEW", reason: "legacy import / draft candidate in needs-review or draft; confirm production need" };
      return { action: "REVIEW", reason: "unclassified canonical entity type" };
    case "integrationHubSourceMappings":
      return MISTAKEN_MAPPING(f) ? { action: "DO_NOT_MIGRATE", reason: "mistaken staging Angel Court mapping already retired (historical); production never needs it" } : { action: "MIGRATE", reason: "governed source/provider-location mapping" };
    case "integrationHubCanonicalRevisions":
      return ctx.migratedCanonical.has(f.canonicalId) ? { action: "MIGRATE", reason: "revision history of a migrated canonical record" } : ctx.reviewCanonical.has(f.canonicalId) ? { action: "REVIEW", reason: "follows its REVIEW canonical record" } : { action: "DO_NOT_MIGRATE", reason: "revision of an excluded/dev canonical record" };
    case "integrationHubGovernanceAudit": {
      const ref = String(f.entityReference || "");
      return ctx.migratedCanonical.has(ref) || ctx.migratedMappings.has(ref) ? { action: "MIGRATE", reason: "governance audit evidence for a migrated record" } : ctx.reviewCanonical.has(ref) ? { action: "REVIEW", reason: "follows its REVIEW record" } : { action: "DO_NOT_MIGRATE", reason: "audit for an excluded record (dev staffing, mistaken mapping, UAT)" };
    }
    case "fikaMenuPlanningCatalogue":
      return TEST_DISH.test(id) ? { action: "DO_NOT_MIGRATE", reason: "UAT/test dish" } : { action: "MIGRATE", reason: "saved dish / recipe catalogue record (stable ID preserved)" };
    case "fikaMenuPlanningWeeks":
      return f.status === "imported" ? { action: "MIGRATE", reason: "historical imported Meal Planner week (no publication state)" } : { action: "REVIEW", reason: `week status '${f.status}' is tied to staging publications/UAT; migrating it would carry publication state` };
    case "fikaCpuProductionItemsV1":
      return TEST_DISH.test(id) ? { action: "DO_NOT_MIGRATE", reason: "UAT/test saved sandwich" } : { action: "MIGRATE", reason: "saved sandwich/production item library (allergen checker)" };
    case "authmodApplications":
      return { action: "MIGRATE", reason: "application registry (no user identity data)" };
    case "authmodAccessHeads": case "authmodAppAssignments": case "authmodAuthorityGrants": case "authmodCustodianAssignments": case "authmodIdentities": case "authmodSiteAssignments":
      return { action: "REVIEW", reason: "AUTHMOD access data is bound to STAGING Firebase Auth UIDs; production access must be established deliberately (fail-closed)" };
    default:
      return { action: "DO_NOT_MIGRATE", reason: EXCLUDE_REASON[collection] || "not on the migration allow-list" };
  }
}
const EXCLUDE_REASON = {
  authmodAccessAudit: "staging access audit evidence", authmodImportResolutions: "staging import workflow state", authmodImports: "staging import workflow state",
  fikaBookings: "UAT/test Hospitality Bookings", fikaBookingAudit: "audit of excluded UAT Bookings", fikaBookingNotifications: "notification obligations of excluded Bookings",
  fikaCpuAllergenCompositionAuthoritiesV1: "UAT reuse authority", fikaCpuMasterAllergenReviewsV1: "UAT allergen review state", fikaCpuProductionChangeCursorV1: "derived cursor", fikaCpuProductionChangeReceiptsV1: "UAT change receipts",
  fikaCpuProductionChangesV1: "UAT change stack", fikaCpuProductionDayProjectionsV1: "derived projection (production regenerates)", fikaCpuProductionPlansV1: "UAT CPU production plans", fikaCpuProjectionOutboxV1: "outbox", fikaCpuProjectionPackageHeadsV1: "derived package heads",
  fikaCpuProjectionReconciliationV1: "derived reconciliation state", fikaCpuPropagationOutboxV1: "outbox/dead-letter",
  fikaDeliveredInAllergenSafetyV1: "published Delivered-In safety state", fikaDeliveredInCpuReleaseHeadsV1: "UAT release heads", fikaDeliveredInCpuReleaseReceiptsV1: "UAT release receipts", fikaDeliveredInGrabAndGoHandoffV1: "Grab & Go test handoff", fikaDeliveredInGrabAndGoOrdersV1: "Grab & Go test orders",
  fikaDeliveredInProjectionHeadsV1: "derived projection", fikaDeliveredInProjectionIndexHeadsV1: "derived projection", fikaDeliveredInSiteMenusV1: "generated site menus pointing at staging Drive files",
  fikaDomainEventInboxV1: "event inbox", fikaDomainEventsV1: "UAT domain events", fikaFulfilmentRequirementsV1: "UAT fulfilment requirements", fikaProductionOrdersV1: "UAT Production Orders", fikaProductionRequirements: "UAT production requirements",
  fikaLogisticsAssignmentsV1: "UAT logistics assignments", fikaLogisticsChangeCursorV1: "derived cursor", fikaLogisticsChangesV1: "UAT change stack", fikaLogisticsCollectionPreferencesV1: "UAT preference tied to a staging job", fikaLogisticsDayProjectionsV1: "derived projection",
  fikaLogisticsDeliveryLoadsV1: "UAT loads", fikaLogisticsDeliveryRunsV1: "UAT runs", fikaLogisticsDeliveryStopsV1: "UAT stops", fikaLogisticsJobsV1: "UAT jobs", fikaLogisticsMovementRequestsV1: "UAT movements", fikaLogisticsProjectionOutboxV1: "outbox",
  fikaMenuPlanningArchiveMetadata: "points at staging test Drive files", fikaMenuPlanningCatalogueCleanup: "staging operation log", fikaMenuPlanningCatalogueManifests: "derived manifest (regenerated from the catalogue)", fikaMenuPlanningEvents: "UAT publication events", fikaMenuPlanningOutbox: "UAT outbox",
  fikaMenuPlanningPublications: "UAT Delivered-In publications", fikaMenuPlanningPublishedSnapshots: "UAT published snapshots", integrationHubCacheManifests: "derived cache manifest",
};

async function main() {
  const report = { generatedAt: new Date().toISOString(), source: SOURCE, target: TARGET, mode: "DRY_RUN (read-only)", collections: {}, totals: {} };
  const src = await rootCollections(SOURCE); if (src.error) throw new Error(`source: ${src.error}`);
  const tgt = await rootCollections(TARGET);
  report.targetFirestore = tgt.error ? { available: false, reason: tgt.error } : { available: true, rootCollections: tgt.ids };
  // load everything we need to classify (single read pass per collection)
  const loaded = {};
  for (const c of src.ids.sort()) { const r = await listAll(SOURCE, c); if (r.error) throw new Error(`${c}: ${r.error}`); loaded[c] = r.docs; }
  // cross-collection sets
  const canonical = loaded.integrationHubCanonical || [];
  const ctx = { migratedCanonical: new Set(), reviewCanonical: new Set(), migratedMappings: new Set() };
  for (const d of canonical) { const f = fields(d); const a = classify("integrationHubCanonical", d, f, ctx).action; (a === "MIGRATE" ? ctx.migratedCanonical : a === "REVIEW" ? ctx.reviewCanonical : new Set()).add(f.canonicalId); }
  for (const d of loaded.integrationHubSourceMappings || []) { const f = fields(d); if (classify("integrationHubSourceMappings", d, f, ctx).action === "MIGRATE") ctx.migratedMappings.add(f.mappingId); }

  const create = []; // exact source -> destination list for the execution phase
  const plan = (collection, docs, subpath = "") => docs.map((d) => { const f = fields(d); return { d, f, ...classify(collection, d, f, ctx) }; });
  for (const c of Object.keys(loaded)) {
    const rows = plan(c, loaded[c]);
    const tally = { source: loaded[c].length, MIGRATE: 0, REVIEW: 0, DO_NOT_MIGRATE: 0, reasons: {} };
    for (const r of rows) { tally[r.action]++; tally.reasons[`${r.action}: ${r.reason}`] = (tally.reasons[`${r.action}: ${r.reason}`] || 0) + 1; }
    // production comparison for MIGRATE docs
    tally.destination = { exists: tgt.error ? "unknown (production Firestore not enabled)" : tgt.ids.includes(c), toCreate: 0, identical: 0, conflict: 0 };
    for (const r of rows.filter((x) => x.action === "MIGRATE")) {
      let status = "create";
      if (!tgt.error && tgt.ids.includes(c)) { const g = await call(`${api(TARGET)}/${idOf(r.d)}`); if (g.ok) status = hash({ fields: g.body.fields }) === hash(r.d) ? "identical" : "conflict"; }
      tally.destination[status === "create" ? "toCreate" : status]++;
      create.push({ sourcePath: `${SOURCE}/${idOf(r.d)}`, destinationPath: `${TARGET}/${idOf(r.d)}`, status });
    }
    report.collections[c] = tally;
  }
  // Menu Planning subcollections of migrated weeks: weeks/{id}/days/{dayId}/entries/{entryId} (IDs preserved)
  const sub = { days: { MIGRATE: 0 }, entries: { MIGRATE: 0 } };
  for (const w of plan("fikaMenuPlanningWeeks", loaded.fikaMenuPlanningWeeks || []).filter((x) => x.action === "MIGRATE")) {
    const base = idOf(w.d); const days = await listAll(SOURCE, `${base}/days`); sub.days.MIGRATE += days.docs.length;
    for (const day of days.docs) { const e = await listAll(SOURCE, `${idOf(day)}/entries`); sub.entries.MIGRATE += e.docs.length; create.push({ sourcePath: `${SOURCE}/${idOf(day)}`, destinationPath: `${TARGET}/${idOf(day)}`, status: "create" }); for (const x of e.docs) create.push({ sourcePath: `${SOURCE}/${idOf(x)}`, destinationPath: `${TARGET}/${idOf(x)}`, status: "create" }); }
  }
  report.menuPlanningSubcollections = sub;
  const sum = (k) => Object.values(report.collections).reduce((n, c) => n + c[k], 0);
  report.totals = { collections: Object.keys(report.collections).length, sourceDocuments: sum("source"), MIGRATE: sum("MIGRATE") + sub.days.MIGRATE + sub.entries.MIGRATE, MIGRATE_rootOnly: sum("MIGRATE"), REVIEW: sum("REVIEW"), DO_NOT_MIGRATE: sum("DO_NOT_MIGRATE"), documentsToCreate: create.filter((x) => x.status === "create").length, identical: create.filter((x) => x.status === "identical").length, conflicts: create.filter((x) => x.status === "conflict").length };
  report.createList = create;
  // Phase 4 dependency check: these collections are what a migrated record could trigger downstream; none may be a write target.
  report.sideEffectCheck = { writesToTransactionalCollections: create.filter((x) => /\/(fikaBookings|fikaBookingAudit|fikaBookingNotifications|fikaProductionOrders|fikaProductionRequirements|fikaLogistics|fikaDeliveredIn|fikaCpu(?!ProductionItemsV1)|fikaMenuPlanning(Outbox|Events|Publications|PublishedSnapshots)|fikaFulfilment|fikaDomainEvent)/.test(x.destinationPath)).length };
  writeFileSync(OUT, JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ totals: report.totals, targetFirestore: report.targetFirestore, sideEffectCheck: report.sideEffectCheck, menuPlanningSubcollections: sub }, null, 1));
  console.log(`\nFull report: ${OUT}`);
}
main().catch((e) => { console.error(e.message); process.exit(1); });
