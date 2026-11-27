import { NextRequest, NextResponse } from "next/server";
import { archivePublishedDayMatrix, getMenuPublication, listMenuPublications, listMenuPublicationsForDateRange, repairPublishedMenuPublication, withdrawPublishedMenuDay, withdrawPublishedMenuWeek } from "@/lib/menu-publication";
import { actorCanWriteOneOff, requirePublicationActor, resolveMenuActor, scopeMenuPublication } from "@/lib/auth";
import { assertPublishedMenuDaysScope } from "@/lib/menu-mutation-scope";
import { readGovernedOplocs } from "@/lib/oploc-authority";
import type { PublishedMenuDay } from "@/lib/menu-publication";
import { forwardProductionMaterialisationEvent } from "@/lib/production-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";
import { getMenuPlanningEvent, listMenuPlanningEventIdsForPublication } from "@/lib/operational-store";
import { withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { getPublicationHandoff, queuedPublicationHandoff } from "@/lib/publication-handoff";
import { isPublicationEventForPublication, publicationEventDiagnostic } from "@/lib/publication-event-diagnostic";

async function handleGet(request: NextRequest) {
  const actor = await resolveMenuActor(request);
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  const eventId = request.nextUrl.searchParams.get("eventId");
  if (eventId !== null) {
    if (!publicationId) return NextResponse.json({ error: { message: "Publication is required for an event diagnostic." } }, { status: 422 });
    if (!actorCanWriteOneOff(actor, "publish")) return NextResponse.json({ error: { message: "Event diagnostics require organisation-wide Menu Publish authority." } }, { status: 403 });
    if (!publicationId.trim() || publicationId.length > 500 || publicationId.includes("/")) return NextResponse.json({ error: { message: "A valid publication reference is required." } }, { status: 422 });
    if (!eventId.trim() || eventId.length > 2000 || eventId.includes("/")) return NextResponse.json({ error: { message: "A valid event reference is required." } }, { status: 422 });
    const publication = await getMenuPublication(publicationId);
    if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
    const event = await getMenuPlanningEvent(eventId);
    if (!event || !isPublicationEventForPublication(event, publicationId)) return NextResponse.json({ error: { message: "Publication event was not found." } }, { status: 404 });
    return NextResponse.json({ event: publicationEventDiagnostic(event) }, { headers: { "Cache-Control": "no-store" } });
  }
  if (publicationId) {
    const publication = await getMenuPublication(publicationId);
    if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
    return NextResponse.json({ publication: scopeMenuPublication(publication, actor), ...(actor.allOplocs ? { handoff: await getPublicationHandoff(publicationId) } : {}) });
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
    const actor = requirePublicationActor(await resolveMenuActor(request));
    const body = await request.json() as { action?: string; publicationId?: string; publicationDayId?: string; reason?: string };
    if (["retry-handoff", "repair-handoff", "retry-archive"].includes(body.action || "") && !actorCanWriteOneOff(actor, "publish")) {
      throw Object.assign(new Error("Publication recovery requires Menu Publish authority across all sites."), { status: 403 });
    }
    if (body.action === "retry-handoff") {
      if (!body.publicationId) return NextResponse.json({ error: { message: "Publication is required for a targeted handoff retry." } }, { status: 422 });
      const eventIds = await listMenuPlanningEventIdsForPublication(body.publicationId);
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent, new Date(), { eventIds, resetDeadLetter: true });
      return NextResponse.json({ handoff: await getPublicationHandoff(body.publicationId) });
    }
    if (!body.publicationId) return NextResponse.json({ error: { message: "Publication is required." } }, { status: 422 });
    if (body.action === "repair-handoff") {
      const publication = await repairPublishedMenuPublication(body.publicationId);
      const handoff = await replayMenuPublicationOutbox(forwardProductionMaterialisationEvent, new Date(), { eventIds: publication.handoffEventIds, resetDeadLetter: true });
      return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: { status: handoff.deadLettered ? "intervention-required" : handoff.pending || handoff.failed ? "pending" : "delivered", delivered: handoff.delivered, failed: handoff.failed, pending: handoff.pending, deadLettered: handoff.deadLettered } });
    }
    if (body.action === "withdraw-week") {
      const oplocs = await readGovernedOplocs(request);
      const aliases = new Map(oplocs.flatMap(oploc => (oploc.legacyIds || []).map(id => [id, oploc.canonicalId] as const)));
      const authorize = (days: PublishedMenuDay[]) => assertPublishedMenuDaysScope(days, actor, aliases);
      const publication = await withdrawPublishedMenuWeek(body.publicationId, body.reason || "", actor.uid, authorize);
      return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: queuedPublicationHandoff(publication) });
    }
    if (!body.publicationDayId) return NextResponse.json({ error: { message: "Publication day is required." } }, { status: 422 });
    if (body.action === "withdraw") {
      const oplocs = await readGovernedOplocs(request);
      const aliases = new Map(oplocs.flatMap(oploc => (oploc.legacyIds || []).map(id => [id, oploc.canonicalId] as const)));
      const authorize = (days: PublishedMenuDay[]) => assertPublishedMenuDaysScope(days, actor, aliases);
      const publication = await withdrawPublishedMenuDay(body.publicationId, body.publicationDayId, body.reason || "", actor.uid, authorize);
      return NextResponse.json({ publication: scopeMenuPublication(publication, actor), handoff: queuedPublicationHandoff(publication) });
    }
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
