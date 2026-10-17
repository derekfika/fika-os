import { createHash } from "node:crypto";

export const PLAN_SCHEMA = "fika-firestore-bootstrap-plan.v1";
export const SOURCE_PROJECT = "fika-os-dev";
export const DESTINATION_PROJECT = "fika-os";

const RETAINED_ROOTS = new Set([
  "authmodApplications",
  "authmodIdentities",
  "integrationHubCanonical",
  "integrationHubCanonicalRevisions",
  "integrationHubHospitalityCatalogueReviewDecisions",
  "integrationHubHospitalityMenuItemMerges",
  "integrationHubHospitalityMenuProductionRouting",
  "integrationHubSourceMappings",
  "fikaMenuPlanningCatalogue",
  "fikaMenuPlanningCatalogueManifests",
]);

const RETAIN_REASONS = {
  authmodApplications: "production application definitions",
  authmodIdentities: "stable AUTHMOD identity records; staging Firebase binding stripped",
  integrationHubCanonical: "canonical governed reference entities, including Items, Offerings, OPLOCs and sparse exceptions",
  integrationHubCanonicalRevisions: "immutable canonical history, including archived Offering revisions",
  integrationHubHospitalityCatalogueReviewDecisions: "governed catalogue review decisions",
  integrationHubHospitalityMenuItemMerges: "stable Hospitality Item merge lineage",
  integrationHubHospitalityMenuProductionRouting: "Hub-owned production routing decisions",
  integrationHubSourceMappings: "source-to-canonical mappings",
  fikaMenuPlanningCatalogue: "canonical Menu Planning catalogue, including archived history records",
  fikaMenuPlanningCatalogueManifests: "verified Menu Planning catalogue package head for the retained canonical dish source",
};

const TRANSFORMS = [
  { id: "authmod-identities-clear-staging-firebase-binding", appliesTo: "authmodIdentities documents with externalProvider=firebase and non-empty externalUid", operations: ["remove externalProvider", "remove externalUid"], preserves: ["identity id", "normalized email", "display name", "legend linkage", "status", "provenance", "audit/actor references"] },
  { id: "authmod-identities-reset-staging-full-access", appliesTo: "authmodIdentities documents with fullAccess=true", operations: ["set fullAccess=false"], preserves: ["identity id", "identity and actor attribution"] },
];

const EXCLUSION_RULES = [
  { id: "authmod-staging-access-state", roots: ["authmodAccessAudit", "authmodAccessHeads", "authmodAppAssignments", "authmodAuthorityGrants", "authmodCustodianAssignments", "authmodImportResolutions", "authmodImports", "authmodSiteAssignments"], reason: "staging authorization/import state must be provisioned and reviewed in production" },
  { id: "hospitality-booking-history", roots: ["fikaBookings", "fikaBookingAudit", "fikaBookingNotifications", "fikaHospitalityBookingGroups", "fikaHospitalityGroupQuotes"], reason: "Hospitality booking operational history" },
  { id: "menu-operational-history", roots: ["fikaMenuPlanningWeeks", "fikaMenuPlanningPublications", "fikaMenuPlanningPublishedSnapshots", "fikaMenuPlanningEvents", "fikaMenuPlanningOutbox", "fikaMenuPlanningArchiveMetadata"], reason: "staging Menu Planning week/publication history and Drive archive pointers" },
  { id: "delivered-in-operational-history", roots: ["fikaDeliveredInAllergenSafetyV1", "fikaDeliveredInCpuReleaseHeadsV1", "fikaDeliveredInCpuReleaseReceiptsV1", "fikaDeliveredInGrabAndGoHandoffV1", "fikaDeliveredInGrabAndGoOrdersV1", "fikaDeliveredInGrabAndGoStandingOrdersV1", "fikaDeliveredInProjectionHeadsV1", "fikaDeliveredInProjectionIndexHeadsV1", "fikaDeliveredInSiteMenusV1"], reason: "Delivered-In operational projections, published weeks, releases and receipts" },
  { id: "cpu-operational-and-derived-state", roots: ["fikaCpuAllergenCompositionAuthoritiesV1", "fikaCpuMasterAllergenReviewsV1", "fikaCpuProductionChangeCursorV1", "fikaCpuProductionChangeReceiptsV1", "fikaCpuProductionChangesV1", "fikaCpuProductionDayProjectionsV1", "fikaCpuProductionItemsV1", "fikaCpuProductionPlansV1", "fikaCpuProjectionOutboxV1", "fikaCpuProjectionPackageHeadsV1", "fikaCpuProjectionReconciliationV1", "fikaCpuPropagationOutboxV1"], reason: "staging CPU operational state/projections/feed; seed production feed at its own initial cursor" },
  { id: "logistics-operational-and-derived-state", roots: ["fikaLogisticsAssignmentsV1", "fikaLogisticsChangeCursorV1", "fikaLogisticsChangesV1", "fikaLogisticsCollectionPreferencesV1", "fikaLogisticsDayProjectionsV1", "fikaLogisticsDeliveryLoadsV1", "fikaLogisticsDeliveryRunsV1", "fikaLogisticsDeliveryStopsV1", "fikaLogisticsJobsV1", "fikaLogisticsMovementRequestsV1", "fikaLogisticsProjectionOutboxV1"], reason: "staging Logistics operational state/projections/feed; seed production partitions at their own initial cursors" },
  { id: "derived-cross-domain-operations", roots: ["fikaDomainEventInboxV1", "fikaDomainEventsV1", "fikaFulfilmentRequirementsV1", "fikaProductionOrdersV1", "fikaProductionRequirements"], reason: "cross-domain operational events and derived Production/Fulfilment closure" },
  { id: "staging-audit-and-catalogue-migration-state", roots: ["integrationHubGovernanceAudit"], reason: "staging-side canonical governance audit evidence; preserve source-side and do not relabel as production" },
  { id: "environment-specific-bootstrap-state", roots: ["fikaDashboardQuoteSettings", "fikaMenuPlanningCatalogueCleanup", "integrationHubCacheManifests"], reason: "staging-specific folder settings, migration receipts and rebuildable cache metadata" },
];

