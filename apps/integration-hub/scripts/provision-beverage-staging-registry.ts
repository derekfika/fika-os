import { GoogleAuth, UserRefreshClient } from "google-auth-library";
import { getFikaRuntimeConfig } from "../lib/runtime-config";

async function main() {
  const args = process.argv.slice(2);
  const execute = args.length === 1 && args[0] === "--execute";
  const env = process.env;
  const runtime = getFikaRuntimeConfig(env);
  if ((args.length && !execute) || env.FIKA_RUNTIME_MODE !== "staging" || env.FIREBASE_PROJECT_ID !== "fika-os-dev" ||
      runtime.projectId !== "fika-os-dev" || [env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(value => value && value !== runtime.projectId) ||
      env.STORAGE_EMULATOR_HOST || env.FIREBASE_STORAGE_EMULATOR_HOST ||
      env.FIKA_SNAPSHOT_BUCKET !== "fika-os-dev-staging-read-packages-europe-west4") {
    throw new Error("This command requires explicit fika-os-dev staging and its governed snapshot bucket.");
  }

  const adc = await new GoogleAuth({ projectId: runtime.projectId, scopes: [
    "openid", "https://www.googleapis.com/auth/userinfo.email", "https://www.googleapis.com/auth/cloud-platform",
  ] }).getClient();
  if (!(adc instanceof UserRefreshClient)) throw new Error("Existing user Application Default Credentials are required.");
  const { token } = await adc.getAccessToken();
  if (!token) throw new Error("The operator credentials are unavailable.");
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { Authorization: `Bearer ${token}` }, redirect: "error", signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Google did not verify the operator credentials.");
  const google = await response.json() as { email?: unknown; email_verified?: unknown; sub?: unknown } | null;
  if (typeof google?.email !== "string" || !google.email.trim() || google.email_verified !== true ||
      typeof google.sub !== "string" || !google.sub) throw new Error("Google did not return a verified person.");
  const { auth } = await import("../lib/firebase-admin");
  const { resolveBeverageRegistryOperator, provisionBeverageStagingRegistry, publishBeverageRegistryReferences } =
    await import("../lib/beverage-staging-registry");
  const operator = resolveBeverageRegistryOperator(google, await auth.getUserByEmail(google.email));
  const result = await provisionBeverageStagingRegistry(operator, execute);
  if (!execute || result.status === "planned") {
    console.log(JSON.stringify({ project: runtime.projectId, mode: "plan", ...result }));
    return;
  }
  try {
    await publishBeverageRegistryReferences(result.application);
  } catch {
    console.error(JSON.stringify({ project: runtime.projectId, status: result.status, auditId: result.auditId, references: "unverified" }));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({ project: runtime.projectId, ...result, references: "current" }));
}

main().catch(() => {
  console.error("Beverage registry command failed. Check the staging target, verified operator authority and existing registry or audit.");
  process.exitCode = 1;
});
