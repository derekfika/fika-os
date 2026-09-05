import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";

const require = createRequire(import.meta.url);
const { initializeApp, getApps } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");

const RESET_COLLECTIONS = [
  "fikaBookings",
  "fikaBookingAudit",
  "fikaBookingNotifications",
  "fikaProductionOrders",
  "fikaProductionOrdersV1",
  "fikaProductionRequirements",
  "fikaFulfilmentRequirementsV1",
  "fikaMenuPlanningWeeks",
  "fikaMenuPlanningPublications",
  "fikaMenuPlanningEvents",
  "fikaMenuPlanningOutbox",
  "fikaMenuPlanningPublishedSnapshots",
  "fikaLogisticsDeliveryRunsV1",
  "fikaLogisticsMovementRequestsV1",
  "fikaLogisticsDeliveryStopsV1",
  "fikaLogisticsCollectionPreferencesV1",
  "fikaDomainEventInboxV1",
  "fikaDomainEventsV1",
];

const PRESERVED_COLLECTIONS = [
  "authmodIdentities",
  "authmodAppAssignments",
  "authmodSiteAssignments",
  "authmodAuthorityGrants",
  "authmodAuthorityEvents",
  "integrationHubCanonical",
  "integrationHubCanonicalRevisions",
  "integrationHubSourceMappings",
  "integrationHubGovernanceAudit",
  "fikaAddresses",
  "fikaServiceArrangementsV1",
  "fikaServiceDefinitionsV1",
  "fikaMenuPlanningCatalogue",
  "fikaMenuPlanningCatalogueManifests",
];

const args = new Set(process.argv.slice(2));
const confirmReset = args.has("--confirm-staging-reset");
const rebuildCommandIndex = process.argv.indexOf("--rebuild-command");
const rebuildCommand = rebuildCommandIndex >= 0 ? process.argv[rebuildCommandIndex + 1] : undefined;
const runtimeMode = process.env.FIKA_RUNTIME_MODE;
const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;

if (runtimeMode !== "staging") throw new Error("Refusing staging reset: set FIKA_RUNTIME_MODE=staging explicitly.");
if (projectId !== "fika-os-dev") throw new Error("Refusing staging reset: FIREBASE_PROJECT_ID must be exactly fika-os-dev.");
if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing staging reset while FIRESTORE_EMULATOR_HOST is set.");
if (!confirmReset) {
  console.log("DRY RUN: no staging data will be changed.");
} else if (!rebuildCommand) {
  throw new Error("Refusing destructive reset without --rebuild-command <approved rebuild command>.");
}

if (!getApps().length) initializeApp({ projectId });
const db = getFirestore();

async function countCollection(name) {
  const snapshot = await db.collection(name).get();
  return snapshot.size;
}

const counts = {};
for (const name of RESET_COLLECTIONS) counts[name] = await countCollection(name);
console.log(JSON.stringify({ projectId, mode: confirmReset ? "DESTRUCTIVE" : "DRY_RUN", resetCollections: counts, preservedCollections: PRESERVED_COLLECTIONS, preservedStoragePrefixes: ["snapshots/integration-hub/", "snapshots/menu-planning/catalogue/", "snapshots/cpu-production/", "snapshots/delivered-in/"], note: "Collections and storage prefixes not explicitly listed are not touched." }, null, 2));

if (!confirmReset) process.exit(0);

for (const name of RESET_COLLECTIONS) {
  await db.recursiveDelete(db.collection(name));
  console.log(`Deleted staging operational collection: ${name}`);
}

console.log("Operational reset complete. Running the explicitly supplied derived-data rebuild command.");
execFileSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", rebuildCommand], { stdio: "inherit", windowsHide: true });
console.log("Staging reset and derived-data rebuild command completed.");
