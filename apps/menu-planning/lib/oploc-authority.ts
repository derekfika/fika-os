import type { NextRequest } from "next/server";
import { menuPlanningHubBaseUrl } from "./hub-url";
export type GovernedOploc = { canonicalId: string; label: string; address?: string; legacyIds?: string[] };

function resolveOplocRedirect(id: string, redirects: Record<string, string>) {
  let current = id;
  const visited = new Set<string>();
  while (redirects[current] !== undefined) {
    if (visited.has(current)) return undefined;
    visited.add(current);
    const target = redirects[current]?.trim();
    if (!target || target === current || visited.has(target)) return undefined;
    current = target;
  }
  return current;
}

export async function readGovernedOplocs(request: NextRequest): Promise<GovernedOploc[]> {
  const response = await fetch(`${menuPlanningHubBaseUrl()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await response.json() as { oplocs?: GovernedOploc[]; error?: { message?: string } };
  if (!response.ok || !Array.isArray(body.oplocs)) throw Object.assign(new Error(body.error?.message || "Integration Hub OPLOC authority is unavailable; publication was not performed."), { status: response.status >= 500 ? 503 : response.status || 503 });
  return body.oplocs;
}

export async function readDeliveredInOplocs(request: NextRequest): Promise<GovernedOploc[]> {
  const headers = { cookie: request.headers.get("cookie") || "" };
  // The authorized service-arrangements package already contains the
  // authorized OPLOC reference list. Reusing that response avoids a second
  // AUTHMOD evaluation and a second package read for every preview/check.
  const arrangementResponse = await fetch(`${menuPlanningHubBaseUrl()}/api/service-arrangements`, { headers, cache: "no-store" });
  const arrangementBody = await arrangementResponse.json() as { arrangements?: Array<{ oplocId: string; oplocLabel?: string; serviceLabel?: string; lifecycleState?: string; effectiveFrom?: string; effectiveTo?: string }>; error?: { message?: string } };
  const arrangementData = arrangementBody as typeof arrangementBody & { oplocs?: GovernedOploc[]; oplocRedirects?: Record<string, string> };
  if (!arrangementResponse.ok || !Array.isArray(arrangementBody.arrangements) || !Array.isArray(arrangementData.oplocs)) {
    throw Object.assign(new Error(arrangementBody.error?.message || "Delivered-In OPLOC authority is unavailable."), { status: 503 });
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const redirects = arrangementData.oplocRedirects || {};
  const listed = new Map(arrangementData.oplocs.map(item => [item.canonicalId, item]));
  const governed = new Map<string, GovernedOploc>();
  for (const arrangement of arrangementBody.arrangements) {
    if (!(arrangement.lifecycleState === "active" && /delivered[ -]?in/i.test(arrangement.serviceLabel || "") && (!arrangement.effectiveFrom || arrangement.effectiveFrom <= today) && (!arrangement.effectiveTo || arrangement.effectiveTo >= today))) continue;
    const canonicalId = resolveOplocRedirect(arrangement.oplocId, redirects);
    const metadata = canonicalId ? listed.get(canonicalId) : undefined;
    if (!canonicalId || !metadata) continue;
    const existing = governed.get(canonicalId);
    governed.set(canonicalId, {
      ...(existing || metadata),
      canonicalId,
      label: metadata.label || arrangement.oplocLabel || canonicalId,
      ...(metadata.address ? { address: metadata.address } : {}),
      legacyIds: [...new Set([...(existing?.legacyIds || []), ...(metadata.legacyIds || []), ...(arrangement.oplocId !== canonicalId ? [arrangement.oplocId] : [])])].sort(),
    });
  }
  const result = [...governed.values()] as GovernedOploc[];
  for (const item of result) {
    const legacyIds = Object.keys(redirects).filter((legacyId) => resolveOplocRedirect(legacyId, redirects) === item.canonicalId && legacyId !== item.canonicalId);
    item.legacyIds = [...new Set([...(item.legacyIds || []), ...legacyIds])].sort();
  }
  return result;
}
