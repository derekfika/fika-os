import { getStorage } from "firebase-admin/storage";
import "../firebase-admin";
import { FoodDataError } from "./manifest";

/** Read-only view of the private catalogue prefix. No list, write, delete or signed-URL capability exists here. */
export interface FoodDataObjectStore { read(name: string): Promise<Uint8Array>; }

const SAFE_NAME = /^[a-z0-9][a-z0-9._-]*$/;

export function gcsFoodDataStore(bucketName: string, prefix: string): FoodDataObjectStore {
  return {
    async read(name) {
      if (!SAFE_NAME.test(name)) throw new FoodDataError("Invalid Food Data object name.", "FOOD_DATA_MANIFEST_INVALID", 502);
      try {
        // decompress:false returns the stored gzip bytes untouched, which is what the manifest hashes cover.
        const [bytes] = await getStorage().bucket(bucketName).file(`${prefix}${name}`).download({ decompress: false });
        return new Uint8Array(bytes);
      } catch (error) {
        const code = (error as { code?: number }).code;
        if (code === 404) throw new FoodDataError("The Food Data object is not available.", "FOOD_DATA_OBJECT_MISSING", 404);
        console.error("[food-data] storage read failed", { name, code, reason: (error as Error).message?.slice(0, 200) });
        throw new FoodDataError("Food Data storage is unavailable.", "FOOD_DATA_UNAVAILABLE", 503);
      }
    },
  };
}

/**
 * Local development only (FIKA_RUNTIME_MODE=local): reads a copy of the export from a directory instead of GCS,
 * so the UI can be exercised without cloud credentials. Never reachable in staging or production.
 */
export function localDirFoodDataStore(directory: string): FoodDataObjectStore {
  return {
    async read(name) {
      if (!SAFE_NAME.test(name)) throw new FoodDataError("Invalid Food Data object name.", "FOOD_DATA_MANIFEST_INVALID", 502);
      const [{ readFile }, path] = await Promise.all([import("node:fs/promises"), import("node:path")]);
      try { return new Uint8Array(await readFile(path.join(directory, name))); }
      catch { throw new FoodDataError("The Food Data object is not available.", "FOOD_DATA_OBJECT_MISSING", 404); }
    },
  };
}
