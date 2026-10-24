import type { AdHocAccess } from "../../shared/ad-hoc-production-contract";
import type { AdHocDestination } from "./ad-hoc-domain";

/**
 * Validates a chosen OPLOC against the caller's Hub-authorised list (aliases
 * resolved through Hub redirects) and returns a snapshot whose label and address
 * come from Hub authority, never from the browser. The Hub re-validates on send.
 */
export function resolveOplocDestination(destination: AdHocDestination, access: Pick<AdHocAccess, "oplocs" | "redirects">): AdHocDestination {
  if (destination.mode !== "oploc") return destination;
  const requested = destination.oplocId?.trim();
  if (!requested) return destination;
  const canonicalId = access.redirects?.[requested] || requested;
  const match = (access.oplocs || []).find(oploc => oploc.canonicalId === canonicalId && (!oploc.lifecycleStatus || oploc.lifecycleStatus.toLowerCase() === "active"));
  if (!match) throw Object.assign(new Error("That destination is not an active OPLOC you are authorised to use."), { status: 422 });
  return { ...destination, oplocId: match.canonicalId, label: match.label, address: match.address || "", identity: match.canonicalId };
}
