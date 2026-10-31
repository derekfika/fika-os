import { FOOD_DATASETS, type FoodDataset } from "./manifest";

/** Pinned import snapshot. Changing it is a deliberate configuration change, never an automatic "latest" lookup. */
export const DEFAULT_FOOD_DATA_BUCKET = "fika-os-dev-kafoodle-catalogue-europe-west4";
export const DEFAULT_FOOD_DATA_PREFIX = "kafoodle/v1/2026-10-31/";
/** AUTHMOD authority required to read any Food Data. Pack prices are inside the bundle, so this grant covers them. */
export const FOOD_DATA_GRANT = { appId: "integration-hub", resource: "food-data.catalogue", action: "View" } as const;

export type FoodDataConfig = { enabled: boolean; bucket: string; prefix: string };

/**
 * Staging/local only. Production is never enabled, even if the variable is set, and
 * FIKA_FOOD_DATA_ENABLED=false is a kill switch for staging.
 */
export function foodDataConfig(env: Record<string, string | undefined> = process.env): FoodDataConfig {
  const mode = env.FIKA_RUNTIME_MODE || "local";
  const prefix = (env.FIKA_FOOD_DATA_PREFIX || DEFAULT_FOOD_DATA_PREFIX).replace(/^\/+/, "");
  const safePrefix = /^[A-Za-z0-9._/-]+\/$/.test(prefix) && !prefix.includes("..") ? prefix : "";
  return {
    enabled: (mode === "staging" || mode === "local") && env.FIKA_FOOD_DATA_ENABLED !== "false" && Boolean(safePrefix),
    bucket: env.FIKA_FOOD_DATA_BUCKET || DEFAULT_FOOD_DATA_BUCKET,
    prefix: safePrefix,
  };
}

export const isFoodDataset = (value: string): value is FoodDataset => (FOOD_DATASETS as readonly string[]).includes(value);
