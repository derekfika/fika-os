import { NextRequest, NextResponse } from "next/server";
import { assertAuthorisedOploc } from "@/lib/projection";
import { readAllergenSafetyState } from "@/lib/allergen-safety-state";
import { resolveAccess } from "@/lib/server";

export const dynamic = "force-dynamic";
export async function GET(request: NextRequest) {
  const siteId = request.nextUrl.searchParams.get("oplocId") || "";
  const serviceDate = request.nextUrl.searchParams.get("serviceDate") || "";
  const releaseVersion = request.nextUrl.searchParams.get("releaseVersion") || "";
  if (!siteId || !/^\d{4}-\d{2}-\d{2}$/.test(serviceDate) || !releaseVersion) return NextResponse.json({ error: { message: "A site, service date and release version are required." } }, { status: 422 });
  try { const resolved = await resolveAccess(request); assertAuthorisedOploc(resolved.access, siteId); return NextResponse.json({ state: await readAllergenSafetyState(siteId, serviceDate, releaseVersion) || null }, { headers: { "Cache-Control": "no-store, max-age=0" } }); } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Safety state could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
