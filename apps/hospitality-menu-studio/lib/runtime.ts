import { sessionCookieConfig } from "@fika/server-shared/runtime-config";
import { StudioProblem } from "./problem";

const stage = {
  projectId: "fika-os-dev",
  hub: "https://staging-os.fikacatering.com",
  origin: "https://menu-studio-staging.fikacatering.com",
  databaseId: "hospitality-menu-studio",
} as const;

export function studioRuntime(env = process.env) {
  let config: ReturnType<typeof sessionCookieConfig>;
  try { config = sessionCookieConfig(env); }
  catch { throw new StudioProblem(503, "RUNTIME_UNAVAILABLE", "The Studio environment is unavailable."); }

  const hub = env.FIKA_HUB_BASE_URL;
  if (config.mode === "local") {
    if (config.authMode !== "emulator" || (hub && !/^http:\/\/(?:localhost|127\.0\.0\.1):\d+$/.test(hub))) {
      throw new StudioProblem(503, "RUNTIME_UNAVAILABLE", "Local Studio requires loopback dependencies.");
    }
    return {
      ...config,
      hub: hub || "http://localhost:3100",
      databaseId: "(default)",
      writes: true,
      fixture: env.NODE_ENV === "development" && config.projectId === "demo-fika-os" && env.FIKA_STUDIO_LOCAL_PREVIEW === "1",
    };
  }

  if (config.mode !== "staging" || config.projectId !== stage.projectId || hub !== stage.hub ||
      env.FIKA_STUDIO_ORIGIN !== stage.origin || env.FIKA_STUDIO_FIRESTORE_DATABASE !== stage.databaseId ||
      config.domain !== ".fikacatering.com" || env.FIKA_STUDIO_LOCAL_PREVIEW ||
      (env.GCLOUD_PROJECT && env.GCLOUD_PROJECT !== stage.projectId)) {
    throw new StudioProblem(503, "RUNTIME_UNAVAILABLE", "The Studio environment is unavailable.");
  }
  // Operational writes remain unavailable until the isolated writer and
  // separate Studio authority are verified. Configuration cannot enable them.
  return { ...config, ...stage, writes: false, fixture: false };
}
