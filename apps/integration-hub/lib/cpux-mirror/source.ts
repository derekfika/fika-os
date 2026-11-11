import { TIME_ZONE, londonTimestamp, type MirrorDetails, type MirrorSource } from "../../../shared/cpux-calendar/contract";
import type { CanonicalBooking } from "../hospitality-booking-service";
import type { ProductionOrder } from "../production-domain";

const cpu = new Set(["sandwiches", "hospitality", "delivered_in"]);

export function hasRecordedHospitalityHandoff(booking: CanonicalBooking) {
  return booking.statusHistory.some(entry => entry.status === "Sent to CPU");
}

function safeClientDisplayName(booking: CanonicalBooking) {
  const candidates = [booking.client.clientCompany, booking.client.clientName, booking.client.companyName];
  return candidates.map(value => typeof value === "string" ? value.trim() : "").find(value => value && !value.includes("@"));
}

export function hasCurrentHospitalityHandoff(booking: CanonicalBooking) {
  return (booking.lifecycleStatus === "Sent to CPU" || booking.lifecycleStatus === "Completed") && hasRecordedHospitalityHandoff(booking);
}

export function hospitalityMirrorSource(booking: CanonicalBooking, order: ProductionOrder | undefined) {
  if (!hasRecordedHospitalityHandoff(booking)) return undefined;
  if (order && (order.origin !== "hospitality_booking" || order.sourceBookingId !== booking.canonicalId))
    throw new Error("The Production Order does not belong to this Hospitality booking.");
  const handedOff = hasCurrentHospitalityHandoff(booking);
  if (handedOff && !order) throw new Error("The recorded CPU handoff has no verifiable current Production Order.");
  const site = booking.service.oplocId?.trim();
  if (!site) throw new Error("A canonical site is required for the booking Calendar.");
  const withdrawn = !handedOff || !order || ["amended", "cancelled", "rejected"].includes(order.status);
  const source: MirrorSource = {
    stream: "hospitality", identity: booking.canonicalId, revision: booking.version * 1_000_000 + (order?.version || 0),
    sourceReference: JSON.stringify([booking.canonicalId, booking.version, order?.canonicalId, order?.version, booking.quoteState?.currentRevisionId]),
    withdrawn,
  };
  if (withdrawn || !order) return { source, site };
  const lines = order.lines.filter(line => cpu.has(line.workstream || ""));
  if (!lines.length) return { site, source: { ...source, withdrawn: true } };
  if (lines.some(line => !line.canonicalId?.trim() || !line.sourceBookingLineId?.trim() || !line.itemName?.trim() ||
    typeof line.customerQuantity !== "number" || !Number.isFinite(line.customerQuantity) || line.customerQuantity <= 0 || !line.customerUnit?.trim()))
    throw new Error("CPU customer quantities, units, or line identities are unresolved.");
  const quote = booking.quoteState?.revisions.find(item => item.id === booking.quoteState?.currentRevisionId);
  const priorQuote = booking.quoteState?.revisions.find(item => item.id === order.sourceQuoteRevisionId);
  // Completed bookings can refresh charges without replacing the CPU order. Menu changes reopen the booking.
  const commercialRefresh = booking.lifecycleStatus === "Completed" && Boolean(priorQuote);
  if (!quote || quote.stale || (quote.commercialVersion !== undefined && quote.commercialVersion !== (booking.commercialVersion || 1)) ||
    (quote.id !== order.sourceQuoteRevisionId && !commercialRefresh) || quote.pdfStatus !== "saved" || !quote.driveFileId)
    throw new Error("The current approved quote PDF is missing or does not match the CPU handoff.");

  const service = booking.service;
  if (order.serviceDate !== service.eventDate || order.destinationOplocId !== site) throw new Error("The current order does not match the booking service date and destination.");
  const start = londonTimestamp(service.eventDate, service.startTime);
  const end = service.endTime ? londonTimestamp(service.eventDate, service.endTime) : new Date(Date.parse(start) + 60 * 60_000).toISOString();
  if (end <= start) throw new Error("The booking service time is invalid.");
  const label = service.portalSiteLabel || order.destinationLabel || site;
  const company = safeClientDisplayName(booking);
  const type = (booking.order.eventType || "Hospitality").replace(/[_\s]+/g, " ").trim() || "Hospitality";
  const location = [label, service.roomOrArea, service.deliveryPoint].filter(Boolean).join(" · ");
  const details: MirrorDetails = {
    summary: [label, ...(company && company !== label ? [company] : []), type + " x " + service.guestCount].join("_"),
    description: [
      "Booking: " + booking.canonicalId,
      "Service: " + service.eventDate + " " + service.startTime + " (UK) · " + service.guestCount + " guests",
      "Delivery: " + location,
      "FIKA OS: https://cpu.fikacatering.com/?order=" + encodeURIComponent(order.canonicalId) + "&date=" + service.eventDate,
      "", "CPU production:",
      ...lines.map(line => "• " + line.itemName + " — " + line.customerQuantity + " " + line.customerUnit.trim()),
    ].join("\n"),
    location, start: { dateTime: start, timeZone: TIME_ZONE }, end: { dateTime: end, timeZone: TIME_ZONE },
  };
  return { source, site, details, fileId: quote.driveFileId };
}
