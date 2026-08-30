import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const CACHE_TTL_MS = 30_000;
type Entry<T> = { value: T; expiresAt: number };
const entries = new Map<string, Entry<unknown>>();
const inFlight = new Map<string, Promise<unknown>>();
let invalidationGeneration = 0;

function keyFor(input: { identityId: string; appId: string; scope?: string; representedOplocId?: string; primaryCustodianLegendId?: string }) {
  return [input.identityId, input.appId, input.scope || "organisation", input.representedOplocId || "", input.primaryCustodianLegendId || ""].join("|");
}

export function cachedAuthmodAdmission<T>(input: {
  identityId: string;
  appId: string;
  scope?: string;
  representedOplocId?: string;
  primaryCustodianLegendId?: string;
  load: () => Promise<T>;
}): Promise<T> {
  const key = keyFor(input);
  const cached = entries.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.admission.access", source: "APP_CACHE", documents: 0, cacheHit: true });
    return Promise.resolve(cached.value as T);
  }
  const pending = inFlight.get(key);
  if (pending) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.admission.access.pending", source: "APP_CACHE", documents: 0, cacheHit: true });
    return pending as Promise<T>;
  }
  const generation = invalidationGeneration;
  const promise = input.load().then(value => {
    if (generation === invalidationGeneration) entries.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    inFlight.delete(key);
    return value;
  }, error => {
    inFlight.delete(key);
    throw error;
  });
  inFlight.set(key, promise);
  return promise;
}

export function invalidateAuthmodAdmissionCache() {
  invalidationGeneration += 1;
  entries.clear();
}

export function clearAuthmodAdmissionCacheForTests() {
  entries.clear();
  inFlight.clear();
  invalidationGeneration = 0;
}
