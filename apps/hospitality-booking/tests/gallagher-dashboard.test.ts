import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGallagherBookings,
  exactEmailDomain,
  fikaBookingMatches,
  fikaCompanies,
  isGallagherCompanyName,
  isRedingtonRequesterEmail,
  isVisibleToGallagher,
  legacyCompanies,
  legacyRowVisible,
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

/** A legacy client-platform row: ClientCompany is the END client; the requester's company is in the original payload. */
function portalLegacy(input: { bookingCompany: string; endClient: string; email: string; id?: string }) {
  return legacy({
    BookingID: input.id ?? "AC-PORTAL-1",
    ClientCompany: input.endClient,
    HostEmail: input.email,
    ParsedJSON: JSON.stringify({ clientCompany: input.endClient, hostEmail: input.email, clientBooking: { client: { name: "R", email: input.email, companyName: input.bookingCompany, clientName: "C", clientCompanyName: input.endClient } } }),
  });
}

test("requester domain matching is exact and case-insensitive: no subdomains or look-alikes", () => {
  for (const email of ["a@redington.co.uk", " A@REDINGTON.CO.UK "]) assert.equal(isRedingtonRequesterEmail(email), true, email);
  for (const email of ["a@mail.redington.co.uk", "a@redington.co.uk.evil.test", "a@xredington.co.uk", "a@redington.com", "a@redington.co", "a@notredington.co.uk", "a@redington.co.uk@evil.test", "Name <a@redington.co.uk>", "a@redington.co.uk, b@example.com", "redington.co.uk", "@redington.co.uk", "a@", "", undefined, null]) {
    assert.equal(isRedingtonRequesterEmail(email), false, String(email));
  }
  assert.equal(exactEmailDomain(" Person@REDINGTON.CO.UK "), "redington.co.uk");
});

test("booking company matching ignores case, spacing and punctuation but not extra words", () => {
  for (const name of ["Gallagher", "  gAlLaGhEr ", "GALLAGHER.", "G.A.L.L.A.G.H.E.R!"]) assert.equal(isGallagherCompanyName(name), true, name);
  for (const name of ["Gallagher Services", "Gallagher-ish", "Gallagher Re", "Gallagher/ First Actuarial", "", undefined]) assert.equal(isGallagherCompanyName(name), false, String(name));
  assert.equal(normalizeCompany("  GALLAGHER  "), "gallagher");
});

test("visibility is EITHER condition, never requiring both", () => {
  assert.equal(isVisibleToGallagher({ requesterEmail: "x@redington.co.uk", bookingCompany: "Qinetiq" }), true);
  assert.equal(isVisibleToGallagher({ requesterEmail: "x@example.com", bookingCompany: "Gallagher" }), true);
  assert.equal(isVisibleToGallagher({ requesterEmail: "x@redington.co.uk", bookingCompany: "Gallagher" }), true);
  assert.equal(isVisibleToGallagher({ requesterEmail: "x@example.com", bookingCompany: "Qinetiq" }), false);
  assert.equal(isVisibleToGallagher({ requesterEmail: "", bookingCompany: "" }), false);
});

test("legacy: Redington booking for an external client (Qinetiq, Thames Water, Royal Mail) is visible via the requester domain", () => {
  for (const endClient of ["Qinetiq", "Thames Water", "Royal Mail"]) {
    const row = portalLegacy({ bookingCompany: "Redington", endClient, email: "frontofhouse@redington.co.uk" });
    assert.equal(legacyRowVisible(row), true, endClient);
    assert.equal(normalizeLegacyBooking(row, today).endClientCompany, endClient);
    assert.equal(normalizeLegacyBooking(row, today).bookingCompany, "Redington");
  }
});

test("legacy: a Gallagher-booked meeting for an external client is visible even from a non-Redington address", () => {
  const row = portalLegacy({ bookingCompany: "Gallagher", endClient: "Qinetiq", email: "someone@ajg.example" });
  assert.equal(legacyRowVisible(row), true);
  assert.equal(legacyCompanies(row).bookingCompany, "Gallagher");
});

