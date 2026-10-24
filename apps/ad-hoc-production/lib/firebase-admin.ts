import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";

// Ad-Hoc's own datastore access: its request collection only. Production
// Orders, fulfilment and CPU/Logistics data are never read or written here;
// they belong to the Hub and are reached over HTTP (see hub-client.ts).
const runtime = getFikaRuntimeConfig();
if (runtime.mode === "local") process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
const app = getApps().find(candidate => candidate.name === "[DEFAULT]") || initializeApp({ projectId: runtime.projectId });
export const db = getFirestore(app);
if (getApps().length === 1) db.settings({ ignoreUndefinedProperties: true });
