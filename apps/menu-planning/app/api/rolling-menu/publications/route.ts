import { NextRequest, NextResponse } from "next/server";
import { archivePublishedDayMatrix, getMenuPublication, listMenuPublications, listMenuPublicationsForDateRange, repairPublishedMenuPublication, withdrawPublishedMenuDay, withdrawPublishedMenuWeek } from "@/lib/menu-publication";
import { requirePublicationActor, resolveMenuActor, scopeMenuPublication } from "@/lib/auth";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";

async function handleGet(request: NextRequest) {
  const actor = await resolveMenuActor(request);
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  if (publicationId) {
    const publication = await getMenuPublication(publicationId);
    if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
    return NextResponse.json({ publication: scopeMenuPublication(publication, actor) });
  }
  const fromWeek = request.nextUrl.searchParams.get("fromWeek");
  const toWeek = request.nextUrl.searchParams.get("toWeek");
  if (fromWeek || toWeek) {
    if (!fromWeek || !toWeek || !/^\d{4}-\d{2}-\d{2}$/.test(fromWeek) || !/^\d{4}-\d{2}-\d{2}$/.test(toWeek) || fromWeek >= toWeek) return NextResponse.json({ error: { message: "A valid publication date range is required." } }, { status: 422 });
    return NextResponse.json({ publications: (await listMenuPublicationsForDateRange(fromWeek, toWeek)).map(publication => scopeMenuPublication(publication, actor)) });
  }
  return NextResponse.json({ publications: (await listMenuPublications()).map(publication => scopeMenuPublication(publication, actor)) });
}

async function handlePost(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; publicationId?: string; publicationDayId?: string; reason?: string; actor?: string };
    const actor = requirePublicationActor(await resolveMenuActor(request));
    if (body.action === "retry-handoff") {
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent);
      return NextResponse.json({ handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed } });
    }
    if (!body.publicationId) return NextResponse.json({ error: { message: "Publication is required." } }, { status: 422 });
    if (body.action === "repair-handoff") {
      const publication = await repairPublishedMenuPublication(body.publicationId);
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent);
      return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed } });
    }
    if (body.action === "withdraw-week") {
      const publication = await withdrawPublishedMenuWeek(body.publicationId, body.reason || "", actor.uid);
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent).catch(() => ({ delivered: 0, failed: 1 }));
      return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed } });
    }
    if (!body.publicationDayId) return NextResponse.json({ error: { message: "Publication day is required." } }, { status: 422 });
    if (body.action === "withdraw") { const publication = await withdrawPublishedMenuDay(body.publicationId, body.publicationDayId, body.reason || "", actor.uid); const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent).catch(() => ({ delivered: 0, failed: 1 })); return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: { status: handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed } }); }
    if (body.action === "retry-archive") {
      const archive = await archivePublishedDayMatrix(body.publicationId, body.publicationDayId);
      const publication = await getMenuPublication(body.publicationId);
      return NextResponse.json({ publication: publication ? scopeMenuPublication(publication, actor) : undefined, archive });
    }
    return NextResponse.json({ error: { message: "Unknown publication command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Publication command failed." } }, { status }); }
}
export async function GET(request: NextRequest) { return withDataTrace({ app: "menu-planning", action: "menu-planning.publications.load", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handleGet(request)); }
export async function POST(request: NextRequest) { return withDataTrace({ app: "menu-planning", action: "menu-planning.publications.mutation", path: request.nextUrl.pathname, requestId: request.headers.get("x-request-id") || undefined }, () => handlePost(request)); }
