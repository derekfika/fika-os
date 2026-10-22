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
  /** Company exactly as recorded (legacy `ClientCompany` is NOT verified to be the booking company). */
  company: string;
  /** Requester's own company; only set when the source record explicitly distinguishes it from the end client. */
  bookingCompany: string;
  /** End-client company the meeting is for; only set when explicitly distinguished from the booking company. */
  endClientCompany: string;
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
};

type LegacyBookingRow = Record<string, unknown>;
type FikaBooking = Record<string, any>;

const text = (value: unknown) => String(value ?? "").trim();
const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const valueNumber = Number(value);
  return Number.isFinite(valueNumber) ? valueNumber : null;
};

export const GALLAGHER_REQUESTER_DOMAIN = "redington.co.uk";

export function normalizeCompany(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

/** Same normalisation as the Gallagher commercial rule: case, spaces and punctuation are ignored. */
export function isGallagherCompanyName(value: unknown) {
  return text(value).toLocaleLowerCase("en-GB").replace(/[^a-z0-9]/g, "") === "gallagher";
}

export function normalizeEmail(value: unknown) {
  return text(value).replace(/\s+/g, " ").toLocaleLowerCase("en-GB");
}

/** The exact domain of a single, well-formed address; anything ambiguous yields "". */
export function exactEmailDomain(value: unknown) {
  const email = normalizeEmail(value);
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1 || email.indexOf("@") !== at || /[\s,;<>]/.test(email)) return "";
  return email.slice(at + 1);
}

export function isRedingtonRequesterEmail(value: unknown) {
  return exactEmailDomain(value) === GALLAGHER_REQUESTER_DOMAIN;
}

/**
 * Confirmed customer visibility rule (dashboard visibility only; the Gallagher
 * commercial/minimum-order rules are separate and unchanged). A booking is shown
 * when EITHER the requester's email domain is exactly `redington.co.uk` (no
 * subdomains or look-alikes) OR the BOOKING company, not the end-client company,
 * is Gallagher. `bookingCompany` must be "" when the source cannot verify that
 * a company field means the booking company, so an end-client name never counts.
 */
export function isVisibleToGallagher(input: { requesterEmail: unknown; bookingCompany: unknown }) {
  return isRedingtonRequesterEmail(input.requesterEmail) || isGallagherCompanyName(input.bookingCompany);
}

/**
 * Legacy Apps Script rows. `ClientCompany` holds the END client for client-platform
 * submissions (`clientCompany: booking.client.clientCompanyName`); the requester's
 * own company is `clientBooking.client.companyName`. That split is only verifiable
 * when the row's ParsedJSON carries the original `clientBooking.client` payload.
 * Rows without it (e.g. scanned from email) keep `ClientCompany` as an unverified
 * recorded value and can match on the requester domain only.
 */
export function legacyCompanies(row: LegacyBookingRow) {
  const parsed = parseJson<Record<string, unknown>>(row.ParsedJSON, {});
  const recorded = text(row.ClientCompany || parsed.clientCompany);
  const original = (parsed.clientBooking && typeof parsed.clientBooking === "object" ? (parsed.clientBooking as Record<string, unknown>).client : undefined) as Record<string, unknown> | undefined;
  if (original && typeof original === "object" && "clientCompanyName" in original) {
    return { recorded, bookingCompany: text(original.companyName), endClientCompany: text(original.clientCompanyName) || recorded, verified: true };
  }
  return { recorded, bookingCompany: "", endClientCompany: "", verified: false };
}

export function legacyRowVisible(row: LegacyBookingRow) {
  const parsed = parseJson<Record<string, unknown>>(row.ParsedJSON, {});
  return isVisibleToGallagher({ requesterEmail: row.HostEmail || parsed.hostEmail, bookingCompany: legacyCompanies(row).bookingCompany });
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
  const companies = legacyCompanies(row);
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
    company: companies.recorded,
    bookingCompany: companies.bookingCompany,
    endClientCompany: companies.endClientCompany,
    requesterName: text(row.HostName || parsed.hostName),
    requesterEmail: text(row.HostEmail || parsed.hostEmail),
    location: [text(row.Location || parsed.location), text(row.Floor || parsed.floor)].filter(Boolean).join(" · "),
    poReference: text(row.InvoiceReference || parsed.invoiceReference),
    status: legacyStatus(text(row.Status || parsed.status), date, today),
    notes: text(row.Notes || parsed.notes),
    createdAt: legacyTimestamp(row.CreatedAt, parsed.createdAt),
    updatedAt: legacyTimestamp(row.UpdatedAt, parsed.updatedAt),
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

/**
 * Canonical bookings: the portal payload carries the requester's company
 * (`requester.companyName`/`companyName`) separately from the end client
 * (`clientCompany`/`clientName`). The split is trusted only when the record
 * carries the end-client fields; otherwise the company is unverified.
 */
export function fikaCompanies(booking: FikaBooking) {
  const client = booking.client || {};
  const requester = client.requester || {};
  const distinguished = client.clientCompany !== undefined || client.clientName !== undefined;
  return {
    bookingCompany: distinguished ? text(requester.companyName || client.companyName) : "",
    endClientCompany: distinguished ? text(client.clientCompany) : "",
    recorded: text(requester.companyName || client.companyName || client.clientCompany),
  };
}

export function fikaBookingMatches(booking: FikaBooking) {
  const client = booking.client || {};
  return isVisibleToGallagher({ requesterEmail: client.requester?.email || client.email, bookingCompany: fikaCompanies(booking).bookingCompany });
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
    company: fikaCompanies(booking).recorded,
    bookingCompany: fikaCompanies(booking).bookingCompany,
    endClientCompany: fikaCompanies(booking).endClientCompany,
    requesterName: text(requester.name || client.name || client.clientName),
    requesterEmail: text(requester.email || client.email),
    location: [text(service.roomOrArea || service.floorLevel || service.deliveryPoint), text(service.portalSiteLabel)].filter(Boolean).join(" · "),
    poReference: text(client.invoiceReference),
    status,
    notes: text(booking.notes || booking.specialInstructions),
    createdAt: text(booking.createdAt),
    updatedAt: text(booking.updatedAt),
    ...(migratedLegacyId ? { supersededLegacyBookingId: migratedLegacyId } : {}),
  };
}

export function aggregateGallagherBookings(legacyRows: LegacyBookingRow[], fikaRows: FikaBooking[], today: string) {
  const fika = fikaRows.filter(fikaBookingMatches).map((booking) => normalizeFikaBooking(booking, today));
  const superseded = new Set(fika.map((booking) => booking.supersededLegacyBookingId || booking.sourceBookingId));
  const legacyVisible = legacyRows.filter(legacyRowVisible).map((row) => normalizeLegacyBooking(row, today));
  const legacy = legacyVisible.filter((booking) => !superseded.has(booking.sourceBookingId));
  const bookings = [...legacy, ...fika].sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.bookingReference.localeCompare(b.bookingReference));
  return {
    bookings,
    counts: { legacyMatches: legacyVisible.length, fikaMatches: fika.length, dedupedTotal: bookings.length },
  };
}

export function partitionBookings(bookings: GallagherBooking[], today: string) {
  const upcoming = bookings.filter((booking) => booking.date >= today).sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime));
  const history = bookings.filter((booking) => booking.date < today).sort((a, b) => b.date.localeCompare(a.date) || b.startTime.localeCompare(a.startTime));
  return { upcoming, history };
}
