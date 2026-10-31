/**
 * Pure search / filter / sort model for the Hospitality operations dashboard.
 *
 * It only narrows what the server has already authorised for the current
 * dashboard (site and OPLOC scoping happens in `/api/dashboard-bookings`; the
 * dashboard is site-locked, so there is deliberately no site filter here), so it
 * never widens visibility and never reads or writes anything. Booking and group
 * identities stay the canonical IDs; cancelled history is visible unless the
 * operator explicitly filters it out.
 */

export type QueueBooking = {
  canonicalId: string;
  lifecycleStatus: string;
  updatedAt?: string;
  source?: { sourceBookingId?: string };
  client?: {
    name?: string;
    companyName?: string;
    clientName?: string;
    clientCompany?: string;
    requester?: { name?: string; companyName?: string };
  };
  service?: { eventDate?: string; startTime?: string };
};

export type QueueGroup = {
  id: string;
  reference?: string;
  status: string;
  eventDate?: string;
  firstTime?: string;
  client?: { name?: string; companyName?: string };
  services?: Array<{ bookingId: string; sourceReference?: string }>;
};

export type QueueSort = "service-asc" | "service-desc" | "updated-desc";

export const queueSortOptions: ReadonlyArray<{ value: QueueSort; label: string }> = [
  { value: "service-asc", label: "Service date, earliest first" },
  { value: "service-desc", label: "Service date, latest first" },
  { value: "updated-desc", label: "Recently updated" },
];

export type QueueFilters = {
  search: string;
  /** Selected display statuses; empty means every status. */
  statuses: readonly string[];
  /** Inclusive Europe/London business dates as `YYYY-MM-DD`; empty means open-ended. */
  dateFrom: string;
  dateTo: string;
  sort: QueueSort;
};

export const emptyQueueFilters: QueueFilters = {
  search: "",
  statuses: [],
  dateFrom: "",
  dateTo: "",
  sort: "service-asc",
};

/** Canonical operational order, used to list the statuses that are actually present. */
const STATUS_ORDER = [
  "New", "Reviewed", "Quote preparing", "Awaiting quote", "Awaiting routing", "Quoted",
  "Ready for CPU", "Sent to CPU", "Partially processed", "Needs attention", "Completed", "Cancelled",
];

/** The label operators already see for a standalone booking (`Approved` is shown as Ready for CPU). */
export function queueStatusLabel(status: string) {
  return status === "Approved" ? "Ready for CPU" : status;
}

export type QueueRow =
  | { kind: "booking"; id: string; booking: QueueBooking }
  | { kind: "group"; id: string; group: QueueGroup };

export function hasActiveFilters(filters: QueueFilters) {
  return Boolean(filters.search.trim() || filters.statuses.length || filters.dateFrom || filters.dateTo);
}

