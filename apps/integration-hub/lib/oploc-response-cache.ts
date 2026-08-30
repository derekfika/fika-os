import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

export type OplocResponse = {
  oplocs: Array<{ canonicalId: string; label: string; address?: string }>;
};

type Entry = { manifestVersion: number; expiresAt: number; response: OplocResponse };

const CACHE_TTL_MS = 5 * 60 * 1000;
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<OplocResponse>>();

export function clearOplocResponseCache() {
  entries.clear();
  inFlight.clear();
}

export async function getCachedOplocResponse(
  identityScope: string,
  manifestVersion: number,
  load: () => Promise<OplocResponse>,
  now = Date.now(),
) {
  const cached = entries.get(identityScope);
  if (cached && cached.manifestVersion === manifestVersion && cached.expiresAt > now) {
    recordDataAccess({ app: "integration-hub", operation: "oploc.api.cache", source: "APP_CACHE", documents: cached.response.oplocs.length, cacheHit: true });
    return cached.response;
  }
  const existing = inFlight.get(identityScope);
  if (existing) {
    recordDataAccess({ app: "integration-hub", operation: "oploc.api.cache.pending", source: "APP_CACHE", documents: 0, cacheHit: true });
    return existing;
  }
  const request = load().then(response => {
    entries.set(identityScope, { manifestVersion, expiresAt: Date.now() + CACHE_TTL_MS, response });
    return response;
  }).finally(() => inFlight.delete(identityScope));
  inFlight.set(identityScope, request);
  return request;
}
