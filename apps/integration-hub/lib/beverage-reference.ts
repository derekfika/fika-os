import { BEVERAGE_AUTHMOD_APP_ID, type BeverageSiteDecision, type BeverageSiteRequest } from "./authmod-core/beverage-admission";
import type { BeverageReferenceConfig } from "./beverage-reference-config";
import { decodeBundle } from "./food-data/bundle";
import { datasetVersion, parseManifest } from "./food-data/manifest";

const MAX_MANIFEST_BYTES = 64 * 1024;
const MAX_GZIP_BYTES = 5 * 1024 * 1024;
const MAX_JSON_BYTES = 40 * 1024 * 1024;
type FoodObject = "manifest.json" | "ingredients.json.gz";
type CallerClaims = { aud?: string; sub?: string; email?: string; email_verified?: boolean; iss?: string; exp?: number };
export type BeverageReferenceDeps = {
  config?: BeverageReferenceConfig;
  verifyCaller(idToken: string, audience: string): Promise<CallerClaims | undefined>;
  decide(input: BeverageSiteRequest): Promise<BeverageSiteDecision>;
  readFoodObject(name: FoodObject, maxBytes: number): Promise<Uint8Array>;
};

const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", Vary: "Authorization, Cookie" };
const respond = (body: unknown, status = 200) => Response.json(body, { status, headers });
const refuse = (status: number, code: string) => respond({ error: { code } }, status);

function hasExpired(decision: BeverageSiteDecision) {
  return decision.validUntil !== undefined && !(Date.parse(decision.validUntil) > Date.now());
}

export async function collectBeverageFoodObject(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > maxBytes) throw new Error("Beverage reference object exceeds its byte limit.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, size);
}

/** One server caller and one independently verified person control every request. */
export async function handleBeverageReference(request: Request, resource: string, deps: BeverageReferenceDeps) {
  const { config } = deps;
  if (!config || !["oplocs", "manifest", "ingredients"].includes(resource) || (resource !== "oplocs" && !config.food)) {
    return refuse(404, "BEVERAGE_REFERENCE_DISABLED");
  }
  if (request.headers.has("origin") || request.headers.has("sec-fetch-site")) return refuse(403, "BEVERAGE_REFERENCE_SERVER_REQUIRED");
  const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(request.headers.get("authorization") || "")?.[1];
  if (!token || token.length > 8192) return refuse(401, "BEVERAGE_REFERENCE_CALLER_REQUIRED");
  let caller: CallerClaims | undefined;
  try { caller = await deps.verifyCaller(token, config.audience); }
  catch { return refuse(401, "BEVERAGE_REFERENCE_CALLER_REQUIRED"); }
  if (caller?.aud !== config.audience || caller.sub !== config.callerSubject || caller.email !== config.callerEmail ||
      caller.email_verified !== true || !["https://accounts.google.com", "accounts.google.com"].includes(caller.iss || "") ||
      typeof caller.exp !== "number" || !Number.isSafeInteger(caller.exp) || caller.exp <= Date.now() / 1000) {
    return refuse(401, "BEVERAGE_REFERENCE_CALLER_REQUIRED");
  }

  const query = new URL(request.url).searchParams;
  const oplocIds = query.getAll("oploc");
  const versions = query.getAll("version");
  const ingredients = resource === "ingredients";
  if (!oplocIds.length || oplocIds.length > 100 || [...query.keys()].some(key => key !== "oploc" && key !== "version") ||
      versions.length !== (ingredients ? 1 : 0)) return refuse(400, "BEVERAGE_REFERENCE_REQUEST_INVALID");

  try {
    const decision = await deps.decide({ action: "View", oplocIds, personOnly: true });
    if (!decision.allowed) {
      if (decision.reasonCode === "unauthenticated") return refuse(401, "BEVERAGE_REFERENCE_SESSION_REQUIRED");
      if (decision.reasonCode === "invalid-request") return refuse(400, "BEVERAGE_REFERENCE_REQUEST_INVALID");
      if (decision.reasonCode === "store-unavailable") return refuse(503, "BEVERAGE_REFERENCE_UNAVAILABLE");
      return refuse(403, "BEVERAGE_REFERENCE_DENIED");
    }
    if (decision.appId !== BEVERAGE_AUTHMOD_APP_ID || decision.action !== "View" || !decision.principalId ||
        decision.scope?.kind !== "oploc" || !decision.activeOplocs?.length ||
        decision.scope.ids.length !== decision.activeOplocs.length ||
        !decision.activeOplocs.every((site, index) => site.id === decision.scope?.ids[index]) ||
        hasExpired(decision)) return refuse(403, "BEVERAGE_REFERENCE_DENIED");
    if (resource === "oplocs") {
      return respond({ readOnly: true, oplocs: decision.activeOplocs.map(({ id, label }) => ({ id, label })) });
    }

    const pinned = config.food!.version;
    if (ingredients && versions[0] !== pinned) return refuse(409, "FOOD_DATA_VERSION_CHANGED");
    const rawManifest = await deps.readFoodObject("manifest.json", MAX_MANIFEST_BYTES);
    if (!rawManifest.byteLength || rawManifest.byteLength > MAX_MANIFEST_BYTES) return refuse(503, "BEVERAGE_REFERENCE_UNAVAILABLE");
    const manifest = parseManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawManifest)));
    const entry = manifest.files.ingredients;
    if (datasetVersion(manifest, "ingredients") !== pinned) return refuse(409, "FOOD_DATA_VERSION_CHANGED");
    if (entry.object !== "ingredients.json.gz" || entry.gzipBytes < 1 || entry.gzipBytes > MAX_GZIP_BYTES ||
        entry.jsonBytes < 1 || entry.jsonBytes > MAX_JSON_BYTES || entry.rows > 25_000 || entry.columns < 1 || entry.columns > 160) {
      return refuse(503, "BEVERAGE_REFERENCE_UNAVAILABLE");
    }
    if (resource === "manifest") {
      if (hasExpired(decision)) return refuse(403, "BEVERAGE_REFERENCE_DENIED");
      const { gzipBytes, gzipSha256, jsonBytes, jsonSha256, rows, columns } = entry;
      return respond({
        readOnly: true, version: pinned,
        manifest: { schemaVersion: 1, snapshot: manifest.snapshot, files: { ingredients: { gzipBytes, gzipSha256, jsonBytes, jsonSha256, rows, columns } } },
      });
    }
    const gzip = await deps.readFoodObject("ingredients.json.gz", entry.gzipBytes);
    await decodeBundle("ingredients", gzip, entry, manifest.snapshot);
    if (hasExpired(decision)) return refuse(403, "BEVERAGE_REFERENCE_DENIED");
    return new Response(new Uint8Array(gzip), {
      headers: { ...headers, "Content-Type": "application/gzip", "Content-Length": String(gzip.byteLength), "X-Food-Data-Version": pinned },
    });
  } catch { return refuse(503, "BEVERAGE_REFERENCE_UNAVAILABLE"); }
}