export function firestoreValue(value) {
  if (!value || typeof value !== "object") return value;
  if ("nullValue" in value) return null;
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return Number(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("timestampValue" in value) return value.timestampValue;
  if ("referenceValue" in value) return value.referenceValue;
  if ("bytesValue" in value) return value.bytesValue;
  if ("arrayValue" in value) return (value.arrayValue.values || []).map(firestoreValue);
  if ("mapValue" in value) return Object.fromEntries(Object.entries(value.mapValue.fields || {}).map(([key, child]) => [key, firestoreValue(child)]));
  if ("geoPointValue" in value) return value.geoPointValue;
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
  return value;
}

export function sha256(value) {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(stable(value))).digest("hex");
}

function fullPath(record) {
  if (record.path) return record.path;
  return record.name?.split("/documents/")[1];
}

export function sourceRecordHash(record) {
  return sha256({ path: fullPath(record), fields: record.fields || {}, updateTime: record.updateTime || null });
}

export function sourceStateHash(inventory) {
  const records = (inventory.records || []).map(record => [fullPath(record), sourceRecordHash(record)]).sort(([a], [b]) => a.localeCompare(b));
  const placeholders = [...(inventory.placeholders || [])].map(item => typeof item === "string" ? item : item.path).sort();
  return sha256({ records, placeholders });
}

/** Match Menu Planning's catalogueSourceHash contract (schema v1, dish rows
 * only, ordered by canonicalId). The collection also contains sandwiches,
 * which are not inputs to the catalogue package and must not affect identity.
 */
export function menuCatalogueSourceIdentity(records) {
  const sourceRecords = records.filter(record => fullPath(record)?.split("/")[0] === "fikaMenuPlanningCatalogue");
  const dishes = sourceRecords
    .filter(record => firestoreValue(record.fields?.kind) === "dish")
    .map(record => firestoreValue(record.fields?.record) ?? firestoreValue(record.fields || {}))
    .sort((left, right) => String(left?.canonicalId || "").localeCompare(String(right?.canonicalId || "")));
  const manifest = records.find(record => fullPath(record) === "fikaMenuPlanningCatalogueManifests/catalogue");
  const headSourceHash = firestoreValue(manifest?.fields?.sourceHash) ?? null;
  const sourceHash = sha256({ schemaVersion: 1, items: dishes });
  return {
    collection: "fikaMenuPlanningCatalogue",
    manifestPath: "fikaMenuPlanningCatalogueManifests/catalogue",
    sourceRecordCount: dishes.length,
    nonDishRecordCount: sourceRecords.length - dishes.length,
    sourceHash,
    headSourceHash,
    matchesHead: typeof headSourceHash === "string" && headSourceHash === sourceHash,
  };
}

