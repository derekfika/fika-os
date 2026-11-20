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
      env.GOOGLE_APPLICATION_CREDENTIALS ||
      [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== stage.projectId)) {
    throw new StudioProblem(503, "RUNTIME_UNAVAILABLE", "The Studio environment is unavailable.");
  }
  return { ...config, ...stage, writes: true, fixture: false };
}

export function assertStudioDraftCommand(action: string, stagedReview = false) {
  if (stagedReview && action === "submit-dish-review") return;
  if (!["save-dish", "save-menu", "restore-draft", "review"].includes(action)) {
    throw new StudioProblem(403, "STUDIO_WRITE_DENIED", "Studio staging only permits draft authoring.");
  }
}

export function stagedStudioSafetyAvailable(env = process.env) {
  return studioRuntime(env).mode === "staging" && env.FIKA_STUDIO_CPU_REVIEW_ENABLED === "true";
}

export function localStudioSafetyAvailable(env = process.env) {
  const config = studioRuntime(env);
  return config.mode === "local" && config.projectId === "demo-fika-os" && !config.fixture &&
    /^(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/.test(env.FIRESTORE_EMULATOR_HOST ?? "");
}

export function localStudioCheckerOrigin(env = process.env): string | undefined {
  if (!localStudioSafetyAvailable(env)) return undefined;
  const value = env.FIKA_STUDIO_CPU_BASE_URL;
  if (!value || !/^http:\/\/(?:localhost|127\.0\.0\.1):[1-9][0-9]{0,4}$/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.port ? url.origin : undefined;
  } catch {
    return undefined;
  }
}
