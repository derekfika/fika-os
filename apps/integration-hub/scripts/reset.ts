import fs from "node:fs";
import path from "node:path";
import { db } from "../lib/firebase-admin";
import { assertSafeLocalPath, dataRoot } from "../lib/safety";

await db.collection("integrationHub").doc("local-state-v1").delete();
for (const folder of ["uploads", "snapshots", "generated-reports", "quarantine"]) {
  const target = assertSafeLocalPath(path.join(dataRoot(), folder));
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
}
console.log("Only Integration Hub local emulator state and local-data working folders were reset.");