export function transformRecord(record) {
  const path = fullPath(record);
  const root = path.split("/")[0];
  const fields = structuredClone(record.fields || {});
  const transformed = [];
  if (root === "authmodIdentities") {
    const provider = firestoreValue(fields.externalProvider);
    const uid = firestoreValue(fields.externalUid);
    if (provider === "firebase" && typeof uid === "string" && uid.length) {
      delete fields.externalProvider;
      delete fields.externalUid;
      transformed.push(TRANSFORMS[0].id);
    }
    if (firestoreValue(fields.fullAccess) === true) {
      fields.fullAccess = { booleanValue: false };
      transformed.push(TRANSFORMS[1].id);
    }
  }
  return { path, fields, transformed };
}

function exclusionFor(root) {
  return EXCLUSION_RULES.find(rule => rule.roots.includes(root));
}

export function buildPlan(sourceInventory, destinationInventory) {
  if (sourceInventory.project !== SOURCE_PROJECT) throw new Error(`Expected source project ${SOURCE_PROJECT}; received ${sourceInventory.project}.`);
  if (destinationInventory.project !== DESTINATION_PROJECT) throw new Error(`Expected destination project ${DESTINATION_PROJECT}; received ${destinationInventory.project}.`);

  const records = [...(sourceInventory.records || [])].sort((a, b) => fullPath(a).localeCompare(fullPath(b)));
  const seen = new Set();
  const actions = [];
  const excludedByReason = {};
  const retainedByRoot = {};
  const transformedByRule = {};
  const invariantProblems = [];
  const sourcePlaceholders = [...(sourceInventory.placeholders || [])].map(item => typeof item === "string" ? item : item.path).sort();
  const destinationPlaceholders = [...(destinationInventory.placeholders || [])].map(item => typeof item === "string" ? item : item.path).sort();
  if (sourcePlaceholders.length) invariantProblems.push(`source inventory contains ${sourcePlaceholders.length} missing-parent placeholder(s) with descendants`);
  if (destinationPlaceholders.length) invariantProblems.push(`destination inventory contains ${destinationPlaceholders.length} missing-parent placeholder(s) with descendants`);
  for (const record of records) {
    const path = fullPath(record);
    if (!path || seen.has(path)) {
      invariantProblems.push(`missing or duplicate source path: ${path || "<missing>"}`);
      continue;
    }
    seen.add(path);
    const root = path.split("/")[0];
    if (!RETAINED_ROOTS.has(root)) {
      const exclusion = exclusionFor(root);
      const reason = exclusion?.id || "not-in-explicit-retention-allowlist";
      excludedByReason[reason] = (excludedByReason[reason] || 0) + 1;
      actions.push({ path, action: "exclude", reason });
      continue;
    }
    const transformed = transformRecord(record);
    const digest = sourceRecordHash(record);
    retainedByRoot[root] = (retainedByRoot[root] || 0) + 1;
    for (const id of transformed.transformed) transformedByRule[id] = (transformedByRule[id] || 0) + 1;
    actions.push({ path, action: transformed.transformed.length ? "create-transformed" : "create", sourceHash: digest, targetHash: sha256({ path, fields: transformed.fields }), transforms: transformed.transformed });
  }

  if (actions.length !== records.length) invariantProblems.push("action count differs from source document count");
  if (actions.filter(item => item.action.startsWith("create")).length + actions.filter(item => item.action === "exclude").length !== records.length) invariantProblems.push("retained and excluded action counts do not reconcile");
  const destinationRecords = [...(destinationInventory.records || [])].sort((a, b) => fullPath(a).localeCompare(fullPath(b)));
  if (destinationRecords.length || destinationPlaceholders.length) invariantProblems.push("initial production bootstrap requires an empty destination inventory");
  const destinationConflicts = destinationRecords.map(fullPath).filter(path => seen.has(path));
  if (destinationConflicts.length) invariantProblems.push(`destination already contains ${destinationConflicts.length} planned document path(s)`);

  const sourceHash = sourceStateHash(sourceInventory);
  const menuCatalogue = menuCatalogueSourceIdentity(records);
  if (menuCatalogue.sourceRecordCount > 0 && !menuCatalogue.matchesHead) invariantProblems.push("Menu Planning catalogue manifest sourceHash does not match the publisher's dish-only catalogue source identity");
  const destinationHash = sourceStateHash(destinationInventory);
  const retainedCount = actions.filter(item => item.action.startsWith("create")).length;
  const excludedCount = actions.filter(item => item.action === "exclude").length;
  const planCore = {
    schema: PLAN_SCHEMA,
    sourceProject: SOURCE_PROJECT,
    destinationProject: DESTINATION_PROJECT,
    sourceHash,
    menuCatalogue,
    destinationHash,
    sourcePlaceholders,
    destinationPlaceholders,
    sourceDocumentCount: records.length,
    destinationDocumentCount: destinationRecords.length,
    destinationBaseline: destinationRecords.map(record => ({ path: fullPath(record), hash: sourceRecordHash(record) })),
    retainedCount,
    excludedCount,
    retainedByRoot,
    excludedByReason,
    transformedByRule,
    transforms: TRANSFORMS,
    exclusionRules: EXCLUSION_RULES,
    actions,
    invariantProblems,
  };
  return { ...planCore, planHash: sha256(planCore) };
}

