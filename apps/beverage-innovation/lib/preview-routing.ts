export type BeveragePreviewRouteDecision = "pass-through" | "unavailable" | "build-info" | "oploc-read" | "hide-api" | "mock";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);
export const BEVERAGE_PREVIEW_HOST = "beverage-staging.fikacatering.com";
export const BEVERAGE_PREVIEW_OPLOC_PATH = "/api/preview/oplocs";
export const BEVERAGE_STAGING_HUB_ORIGIN = "https://staging-os.fikacatering.com";
export const canonicalPreviewOplocId = /^oploc:[A-Za-z0-9][A-Za-z0-9:_-]{0,153}$/;

export function configuredPreviewOplocIds(env: NodeJS.ProcessEnv = process.env) {
  if (env.FIKA_BEVERAGE_HUB_OPLOC_READS !== "1" || env.FIKA_BEVERAGE_PREVIEW_ONLY !== "1" ||
      env.FIKA_RUNTIME_MODE !== "staging" || env.FIREBASE_PROJECT_ID !== "fika-os-dev" ||
      env.FIKA_HUB_BASE_URL !== BEVERAGE_STAGING_HUB_ORIGIN ||
      env.FIRESTORE_EMULATOR_HOST || env.FIREBASE_AUTH_EMULATOR_HOST ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(project => project && project !== "fika-os-dev")) return undefined;
  const raw = env.FIKA_BEVERAGE_HUB_OPLOC_IDS;
  if (!raw || raw.length > 4096) return undefined;
  const ids = raw.split(",").map(id => id.trim());
  if (ids.length > 100 || ids.some(id => !canonicalPreviewOplocId.test(id)) || new Set(ids).size !== ids.length) return undefined;
  return ids;
}

export function beveragePreviewRouteDecision(pathname: string, hostname: string, env: NodeJS.ProcessEnv = process.env, method = "GET"): BeveragePreviewRouteDecision {
  if (env.FIKA_BEVERAGE_PREVIEW_ONLY !== "1") return "pass-through";
  const local = env.FIKA_RUNTIME_MODE === "local" && ["demo-fika-os", "fika-os-local"].includes(env.FIREBASE_PROJECT_ID || "") &&
    env.FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH === "fixture" && localHosts.has(hostname.toLowerCase());
  const staging = env.FIKA_RUNTIME_MODE === "staging" && env.FIREBASE_PROJECT_ID === "fika-os-dev";
  if (!local && !staging) return "unavailable";
  if (pathname === "/api/build-info") return "build-info";
  if (pathname === BEVERAGE_PREVIEW_OPLOC_PATH && method === "GET" &&
      hostname.toLowerCase() === BEVERAGE_PREVIEW_HOST && configuredPreviewOplocIds(env)) return "oploc-read";
  if (pathname.startsWith("/api/")) return "hide-api";
  return "mock";
}
