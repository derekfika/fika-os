export type GallagherBookingSource = "legacy" | "fika-os";

export type GallagherBooking = {
  source: GallagherBookingSource;
  sourceBookingId: string;
  canonicalBookingId?: string;
  bookingReference: string;
  date: string;
  startTime: string;
  endTime: string;
  guestCount: number | null;
  items: Array<{ name: string; quantity: number | null; notes?: string }>;
  totalPrice: number | null;
  company: string;
  requesterName: string;
  requesterEmail: string;
  location: string;
  poReference: string;
  status: "Upcoming" | "Completed" | "Cancelled";
  notes: string;
  createdAt: string;
  updatedAt: string;
  /** Internal lineage only. The UI never renders this field. */
  supersededLegacyBookingId?: string;
  /** Internal filter evidence. Removed from the customer API response. */
  matchedBy?: "company" | "email-domain" | "both";
};

type LegacyBookingRow = Record<string, unknown>;
type FikaBooking = Record<string, any>;

const text = (value: unknown) => String(value ?? "").trim();
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : null;
};

export function normalizeCompany(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

export function exactEmailDomain(value: unknown) {
  const email = text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at) return "";
  return email.slice(at + 1).replace(/\.$/, "");
}

export function matchedGallagherRecord(company: unknown, email: unknown) {
  const companyMatch = normalizeCompany(company) === "gallagher";
  const emailMatch = exactEmailDomain(email) === "redington.co.uk";
  return companyMatch || emailMatch;
}

function matchReason(company: unknown, email: unknown): GallagherBooking["matchedBy"] {
  const companyMatch = normalizeCompany(company) === "gallagher";
  const emailMatch = exactEmailDomain(email) === "redington.co.uk";
  return companyMatch && emailMatch ? "both" : companyMatch ? "company" : emailMatch ? "email-domain" : undefined;
}

export function parseLegacyDate(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    const millis = Math.round((value - 25569) * 86400000);
    return new Date(millis).toISOString().slice(0, 10);
  }
  const raw = text(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const uk = raw.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (uk) return `${uk[3]}-${uk[2].padStart(2, "0")}-${uk[1].padStart(2, "0")}`;
  return "";
}

function legacyTimestamp(value: unknown, parsedValue: unknown) {
  const parsed = text(parsedValue);
  if (parsed) return parsed;
  if (typeof value === "number" && Number.isFinite(value)) {
    const date = new Date(Math.round((value - 25569) * 86400000)).toISOString();
    return `${date.slice(0, 16).replace("T", " ")} (Europe/London)`;
  }
  return text(value);
}

function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") return (value as T) ?? fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function legacyStatus(status: string, date: string, today: string): GallagherBooking["status"] {
  if (/cancel/i.test(status)) return "Cancelled";
  if (date && date < today || /^(ARCHIVED|COMPLETED)$/i.test(status)) return "Completed";
  return "Upcoming";
}

export function normalizeLegacyBooking(row: LegacyBookingRow, today: string): GallagherBooking {
  const parsed = parseJson<Record<string, unknown>>(row.ParsedJSON, {});
  const itemsRaw = parseJson<Array<Record<string, unknown>>>(row.ItemsJSON, Array.isArray(parsed.items) ? parsed.items as Array<Record<string, unknown>> : []);
  const times = parseJson<unknown[]>(row.ServiceTimes, Array.isArray(parsed.serviceTimes) ? parsed.serviceTimes : []);
  const items = itemsRaw.map((item) => ({
    name: text(item.name || item.itemName || item.item || item.description) || "Item",
    quantity: numberOrNull(item.qty ?? item.quantity),
    ...(text(item.notes || item.comments) ? { notes: text(item.notes || item.comments) } : {}),
  }));
  const reference = text(row.BookingID || parsed.bookingId);
  const date = parseLegacyDate(row.EventDate || parsed.eventDate);
  return {
    source: "legacy",
    sourceBookingId: reference,
    bookingReference: reference,
    date,
    startTime: text(times[0] || row.StartTime),
    endTime: text(row.EndTime || parsed.endTime),
    guestCount: numberOrNull(row.Pax ?? parsed.pax),
    items,
    // GrossPrice is the legacy quote's stored total-to-pay (after fee and VAT).
    totalPrice: numberOrNull(row.GrossPrice ?? parsed.grossPrice),
    company: text(row.ClientCompany || parsed.clientCompany),
    requesterName: text(row.HostName || parsed.hostName),
    requesterEmail: text(row.HostEmail || parsed.hostEmail),
    location: [text(row.Location || parsed.location), text(row.Floor || parsed.floor)].filter(Boolean).join(" · "),
    poReference: text(row.InvoiceReference || parsed.invoiceReference),
    status: legacyStatus(text(row.Status || parsed.status), date, today),
    notes: text(row.Notes || parsed.notes),
    createdAt: legacyTimestamp(row.CreatedAt, parsed.createdAt),
    updatedAt: legacyTimestamp(row.UpdatedAt, parsed.updatedAt),
    matchedBy: matchReason(row.ClientCompany || parsed.clientCompany, row.HostEmail || parsed.hostEmail),
  };
}