export function verifySavedPlan(saved, freshPlan, args, env) {
  if (!saved || typeof saved !== "object" || !saved.planHash) throw new Error("Saved plan is missing its approved planHash.");
  const { planHash, ...body } = saved;
  const recomputed = sha256(body);
  if (recomputed !== planHash) throw new Error("Saved plan body does not match its embedded planHash.");
  if (recomputed !== freshPlan.planHash) throw new Error("Saved plan body differs from the freshly generated plan.");
  assertApproval(freshPlan, args, env);
  return freshPlan;
}

export function validateJournal(journal, plan) {
  if (!journal || journal.schema !== "fika-firestore-bootstrap-journal.v1" || journal.planHash !== plan.planHash || journal.sourceProject !== plan.sourceProject || journal.destinationProject !== plan.destinationProject) throw new Error("Journal identity does not match this plan and project pair.");
  if (!journal.entries || typeof journal.entries !== "object" || Array.isArray(journal.entries)) throw new Error("Journal entries are malformed.");
  const allowed = new Map(plan.actions.filter(item => item.action.startsWith("create")).map(item => [item.path, item]));
  for (const [path, entry] of Object.entries(journal.entries)) {
    const action = allowed.get(path);
    if (!action || !entry || entry.path !== path || entry.sourceHash !== action.sourceHash || entry.targetHash !== action.targetHash || !Array.isArray(entry.transforms) || sha256(entry.transforms) !== sha256(action.transforms) || !["verified-existing-identical", "created-and-verified"].includes(entry.status)) throw new Error(`Journal entry is invalid or unauthorized at ${path}.`);
  }
  return journal.entries;
}

export function assertApproval(plan, args, env) {
  if (!args.apply) throw new Error("Apply requires the explicit --apply flag.");
  if (plan.invariantProblems.length) throw new Error(`invariantProblems must be [] before apply: ${plan.invariantProblems.join("; ")}`);
  if (args.planHash !== plan.planHash) throw new Error("--plan-hash must match the freshly generated planHash.");
  if (env.FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH !== plan.planHash) throw new Error("FIKA_FIRESTORE_BOOTSTRAP_APPROVED_PLAN_HASH must equal the reviewed planHash.");
  if (plan.sourceProject !== SOURCE_PROJECT || plan.destinationProject !== DESTINATION_PROJECT) throw new Error("Refusing project pair mismatch.");
}

