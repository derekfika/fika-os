import assert from "node:assert/strict";
import test from "node:test";
import type { GallagherBooking } from "../lib/gallagher-dashboard";
import {
  clientLabel,
  defaultSort,
  emptyFilters,
  filterBookings,
  filtersActive,
  formatBusinessDate,
  formatTimeRange,
  invalidDateRange,
  londonToday,
  sortBookings,
  splitByView,
  summarise,
  summariseItems,
} from "../lib/gallagher-view";

const today = "2026-10-22";

function booking(overrides: Partial<GallagherBooking> = {}): GallagherBooking {
  return {
    source: "legacy", sourceBookingId: "AC-1", bookingReference: "AC-1", date: "2026-10-25", startTime: "09:00", endTime: "",
    guestCount: 10, items: [{ name: "Working lunch", quantity: 10 }], totalPrice: 100, company: "Gallagher", bookingCompany: "Gallagher", endClientCompany: "", requesterName: "Priya Patel",
    requesterEmail: "priya@redington.co.uk", location: "Meeting room 3", poReference: "PO-9", status: "Upcoming", notes: "", createdAt: "", updatedAt: "",
    ...overrides,
  };
}

test("business-date partition: today is upcoming, undated records stay visible in history", () => {
  const split = splitByView([
    booking({ sourceBookingId: "TODAY", date: today }),
    booking({ sourceBookingId: "PAST", date: "2026-10-21", status: "Completed" }),
    booking({ sourceBookingId: "UNDATED", date: "" }),
  ], today);
  assert.deepEqual(split.upcoming.map((item) => item.sourceBookingId), ["TODAY"]);
  assert.deepEqual(split.history.map((item) => item.sourceBookingId).sort(), ["PAST", "UNDATED"]);
});

test("default sort is soonest-first for upcoming and newest-first for history, and toggles", () => {
  assert.equal(defaultSort("upcoming"), "asc");
  assert.equal(defaultSort("history"), "desc");
  const rows = [booking({ bookingReference: "B", date: "2026-11-01" }), booking({ bookingReference: "A", date: "2026-10-30" })];
  assert.deepEqual(sortBookings(rows, "asc").map((item) => item.bookingReference), ["A", "B"]);
  assert.deepEqual(sortBookings(rows, "desc").map((item) => item.bookingReference), ["B", "A"]);
});

test("search covers reference, PO, item, room and contact, requiring every term", () => {
  const rows = [
    booking({ sourceBookingId: "1", bookingReference: "AC-100", items: [{ name: "Sandwich platter", quantity: 4 }], location: "Level 12 boardroom" }),
    booking({ sourceBookingId: "2", bookingReference: "AC-200", poReference: "PO-777", requesterName: "Tom Ashworth" }),
  ];
  const ids = (query: string) => filterBookings(rows, { ...emptyFilters, query }).map((item) => item.sourceBookingId);
  assert.deepEqual(ids("sandwich"), ["1"]);
  assert.deepEqual(ids("BOARDROOM level"), ["1"]);
  assert.deepEqual(ids("po-777"), ["2"]);
  assert.deepEqual(ids("ashworth"), ["2"]);
  assert.deepEqual(ids("sandwich ashworth"), []);
  assert.deepEqual(ids(""), ["1", "2"]);
});

test("date range and status filters are inclusive; undated bookings never satisfy a date filter", () => {
  const rows = [
    booking({ sourceBookingId: "A", date: "2026-10-25" }),
    booking({ sourceBookingId: "B", date: "2026-10-30", status: "Cancelled" }),
    booking({ sourceBookingId: "C", date: "" }),
  ];
  const run = (patch: Partial<typeof emptyFilters>) => filterBookings(rows, { ...emptyFilters, ...patch }).map((item) => item.sourceBookingId);
  assert.deepEqual(run({ from: "2026-10-25", to: "2026-10-30" }), ["A", "B"]);
  assert.deepEqual(run({ from: "2026-10-26" }), ["B"]);
  assert.deepEqual(run({ status: "Cancelled" }), ["B"]);
  assert.deepEqual(run({}), ["A", "B", "C"]);
});

