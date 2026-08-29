import { URL } from "node:url";

type HubEnvironment = Record<string, string | undefined>;

export function getHubBaseUrl(env: HubEnvironment = process.env) {
  const mode = env.FIKA_RUNTIME_MODE || (env.NODE_ENV === "production" ? "production" : "local");
  const configured = env.FIKA_HUB_BASE_URL?.trim();
  if (mode === "local") return (configured || "http://localhost:3200").replace(/\/$/, "");
  if (mode !== "staging" && mode !== "production") throw new Error(`Unsupported FIKA_RUNTIME_MODE '${mode}'.`);
  if (!configured) throw Object.assign(new Error("FIKA_HUB_BASE_URL is required in hosted CPU Production runtime."), { status: 503, code: "CPU_HUB_URL_NOT_CONFIGURED" });
  let parsed: URL;
  try { parsed = new URL(configured); } catch { throw Object.assign(new Error("FIKA_HUB_BASE_URL must be a valid HTTPS URL in hosted CPU Production runtime."), { status: 503, code: "CPU_HUB_URL_INVALID" }); }
  if (parsed.protocol !== "https:") throw Object.assign(new Error("FIKA_HUB_BASE_URL must use HTTPS in hosted CPU Production runtime."), { status: 503, code: "CPU_HUB_URL_INVALID" });
  return configured.replace(/\/$/, "");
}
