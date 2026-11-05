import type { CanonicalBooking } from "./hospitality-booking-service";
import type { ProductionOrder } from "./production-domain";
import type { AuthModRepository } from "./authmod-core/repository";
import type { AuthPrincipal } from "./authmod-core/model";
import { resolveUserAccess } from "./authmod-core/evaluator";

type Reads = {
  order(id: string): Promise<ProductionOrder | undefined>;
  booking(id: string): Promise<CanonicalBooking>;
};

const unavailable = (message: string, status = 409) => Object.assign(new Error(message), { status });

/** Bounded, read-only resolution of the existing handoff and immutable PDF reference. */
export async function cpuXCalendarQuoteContext(bookingId: string, reads: Reads) {
  if (!/^booking:[^\s]{1,200}$/.test(bookingId)) throw unavailable("A canonical Hospitality Booking ID is required.", 400);
  let id = `production-order:v1:${bookingId}`;
  const visited = new Set<string>();
  let current: ProductionOrder | undefined;
  for (let depth = 0; depth < 10; depth += 1) {
    if (visited.has(id)) throw unavailable("The Production Order supersession chain contains a cycle.");
    visited.add(id);
    current = await reads.order(id);
    if (!current || current.canonicalId !== id || current.origin !== "hospitality_booking" || current.sourceBookingId !== bookingId) {
      throw unavailable("The canonical Hospitality Production Order could not be verified.", 404);
    }
    if (!current.supersededBy) break;
    id = current.supersededBy;
    current = undefined;
  }
  if (!current) throw unavailable("The Production Order supersession chain exceeds the supported depth.");
  const booking = await reads.booking(bookingId);
  if (booking.canonicalId !== bookingId) throw unavailable("The canonical Booking identity does not match.");
  const oplocId = booking.service.oplocId?.trim();
  if (!oplocId) throw unavailable("The quote Booking has no canonical OPLOC.");
  const revision = booking.quoteState?.revisions.find(value => value.id === current!.sourceQuoteRevisionId);
  const active = !["cancelled", "rejected", "amended"].includes(current.status) && booking.lifecycleStatus !== "Cancelled";
  const quote = active && revision && revision.id === booking.quoteState?.currentRevisionId && !revision.stale
    && revision.commercialVersion === (booking.commercialVersion || 1) && revision.pdfStatus === "saved"
    && revision.driveFileId && /^[a-zA-Z0-9_-]{1,200}$/.test(revision.driveFileId)
    ? { revisionId: revision.id, driveFileId: revision.driveFileId, url: `https://drive.google.com/file/d/${encodeURIComponent(revision.driveFileId)}/view` }
    : undefined;
  return { order: current, oplocId, ...(quote ? { quote } : {}) };
}

/** Resolve aliases before the existing AUTHMOD site decision, never by a display label. */
export function calendarQuoteOplocId(id: string, redirects: Record<string, string>) {
  const visited = new Set<string>();
  for (let depth = 0; depth < 10; depth += 1) {
    if (!id || visited.has(id)) throw unavailable("The quote OPLOC identity could not be resolved.", 403);
    visited.add(id);
    if (!redirects[id]) return id;
    id = redirects[id];
  }
  throw unavailable("The quote OPLOC redirect chain exceeds the supported depth.", 403);
}

export async function assertCpuXCalendarQuoteAccess(repository: AuthModRepository, principal: AuthPrincipal, sourceOplocId: string) {
  const oplocId = calendarQuoteOplocId(sourceOplocId, await repository.listOplocRedirects());
  const decision = await resolveUserAccess(repository, { principal, appId: "cpu-production", oplocId });
  if (!decision.allowed) throw unavailable("CPU Production access to this quote location was not granted.", decision.reasonCode === "store-unavailable" ? 503 : 403);
}
