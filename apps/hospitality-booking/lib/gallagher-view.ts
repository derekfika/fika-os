import type { GallagherBooking } from "@/lib/gallagher-dashboard";

/** Pure, client-safe view logic for the read-only Gallagher ledger. */

export type LedgerView = "upcoming" | "history";
export type StatusFilter = "all" | GallagherBooking["status"];
export type DateSort = "asc" | "desc";
export type LedgerFilters = { query: string; from: string; to: string; status: StatusFilter };

export const emptyFilters: LedgerFilters = { query: "", from: "", to: "", status: "all" };

const compareChronological = (a: GallagherBooking, b: GallagherBooking) =>
  a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime) || a.bookingReference.localeCompare(b.bookingReference);

/** A booking with no recorded date is never "upcoming"; it stays visible in History. */
export function viewOf(booking: GallagherBooking, today: string): LedgerView {
  return booking.date && booking.date >= today ? "upcoming" : "history";
}

export function splitByView(bookings: GallagherBooking[], today: string) {
  const upcoming: GallagherBooking[] = [];
  const history: GallagherBooking[] = [];
  for (const booking of bookings) (viewOf(booking, today) === "upcoming" ? upcoming : history).push(booking);
  return { upcoming, history };
}

export function defaultSort(view: LedgerView): DateSort {
  return view === "upcoming" ? "asc" : "desc";
}

export function sortBookings(bookings: GallagherBooking[], direction: DateSort) {
  const sorted = [...bookings].sort(compareChronological);
  return direction === "asc" ? sorted : sorted.reverse();
}

function haystack(booking: GallagherBooking) {
  return [
    booking.bookingReference, booking.poReference, booking.company, booking.bookingCompany, booking.endClientCompany, booking.requesterName, booking.requesterEmail,
    booking.location, booking.notes, booking.status,
    ...booking.items.map((item) => item.name),
  ].join(" ").toLocaleLowerCase("en-GB");
}

export function invalidDateRange(filters: Pick<LedgerFilters, "from" | "to">) {
  return Boolean(filters.from && filters.to && filters.from > filters.to);
}

export function filtersActive(filters: LedgerFilters) {
  return Boolean(filters.query.trim() || filters.from || filters.to || filters.status !== "all");
}

export function filterBookings(bookings: GallagherBooking[], filters: LedgerFilters) {
  const terms = filters.query.toLocaleLowerCase("en-GB").split(/\s+/).filter(Boolean);
  if (invalidDateRange(filters)) return [];
  return bookings.filter((booking) => {
    if (filters.status !== "all" && booking.status !== filters.status) return false;
    if (filters.from && (!booking.date || booking.date < filters.from)) return false;
    if (filters.to && (!booking.date || booking.date > filters.to)) return false;
    if (!terms.length) return true;
    const text = haystack(booking);
    return terms.every((term) => text.includes(term));
  });
}

/** Headline figures. Cancelled bookings never count as upcoming or completed. */
export function summarise(bookings: GallagherBooking[], today: string) {
  const live = bookings.filter((booking) => booking.status !== "Cancelled");
  const upcoming = live.filter((booking) => viewOf(booking, today) === "upcoming");
  const next = sortBookings(upcoming, "asc")[0] ?? null;
  return {
    upcoming: upcoming.length,
    completed: live.filter((booking) => viewOf(booking, today) === "history").length,
    cancelled: bookings.length - live.length,
    total: bookings.length,
    next,
  };
}

/** `YYYY-MM-DD` business dates formatted in the Europe/London zone, never via UTC slicing. */
export function formatBusinessDate(value: string, style: "short" | "long" = "short") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "Date not recorded";
  const noon = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: style === "long" ? "long" : "short",
    day: "numeric",
    month: style === "long" ? "long" : "short",
    year: "numeric",
  }).format(noon);
}

export function formatTimeRange(booking: Pick<GallagherBooking, "startTime" | "endTime">) {
  if (!booking.startTime) return "Not recorded";
  return booking.endTime ? `${booking.startTime} – ${booking.endTime}` : booking.startTime;
}

/** The client the meeting is for: the verified end client, else the company as recorded. */
export function clientLabel(booking: Pick<GallagherBooking, "endClientCompany" | "company">) {
  return booking.endClientCompany || booking.company || "";
}

export function summariseItems(items: GallagherBooking["items"], limit = 2) {
  if (!items.length) return "Items not recorded";
  const label = (item: GallagherBooking["items"][number]) => `${item.name}${item.quantity === null ? "" : ` × ${item.quantity}`}`;
  if (items.length <= limit) return items.map(label).join(", ");
  return `${items.slice(0, limit).map(label).join(", ")} +${items.length - limit} more`;
}

export function londonToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}
