import { sessionCookieConfig } from "@fika/server-shared/runtime-config";
import { StudioProblem } from "./problem";

const cloudTargets = {
  staging: { projectId: "fika-os-dev", hub: "https://staging-os.fikacatering.com" },
  production: { projectId: "fika-os", hub: "https://os.fikacatering.com" },
};

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
      writes: true,
      fixture: env.NODE_ENV === "development" && config.projectId === "demo-fika-os" && env.FIKA_STUDIO_LOCAL_PREVIEW === "1",
    };
  }

  const expected = cloudTargets[config.mode];
  if (config.projectId !== expected.projectId || hub !== expected.hub || env.FIKA_STUDIO_LOCAL_PREVIEW) {
    throw new StudioProblem(503, "RUNTIME_UNAVAILABLE", "The Studio environment is unavailable.");
  }
  // Operational writes remain unavailable until the isolated writer and
  // separate Studio authority are verified. Configuration cannot enable them.
  return { ...config, hub, writes: false, fixture: false };
}
