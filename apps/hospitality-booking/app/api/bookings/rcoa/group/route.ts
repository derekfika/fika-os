import { assertBookingDate } from "@fika/server-shared/hospitality-effective-offering";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { recordDataAccess, setDataTraceOutcome, withDataTrace } from "@fika/server-shared/data-source-meter-server";
import { hubFetch } from "@/lib/hub";
import { buildRcoaGroupHubPayloads, RcoaGroupSubmissionSchema } from "@/lib/rcoa-booking-group";
import { loadGovernedRcoaMenu } from "@/lib/governed-rcoa-menu";
import { existingRcoaBookingIds } from "@/lib/rcoa-booking-replay";

/**
 * One public All Day Hospitality request. Every service row is validated BEFORE anything is created; then one ordinary
 * canonical RCoA Booking is created per service row, in sequence, through the same governed Hub path as a single booking. Child
 * references are deterministic (`<group>-01..NN`), so a retry of the whole group replays safely: existing children come back as
 * `created: false` and only the missing ones are created. Group success is reported only when every child exists.
 */
export async function POST(request: NextRequest) {
  return withDataTrace({ app: "hospitality-booking", action: "booking.create.rcoa.group", path: "/api/bookings/rcoa/group", outcome: "SUCCESS" }, async () => {
    const expectedOplocId = process.env.FIKA_RCOA_OPLOC_ID?.trim();
    if (!expectedOplocId) return NextResponse.json({ error: { message: "RCoA booking is unavailable until its governed OPLOC mapping is configured." } }, { status: 503 });

    let built: ReturnType<typeof buildRcoaGroupHubPayloads>;
    let existingIds: Set<string>;
    try {
      const submission = RcoaGroupSubmissionSchema.parse(await request.json());
      existingIds = await existingRcoaBookingIds(submission.requests.map(child => child.bookingId));
      const governedMenu = existingIds.size === submission.requests.length ? undefined : await loadGovernedRcoaMenu(expectedOplocId).catch(error => { throw Object.assign(error, { status: 503 }); });
      built = buildRcoaGroupHubPayloads(submission, governedMenu?.menu || [], governedMenu?.visibility, existingIds);
      const now = new Date().toISOString();
      for (const payload of built.payloads) if (!existingIds.has(payload.bookingId)) assertBookingDate(governedMenu!.menu.filter(item => payload.order.items.some(line => line.itemId === item.id)), payload.event.eventDate, now, { site: "rcoa", occasion: payload.order.eventType, startTime: payload.event.startTime });
    } catch (error) {
      const message = error instanceof ZodError ? "Some booking information was incomplete. Check each service and try again." : (error as Error).message || "The RCoA request is invalid.";
      return NextResponse.json({ error: { message, ...((error as { code?: string }).code ? { code: (error as { code: string }).code } : {}), ...((error as { earliestDate?: string }).earliestDate ? { earliestDate: (error as { earliestDate: string }).earliestDate } : {}) } }, { status: (error as { status?: number }).status || 400 });
    }

    const { groupId, payloads } = built;
    const bookings: Array<{ sequence: number; reference: string; canonicalBookingId: string; created: boolean; startTime: string }> = [];
    for (const payload of payloads) {
      const sequence = payload.bookingGroup!.sequence;
      try {
        const response = await hubFetch("/api/bookings/mnk", {
          method: "POST",
          headers: { "content-type": "application/json", "x-fika-expected-rcoa-oploc-id": expectedOplocId, ...(existingIds.has(payload.bookingId) ? { "x-fika-rcoa-existing-only": "true" } : {}) },
          body: JSON.stringify(payload),
        });
        recordDataAccess({ operation: "booking.create.rcoa.group", source: "NETWORK_UPSTREAM", documents: 0, dataset: "hospitality/bookings" });
        const bodyText = await response.text();
        let body: { canonicalBookingId?: string; created?: boolean; error?: { message?: string } } = {};
        try { body = JSON.parse(bodyText); } catch { /* handled below */ }
        if (!response.ok || !body.canonicalBookingId) {
          console.error("hospitality.booking.create.rcoa.group.child-failed", { groupId, sequence, size: payloads.length, completed: bookings.length, status: response.status });
          setDataTraceOutcome("ERROR");
          // Not a group success: report exactly what exists so the retry (same group id) only creates what is missing.
          return NextResponse.json({ error: { message: `Service ${sequence} could not be sent. Nothing needs to be re-entered: please try again.` }, group: { id: groupId, size: payloads.length, completed: bookings.length, bookings } }, { status: response.status >= 400 && response.status < 500 && response.status !== 429 ? response.status : 502 });
        }
        bookings.push({ sequence, reference: payload.bookingId, canonicalBookingId: body.canonicalBookingId, created: Boolean(body.created), startTime: payload.event.startTime });
      } catch (error) {
        console.error("hospitality.booking.create.rcoa.group.child-error", { groupId, sequence, size: payloads.length, completed: bookings.length, message: (error as Error).message });
        setDataTraceOutcome("ERROR");
        return NextResponse.json({ error: { message: `Service ${sequence} could not be sent. Nothing needs to be re-entered: please try again.` }, group: { id: groupId, size: payloads.length, completed: bookings.length, bookings } }, { status: 503 });
      }
    }
    return NextResponse.json({ group: { id: groupId, size: payloads.length, completed: bookings.length, bookings }, created: bookings.filter((booking) => booking.created).length });
  });
}
