import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "./runtime-config";

const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") {
  process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  if (runtime.authMode === "emulator") process.env.FIREBASE_AUTH_EMULATOR_HOST = runtime.authHost;
}
const defaultApp = getApps().find(candidate => candidate.name === "[DEFAULT]") || initializeApp({ projectId: runtime.projectId });
const authApp = runtime.authMode === "cloud"
  ? getApps().find(candidate => candidate.name === "fika-auth") || initializeApp({ projectId: runtime.authProjectId }, "fika-auth")
  : defaultApp;

export const auth = getAuth(authApp);
export const db = getFirestore(defaultApp);
if (defaultApp.name === "[DEFAULT]") db.settings({ ignoreUndefinedProperties: true });
