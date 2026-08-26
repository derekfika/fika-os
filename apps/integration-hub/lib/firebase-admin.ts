import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "./runtime-config";

const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") {
  process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = runtime.authHost;
}
const existingApp = getApps()[0];
const app = existingApp || initializeApp({ projectId: runtime.projectId });

export const auth = getAuth(app);
export const db = getFirestore(app);
if (!existingApp) db.settings({ ignoreUndefinedProperties: true });
