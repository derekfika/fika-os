import { NextRequest, NextResponse } from "next/server";
import { projectedAllergenDay, resolveAccess } from "@/lib/server";
import { createGoogleSiteMenu, retireGoogleSiteMenu } from "@/lib/google-site-menu";
import { latestSiteMenuArtifactHosted, saveSiteMenuArtifactHosted } from "@/lib/site-menu-store";
import { siteMenuState } from "@/lib/site-menu";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const oplocId = request.nextUrl.searchParams.get("oplocId");
    const publicationDayId = request.nextUrl.searchParams.get("publicationDayId");
    if (!oplocId || !publicationDayId) return NextResponse.json({ error: { message: "A site and published day are required." } }, { status: 422 });
    const day = await projectedAllergenDay(request, oplocId, publicationDayId);
    return NextResponse.json({ siteMenu: day.siteMenu || { status: "none" } }, { headers: { "Cache-Control": "no-store, max-age=0" } });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The site menu could not be loaded." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { oplocId?: string; publicationDayId?: string; action?: "generate" | "regenerate" };
    if (!body.oplocId || !body.publicationDayId) return NextResponse.json({ error: { message: "A site and published day are required." } }, { status: 422 });
    const day = await projectedAllergenDay(request, body.oplocId, body.publicationDayId);
    if (!day.site) return NextResponse.json({ error: { message: "The selected Delivered-In site was not found." } }, { status: 404 });
    if (day.cpuReview?.status !== "signed") return NextResponse.json({ error: { message: "The site menu is locked until CPU has signed the allergen matrix." } }, { status: 409 });
    const access = await resolveAccess(request);
    const previous = await latestSiteMenuArtifactHosted(body.oplocId, day.sourceDayId);
    const artifact = await createGoogleSiteMenu(day, day.site, access.access.email, previous?.driveFileId);
    await saveSiteMenuArtifactHosted(artifact);
    if (previous?.driveFileId && previous.driveFileId !== artifact.driveFileId) await retireGoogleSiteMenu(previous.driveFileId);
    return NextResponse.json({ siteMenu: siteMenuState(day, artifact), artifact }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "The site menu could not be generated." } }, { status: Number((error as { status?: number }).status) || 502 });
  }
}
