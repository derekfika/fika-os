import type { NextRequest } from "next/server";
import { menuPlanningHubBaseUrl } from "./hub-url";
export type GovernedOploc = { canonicalId: string; label: string; address?: string; legacyIds?: string[] };
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
  const today = new Date().toISOString().slice(0, 10);
  const eligible = new Set(arrangementBody.arrangements.filter(item => item.lifecycleState === "active" && /delivered[ -]?in/i.test(item.serviceLabel || "") && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today)).map(item => item.oplocId));
  const listed = new Map(arrangementData.oplocs.map(item => [item.canonicalId, item]));
  const governed = new Map<string, GovernedOploc>();
  for (const arrangement of arrangementBody.arrangements) {
    if (!eligible.has(arrangement.oplocId)) continue;
    governed.set(arrangement.oplocId, listed.get(arrangement.oplocId) || { canonicalId: arrangement.oplocId, label: arrangement.oplocLabel || arrangement.oplocId });
  }
  const result = [...governed.values()] as GovernedOploc[];
  for (const item of result) if (!item.legacyIds?.length) { const legacyIds = Object.entries(arrangementData.oplocRedirects || {}).filter(([, target]) => target === item.canonicalId).map(([legacyId]) => legacyId).sort(); if (legacyIds.length) item.legacyIds = legacyIds; }
  return result;
}
