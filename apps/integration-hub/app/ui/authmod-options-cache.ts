import { readCachedAuthmodOptions, writeCachedAuthmodOptions } from "./integration-cache-client";
import { recordDataAccess } from "@fika/server-shared/data-source-meter-client";

type Options = { applications: { appId: string; displayName: string; standardActions: string[] }[]; oplocs: { id: string; label: string }[]; legends: { id: string; label: string; email?: string }[] };
type Manifest = { packageVersion?: number };

export async function loadAuthmodOptions(): Promise<Response> {
  const cached = await readCachedAuthmodOptions().catch(() => undefined);
  const manifestResponse = await fetch("/api/authmod/options?manifest=1", { cache: "no-store" });
  if (!manifestResponse.ok) return manifestResponse;
  const manifest = (await manifestResponse.json() as { manifest?: Manifest }).manifest;
  if (cached && manifest?.packageVersion === cached.packageVersion) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.options.indexeddb", source: "CLIENT_CACHE", documents: cached.applications.length + cached.oplocs.length + cached.legends.length, cacheHit: true, cacheResult: "HIT", packageVersion: cached.packageVersion, dataset: "authmod-references" });
    return new Response(JSON.stringify(cached), { status: 200, headers: { "content-type": "application/json" } });
  }
  const response = await fetch("/api/authmod/options", { cache: "no-store" });
  if (!response.ok) return response;
  const options = await response.clone().json() as Options;
  if (manifest?.packageVersion !== undefined) await writeCachedAuthmodOptions({ ...options, packageVersion: manifest.packageVersion }).catch(() => undefined);
  return response;
}
