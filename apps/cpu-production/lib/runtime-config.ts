export type FikaRuntimeMode = "local" | "staging" | "production";
const LOOPBACK = /^(127\.0.0.1|localhost):\d+$/;
const SAFE_LOCAL_PROJECTS = new Set(["fika-os-local", "demo-fika-os"]);
export function getFikaRuntimeConfig(env: Record<string, string | undefined> = process.env) {
  const mode = (env.FIKA_RUNTIME_MODE || "local") as FikaRuntimeMode;
  if (!["local", "staging", "production"].includes(mode)) throw new Error("FIKA_RUNTIME_MODE must be local, staging, or production.");
  const projectId = env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || (mode === "local" ? "fika-os-local" : "");
  if (mode === "local") { if (!SAFE_LOCAL_PROJECTS.has(projectId)) throw new Error(`Unsafe Firebase project: ${projectId}`); const firestoreHost = env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8085"; if (!LOOPBACK.test(firestoreHost)) throw new Error("Local FIKA runtime requires a loopback Firestore emulator."); return { mode, projectId, firestoreHost } as const; }
  if (env.FIRESTORE_EMULATOR_HOST) throw new Error("Firebase emulator configuration is forbidden outside local FIKA runtime mode.");
  if (!projectId) throw new Error("A Firebase project must be configured outside local FIKA runtime mode.");
  return { mode, projectId, firestoreHost: undefined } as const;
}
