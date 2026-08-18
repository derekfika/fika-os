import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * Server-only local fallback. Normal deployed environments use injected
 * secrets; this only prevents a launcher with the wrong working directory
 * from silently losing the portal's own local bridge configuration.
 */
function bridgeSetting(key: "FIKA_HUB_BASE_URL" | "MNK_CANON_BRIDGE_TOKEN") {
  const supplied = process.env[key]?.trim();
  if (supplied) return supplied;

  const candidates = [
    path.resolve(process.cwd(), ".env.local"),
    path.resolve(process.cwd(), "apps/hospitality-booking/.env.local"),
    path.resolve(process.cwd(), "../.env.local"),
    path.resolve(process.cwd(), "hospitality-booking/.env.local"),
    path.resolve(process.cwd(), "../apps/hospitality-booking/.env.local"),
    path.join(path.parse(process.cwd()).root, "FIKA", "apps", "hospitality-booking", ".env.local"),
  ];
  for (const file of candidates) {
    if (!existsSync(file)) continue;
    const line = readFileSync(file, "utf8").split(/\r?\n/).find(value => value.startsWith(`${key}=`));
    const value = line?.slice(key.length + 1).trim();
    if (value) return value;
  }
  return undefined;
}

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
