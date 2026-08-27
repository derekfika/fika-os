import { NextRequest, NextResponse } from "next/server";
import { archivePublishedDayMatrix, getMenuPublication, listMenuPublications, withdrawPublishedMenuDay, withdrawPublishedMenuWeek } from "@/lib/menu-publication";
import { requirePublicationActor, resolveMenuActor } from "@/lib/auth";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";

export async function GET(request: NextRequest) {
  try {
    await resolveMenuActor(request);
    const publicationId = request.nextUrl.searchParams.get("publicationId");
    if (publicationId) {
      const publication = getMenuPublication(publicationId);
      if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
      return NextResponse.json({ publication }, { headers: { "Cache-Control": "no-store" } });
    }
    return NextResponse.json({ publications: listMenuPublications() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 503 : 503;
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Menu publication read failed." } }, { status });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; publicationId?: string; publicationDayId?: string; reason?: string; actor?: string };
    const actor = requirePublicationActor(await resolveMenuActor(request));
    if (body.action === "retry-handoff") {
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent);
      return NextResponse.json({ handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed } });
    }
    if (!body.publicationId) return NextResponse.json({ error: { message: "Publication is required." } }, { status: 422 });
    if (body.action === "withdraw-week") {
      const publication = withdrawPublishedMenuWeek(body.publicationId, body.reason || "", actor.uid);
      void replayMenuPublicationOutbox(forwardProductionMaterialisationEvent).catch(() => undefined);
      return NextResponse.json({ publication });
    }
    if (!body.publicationDayId) return NextResponse.json({ error: { message: "Publication day is required." } }, { status: 422 });
    if (body.action === "withdraw") { const publication = withdrawPublishedMenuDay(body.publicationId, body.publicationDayId, body.reason || "", actor.uid); void replayMenuPublicationOutbox(forwardProductionMaterialisationEvent).catch(() => undefined); return NextResponse.json({ publication }); }
    if (body.action === "retry-archive") {
      const archive = await archivePublishedDayMatrix(body.publicationId, body.publicationDayId);
      return NextResponse.json({ publication: getMenuPublication(body.publicationId), archive });
    }
    return NextResponse.json({ error: { message: "Unknown publication command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Publication command failed." } }, { status }); }
}
