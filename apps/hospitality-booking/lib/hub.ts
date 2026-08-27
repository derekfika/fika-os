/** Configuration is injected by Next/App Hosting; Next loads local .env.local
 * automatically during development, so no repository filesystem probing is
 * needed here. */
function bridgeSetting(key: "FIKA_HUB_BASE_URL" | "MNK_CANON_BRIDGE_TOKEN") { return process.env[key]?.trim() || undefined; }

export function isLocalBridgeEnvironment() {
  const base = bridgeSetting("FIKA_HUB_BASE_URL");
  return Boolean(base && /^https?:\/\/(127\.0\.0\.1|localhost)(?::\d+)?(?:\/|$)/i.test(base));
}

export async function hubFetch(pathname: string, init: RequestInit = {}) {
  const base = bridgeSetting("FIKA_HUB_BASE_URL");
  const token = bridgeSetting("MNK_CANON_BRIDGE_TOKEN");
  if (!base || !token) throw Error("The MNK Canon bridge is not configured. Set the local Hub address and bridge token.");
  const headers = new Headers(init.headers);
  headers.set("x-fika-mnk-bridge-token", token);
  return fetch(`${base.replace(/\/$/, "")}${pathname}`, { ...init, headers, cache: "no-store" });
}

export async function hubUserFetch(pathname: string, cookie: string | null, init: RequestInit = {}) {
  const base = bridgeSetting("FIKA_HUB_BASE_URL");
  if (!base) throw Error("The Hub address has not been configured for this environment.");
  const headers = new Headers(init.headers);
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${base.replace(/\/$/, "")}${pathname}`, { ...init, headers, cache: "no-store" });
}