export async function applyPlan(plan, adapters, journal = {}) {
  if (plan.invariantProblems.length) throw new Error("invariantProblems must be [] before apply.");
  for (const action of plan.actions) {
    if (!action.action.startsWith("create")) continue;
    const record = await adapters.readSource(action.path);
    if (!record || sourceRecordHash(record) !== action.sourceHash) throw new Error(`Source drift at ${action.path}; regenerate and re-review the plan.`);
    const transformed = transformRecord(record);
    if (sha256({ path: action.path, fields: transformed.fields }) !== action.targetHash) throw new Error(`Transform drift at ${action.path}; regenerate and re-review the plan.`);
    const existing = await adapters.readDestination(action.path);
    if (existing) {
      if (sha256({ path: action.path, fields: existing.fields || {} }) !== action.targetHash) throw new Error(`Create-only conflict at ${action.path}; destination differs.`);
      journal[action.path] = { path: action.path, sourceHash: action.sourceHash, targetHash: action.targetHash, transforms: action.transforms, status: "verified-existing-identical" };
      await adapters.saveJournal?.(journal);
      continue;
    }
    await adapters.createDestination(action.path, transformed.fields);
    const verified = await adapters.readDestination(action.path);
    if (!verified || sha256({ path: action.path, fields: verified.fields || {} }) !== action.targetHash) throw new Error(`Post-write verification failed at ${action.path}.`);
    journal[action.path] = { path: action.path, sourceHash: action.sourceHash, targetHash: action.targetHash, transforms: action.transforms, status: "created-and-verified" };
    await adapters.saveJournal?.(journal);
  }
  return journal;
}

export function validateResumableDestination(plan, inventory) {
  if (inventory.project !== DESTINATION_PROJECT) throw new Error(`Expected destination project ${DESTINATION_PROJECT}.`);
  const expected = new Map(plan.destinationBaseline.map(item => [item.path, item.hash]));
  const allowedNew = new Map(plan.actions.filter(item => item.action.startsWith("create")).map(item => [item.path, item.targetHash]));
  for (const record of inventory.records || []) {
    const path = fullPath(record);
    const actual = sha256({ path, fields: record.fields || {} });
    if (expected.has(path)) {
      if (sourceRecordHash(record) !== expected.get(path)) throw new Error(`Destination baseline drift at ${path}.`);
      expected.delete(path);
      continue;
    }
    if (!allowedNew.has(path) || actual !== allowedNew.get(path)) throw new Error(`Unexpected or differing destination document at ${path}.`);
    allowedNew.delete(path);
  }
  if (expected.size) throw new Error(`Destination baseline documents are missing: ${[...expected.keys()].slice(0, 5).join(", ")}.`);
  return { verifiedBaselineDocuments: plan.destinationBaseline.length, verifiedResumedDocuments: plan.actions.filter(item => item.action.startsWith("create")).length - allowedNew.size };
}

export function verifyFinalDestination(plan, inventory) {
  if (inventory.project !== DESTINATION_PROJECT) throw new Error(`Expected destination project ${DESTINATION_PROJECT}.`);
  const placeholders = [...(inventory.placeholders || [])].map(item => typeof item === "string" ? item : item.path);
  if (placeholders.length) throw new Error(`Final destination contains ${placeholders.length} missing-parent placeholder(s).`);
  const expected = new Map();
  for (const item of plan.destinationBaseline) expected.set(item.path, { kind: "baseline", hash: item.hash });
  for (const action of plan.actions.filter(item => item.action.startsWith("create"))) expected.set(action.path, { kind: "planned", hash: action.targetHash });
  const seen = new Set();
  for (const record of inventory.records || []) {
    const path = fullPath(record);
    if (!path || seen.has(path)) throw new Error(`Final destination has a missing or duplicate document path: ${path || "<missing>"}.`);
    seen.add(path);
    const item = expected.get(path);
    if (!item) throw new Error(`Final destination contains an unexpected document at ${path}.`);
    const actual = item.kind === "baseline" ? sourceRecordHash(record) : sha256({ path, fields: record.fields || {} });
    if (actual !== item.hash) throw new Error(`Final destination document differs from the plan at ${path}.`);
    expected.delete(path);
  }
  if (expected.size) throw new Error(`Final destination is missing planned document(s): ${[...expected.keys()].slice(0, 5).join(", ")}.`);
  return { verifiedDocumentCount: seen.size, verifiedPlaceholderCount: 0 };
}

export const planPolicy = { retainedRoots: [...RETAINED_ROOTS].sort(), retainedReasons: RETAIN_REASONS, transforms: TRANSFORMS, exclusions: EXCLUSION_RULES };
