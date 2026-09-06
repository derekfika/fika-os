import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const { getStorage } = require("firebase-admin/storage");

// Explicit staging-UAT policy. Unknown collections and prefixes are never touched.
const PRESERVE_COLLECTIONS = [
  "authmodIdentities", "authmodAppAssignments", "authmodSiteAssignments", "authmodAuthorityGrants", "authmodAuthorityEvents",
  "integrationHubCanonical", "integrationHubCanonicalRevisions", "integrationHubSourceMappings", "integrationHubGovernanceAudit",
  "fikaAddresses", "fikaServiceArrangementsV1", "fikaServiceDefinitionsV1", "fikaMenuPlanningCatalogue", "fikaMenuPlanningCatalogueManifests",
  // Reusable planning source/history is preserved for Duplicate Week and historic UAT reference.
  "fikaMenuPlanningWeeks",
  // Audit/evidence is deliberately preserved.
  "fikaBookingAudit",
];

const DELETE_COLLECTIONS = [
  "fikaBookings", "fikaBookingNotifications", "fikaProductionOrders", "fikaProductionOrdersV1", "fikaProductionRequirements",
  "fikaFulfilmentRequirementsV1", "fikaCpuProductionPlansV1", "fikaCpuProductionChangesV1", "fikaCpuProductionChangeCursorV1", "fikaCpuProductionChangeReceiptsV1", "fikaCpuProductionDayProjectionsV1", "fikaDeliveredInAllergenSafetyV1", "fikaDeliveredInSiteMenusV1", "fikaMenuPlanningPublications", "fikaMenuPlanningEvents", "fikaMenuPlanningOutbox", "fikaMenuPlanningPublishedSnapshots",
  "fikaLogisticsDeliveryRunsV1", "fikaLogisticsMovementRequestsV1", "fikaLogisticsDeliveryStopsV1", "fikaLogisticsCollectionPreferencesV1",
  "fikaDomainEventInboxV1", "fikaDomainEventsV1",
];

const CLEAR_DERIVED_STORAGE = [
  "snapshots/cpu-production/projection-week/", "snapshots/cpu-production/projection-day/", "snapshots/cpu-production/delivered-in-review/",
  "snapshots/cpu-production/daily-signed-oploc-bundle/", "delivered-in/day/", "delivered-in/projection-index/", "snapshots/menu-planning/catalogue/",
  "manifests/cpu-production_projection-week", "manifests/cpu-production_projection-day", "manifests/cpu-production_delivered-in-review",
  "manifests/cpu-production_daily-signed-oploc-bundle", "manifests/delivered-in_day", "manifests/delivered-in_projection-index", "manifests/menu-planning_catalogue",
];

const REBUILD_AFTER_RESET = [
  "Menu Planning catalogue package from preserved fikaMenuPlanningCatalogue via GET /api/catalogue",
  "CPU weekly/day projection packages from post-reset operational state",
  "Delivered-In projection/index packages from post-reset CPU/current state",
];

const PRESERVE_STORAGE = [
  "Integration Hub reference/read packages and canonical/reference materialisations",
  "CPU-owned Grab & Go catalogue package",
  "Any storage object not matching CLEAR_DERIVED_STORAGE",
];

const args = new Set(process.argv.slice(2));
const confirmReset = args.has("--confirm-staging-reset");
const hardResetPlanningHistory = args.has("--hard-reset-planning-history");
const rebuildCommandIndex = process.argv.indexOf("--rebuild-command");
const rebuildCommand = rebuildCommandIndex >= 0 ? process.argv[rebuildCommandIndex + 1] : undefined;
const runtimeMode = process.env.FIKA_RUNTIME_MODE;
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

if (runtimeMode !== "staging") throw new Error("Refusing staging reset: set FIKA_RUNTIME_MODE=staging explicitly.");
if (projectId !== "fika-os-dev") throw new Error("Refusing staging reset: FIREBASE_PROJECT_ID must be exactly fika-os-dev.");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing staging reset while FIRESTORE_EMULATOR_HOST is set.");
if (confirmReset && !rebuildCommand) throw new Error("Refusing destructive reset without --rebuild-command <approved rebuild command>.");
if (hardResetPlanningHistory && !confirmReset) throw new Error("Refusing hard planning-history reset without --confirm-staging-reset.");

console.log(JSON.stringify({
  projectId, mode: confirmReset ? "DESTRUCTIVE" : "DRY_RUN",
  PRESERVE: { collections: PRESERVE_COLLECTIONS, storage: PRESERVE_STORAGE },
  DELETE: { collections: DELETE_COLLECTIONS, decision: "Operational bookings, publications, events and downstream state are reset; fikaBookingAudit and all fikaMenuPlanningWeeks remain preserved by default." },
  "HARD RESET ONLY": { collection: "fikaMenuPlanningWeeks", flag: "--hard-reset-planning-history", decision: "Only this separate mode may delete reusable planning-source/history data, and it requires both --confirm-staging-reset and --hard-reset-planning-history." },
  "CLEAR DERIVED STORAGE": CLEAR_DERIVED_STORAGE,
  "REBUILD AFTER RESET": REBUILD_AFTER_RESET,
  "UNKNOWN / NOT TOUCHED": "Every collection, document, storage object and prefix not explicitly listed above.",
}, null, 2));

if (!getApps().length) initializeApp({ projectId, storageBucket: process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET });
const db = getFirestore();
const bucketName = process.env.FIKA_SNAPSHOT_BUCKET || process.env.FIREBASE_STORAGE_BUCKET;

async function countCollection(name) { return (await db.collection(name).get()).size; }
async function countStoragePrefix(bucket, prefix) { return (await bucket.getFiles({ prefix }))[0].length; }

const counts = { DELETE: {}, PRESERVE: {}, "CLEAR DERIVED STORAGE": {} };
try {
  for (const name of DELETE_COLLECTIONS) counts.DELETE[name] = await countCollection(name);
  for (const name of PRESERVE_COLLECTIONS) counts.PRESERVE[name] = await countCollection(name);
  if (!bucketName) throw new Error("FIKA_SNAPSHOT_BUCKET/FIREBASE_STORAGE_BUCKET is not configured.");
  const bucket = getStorage().bucket(bucketName);
  for (const prefix of CLEAR_DERIVED_STORAGE) counts["CLEAR DERIVED STORAGE"][prefix] = await countStoragePrefix(bucket, prefix);
  console.log(JSON.stringify({ counts }, null, 2));
} catch (error) {
  console.error(`COUNTS UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}`);
  if (confirmReset) throw error;
  process.exit(0);
}

if (!confirmReset) process.exit(0);
for (const name of DELETE_COLLECTIONS) await db.recursiveDelete(db.collection(name));
if (hardResetPlanningHistory) await db.recursiveDelete(db.collection("fikaMenuPlanningWeeks"));
const bucket = getStorage().bucket(bucketName);
for (const prefix of CLEAR_DERIVED_STORAGE) {
  const [files] = await bucket.getFiles({ prefix });
  for (const file of files) await file.delete({ ignoreNotFound: true });
}
console.log("Operational state and derived storage cleared. Running the explicitly supplied rebuild command.");
execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", rebuildCommand], { stdio: "inherit", windowsHide: true });
console.log("Staging reset completed only after the required rebuild command exited successfully.");
