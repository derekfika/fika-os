import type { NextRequest } from "next/server";
export type GovernedOploc = { canonicalId: string; label: string };
const hubBase = () => (process.env.INTEGRATION_HUB_BASE_URL || "http://localhost:3200").replace(/\/$/, "");
export async function readGovernedOplocs(request: NextRequest): Promise<GovernedOploc[]> {
  const response = await fetch(`${hubBase()}/api/oplocs`, { headers: { cookie: request.headers.get("cookie") || "" }, cache: "no-store" });
  const body = await response.json() as { oplocs?: GovernedOploc[]; error?: { message?: string } };
  if (!response.ok || !Array.isArray(body.oplocs)) throw Object.assign(new Error(body.error?.message || "Integration Hub OPLOC authority is unavailable; publication was not performed."), { status: response.status >= 500 ? 503 : response.status || 503 });
  return body.oplocs;
}
