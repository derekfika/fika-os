import { z } from "zod";
import { hubFetch } from "@/lib/hub";
import { studioPortalPilot } from "@/lib/studio-portal-pilot";

const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const pilot = studioPortalPilot();
  if (!pilot) return Response.json({ code: "STUDIO_PORTAL_DISABLED" }, { status: 404, headers });
  const date = z.iso.date().safeParse(new URL(request.url).searchParams.get("eventDate"));
  if (!date.success || date.data < pilot.firstDate || date.data > pilot.lastDate) {
    return Response.json({ code: "STUDIO_PILOT_DATE" }, { status: 403, headers });
  }
  try {
    const query = new URLSearchParams({ oplocId: pilot.oplocId, serviceDate: date.data });
    const response = await hubFetch(`/api/hospitality-menu/portal?${query}`);
    if (!response.ok) throw Error();
    const catalogue = await response.json() as { request?: { oplocId?: string; serviceDate?: string }; offerings?: unknown[] };
    if (catalogue.request?.oplocId !== pilot.oplocId || catalogue.request.serviceDate !== date.data || !Array.isArray(catalogue.offerings)) throw Error();
    return Response.json({ offerings: catalogue.offerings }, { headers });
  } catch {
    return Response.json({ code: "STUDIO_CATALOGUE_UNAVAILABLE" }, { status: 503, headers });
  }
}