test("an inverted date range is reported and matches nothing rather than silently swapping", () => {
  assert.equal(invalidDateRange({ from: "2026-11-01", to: "2026-10-01" }), true);
  assert.equal(invalidDateRange({ from: "2026-10-01", to: "2026-10-01" }), false);
  assert.deepEqual(filterBookings([booking()], { ...emptyFilters, from: "2026-11-01", to: "2026-10-01" }), []);
  assert.equal(filtersActive(emptyFilters), false);
  assert.equal(filtersActive({ ...emptyFilters, query: " x " }), true);
});

test("summary excludes cancelled bookings from upcoming/completed and picks the next live booking", () => {
  const rows = [
    booking({ sourceBookingId: "CANCELLED-SOON", date: "2026-10-23", status: "Cancelled" }),
    booking({ sourceBookingId: "NEXT", date: "2026-10-24", startTime: "08:00" }),
    booking({ sourceBookingId: "LATER", date: "2026-11-02" }),
    booking({ sourceBookingId: "DONE", date: "2026-10-01", status: "Completed" }),
  ];
  const summary = summarise(rows, today);
  assert.equal(summary.upcoming, 2);
  assert.equal(summary.completed, 1);
  assert.equal(summary.cancelled, 1);
  assert.equal(summary.total, 4);
  assert.equal(summary.next?.sourceBookingId, "NEXT");
  assert.equal(summarise([], today).next, null);
});

test("business dates render in Europe/London without UTC slicing, across the BST/GMT change", () => {
  assert.equal(formatBusinessDate("2026-10-25"), "Sun, 25 Oct 2026");
  assert.equal(formatBusinessDate("2026-03-29", "long"), "Sunday, 29 March 2026");
  assert.equal(formatBusinessDate(""), "Date not recorded");
  assert.equal(formatBusinessDate("25/10/2026"), "Date not recorded");
  // 23:30 UTC on 24 Oct is 00:30 BST on 25 Oct; 23:30 UTC on 25 Oct is 23:30 GMT on 25 Oct.
  assert.equal(londonToday(new Date("2026-10-24T23:30:00Z")), "2026-10-25");
  assert.equal(londonToday(new Date("2026-10-25T23:30:00Z")), "2026-10-25");
});

test("time and item summaries state missing data instead of inventing it", () => {
  assert.equal(formatTimeRange({ startTime: "", endTime: "" }), "Not recorded");
  assert.equal(formatTimeRange({ startTime: "09:00", endTime: "" }), "09:00");
  assert.equal(formatTimeRange({ startTime: "09:00", endTime: "14:00" }), "09:00 – 14:00");
  assert.equal(summariseItems([]), "Items not recorded");
  assert.equal(summariseItems([{ name: "A", quantity: null }]), "A");
  assert.equal(summariseItems([{ name: "A", quantity: 2 }, { name: "B", quantity: 3 }, { name: "C", quantity: 4 }]), "A × 2, B × 3 +1 more");
});

test("client label prefers the verified end client and search finds bookings by client company", () => {
  assert.equal(clientLabel({ endClientCompany: "Qinetiq", company: "Whoever" }), "Qinetiq");
  assert.equal(clientLabel({ endClientCompany: "", company: "Recorded Co" }), "Recorded Co");
  const rows = [booking({ sourceBookingId: "Q", endClientCompany: "Qinetiq", bookingCompany: "Redington" }), booking({ sourceBookingId: "T", endClientCompany: "Thames Water" })];
  assert.deepEqual(filterBookings(rows, { ...emptyFilters, query: "qinetiq" }).map((item) => item.sourceBookingId), ["Q"]);
});
