import { getFikaRuntimeConfig } from "@fika/server-shared/runtime-config";
import { approvedCredentialedUpstream } from "@fika/server-shared/credentialed-upstream";
type RuntimeEnv = Record<string, string | undefined>;

export function logisticsRuntime(env: RuntimeEnv = process.env) {
  return getFikaRuntimeConfig(env);
}

export function hostedRuntime(env: RuntimeEnv = process.env) {
  return ["staging", "production"].includes(logisticsRuntime(env).mode);
}

export function requiredUpstreamUrl(name: "FIKA_HUB_BASE_URL" | "FIKA_CPU_BASE_URL", env: RuntimeEnv = process.env) {
  const value = env[name]?.trim();
  if (value) {
    let normalised: string;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" && hostedRuntime(env)) throw new Error(`${name} must use HTTPS outside local development.`);
      normalised = url.toString().replace(/\/$/, "");
    } catch (error) {
      if (error instanceof Error && error.message.includes("must use HTTPS")) throw error;
      throw new Error(`${name} is not a valid upstream URL.`);
    }
    return approvedCredentialedUpstream(name === "FIKA_HUB_BASE_URL" ? "hub" : "cpu", normalised, env.FIKA_RUNTIME_MODE);
  }
  if (hostedRuntime(env)) throw new Error(`${name} is required in hosted Logistics runtime.`);
  return name === "FIKA_HUB_BASE_URL" ? "http://localhost:3200" : "http://localhost:3400";
}
