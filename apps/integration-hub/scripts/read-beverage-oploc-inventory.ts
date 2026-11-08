import { getStorage } from "firebase-admin/storage";
import { getFikaRuntimeConfig } from "../lib/runtime-config";

async function main() {
  const env = process.env;
  const runtime = getFikaRuntimeConfig(env);
  if (process.argv.length !== 2 || env.FIKA_RUNTIME_MODE !== "staging" || env.FIREBASE_PROJECT_ID !== "fika-os-dev" ||
      runtime.projectId !== "fika-os-dev" || [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== "fika-os-dev") ||
      env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST) {
    throw new Error("This read-only command requires explicit fika-os-dev staging mode without emulators.");
  }
  const { BEVERAGE_OPLOC_INVENTORY_BUCKET, BeverageOplocInventoryError, readBeverageOplocInventory } = await import("../lib/beverage-oploc-inventory");
  if (env.FIKA_SNAPSHOT_BUCKET !== BEVERAGE_OPLOC_INVENTORY_BUCKET) throw new Error("Select the governed staging OPLOC snapshot bucket.");
  const { db } = await import("../lib/firebase-admin");
  const { readBoundedBeverageObject } = await import("../lib/beverage-reference-object");
  const bucket = getStorage().bucket(BEVERAGE_OPLOC_INVENTORY_BUCKET);
  try {
    const evidence = await readBeverageOplocInventory({
      firestore: db,
      readObject: (name, maxBytes) => readBoundedBeverageObject(bucket.file(name).createReadStream({ decompress: false }), maxBytes),
    });
    console.log(JSON.stringify({ project: runtime.projectId, ...evidence }, null, 2));
  } catch (error) {
    if (!(error instanceof BeverageOplocInventoryError)) throw error;
    console.error(error.message);
    process.exitCode = 1;
  }
}

main().catch(() => {
  console.error("Beverage OPLOC inventory read failed. Verify the staging configuration, read credentials and current canonical package.");
  process.exitCode = 1;
});
