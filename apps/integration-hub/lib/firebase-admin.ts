import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "./runtime-config";

const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") {
  process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  if (runtime.authMode === "emulator") process.env.FIREBASE_AUTH_EMULATOR_HOST = runtime.authHost;
}
const existingDefaultApp = getApps().find(candidate => candidate.name === "[DEFAULT]");
const defaultApp = existingDefaultApp || initializeApp({ projectId: runtime.projectId });
const authApp = runtime.authMode === "cloud"
  ? getApps().find(candidate => candidate.name === "fika-auth") || initializeApp({ projectId: runtime.authProjectId }, "fika-auth")
  : defaultApp;

export const auth = getAuth(authApp);
if (!existingDefaultApp) getFirestore(defaultApp).settings({ ignoreUndefinedProperties: true });
export const db = getFirestore(defaultApp);
