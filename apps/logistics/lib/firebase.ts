import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const host = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host)) throw new Error("Logistics requires the local Firestore emulator.");
process.env.FIRESTORE_EMULATOR_HOST = host;
const existingApp = getApps()[0];
const app = existingApp || initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID || "fika-os-local" });
export const db = getFirestore(app);
if (!existingApp) db.settings({ ignoreUndefinedProperties: true });
