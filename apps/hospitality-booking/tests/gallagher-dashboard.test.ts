import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGallagherBookings,
  exactEmailDomain,
  fikaBookingMatches,
  matchedGallagherRecord,
  normalizeCompany,
  normalizeFikaBooking,
  normalizeLegacyBooking,
  parseLegacyDate,
  partitionBookings,
} from "../lib/gallagher-dashboard";

const today = "2026-10-15";

function legacy(overrides: Record<string, unknown> = {}) {
  return {
    BookingID: "AC-20261016-001",
    Status: "CONFIRMED",
    ClientCompany: "Gallagher",
    HostName: "Requester",
    HostEmail: "person@redington.co.uk",
    Pax: 20,
    EventDate: "2026-10-16",
    ServiceTimes: '["09:00"]',
    Location: "One Angel Court",
    Floor: "Level 4",
    Notes: "No onions",
    GrossPrice: 170.29,
    TotalPrice: 131.4,
    ItemsJSON: '[{"name":"Lunch package","qty":"20","unitPrice":6.57}]',
    InvoiceReference: "PO-123",
    CreatedAt: "2026-10-01T10:00:00.000Z",
    UpdatedAt: "2026-10-02T10:00:00.000Z",
    ...overrides,
  };
}

function fika(overrides: Record<string, unknown> = {}) {
  return {
    canonicalId: "booking:angel:canonical-1",
    lifecycleStatus: "Quoted",
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
    source: { sourceBookingId: "ANGEL-NEW-001", provider: "angel-court-hospitality", originalPayload: {} },
    client: { name: "Requester", email: "person@redington.co.uk", companyName: "Gallagher", requester: { name: "Requester", email: "person@redington.co.uk", companyName: "Gallagher" }, invoiceReference: "PO-456" },
    service: { eventDate: "2026-10-16", startTime: "12:00", endTime: "13:00", guestCount: 35, portalSiteId: "angel-court", portalSiteLabel: "One Angel Court", roomOrArea: "Meeting room" },
    order: { items: [{ itemName: "Lunch package", quantity: 35, unitPrice: 2, lineTotal: 70 }], grossTotal: 84 },
    quoteState: { currentRevisionId: "quote:r1", revisions: [{ id: "quote:r1", snapshot: { totals: { gross: { amount: 120.75 } } } }] },
    notes: "Dietaries recorded",
    ...overrides,
  };
}

test("Gallagher company matching is case-insensitive and whitespace-normalized but exact", () => {
  assert.equal(normalizeCompany("  GALLAGHER  "), "gallagher");
  assert.equal(matchedGallagherRecord("  gAlLaGhEr ", "someone@example.com"), true);
  assert.equal(matchedGallagherRecord("Gallagher Services", "someone@example.com"), false);
  assert.equal(matchedGallagherRecord("Unrelated client", "someone@example.com"), false);
});

test("email matching compares the exact case-insensitive domain", () => {
  assert.equal(exactEmailDomain(" Person@REDINGTON.CO.UK "), "redington.co.uk");
  assert.equal(matchedGallagherRecord("Unrelated client", " Person@REDINGTON.CO.UK "), true);
  assert.equal(matchedGallagherRecord("Unrelated client", "person@redington.co.uk.example.com"), false);
  assert.equal(matchedGallagherRecord("Unrelated client", "redington.co.uk"), false);
});

test("legacy normalizer retains stored gross price, booking details and cancellation", () => {
  const result = normalizeLegacyBooking(legacy({ Status: "CANCELLED", GrossPrice: 170.29 }), today);
  assert.equal(result.source, "legacy");
  assert.equal(result.bookingReference, "AC-20261016-001");
  assert.equal(result.totalPrice, 170.29);
  assert.equal(result.status, "Cancelled");
  assert.equal(result.items[0].name, "Lunch package");
  assert.equal(result.items[0].quantity, 20);
  assert.equal(result.location, "One Angel Court · Level 4");
  assert.equal(result.poReference, "PO-123");
  assert.equal(result.matchedBy, "both");
  assert.equal(result.endTime, "");
});

