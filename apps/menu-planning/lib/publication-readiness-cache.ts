const MAX_ENTRIES = 64;
const values = new Map<string, string[]>();
const inFlight = new Map<string, Promise<string[]>>();

function remember(key: string, blockers: string[]) {
  values.delete(key);
  values.set(key, blockers);
  while (values.size > MAX_ENTRIES) values.delete(values.keys().next().value!);
}

export function clearPublicationReadinessCache() {
  values.clear();
  inFlight.clear();
}

export function getCachedPublicationReadiness(key: string) {
  const blockers = values.get(key);
  if (!blockers) return undefined;
  values.delete(key);
  values.set(key, blockers);
  return blockers;
}

export function loadPublicationReadiness(key: string, load: () => Promise<string[]>) {
  const cached = getCachedPublicationReadiness(key);
  if (cached) return Promise.resolve(cached);
  const pending = inFlight.get(key);
  if (pending) return pending;
  const request = load().then(blockers => {
    remember(key, blockers);
    return blockers;
  }).finally(() => inFlight.delete(key));
  inFlight.set(key, request);
  return request;
}
