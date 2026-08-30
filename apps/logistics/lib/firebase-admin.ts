import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";

const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
const existingDefaultApp = getApps().find(candidate => candidate.name === "[DEFAULT]");
const defaultApp = existingDefaultApp || initializeApp({ projectId: runtime.projectId });
if (!existingDefaultApp) getFirestore(defaultApp).settings({ ignoreUndefinedProperties: true });
export const db = getFirestore(defaultApp);
