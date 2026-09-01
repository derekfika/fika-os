import { NextRequest, NextResponse } from "next/server";
import { errorResponse } from "../../../../lib/api";
import { publishPublicationChanged, type PublicationChangedEvent } from "../../../../lib/publication-events";
import { internalCpuRequestAllowed } from "../../../../lib/cpu-internal-auth";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    if (!internalCpuRequestAllowed(request)) return NextResponse.json({ error: { message: "Internal CPU publication access is not authorised." } }, { status: 401 });
    const body = await request.json() as Partial<PublicationChangedEvent>;
    if (body.event !== "publication_changed" || !body.publicationDayId || !body.serviceDate || !body.version || !body.action) {
      return NextResponse.json({ error: { message: "A valid publication change event is required." } }, { status: 422 });
    }
    publishPublicationChanged({ event: "publication_changed", publicationDayId: body.publicationDayId, serviceDate: body.serviceDate, version: Number(body.version), action: body.action });
    return NextResponse.json({ accepted: true });
  } catch (error) { return errorResponse(error); }
}