const normalise = (value: string | undefined) => (value || "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

function rowStatus(row: QueueRow) {
  return queueStatusLabel(row.kind === "booking" ? row.booking.lifecycleStatus : row.group.status);
}

function rowDate(row: QueueRow) {
  return (row.kind === "booking" ? row.booking.service?.eventDate : row.group.eventDate) || "";
}

function rowTime(row: QueueRow) {
  return (row.kind === "booking" ? row.booking.service?.startTime : row.group.firstTime) || "";
}

/** Text a search term is matched against: who booked, and every reference we hold for the row. */
function searchHaystack(row: QueueRow) {
  if (row.kind === "booking") {
    const { booking } = row;
    return [
      booking.client?.name, booking.client?.companyName, booking.client?.clientName, booking.client?.clientCompany,
      booking.client?.requester?.name, booking.client?.requester?.companyName,
      booking.canonicalId, booking.source?.sourceBookingId,
    ];
  }
  const { group } = row;
  return [
    group.client?.name, group.client?.companyName, group.reference, group.id,
    ...(group.services || []).flatMap((service) => [service.bookingId, service.sourceReference]),
  ];
}

export function rowMatches(row: QueueRow, filters: QueueFilters) {
  const terms = normalise(filters.search).split(" ").filter(Boolean);
  if (terms.length) {
    const haystack = normalise(searchHaystack(row).filter(Boolean).join(" "));
    if (!terms.every((term) => haystack.includes(term))) return false;
  }
  if (filters.statuses.length && !filters.statuses.includes(rowStatus(row))) return false;
  const date = rowDate(row);
  // A row with no service date can never be shown to satisfy a date range.
  if (filters.dateFrom && (!date || date < filters.dateFrom)) return false;
  if (filters.dateTo && (!date || date > filters.dateTo)) return false;
  return true;
}

/** Latest `updatedAt` of a row; groups use their member bookings, which hold the audit time. */
function updatedTime(row: QueueRow, updatedByBooking: ReadonlyMap<string, string>) {
  if (row.kind === "booking") return row.booking.updatedAt || "";
  return (row.group.services || []).reduce((latest, service) => {
    const value = updatedByBooking.get(service.bookingId) || "";
    return value > latest ? value : latest;
  }, "");
}

function compareService(left: QueueRow, right: QueueRow) {
  const leftDate = rowDate(left);
  const rightDate = rowDate(right);
  // Rows without a date sort last in both directions so they stay findable but never lead the queue.
  if (!leftDate !== !rightDate) return leftDate ? -1 : 1;
  return leftDate.localeCompare(rightDate) || rowTime(left).localeCompare(rowTime(right)) || left.id.localeCompare(right.id);
}

export function sortRows(rows: readonly QueueRow[], sort: QueueSort, updatedByBooking: ReadonlyMap<string, string> = new Map()) {
  const sorted = [...rows];
  if (sort === "service-asc") return sorted.sort(compareService);
  if (sort === "service-desc") {
    return sorted.sort((left, right) => {
      if (!rowDate(left) !== !rowDate(right)) return rowDate(left) ? -1 : 1;
      return compareService(right, left);
    });
  }
  return sorted.sort((left, right) => {
    const leftUpdated = updatedTime(left, updatedByBooking);
    const rightUpdated = updatedTime(right, updatedByBooking);
    if (!leftUpdated !== !rightUpdated) return leftUpdated ? -1 : 1;
    return rightUpdated.localeCompare(leftUpdated) || compareService(left, right);
  });
}

export type QueueResult = {
  rows: QueueRow[];
  bookings: QueueBooking[];
  groups: QueueGroup[];
  total: number;
  shown: number;
};

/**
 * Apply the filters and sort to the standalone bookings and booking groups the
 * dashboard has loaded. `standaloneIds` keeps grouped child bookings out of the
 * standalone list exactly as the existing queue does.
 */
export function filterQueue(input: {
  bookings: readonly QueueBooking[];
  groups: readonly QueueGroup[];
  standaloneIds: ReadonlySet<string>;
  filters: QueueFilters;
}): QueueResult {
  const bookingById = new Map(input.bookings.map((booking) => [booking.canonicalId, booking]));
  const updatedByBooking = new Map(input.bookings.flatMap((booking) => (booking.updatedAt ? [[booking.canonicalId, booking.updatedAt] as const] : [])));
  const all: QueueRow[] = [
    ...input.groups.map((group): QueueRow => ({ kind: "group", id: group.id, group })),
    ...input.bookings.filter((booking) => input.standaloneIds.has(booking.canonicalId)).map((booking): QueueRow => ({ kind: "booking", id: booking.canonicalId, booking })),
  ];
  const rows = sortRows(all.filter((row) => rowMatches(row, input.filters)), input.filters.sort, updatedByBooking);
  return {
    rows,
    bookings: rows.flatMap((row) => (row.kind === "booking" ? [row.booking] : [])),
    groups: rows.flatMap((row) => (row.kind === "group" ? [row.group] : [])),
    total: all.length,
    shown: rows.length,
  };
}

/** Statuses actually present in the loaded data, in operational order. Never offers an unsupported status. */
export function availableStatuses(input: { bookings: readonly QueueBooking[]; groups: readonly QueueGroup[]; standaloneIds: ReadonlySet<string> }) {
  const present = new Set<string>([
    ...input.groups.map((group) => queueStatusLabel(group.status)),
    ...input.bookings.filter((booking) => input.standaloneIds.has(booking.canonicalId)).map((booking) => queueStatusLabel(booking.lifecycleStatus)),
  ]);
  const known = STATUS_ORDER.filter((status) => present.has(status));
  const other = [...present].filter((status) => !STATUS_ORDER.includes(status)).sort();
  return [...known, ...other];
}

export function describeFilters(filters: QueueFilters) {
  const chips: Array<{ key: string; label: string }> = [];
  if (filters.search.trim()) chips.push({ key: "search", label: `Search: ${filters.search.trim()}` });
  for (const status of filters.statuses) chips.push({ key: `status:${status}`, label: status });
  if (filters.dateFrom || filters.dateTo) chips.push({ key: "date", label: `${filters.dateFrom || "Any"} to ${filters.dateTo || "any"}` });
  return chips;
}
