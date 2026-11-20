import { NextRequest, NextResponse } from "next/server";
import { hubFetch } from "@/lib/hub";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { sessionCookieConfig } from "@fika/server-shared/runtime-config";
import { isStudioDishChoice } from "../../../../shared/hospitality-menu-studio-selection";
import { studioHospitalityOrigin, studioPortalPilot } from "@/lib/studio-portal-pilot";

/** The browser only gets a safe message; the upstream status, code and requestId stay in the server log so the failure can be traced. */
function logUpstreamRejection(path: string, status: number, bodyText: string) {
  try {
    const error = (JSON.parse(bodyText) as { error?: { code?: unknown; requestId?: unknown } }).error;
    console.error("hospitality.booking.create.upstream-rejected", { path, status, code: typeof error?.code === "string" ? error.code : undefined, hubRequestId: typeof error?.requestId === "string" ? error.requestId : undefined });
  } catch { console.error("hospitality.booking.create.upstream-rejected", { path, status }); }
}

export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create", path: "/api/bookings", outcome: "SUCCESS" }, async () => { try {
    const payload = await request.json();
    // RCoA has a governed submit path (trusted payload + expected OPLOC). The generic form cannot supply either, so refuse clearly
    // here instead of forwarding a payload the Hub must reject with an opaque 503.
    if (String(payload?.siteId || "").trim().toLowerCase() === "rcoa") {
      console.warn("hospitality.booking.create.rcoa-on-generic-route", { path: "/api/bookings" });
      return NextResponse.json({ error: { message: "RCoA bookings must be submitted through the RCoA booking form." } }, { status: 422 });
    }
    const endpoint = "/api/bookings/mnk";
    const headers: Record<string, string> = { "content-type": "application/json" };
    const includesStudio = Array.isArray(payload?.order?.items) && payload.order.items.some((item: { choices?: unknown }) =>
      Array.isArray(item?.choices) && item.choices.some(isStudioDishChoice));
    if (includesStudio) {
      const pilot = studioPortalPilot();
      const eventDate = payload?.event?.eventDate;
      const email = payload?.client?.email;
      const requesterEmail = payload?.client?.requester?.email;
      if (!pilot || payload?.siteId !== "mnk" || request.headers.get("origin") !== studioHospitalityOrigin ||
          request.headers.get("sec-fetch-site") === "cross-site" || typeof eventDate !== "string" ||
          eventDate < pilot.firstDate || eventDate > pilot.lastDate || typeof email !== "string" || !email.endsWith("@example.test") ||
          (requesterEmail && (typeof requesterEmail !== "string" || !requesterEmail.endsWith("@example.test")))) {
        return NextResponse.json({ error: { message: "This booking is outside the approved Studio rehearsal." } }, { status: 403 });
      }
      const cookieName = sessionCookieConfig().name;
      const cookie = request.cookies.get(cookieName)?.value;
      if (!cookie) return NextResponse.json({ error: { message: "Sign in using the approved rehearsal account." } }, { status: 401 });
      headers.cookie = `${cookieName}=${encodeURIComponent(cookie)}`;
      payload.bookingId = pilot.bookingId;
    }
    const response = await hubFetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });
    recordDataAccess({ operation: "booking.create", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
    const bodyText = await response.text();
    if (!response.ok) logUpstreamRejection("/api/bookings", response.status, bodyText);
    try {
      return NextResponse.json(JSON.parse(bodyText), {
        status: response.status,
      });
    } catch {
      return NextResponse.json(
        {
          error: {
            message: `The Canon bridge returned an unexpected response (HTTP ${response.status}). Check that the Integration Hub is running on port 3200 and the bridge token matches.`,
          },
        },
        { status: response.ok ? 502 : response.status },
      );
    }
  } catch (error) { setDataTraceOutcome("ERROR");
    return NextResponse.json(
      { error: { message: (error as Error).message } },
      { status: 503 },
    );
  } });
}
