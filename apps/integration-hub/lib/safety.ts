import path from "node:path";
import { getFikaRuntimeConfig } from "./runtime-config";

export function assertLocalSafety(env: NodeJS.ProcessEnv = process.env) {
  const runtime = getFikaRuntimeConfig(env);
  if (runtime.mode !== "local") throw new Error("This operation is local-development only.");
  process.env.FIREBASE_PROJECT_ID = runtime.projectId;
  process.env.FIRESTORE_EMULATOR_HOST = runtime.firestoreHost;
  if (runtime.authMode !== "emulator" || !runtime.authHost) throw new Error("Local synthetic authentication requires the Firebase Auth emulator.");
  process.env.FIREBASE_AUTH_EMULATOR_HOST = runtime.authHost;
  return { projectId: runtime.projectId, firestoreHost: runtime.firestoreHost, authHost: runtime.authHost };
}

export function dataRoot() {
  const configured = process.env.INTEGRATION_HUB_DATA_ROOT;
  return path.resolve(configured || path.join(process.cwd(), "..", "..", "local-data", "integration-hub"));
}

export function assertSafeLocalPath(candidate: string) {
  const root = dataRoot();
  const resolved = path.resolve(candidate);
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new Error("Refusing to access data outside the Integration Hub local-data boundary.");
  }
  return resolved;
}
