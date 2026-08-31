import { recordDataAccess } from "@fika/server-shared/data-source-meter-server";
import { AsyncLocalStorage } from "node:async_hooks";

const CACHE_TTL_MS = 30_000;
type Entry<T> = { value: T; expiresAt: number };
const entries = new Map<string, Entry<unknown>>();
type InFlight = { generation: number; promise: Promise<unknown> };
const inFlight = new Map<string, InFlight>();
const requestContext = new AsyncLocalStorage<Map<string, { generation: number; promise: Promise<unknown> }>>();
let invalidationGeneration = 0;

function keyFor(input: { identityId: string; appId: string; scope?: string; authorityAction?: string; representedOplocId?: string; primaryCustodianLegendId?: string }) {
  return JSON.stringify([input.identityId, input.appId, input.scope || "organisation", input.authorityAction || "app-access", input.representedOplocId || "", input.primaryCustodianLegendId || ""]);
}

function expiryFor(value: unknown, now: number) {
  const explicit = typeof value === "object" && value !== null && "validUntil" in value ? Date.parse(String(value.validUntil)) : Number.NaN;
  return Math.min(now + CACHE_TTL_MS, Number.isFinite(explicit) ? explicit : Number.POSITIVE_INFINITY);
}

export function withAuthmodRequestContext<T>(callback: () => Promise<T> | T): Promise<T> | T {
  return requestContext.run(new Map(), callback);
}

export function cachedAuthmodAdmission<T>(input: {
  identityId: string;
  appId: string;
  scope?: string;
  authorityAction?: string;
  representedOplocId?: string;
  primaryCustodianLegendId?: string;
  load: () => Promise<T>;
}): Promise<T> {
  const key = keyFor(input);
  const now = Date.now();
  const requestEntries = requestContext.getStore();
  const requestCached = requestEntries?.get(key);
  if (requestCached && requestCached.generation === invalidationGeneration) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.admission.request-context", source: "APP_CACHE", documents: 0, cacheHit: true });
    return requestCached.promise as Promise<T>;
  }
  const cached = entries.get(key);
  if (cached && cached.expiresAt > now) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.admission.access", source: "APP_CACHE", documents: 0, cacheHit: true });
    const promise = Promise.resolve(cached.value as T);
    requestEntries?.set(key, { generation: invalidationGeneration, promise });
    return promise;
  }
  const pending = inFlight.get(key);
  if (pending && pending.generation === invalidationGeneration) {
    recordDataAccess({ app: "integration-hub", operation: "authmod.admission.access.pending", source: "APP_CACHE", documents: 0, cacheHit: true });
    requestEntries?.set(key, pending);
    return pending.promise as Promise<T>;
  }
  const generation = invalidationGeneration;
  const promise = input.load().then(value => {
    const decision = value as T & { allowed?: boolean; reasonCode?: string };
    if (generation === invalidationGeneration && decision.reasonCode !== "store-unavailable") {
      entries.set(key, { value, expiresAt: expiryFor(value, Date.now()) });
    }
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    return value;
  }, error => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
    throw error;
  });
  const flight = { generation, promise };
  inFlight.set(key, flight);
  requestEntries?.set(key, flight);
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

export function authmodAdmissionCacheConfigForTests() { return { ttlMs: CACHE_TTL_MS, generation: invalidationGeneration }; }
