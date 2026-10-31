import { createHash } from "node:crypto";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { FoodDataError, datasetVersion, parseManifest, type FoodDataset, type FoodManifest } from "./manifest";
import { foodDataConfig, isFoodDataset, type FoodDataConfig } from "./config";
import type { FoodDataObjectStore } from "./storage";

export type FoodDataServerDeps = {
  config: FoodDataConfig;
  /** Resolves the verified Hub session of an active staff (person) account to its AUTHMOD identity id, or throws FoodDataError 401/403. No further grant is required. */
  authenticate(request: Request): Promise<{ identityId: string }>;
  store(): FoodDataObjectStore;
};

const NO_STORE = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Cookie" };

function json(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...NO_STORE, "Content-Type": "application/json" } }); }
export function foodDataErrorResponse(error: unknown) {
  if (error instanceof FoodDataError) return json({ error: error.message, code: error.code }, error.status);
  console.error("[food-data] unexpected failure", { name: (error as Error)?.name });
  return json({ error: "Food Data is unavailable.", code: "FOOD_DATA_UNAVAILABLE" }, 500);
}

/** Session authentication happens before ANY storage access; a refused caller causes zero object reads. */
async function authorise(request: Request, deps: FoodDataServerDeps) {
  if (!deps.config.enabled) throw new FoodDataError("Food Data is not enabled in this environment.", "FOOD_DATA_DISABLED", 404);
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw new FoodDataError("Food Data is only served to this application.", "FOOD_DATA_FORBIDDEN", 403);
  const { identityId } = await deps.authenticate(request);
  return identityId;
}

async function readManifest(deps: FoodDataServerDeps): Promise<FoodManifest> {
  const bytes = await deps.store().read("manifest.json");
  let parsed: unknown;
  try { parsed = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new FoodDataError("Food Data manifest is not valid JSON.", "FOOD_DATA_MANIFEST_INVALID", 502); }
  return parseManifest(parsed);
}

export async function handleFoodDataManifest(request: Request, deps: FoodDataServerDeps) {
  try {
    const identityId = await authorise(request, deps);
    const manifest = await readManifest(deps);
    recordDataAccess({ app: "integration-hub", operation: "food-data.manifest", source: "NETWORK_UPSTREAM", documents: 1, estimatedBillableReads: 0, dataset: "integration-hub/food-data-manifest" });
    return json({ identityScope: identityId, readOnly: true, manifest });
  } catch (error) { return foodDataErrorResponse(error); }
}

export async function handleFoodDataBundle(request: Request, datasetName: string, deps: FoodDataServerDeps) {
  try {
    await authorise(request, deps);
    if (!isFoodDataset(datasetName)) throw new FoodDataError("Unknown Food Data dataset.", "FOOD_DATA_OBJECT_MISSING", 404);
    const dataset: FoodDataset = datasetName;
    const manifest = await readManifest(deps);
    const entry = manifest.files[dataset];
    const requested = new URL(request.url).searchParams.get("version");
    // The caller names the version it expects; if the snapshot moved, tell it to re-check the manifest.
    if (requested !== datasetVersion(manifest, dataset)) throw new FoodDataError("This dataset version is no longer current. Check the manifest again.", "FOOD_DATA_VERSION_CHANGED", 409);
    const bytes = await deps.store().read(entry.object);
    if (bytes.byteLength !== entry.gzipBytes || createHash("sha256").update(bytes).digest("hex") !== entry.gzipSha256) {
      console.error("[food-data] stored object failed its manifest hash", { dataset });
      throw new FoodDataError("The stored Food Data object failed its integrity check.", "FOOD_DATA_INTEGRITY_FAILED", 502);
    }
    recordDataAccess({ app: "integration-hub", operation: `food-data.bundle.${dataset}`, source: "NETWORK_UPSTREAM", documents: entry.rows, estimatedBillableReads: 0, dataset: `integration-hub/food-data-${dataset}` });
    // Deliberately NOT Content-Encoding: gzip, so the browser keeps the exact stored bytes for SHA-256 verification.
    return new Response(bytes as unknown as BodyInit, { status: 200, headers: { ...NO_STORE, "Content-Type": "application/gzip", "Content-Length": String(bytes.byteLength), "X-Food-Data-Version": requested } });
  } catch (error) { return foodDataErrorResponse(error); }
}

export function liveFoodDataDeps(): FoodDataServerDeps {
  const config = foodDataConfig();
  return {
    config,
    async authenticate(request) {
      const [{ requireFikaSession }, { FirestoreAuthModRepository }] = await Promise.all([import("../fika-session"), import("../authmod-core")]);
      try {
        const session = await requireFikaSession(request as unknown as Parameters<typeof requireFikaSession>[0], new FirestoreAuthModRepository("session"));
        if (session.identityKind !== "person") throw new FoodDataError("A person account is required.", "FOOD_DATA_FORBIDDEN", 403);
        return { identityId: session.authmodIdentityId };
      } catch (error) {
        if (error instanceof FoodDataError) throw error;
        const status = (error as { status?: number }).status;
        throw new FoodDataError("Sign in to view Food Data.", status === 403 ? "FOOD_DATA_FORBIDDEN" : "FOOD_DATA_UNAUTHENTICATED", status === 403 ? 403 : 401);
      }
    },
    // The GCS client is only imported on first read, which only happens after authorisation has succeeded.
    store: () => ({ async read(name) { const storage = await import("./storage"); const localDirectory = process.env.FIKA_RUNTIME_MODE === "local" || !process.env.FIKA_RUNTIME_MODE ? process.env.FIKA_FOOD_DATA_LOCAL_DIR : undefined; return (localDirectory ? storage.localDirFoodDataStore(localDirectory) : storage.gcsFoodDataStore(config.bucket, config.prefix)).read(name); } }),
  };
}
