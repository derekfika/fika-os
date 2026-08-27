import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "./runtime-config";
const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
const app = getApps().find(candidate => candidate.name === "[DEFAULT]") || initializeApp({ projectId: runtime.projectId });
export const db = getFirestore(app);
if (getApps().length === 1) db.settings({ ignoreUndefinedProperties: true });
