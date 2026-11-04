import { FOOD_DATASETS, type FoodDataset } from "./manifest";

/** Pinned import snapshot. Changing it is a deliberate configuration change, never an automatic "latest" lookup. */
export const DEFAULT_FOOD_DATA_BUCKET = "fika-os-dev-kafoodle-catalogue-europe-west4";
export const DEFAULT_FOOD_DATA_PREFIX = "kafoodle/v1/2026-10-31/";
export type FoodDataConfig = { enabled: boolean; bucket: string; prefix: string };
export type RecipeCompositionConfig = { enabled: boolean; bucket: string; prefix: string };

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

/** Pinned v2 candidate prefix. It is a separate object tree and cannot repoint the legacy v1 snapshot. */
export function recipeCompositionConfig(env: Record<string, string | undefined> = process.env): RecipeCompositionConfig {
  const mode = env.FIKA_RUNTIME_MODE || "local";
  const prefix = (env.FIKA_FOOD_COMPOSITIONS_PREFIX || "kafoodle/compositions/v2/2026-11-03/").replace(/^\/+/, "");
  const safePrefix = /^kafoodle\/compositions\/v2\/\d{4}-\d{2}-\d{2}\/$/.test(prefix) ? prefix : "";
  return {
    enabled: (mode === "staging" || mode === "local") && env.FIKA_FOOD_DATA_ENABLED !== "false" && env.FIKA_FOOD_COMPOSITIONS_ENABLED !== "false" && Boolean(safePrefix),
    bucket: env.FIKA_FOOD_DATA_BUCKET || DEFAULT_FOOD_DATA_BUCKET,
    prefix: safePrefix,
  };
}

export const isFoodDataset = (value: string): value is FoodDataset => (FOOD_DATASETS as readonly string[]).includes(value);
