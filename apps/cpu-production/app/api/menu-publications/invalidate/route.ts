import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/api";
import { publishPublicationChanged, type PublicationChangedEvent } from "../../../../lib/publication-events";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Partial<PublicationChangedEvent>;
    if (body.event !== "publication_changed" || !body.publicationDayId || !body.serviceDate || !body.version || !body.action) {
      return NextResponse.json({ error: { message: "A valid publication change event is required." } }, { status: 422 });
    }
    publishPublicationChanged({ event: "publication_changed", publicationDayId: body.publicationDayId, serviceDate: body.serviceDate, version: Number(body.version), action: body.action });
    return NextResponse.json({ accepted: true });
  } catch (error) { return errorResponse(error); }
}
