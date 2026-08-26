export type FikaRuntimeMode = "local" | "staging" | "production";

const LOOPBACK = /^(127\.0\.0\.1|localhost):\d+$/;
const SAFE_LOCAL_PROJECTS = new Set(["fika-os-local", "demo-fika-os"]);

export function getFikaRuntimeConfig(env: NodeJS.ProcessEnv = process.env) {
  const mode = (env.FIKA_RUNTIME_MODE || "local") as FikaRuntimeMode;
  if (!["local", "staging", "production"].includes(mode)) throw new Error("FIKA_RUNTIME_MODE must be local, staging, or production.");
  const projectId = env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || (mode === "local" ? "fika-os-local" : "");
  const authEmulator = env.FIREBASE_AUTH_EMULATOR_HOST;
  const firestoreEmulator = env.FIRESTORE_EMULATOR_HOST;
  if (mode === "local") {
    if (!SAFE_LOCAL_PROJECTS.has(projectId)) throw new Error(`Unsafe Firebase project: ${projectId}`);
    const authHost = authEmulator || "127.0.0.1:9099";
    const firestoreHost = firestoreEmulator || "127.0.0.1:8085";
    if (!LOOPBACK.test(authHost) || !LOOPBACK.test(firestoreHost)) throw new Error("Local FIKA runtime requires loopback Firebase emulators.");
    return { mode, projectId, authHost, firestoreHost, secureCookies: false } as const;
  }
  if (authEmulator || firestoreEmulator) throw new Error("Firebase emulator configuration is forbidden outside local FIKA runtime mode.");
  if (!projectId) throw new Error("A Firebase project must be configured outside local FIKA runtime mode.");
  return { mode, projectId, authHost: undefined, firestoreHost: undefined, secureCookies: true } as const;
}

export function sessionCookieConfig(env: NodeJS.ProcessEnv = process.env) {
  const runtime = getFikaRuntimeConfig(env);
  const configured = Number(env.FIKA_SESSION_MAX_AGE_SECONDS || 7 * 24 * 60 * 60);
  const maxAge = Number.isFinite(configured) && configured > 0 ? Math.min(Math.floor(configured), 14 * 24 * 60 * 60) : 7 * 24 * 60 * 60;
  const domain = env.FIKA_SESSION_COOKIE_DOMAIN?.trim();
  return { ...runtime, name: "fika_os_session", maxAge, ...(domain && !domain.includes("localhost") ? { domain } : {}) } as const;
}

export function allowedEmailDomains(env: NodeJS.ProcessEnv = process.env) {
  return (env.FIKA_ALLOWED_EMAIL_DOMAINS || "fikacatering.com").split(",").map(value => value.trim().toLowerCase()).filter(Boolean);
}
