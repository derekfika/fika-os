import { NextRequest, NextResponse } from "next/server";
import { requireCpuActor } from "../../../lib/cpu-access-client";
import { menuPlanningJson } from "../../../lib/menu-planning-http-client";
import { publishedAllergenMatrixHtml } from "../../../lib/published-allergen-matrix";

export const dynamic = "force-dynamic";
type Publication = { publicationId: string; sourceWeekId: string; weekCommencing: string; weekEnding: string; days: Array<{ publicationDayId: string; status: "published" | "superseded" | "withdrawn"; date: string; dayName: string; version: number; contentHash: string; entries: Array<{ dishName: string; sourceEntryId: string; slot: string; portions: number; allocations: Array<{ destinationLabel: string; quantity: number }>; allergens: Record<string, "clear" | "contains" | "may_contain">; mayContainNotes?: string }>; allergenSignoff: { productionChef?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; headChefSiteManager?: { printedName: string; signedAt: string; signatureDataUrl?: string; actor?: string; attestation?: string }; printedName?: string; signedAt?: string; signatureDataUrl?: string; dayContentHash: string } }> };
type PublicationResponse = { publications?: Publication[]; publication?: Publication };
const isPublicationResponse = (value: unknown): value is PublicationResponse => Boolean(value && typeof value === "object" && (Array.isArray((value as PublicationResponse).publications) || (value as PublicationResponse).publication));
function errorResponse(error: unknown) { const status = typeof (error as { status?: unknown }).status === "number" ? (error as { status: number }).status : 503; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Published menus could not be loaded." } }, { status }); }

export async function GET(request: NextRequest) {
  try {
    await requireCpuActor(request);
    const response = await menuPlanningJson(request, `/api/rolling-menu/publications${request.nextUrl.search}`, isPublicationResponse);
    if (request.nextUrl.searchParams.get("format") !== "matrix") return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
    const publication = response.publication;
    const requestedPublicationDayId = request.nextUrl.searchParams.get("publicationDayId");
    const requestedDate = request.nextUrl.searchParams.get("date");
    const day = requestedPublicationDayId
      ? publication?.days.find(value => value.publicationDayId === requestedPublicationDayId)
      : publication?.days.find(value => value.date === requestedDate && value.status === "published");
    if (!publication || !day) return NextResponse.json({ error: { message: "Published menu day was not found." } }, { status: 404 });
    const productionChef = day.allergenSignoff.productionChef || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const headChefSiteManager = day.allergenSignoff.headChefSiteManager || { printedName: day.allergenSignoff.printedName || "", signedAt: day.allergenSignoff.signedAt || "", signatureDataUrl: day.allergenSignoff.signatureDataUrl, actor: "menu-planning", attestation: day.allergenSignoff.dayContentHash };
    const html = publishedAllergenMatrixHtml({ dayName: day.dayName, date: day.date, version: day.version, contentHash: day.contentHash, entries: day.entries, allergenSignoff: { productionChef, headChefSiteManager } });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  } catch (error) {
    return errorResponse(error);
  }
}
