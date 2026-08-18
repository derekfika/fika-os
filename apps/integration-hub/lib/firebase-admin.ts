import { getApps, initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { assertLocalSafety } from "./safety";

const local = assertLocalSafety();
const existingApp = getApps()[0];
const app = existingApp || initializeApp({ projectId: local.projectId });

export const auth = getAuth(app);
export const db = getFirestore(app);
if (!existingApp) db.settings({ ignoreUndefinedProperties: true });
