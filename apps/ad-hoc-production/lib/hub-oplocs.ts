import type { AdHocDestination } from "./ad-hoc-domain";

export type HubOploc = { canonicalId: string; label: string; address?: string; lifecycleStatus?: string };
type HubOplocPackage = { oplocs?: HubOploc[]; redirects?: Record<string, string> };

const hubOrigin = () => process.env.FIKA_HUB_ORIGIN || "http://localhost:3200";
const isActive = (oploc: HubOploc) => !oploc.lifecycleStatus || oploc.lifecycleStatus.toLowerCase() === "active";

/** The caller's AUTHMOD-filtered OPLOC list, read from the Hub with the caller's own session. */
export async function fetchAuthorisedOplocs(cookie: string): Promise<HubOplocPackage> {
  const response = await fetch(`${hubOrigin()}/api/oplocs`, { headers: { cookie }, cache: "no-store" });
  if (!response.ok) throw Object.assign(new Error(response.status === 401 || response.status === 403 ? "You are not authorised to use OPLOC destinations." : "OPLOC authority is unavailable."), { status: response.status === 401 || response.status === 403 ? response.status : 503 });
  return await response.json() as HubOplocPackage;
}

/**
 * Resolves the chosen OPLOC through Hub authority (historical aliases included)
 * and returns a server-built snapshot. The client's label/address are never trusted.
 */
export async function resolveOplocDestination(destination: AdHocDestination, cookie: string): Promise<AdHocDestination> {
  if (destination.mode !== "oploc") return destination;
  const requested = destination.oplocId?.trim();
  if (!requested) return destination;
  const hub = await fetchAuthorisedOplocs(cookie);
  const canonicalId = hub.redirects?.[requested] || requested;
  const match = (hub.oplocs || []).find(oploc => oploc.canonicalId === canonicalId && isActive(oploc));
  if (!match) throw Object.assign(new Error("That destination is not an active OPLOC you are authorised to use."), { status: 422 });
  return { ...destination, oplocId: match.canonicalId, label: match.label, address: match.address || "", identity: match.canonicalId };
}
