const inFlightGets = new Map<string, Promise<Response>>();

export function fetchPlannerGet(input: RequestInfo | URL, init?: RequestInit) {
  const request = new Request(input, init);
  if (request.method !== "GET") return fetch(input, init);
  const key = request.url;
  const existing = inFlightGets.get(key);
  if (existing) return existing.then((response) => response.clone());
  const pending = fetch(request).finally(() => inFlightGets.delete(key));
  inFlightGets.set(key, pending);
  return pending;
}