test("legacy serial dates convert to UK business-date strings without local-time slicing", () => {
  assert.equal(parseLegacyDate(46191), "2026-06-18");
  assert.equal(parseLegacyDate("18/06/2026"), "2026-06-18");
  const row = normalizeLegacyBooking(legacy({ CreatedAt: 46178.514666504634, ParsedJSON: JSON.stringify({ createdAt: "2026-06-05T11:21:07.186Z", updatedAt: "2026-06-05T12:21:07.186Z" }) }), today);
  assert.equal(row.createdAt, "2026-06-05T11:21:07.186Z");
});

test("FIKA OS uses the stored quote total rather than recomputing line prices", () => {
  const result = normalizeFikaBooking(fika(), today);
  assert.equal(result.canonicalBookingId, "booking:angel:canonical-1");
  assert.equal(result.bookingReference, "ANGEL-NEW-001");
  assert.equal(result.totalPrice, 120.75);
  assert.equal(result.items[0].quantity, 35);
  assert.equal(result.poReference, "PO-456");
  assert.equal(result.location, "Meeting room · One Angel Court");
  assert.equal(fikaBookingMatches(fika()), true);
});

test("missing authoritative price stays unavailable and FIKA cancellation is customer-facing", () => {
  const noPrice = normalizeFikaBooking(fika({ order: { items: [], grossTotal: undefined }, quoteState: { revisions: [] } }), today);
  assert.equal(noPrice.totalPrice, null);
  const cancelled = normalizeFikaBooking(fika({ lifecycleStatus: "Cancelled" }), today);
  assert.equal(cancelled.status, "Cancelled");
});

test("aggregation deduplicates only an exact stable legacy reference or explicit provenance", () => {
  const exact = fika({ source: { sourceBookingId: "AC-20261016-001", provider: "angel-court-hospitality", originalPayload: {} } });
  const linked = fika({ source: { sourceBookingId: "ANGEL-002", provider: "angel-court-hospitality", originalPayload: { legacyBookingReference: "AC-OLD-002" } } });
  const output = aggregateGallagherBookings([legacy(), legacy({ BookingID: "AC-OLD-002" })], [exact, linked], today);
  assert.equal(output.bookings.length, 2);
  assert.equal(output.bookings.every((booking) => booking.source === "fika-os"), true);
  assert.equal(output.bookings.find((booking) => booking.sourceBookingId === "ANGEL-002")?.supersededLegacyBookingId, "AC-OLD-002");

  const unrelated = fika({ source: { sourceBookingId: "ANGEL-003", provider: "angel-court-hospitality", originalPayload: {} }, service: { eventDate: "2026-10-16", startTime: "09:00", guestCount: 20, portalSiteLabel: "One Angel Court" } });
  assert.equal(aggregateGallagherBookings([legacy()], [unrelated], today).bookings.length, 2);
});

test("unrelated One Angel Court records stay excluded", () => {
  const unrelated = fika({ client: { name: "Other", email: "other@example.com", companyName: "Other Co", requester: { name: "Other", email: "other@example.com", companyName: "Other Co" } } });
  assert.equal(fikaBookingMatches(unrelated), false);
  assert.equal(aggregateGallagherBookings([legacy({ ClientCompany: "Other", HostEmail: "other@example.com" })], [unrelated], today).bookings.length, 0);
});

test("upcoming order is nearest-first and history order is newest-first", () => {
  const records = [
    normalizeLegacyBooking(legacy({ BookingID: "LATE", EventDate: "2026-10-20" }), today),
    normalizeLegacyBooking(legacy({ BookingID: "NEAR", EventDate: "2026-10-16" }), today),
    normalizeLegacyBooking(legacy({ BookingID: "OLD", EventDate: "2026-10-01" }), today),
    normalizeLegacyBooking(legacy({ BookingID: "OLDER", EventDate: "2026-09-01" }), today),
  ];
  const split = partitionBookings(records, today);
  assert.deepEqual(split.upcoming.map((booking) => booking.sourceBookingId), ["NEAR", "LATE"]);
  assert.deepEqual(split.history.map((booking) => booking.sourceBookingId), ["OLD", "OLDER"]);
});
