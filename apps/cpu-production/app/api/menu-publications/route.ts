import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "@hub/lib/api";
import { requireActor } from "@hub/lib/auth";
import { assertPermission } from "@hub/lib/authmod";
import { publishedAllergenMatrixHtml } from "../../../../shared/published-allergen-matrix";

export const dynamic = "force-dynamic";
const menuPlanningBase = () => (process.env.MENU_PLANNING_BASE_URL || "http://localhost:3500").replace(/\/$/, "");
const localActor = { uid: "local-cpu-publications", name: "CPU Head Chef / Site Manager (local)", role: "integration-admin" as const, synthetic: true as const };
async function publicationActor(request: NextRequest) { try { return await requireActor(request); } catch (error) { if (process.env.NODE_ENV !== "production" && (error as { status?: number }).status === 401) return localActor; throw error; } }
async function upstream(request: NextRequest) {
  const response = await fetch(`${menuPlanningBase()}/api/rolling-menu/publications${request.nextUrl.search}`, { cache: "no-store" });
  const body = await response.text();
  return { response, body };
}
export async function GET(request: NextRequest) {
  try {
    const actor = await publicationActor(request); assertPermission(actor, "canonical.view");
    const { response, body } = await upstream(request);
    if (!response.ok) return new NextResponse(body, { status: response.status, headers: { "content-type": "application/json" } });
    if (request.nextUrl.searchParams.get("format") !== "matrix") return new NextResponse(body, { headers: { "content-type": "application/json" } });
    const parsed = JSON.parse(body) as { publication?: { days: Array<{ publicationDayId: string; status: "published" | "superseded" | "withdrawn"; date: string; dayName: string; version: number; contentHash: string; entries: Array<{ dishName: string; sourceEntryId: string; slot: string; portions: number; allocations: Array<{ destinationLabel: string; quantity: number }>; allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }>; allergenSignoff: { productionChef?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; headChefSiteManager?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; printedName?: string; signedAt?: string; signatureDataUrl?: string; dayContentHash: string } }> } };
    const publication = parsed.publication;
    const requestedPublicationDayId = request.nextUrl.searchParams.get("publicationDayId");
    const requestedDate = request.nextUrl.searchParams.get("date");
    const day = requestedPublicationDayId
      ? publication?.days.find(value => value.publicationDayId === requestedPublicationDayId)
      : publication?.days.find(value => value.date === requestedDate && value.status === "published");
    if (!publication || !day) return NextResponse.json({ error: { message: "Published menu day was not found." } }, { status: 404 });
    const productionChef = day.allergenSignoff.productionChef || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const headChefSiteManager = day.allergenSignoff.headChefSiteManager || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const html = publishedAllergenMatrixHtml({ dayName: day.dayName, date: day.date, version: day.version, contentHash: day.contentHash, entries: day.entries, allergenSignoff: { productionChef, headChefSiteManager } });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  } catch (error) {
    return errorResponse(error);
  }
}
