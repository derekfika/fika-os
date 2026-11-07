import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";
import { beverageFirestoreHost } from "./runtime";

export const BEVERAGE_LOCAL_PROJECT_DEFAULT = "demo-fika-os";
export const BEVERAGE_DATABASE_LABEL = "beverage-innovation-local";

export function beverageDb() {
  const projectId = process.env.FIREBASE_PROJECT_ID || BEVERAGE_LOCAL_PROJECT_DEFAULT;
  const config = getFikaRuntimeConfig({ ...process.env, FIREBASE_PROJECT_ID: projectId });
  if (config.mode !== "local") throw Object.assign(new Error("Beverage Stage B database writes are disabled outside local development."), { status: 503, code: "BEVERAGE_LOCAL_DATABASE_REQUIRED" });
  const firestoreHost = beverageFirestoreHost();
  // Firebase Admin selects the emulator from this process-level setting. Runtime validation above
  // accepts loopback only and rejects emulator variables in staging or production.
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  const app = getApps().find(candidate => candidate.name === BEVERAGE_DATABASE_LABEL)
    || initializeApp({ projectId: config.projectId }, BEVERAGE_DATABASE_LABEL);
  return getFirestore(app);
}
