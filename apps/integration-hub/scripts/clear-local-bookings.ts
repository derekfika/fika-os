import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/firebase-admin";

const collections = [
  "fikaBookings",
  "fikaProductionOrders",
  "fikaProductionOrdersV1",
  "fikaProductionRequirements",
  "fikaBookingNotifications",
  "fikaBookingAudit",
] as const;

async function deleteCollection(name: string) {
  const snapshot = await db.collection(name).get();
  for (let index = 0; index < snapshot.docs.length; index += 400) {
    const batch = db.batch();
    snapshot.docs.slice(index, index + 400).forEach((document) => batch.delete(document.ref));
    await batch.commit();
  }
  return snapshot.size;
}

const removed = Object.fromEntries(await Promise.all(collections.map(async (name) => [name, await deleteCollection(name)] as const)));
console.log(`Removed local booking/production records: ${JSON.stringify(removed)}`);

// These are local generated booking artefacts, not Canon/reference data.
const workspaceRoot = path.resolve(process.cwd(), "..", "..");
const localFiles = [
  path.join(workspaceRoot, "apps", "cpu-production", "local-data", "cpu-production", "plans.json"),
  path.join(workspaceRoot, "apps", "hospitality-booking", "local-data", "hospitality-booking", "menu-outputs.json"),
];
for (const file of localFiles) {
  if (fs.existsSync(file)) fs.writeFileSync(file, file.endsWith("plans.json") ? "{}\n" : "[]\n", "utf8");
}
console.log("Cleared local production plans and generated hospitality menu outputs. Reference/catalogue data was not changed.");
