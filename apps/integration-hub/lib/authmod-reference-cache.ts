import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const CACHE_TTL_MS = 60_000;
type Entry = { value: unknown; expiresAt: number };
type InFlight = { generation: number; promise: Promise<unknown> };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, InFlight>();
let invalidationGeneration = 0;

export function cachedAuthmodReference<T>(input: { scope: string; name: string; load: () => Promise<T>; documents: (value: T) => number }): Promise<T> {
  const key = `${input.scope}:${input.name}`;
  const now = Date.now();
  const cached = entries.get(key);
  if (cached && cached.expiresAt > now) {
    recordDataAccess({ app: "integration-hub", operation: `authmod.${input.name}`, source: "APP_CACHE", documents: input.documents(cached.value as T), cacheHit: true });
    return Promise.resolve(cached.value as T);
  }
  const pending = inFlight.get(key);
  if (pending && pending.generation === invalidationGeneration) {
    recordDataAccess({ app: "integration-hub", operation: `authmod.${input.name}.pending`, source: "APP_CACHE", documents: 0, cacheHit: true, cacheResult: "IN_FLIGHT_JOIN" });
    return pending.promise as Promise<T>;
  }
  const generation = invalidationGeneration;
  const promise = input.load().then(value => {
    if (generation === invalidationGeneration) entries.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    return value;
  }, error => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    throw error;
  });
  inFlight.set(key, { generation, promise });
  return promise;
}

export function invalidateAuthmodReferenceCaches() {
  invalidationGeneration += 1;
  entries.clear();
}

export function clearAuthmodReferenceCachesForTests() {
  entries.clear();
  inFlight.clear();
  invalidationGeneration = 0;
}
