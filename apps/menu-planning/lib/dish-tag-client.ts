import type { DishTag } from "./dish-tags";
export type ClientTagRegistry = { version: number; tags: DishTag[] };

/** Short-lived, memory-only reference cache. Never persists registry data across identities. */
export function createDishTagClient(fetcher: typeof fetch, identity: () => string | undefined, now = Date.now, ttlMs = 60000) {
  let scope: string | undefined, generation = 0, minimumVersion = 0;
  let cached: { value: ClientTagRegistry; until: number } | undefined;
  let pending: Promise<ClientTagRegistry> | undefined;
  const invalidate = (version = 0) => { generation++; cached = undefined; pending = undefined; minimumVersion = Math.max(minimumVersion,version); };
  const syncIdentity = () => {
    const current = identity();
    if (scope !== current) { scope = current; minimumVersion = 0; invalidate(); }
    return current;
  };
  const load = (): Promise<ClientTagRegistry> => {
    const current = syncIdentity(), revision = generation;
    if (current && cached && cached.until > now()) return Promise.resolve(cached.value);
    if (current && pending) return pending;
    const request = fetcher("/api/dish-tags",{cache:"no-store",signal:AbortSignal.timeout(10000)}).then(async response => {
      const body = await response.json();
      if (!response.ok) throw Error(body.error?.message || "Tags could not be loaded.");
      if (!Number.isInteger(body.version) || body.version < minimumVersion || !Array.isArray(body.tags) || body.tags.some((tag: unknown) => !tag || typeof (tag as DishTag).id !== "string")) throw Error("The tag registry response is invalid or older than the known version.");
      if (identity() !== current || generation !== revision) throw Error("The tag registry changed while loading; retry with the current identity/version.");
      const value = {version:body.version,tags:body.tags as DishTag[]};
      minimumVersion = value.version;
      if (current) cached = {value,until:now()+ttlMs};
      return value;
    }).finally(()=>{ if (pending === request) pending = undefined; });
    if (current) pending = request;
    return request;
  };
  return {load,invalidate:(version=0)=>{syncIdentity();invalidate(version);}};
}

const client = createDishTagClient((...args)=>fetch(...args),()=>{
  try {
    if (typeof window === "undefined") return undefined;
    const identity = window.sessionStorage.getItem("fika-menu-identity");
    return identity ? `${window.location.origin}|${identity}` : undefined;
  }
  catch { return undefined; }
});
export const loadDishTagRegistry = client.load;
export const invalidateDishTagRegistry = client.invalidate;
