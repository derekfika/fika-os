import { emptyState, ensureDataFolders } from "../lib/repository";
import { db } from "../lib/firebase-admin";

ensureDataFolders();
await db.collection("integrationHub").doc("local-state-v1").set(emptyState());
console.log("Integration Hub local emulator state seeded with synthetic empty data.");
