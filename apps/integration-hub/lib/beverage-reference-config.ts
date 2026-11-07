import { getFikaRuntimeConfig } from "./runtime-config";
import { DEFAULT_FOOD_DATA_BUCKET } from "./food-data/config";

const AUDIENCE = "https://staging-os.fikacatering.com/api/internal/beverage/reference";
export type BeverageReferenceConfig = {
  audience: string;
  callerSubject: string;
  callerEmail: string;
  food?: { bucket: string; prefix: string; version: string };
};

export function beverageReferenceConfig(env: Record<string, string | undefined> = process.env): BeverageReferenceConfig | undefined {
  if (env.FIKA_BEVERAGE_REFERENCE_ENABLED !== "true" || env.FIKA_RUNTIME_MODE !== "staging") return undefined;
  if ([env.GCLOUD_PROJECT, env.GOOGLE_CLOUD_PROJECT].some(project => project && project !== "fika-os-dev")) return undefined;
  try {
    if (getFikaRuntimeConfig(env).projectId !== "fika-os-dev") return undefined;
  } catch { return undefined; }
  const callerSubject = env.FIKA_BEVERAGE_REFERENCE_CALLER_SUBJECT;
  const callerEmail = env.FIKA_BEVERAGE_REFERENCE_CALLER_EMAIL;
  if (!callerSubject || !/^\d{15,30}$/.test(callerSubject) ||
      !callerEmail || !/^[a-z][a-z0-9-]{4,29}@fika-os-dev\.iam\.gserviceaccount\.com$/.test(callerEmail) ||
      env.FIKA_BEVERAGE_REFERENCE_AUDIENCE !== AUDIENCE) return undefined;

  const bucket = env.FIKA_BEVERAGE_FOOD_DATA_BUCKET;
  const version = env.FIKA_BEVERAGE_FOOD_DATA_VERSION;
  const snapshot = /^(\d{4}-\d{2}-\d{2}):[a-f0-9]{64}$/.exec(version || "")?.[1];
  const day = snapshot ? new Date(`${snapshot}T00:00:00.000Z`) : undefined;
  const validSnapshot = day && Number.isFinite(day.getTime()) && day.toISOString().slice(0, 10) === snapshot;
  const food = env.FIKA_FOOD_DATA_ENABLED !== "false" && bucket === DEFAULT_FOOD_DATA_BUCKET && version && validSnapshot
    ? { bucket, prefix: `kafoodle/v1/${snapshot}/`, version } : undefined;
  return { audience: AUDIENCE, callerSubject, callerEmail, food };
}