function currentQuoteTotal(booking: FikaBooking): number | null {
  const state = booking.quoteState;
  const revisions = Array.isArray(state?.revisions) ? state.revisions : [];
  const current = revisions.find((revision: Record<string, any>) => revision.id === state?.currentRevisionId)
    || revisions.at(-1);
  const snapshotGross = current?.snapshot?.totals?.gross?.amount;
  return numberOrNull(snapshotGross ?? booking.order?.grossTotal);
}

export function fikaBookingMatches(booking: FikaBooking) {
  const company = booking.client?.requester?.companyName || booking.client?.companyName;
  const email = booking.client?.requester?.email || booking.client?.email;
  return matchedGallagherRecord(company, email);
}

export function normalizeFikaBooking(booking: FikaBooking, today: string): GallagherBooking {
  const service = booking.service || {};
  const client = booking.client || {};
  const requester = client.requester || {};
  const date = text(service.eventDate);
  const rawStatus = text(booking.lifecycleStatus);
  const status = /cancel/i.test(rawStatus) ? "Cancelled" : date && date < today || /completed/i.test(rawStatus) ? "Completed" : "Upcoming";
  const sourceBookingId = text(booking.source?.sourceBookingId || booking.canonicalId);
  const originalPayload = booking.source?.originalPayload || {};
  const migratedLegacyId = text(
    booking.legacyBookingId || booking.source?.legacyBookingId || originalPayload.legacyBookingReference || originalPayload.legacyBookingId,
  );
  return {
    source: "fika-os",
    sourceBookingId,
    canonicalBookingId: text(booking.canonicalId),
    bookingReference: sourceBookingId,
    date,
    startTime: text(service.startTime),
    endTime: text(service.endTime),
    guestCount: numberOrNull(service.guestCount),
    items: (Array.isArray(booking.order?.items) ? booking.order.items : []).map((item: Record<string, unknown>) => ({
      name: text(item.itemName || item.description || item.itemId) || "Item",
      quantity: numberOrNull(item.quantity),
      ...(text(item.comments) ? { notes: text(item.comments) } : {}),
    })),
    totalPrice: currentQuoteTotal(booking),
    company: text(requester.companyName || client.companyName || client.clientCompany),
    requesterName: text(requester.name || client.name || client.clientName),
    requesterEmail: text(requester.email || client.email),
    location: [text(service.roomOrArea || service.floorLevel || service.deliveryPoint), text(service.portalSiteLabel)].filter(Boolean).join(" · "),
    poReference: text(client.invoiceReference),
    status,
    notes: text(booking.notes || booking.specialInstructions),
    createdAt: text(booking.createdAt),
    updatedAt: text(booking.updatedAt),
    ...(migratedLegacyId ? { supersededLegacyBookingId: migratedLegacyId } : {}),
    matchedBy: matchReason(requester.companyName || client.companyName || client.clientCompany, requester.email || client.email),
  };
}

export function aggregateGallagherBookings(legacyRows: LegacyBookingRow[], fikaRows: FikaBooking[], today: string) {
  const fika = fikaRows.filter(fikaBookingMatches).map((booking) => normalizeFikaBooking(booking, today));
  const superseded = new Set(fika.map((booking) => booking.supersededLegacyBookingId || booking.sourceBookingId));
  const legacy = legacyRows
    .map((row) => normalizeLegacyBooking(row, today))
    .filter((booking) => matchedGallagherRecord(booking.company, booking.requesterEmail))
    .filter((booking) => !superseded.has(booking.sourceBookingId));
  const bookings = [...legacy, ...fika].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.bookingReference.localeCompare(b.bookingReference));
  return {
    bookings,
    counts: {
      legacyMatches: legacyRows.map((row) => normalizeLegacyBooking(row, today)).filter((booking) => normalizeCompany(booking.company) === "gallagher").length,
      legacyEmailMatches: legacyRows.map((row) => normalizeLegacyBooking(row, today)).filter((booking) => exactEmailDomain(booking.requesterEmail) === "redington.co.uk").length,
      fikaMatches: fika.length,
      dedupedTotal: bookings.length,
    },
  };
}

export function partitionBookings(bookings: GallagherBooking[], today: string) {
  const upcoming = bookings.filter((booking) => booking.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const history = bookings.filter((booking) => booking.date < today).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  return { upcoming, history };
}
