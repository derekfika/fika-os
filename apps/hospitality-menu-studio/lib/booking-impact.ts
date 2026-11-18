import { z } from "zod";
import type { Review } from "./contract";
import type { PublicationImpactTarget } from "./publication";
import { dateSchema } from "./schema";

const canonicalItemId = z.string().regex(/^hospitality-menu-item:[a-z0-9][a-z0-9:._-]{0,180}$/i);
const responseSchema = z.object({
  scope: z.literal("catalogue-item"), coverage: z.enum(["complete", "partial"]),
  reasons: z.array(z.enum(["BOOKING_WINDOW_TRUNCATED", "BOOKING_IDENTITY_UNAVAILABLE", "DISH_SELECTION_EVIDENCE_UNAVAILABLE", "SITE_UNAVAILABLE"])).max(4),
  bookings: z.array(z.object({ id: z.string().min(1).max(256), eventDate: dateSchema, site: z.string().min(1).max(256),
    selectionIds: z.array(canonicalItemId).min(1).max(50), selections: z.array(z.string().min(1).max(256)).min(1).max(50),
  }).strict().refine(booking => booking.selectionIds.length === booking.selections.length)).max(250),
}).strict().refine(result => (result.coverage === "complete") === (result.reasons.length === 0));

export async function readStudioBookingImpact(hub: string, sessionCookie: string, target: PublicationImpactTarget,
  requestHub: typeof fetch = fetch): Promise<Review["impact"]> {
  const unavailable = { status: "unavailable" } as const;
  const span = Date.parse(target.lastEventDate) - Date.parse(target.firstEventDate);
  if (!sessionCookie || !target.catalogueItemIds.length || target.catalogueItemIds.length > 50 || !Number.isFinite(span)
    || span < 0 || span > 366 * 86_400_000 || target.catalogueItemIds.some(id => !canonicalItemId.safeParse(id).success)) return unavailable;
  try {
    const response = await requestHub(`${hub}/api/hospitality-studio-impact`, {
      method: "POST", headers: { cookie: sessionCookie, accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(target), redirect: "error", cache: "no-store", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok || !response.body) return unavailable;
    const reader = response.body.getReader();
    const bytes: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.byteLength;
        if (length > 768_000) { await reader.cancel(); return unavailable; }
        bytes.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const parsed = responseSchema.safeParse(JSON.parse(Buffer.concat(bytes).toString("utf8")));
    if (!parsed.success || new Set(parsed.data.bookings.map(booking => booking.id)).size !== parsed.data.bookings.length
      || parsed.data.bookings.some(booking => booking.eventDate < target.firstEventDate || booking.eventDate > target.lastEventDate)) return unavailable;
    const { coverage, reasons, bookings } = parsed.data;
    return { status: "available", coverage, reasons, bookings: bookings.sort((left, right) => left.eventDate.localeCompare(right.eventDate) || left.id.localeCompare(right.id)) };
  } catch { return unavailable; }
}
