import { NextRequest, NextResponse } from "next/server";
import { archivePublishedDayMatrix, getMenuPublication, listMenuPublications, withdrawPublishedMenuDay } from "@/lib/menu-publication";
import { requirePublicationActor, resolveMenuActor } from "@/lib/auth";
import { forwardFulfilmentEvent } from "../../../../../shared/fulfilment-client";
import { replayMenuPublicationOutbox } from "@/lib/menu-publication";

export async function GET(request: NextRequest) {
  const publicationId = request.nextUrl.searchParams.get("publicationId");
  if (publicationId) {
    const publication = getMenuPublication(publicationId);
    if (!publication) return NextResponse.json({ error: { message: "Menu publication was not found." } }, { status: 404 });
    return NextResponse.json({ publication });
  }
  return NextResponse.json({ publications: listMenuPublications() });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as { action?: string; publicationId?: string; publicationDayId?: string; reason?: string; actor?: string };
    const actor = requirePublicationActor(await resolveMenuActor(request));
    if (!body.publicationId || !body.publicationDayId) return NextResponse.json({ error: { message: "Publication and publication day are required." } }, { status: 422 });
    if (body.action === "withdraw") { const publication = withdrawPublishedMenuDay(body.publicationId, body.publicationDayId, body.reason || "", actor.uid); void replayMenuPublicationOutbox(forwardFulfilmentEvent).catch(() => undefined); return NextResponse.json({ publication }); }
    if (body.action === "retry-archive") {
      const archive = await archivePublishedDayMatrix(body.publicationId, body.publicationDayId);
      return NextResponse.json({ publication: getMenuPublication(body.publicationId), archive });
    }
    return NextResponse.json({ error: { message: "Unknown publication command." } }, { status: 400 });
  } catch (error) { const status = error && typeof error === "object" && "status" in error ? Number((error as { status?: unknown }).status) || 400 : 400; return NextResponse.json({ error: { message: error instanceof Error ? error.message : "Publication command failed." } }, { status }); }
}
