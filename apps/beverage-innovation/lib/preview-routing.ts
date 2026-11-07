export type BeveragePreviewRouteDecision = "pass-through" | "unavailable" | "build-info" | "hide-api" | "mock";

const localHosts = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function beveragePreviewRouteDecision(pathname: string, hostname: string, env: NodeJS.ProcessEnv = process.env): BeveragePreviewRouteDecision {
  if (env.FIKA_BEVERAGE_PREVIEW_ONLY !== "1") return "pass-through";
  const local = env.FIKA_RUNTIME_MODE === "local" && ["demo-fika-os", "fika-os-local"].includes(env.FIREBASE_PROJECT_ID || "") &&
    env.FIKA_BEVERAGE_PREVIEW_LOCAL_AUTH === "fixture" && localHosts.has(hostname.toLowerCase());
  const staging = env.FIKA_RUNTIME_MODE === "staging" && env.FIREBASE_PROJECT_ID === "fika-os-dev";
  if (!local && !staging) return "unavailable";
  if (pathname === "/api/build-info") return "build-info";
  if (pathname.startsWith("/api/")) return "hide-api";
  return "mock";
}
