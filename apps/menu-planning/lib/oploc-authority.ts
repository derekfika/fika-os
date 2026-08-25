import type { NextRequest } from "next/server";
export type GovernedOploc = { canonicalId: string; label: string; address?: string };
const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
export async function readGovernedOplocs(request: NextRequest): Promise<GovernedOploc[]> {
  const response = await fetch(`${hubBase()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await response.json() as { oplocs?: GovernedOploc[]; error?: { message?: string } };
  if (!response.ok || !Array.isArray(body.oplocs)) throw Object.assign(new Error(body.error?.message || "Integration Hub OPLOC authority is unavailable; publication was not performed."), { status: response.status >= 500 ? 503 : response.status || 503 });
  return body.oplocs;
}

export async function readDeliveredInOplocs(request: NextRequest): Promise<GovernedOploc[]> {
  const headers = { cookie: request.headers.get("cookie") || "" };
  const [oplocResponse, arrangementResponse] = await Promise.all([
    fetch(`${hubBase()}/api/oplocs`, { headers, cache: "no-store" }),
    fetch(`${hubBase()}/api/service-arrangements`, { headers, cache: "no-store" }),
  ]);
  const oplocBody = await oplocResponse.json() as { oplocs?: GovernedOploc[]; error?: { message?: string } };
  const arrangementBody = await arrangementResponse.json() as { arrangements?: Array<{ oplocId: string; oplocLabel?: string; serviceLabel?: string; lifecycleState?: string; effectiveFrom?: string; effectiveTo?: string }>; error?: { message?: string } };
  if (!oplocResponse.ok || !Array.isArray(oplocBody.oplocs) || !arrangementResponse.ok || !Array.isArray(arrangementBody.arrangements)) {
    throw Object.assign(new Error(oplocBody.error?.message || arrangementBody.error?.message || "Delivered-In OPLOC authority is unavailable."), { status: 503 });
  }
  const today = new Date().toISOString().slice(0, 10);
  const eligible = new Set(arrangementBody.arrangements.filter(item => item.lifecycleState === "active" && /delivered[ -]?in/i.test(item.serviceLabel || "") && (!item.effectiveFrom || item.effectiveFrom <= today) && (!item.effectiveTo || item.effectiveTo >= today)).map(item => item.oplocId));
  const listed = new Map(oplocBody.oplocs.map(item => [item.canonicalId, item]));
  const governed = new Map<string, GovernedOploc>();
  for (const arrangement of arrangementBody.arrangements) {
    if (!eligible.has(arrangement.oplocId)) continue;
    governed.set(arrangement.oplocId, listed.get(arrangement.oplocId) || { canonicalId: arrangement.oplocId, label: arrangement.oplocLabel || arrangement.oplocId });
  }
  return [...governed.values()];
}
