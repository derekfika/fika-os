import path from "node:path";

const SAFE_PROJECTS = new Set(["fika-os-local", "demo-fika-os"]);
const LOOPBACK = /^(127\.0\.0\.1|localhost):\d+$/;

export function assertLocalSafety(env: NodeJS.ProcessEnv = process.env) {
  const projectId = env.FIREBASE_PROJECT_ID || "fika-os-local";
  const firestoreHost = env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085";
  const authHost = env.FIREBASE_AUTH_EMULATOR_HOST || "127.0.0.1:9099";
  if (!SAFE_PROJECTS.has(projectId)) throw new Error(`Unsafe Firebase project: ${projectId}`);
  if (!LOOPBACK.test(firestoreHost) || !LOOPBACK.test(authHost)) {
    throw new Error("Integration Hub requires loopback Firebase emulators.");
  }
  process.env.FIREBASE_PROJECT_ID = projectId;
  process.env.FIRESTORE_EMULATOR_HOST = firestoreHost;
  process.env.FIREBASE_AUTH_EMULATOR_HOST = authHost;
  return { projectId, firestoreHost, authHost };
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