test("legacy: Gallagher as the END client of someone else's booking is not enough", () => {
  const row = portalLegacy({ bookingCompany: "Qinetiq", endClient: "Gallagher", email: "buyer@qinetiq.example" });
  assert.equal(legacyRowVisible(row), false);
});

test("legacy: ClientCompany alone is never treated as the booking company when its meaning is unverified", () => {
  const unverified = legacy({ BookingID: "OLD-1", ClientCompany: "Gallagher", HostEmail: "someone@example.com", ParsedJSON: "" });
  assert.equal(legacyCompanies(unverified).verified, false);
  assert.equal(legacyRowVisible(unverified), false);
  // The requester domain still includes an unverified row.
  assert.equal(legacyRowVisible(legacy({ BookingID: "OLD-2", ClientCompany: "Whoever", HostEmail: "x@redington.co.uk", ParsedJSON: "" })), true);
});

test("incorrect domains and non-Gallagher bookings are not exposed", () => {
  const rows = [
    portalLegacy({ id: "SUBDOMAIN", bookingCompany: "Other", endClient: "Qinetiq", email: "x@mail.redington.co.uk" }),
    portalLegacy({ id: "LOOKALIKE", bookingCompany: "Other", endClient: "Qinetiq", email: "x@redington.co.uk.evil.test" }),
    portalLegacy({ id: "WRONGTLD", bookingCompany: "Other", endClient: "Thames Water", email: "x@redington.com" }),
    portalLegacy({ id: "NONGALLAGHER", bookingCompany: "Royal Mail", endClient: "Royal Mail", email: "x@royalmail.example" }),
    portalLegacy({ id: "END-CLIENT-ONLY", bookingCompany: "Other", endClient: "Gallagher", email: "x@other.example" }),
    portalLegacy({ id: "VISIBLE-DOMAIN", bookingCompany: "Redington", endClient: "Qinetiq", email: "X@Redington.CO.UK" }),
    portalLegacy({ id: "VISIBLE-COMPANY", bookingCompany: "Gallagher", endClient: "Royal Mail", email: "y@gallagher.example" }),
  ];
  const output = aggregateGallagherBookings(rows, [], today);
  assert.deepEqual(output.bookings.map((booking) => booking.sourceBookingId).sort(), ["VISIBLE-COMPANY", "VISIBLE-DOMAIN"]);
  assert.equal(output.counts.dedupedTotal, 2);
});

test("FIKA OS: requester company vs end client is trusted only when the payload distinguishes them", () => {
  const portal = (requesterCompany: string, clientCompany: string, email: string) => fika({
    client: { name: "R", email, companyName: requesterCompany, requester: { name: "R", email, companyName: requesterCompany }, clientName: "C", clientCompany },
  });
  assert.equal(fikaBookingMatches(portal("Redington", "Qinetiq", "x@redington.co.uk")), true);
  assert.equal(fikaBookingMatches(portal("Gallagher", "Thames Water", "x@example.com")), true);
  assert.equal(fikaBookingMatches(portal("Other", "Gallagher", "x@example.com")), false);
  assert.equal(fikaBookingMatches(portal("Other", "Qinetiq", "x@redington.co.uk.evil.test")), false);
  // A canonical record without end-client fields (e.g. calendar-derived) has an unverified company.
  const undistinguished = fika({ client: { name: "R", email: "x@example.com", companyName: "Gallagher", requester: { name: "R", email: "x@example.com", companyName: "Gallagher" } } });
  assert.equal(fikaCompanies(undistinguished).bookingCompany, "");
  assert.equal(fikaBookingMatches(undistinguished), false);
  assert.equal(normalizeFikaBooking(portal("Redington", "Qinetiq", "x@redington.co.uk"), today).endClientCompany, "Qinetiq");
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
