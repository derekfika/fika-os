const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT;
const report = {
  catalogue: "not-run" as "rebuilt" | "failed" | "not-run",
  cpu: "not-run" as "rebuilt" | "intentionally absent" | "failed" | "not-run",
  deliveredIn: "not-run" as "rebuilt" | "intentionally absent" | "failed" | "not-run",
};

function guard() {
  if (process.env.FIKA_RUNTIME_MODE !== "staging") throw new Error("Refusing staging rebuild: FIKA_RUNTIME_MODE must be staging.");
  if (projectId !== "fika-os-dev") throw new Error("Refusing staging rebuild: FIREBASE_PROJECT_ID must be exactly fika-os-dev.");
  if (process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Refusing staging rebuild while FIRESTORE_EMULATOR_HOST is set.");
  if (!process.env.FIKA_SNAPSHOT_BUCKET && !process.env.FIREBASE_STORAGE_BUCKET) throw new Error("Refusing staging rebuild: FIKA_SNAPSHOT_BUCKET or FIREBASE_STORAGE_BUCKET must be configured.");
}

guard();

async function main() {
const [{ db }, { listCatalogueEntries }, { cataloguePackageStore }, { publishCataloguePackage }] = await Promise.all([
  import("../../apps/integration-hub/lib/firebase-admin.ts"),
  import("../../apps/menu-planning/lib/catalogue.ts"),
  import("../../apps/menu-planning/lib/catalogue-package-store.ts"),
  import("../../apps/menu-planning/lib/catalogue-read-package.ts"),
]);

try {
  const entries = await listCatalogueEntries();
  await publishCataloguePackage(entries, cataloguePackageStore());
  report.catalogue = "rebuilt";
} catch (error) {
  report.catalogue = "failed";
  console.error(`Catalogue rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
}

const [productionOrders, legacyProductionOrders, fulfilmentRequirements] = await Promise.all([
  db.collection("fikaProductionOrdersV1").get(),
  db.collection("fikaProductionOrders").get(),
  db.collection("fikaFulfilmentRequirementsV1").get(),
]);

if (productionOrders.empty && legacyProductionOrders.empty) report.cpu = "intentionally absent";
else report.cpu = "failed";
if (fulfilmentRequirements.empty) report.deliveredIn = "intentionally absent";
else report.deliveredIn = "failed";

console.log(JSON.stringify({
  "catalogue rebuilt / failed": report.catalogue,
  "CPU derived state rebuilt / intentionally absent": report.cpu,
  "Delivered-In derived state rebuilt / intentionally absent": report.deliveredIn,
}, null, 2));

if (report.catalogue === "failed" || report.cpu === "failed" || report.deliveredIn === "failed") {
  process.exitCode = 1;
}
}

main().catch((error) => {
  console.error(`Staging rebuild failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
