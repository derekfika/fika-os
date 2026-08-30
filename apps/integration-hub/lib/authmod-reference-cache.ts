import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";

const CACHE_TTL_MS = 60_000;
type Entry = { value: unknown; expiresAt: number };
const entries = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();
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
  if (pending) return pending as Promise<T>;
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

export function invalidateAuthmodReferenceCaches() {
  invalidationGeneration += 1;
  entries.clear();
}

export function clearAuthmodReferenceCachesForTests() {
  entries.clear();
  inFlight.clear();
  invalidationGeneration = 0;
}
