import { NextRequest, NextResponse } from "next/server";
import { assertAuthorisedOploc } from "@/lib/projection";
import { acknowledgeAllergenSafety } from "@/lib/allergen-safety-state";
import { resolveAccess } from "@/lib/server";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => undefined) as { siteId?: string; serviceDate?: string; releaseVersion?: string } | undefined;
  if (!body?.siteId || !/^\d{4}-\d{2}-\d{2}$/.test(body.serviceDate || "") || !body.releaseVersion) return NextResponse.json({ error: { message: "A site, service date and release version are required." } }, { status: 422 });
  try { const resolved = await resolveAccess(request); assertAuthorisedOploc(resolved.access, body.siteId); const state = await acknowledgeAllergenSafety(body.siteId, body.serviceDate!, body.releaseVersion, resolved.access.email, new Date().toISOString()); return NextResponse.json({ state }); } catch (error) { return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Acknowledgement could not be saved." } }, { status: Number((error as { status?: number }).status) || 502 }); }
}
