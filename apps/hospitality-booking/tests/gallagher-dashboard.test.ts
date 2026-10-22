import assert from "node:assert/strict";
import test from "node:test";
import {
  aggregateGallagherBookings,
  exactEmailDomain,
  fikaBookingMatches,
  isApprovedGallagherRequester,
  normalizeCompany,
  normalizeFikaBooking,
  normalizeLegacyBooking,
  parseLegacyDate,
  partitionBookings,
  visibilityPolicyConfigured,
  visibilityPolicyFromEnvironment,
} from "../lib/gallagher-dashboard";

const policy = visibilityPolicyFromEnvironment({ GALLAGHER_DASHBOARD_APPROVED_REQUESTERS: "person@redington.co.uk, frontofhouse@redington.co.uk" });

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

test("company text alone never makes a booking visible; only an approved requester does", () => {
  assert.equal(normalizeCompany("  GALLAGHER  "), "gallagher");
  assert.equal(isApprovedGallagherRequester("stranger@example.com", policy), false);
  assert.equal(isApprovedGallagherRequester("person@redington.co.uk", policy), true);
  assert.equal(isApprovedGallagherRequester(" Person@REDINGTON.CO.UK ", policy), true);
});

test("an unapproved address on the Redington domain is not visible unless the domain is explicitly approved", () => {
  assert.equal(exactEmailDomain(" Person@REDINGTON.CO.UK "), "redington.co.uk");
  assert.equal(isApprovedGallagherRequester("someone.else@redington.co.uk", policy), false);
  const domainPolicy = visibilityPolicyFromEnvironment({ GALLAGHER_DASHBOARD_APPROVED_DOMAINS: "redington.co.uk" });
  assert.equal(isApprovedGallagherRequester("someone.else@redington.co.uk", domainPolicy), true);
  assert.equal(isApprovedGallagherRequester("someone@redington.co.uk.evil.test", domainPolicy), false);
});

test("malformed, display-name, multi-address and empty requester values fail closed", () => {
  for (const value of ["", undefined, null, "redington.co.uk", "Person <person@redington.co.uk>", "person@redington.co.uk, other@example.com", "person@redington.co.uk@evil.test", "@redington.co.uk", "person@"]) {
    assert.equal(isApprovedGallagherRequester(value, policy), false, String(value));
  }
});

test("an unconfigured or invalid policy approves nothing", () => {
  const empty = visibilityPolicyFromEnvironment({});
  assert.equal(visibilityPolicyConfigured(empty), false);
  assert.equal(isApprovedGallagherRequester("person@redington.co.uk", empty), false);
  const invalid = visibilityPolicyFromEnvironment({ GALLAGHER_DASHBOARD_APPROVED_REQUESTERS: "not-an-email, *", GALLAGHER_DASHBOARD_APPROVED_DOMAINS: "*, localhost" });
  assert.equal(visibilityPolicyConfigured(invalid), false);
});

test("regression: unrelated companies bookings cannot be exposed through the Gallagher dashboard", () => {
  const unrelated = [
    legacy({ BookingID: "OTHER-1", ClientCompany: "Qinetiq", HostEmail: "buyer@qinetiq.com" }),
    legacy({ BookingID: "OTHER-2", ClientCompany: "Thames Water", HostEmail: "pa@thameswater.co.uk" }),
    // A different tenant typing "Gallagher" into the free-text company field must not surface.
    legacy({ BookingID: "SPOOF-1", ClientCompany: "Gallagher", HostEmail: "attacker@example.com" }),
    legacy({ BookingID: "SPOOF-2", ClientCompany: "  GALLAGHER ", HostEmail: "" }),
    // Look-alike Redington addresses and unapproved colleagues.
    legacy({ BookingID: "LOOKALIKE", ClientCompany: "Other", HostEmail: "person@redington.co.uk.example.com" }),
    legacy({ BookingID: "UNAPPROVED-COLLEAGUE", ClientCompany: "Other", HostEmail: "unknown@redington.co.uk" }),
  ];
  const approved = legacy({ BookingID: "APPROVED", ClientCompany: "Qinetiq", HostEmail: "frontofhouse@redington.co.uk" });
  const output = aggregateGallagherBookings([...unrelated, approved], [], today, policy);
  assert.deepEqual(output.bookings.map((booking) => booking.sourceBookingId), ["APPROVED"]);
  assert.equal(JSON.stringify(output).includes("Thames Water"), false);
  assert.equal(output.counts.dedupedTotal, 1);
});

test("canonical FIKA OS bookings pass through the same fail-closed gate", () => {
  const stranger = fika({ client: { name: "X", email: "x@example.com", companyName: "Gallagher", requester: { name: "X", email: "x@example.com", companyName: "Gallagher" } } });
  const colleague = fika({ client: { name: "X", email: "unknown@redington.co.uk", companyName: "Other", requester: { name: "X", email: "unknown@redington.co.uk", companyName: "Other" } } });
  assert.equal(fikaBookingMatches(stranger, policy), false);
  assert.equal(fikaBookingMatches(colleague, policy), false);
  assert.equal(fikaBookingMatches(fika(), policy), true);
  assert.deepEqual(aggregateGallagherBookings([], [stranger, colleague], today, policy).bookings, []);
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
  assert.equal(fikaBookingMatches(fika(), policy), true);
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
  const output = aggregateGallagherBookings([legacy(), legacy({ BookingID: "AC-OLD-002" })], [exact, linked], today, policy);
  assert.equal(output.bookings.length, 2);
  assert.equal(output.bookings.every((booking) => booking.source === "fika-os"), true);
  assert.equal(output.bookings.find((booking) => booking.sourceBookingId === "ANGEL-002")?.supersededLegacyBookingId, "AC-OLD-002");

  const unrelated = fika({ source: { sourceBookingId: "ANGEL-003", provider: "angel-court-hospitality", originalPayload: {} }, service: { eventDate: "2026-10-16", startTime: "09:00", guestCount: 20, portalSiteLabel: "One Angel Court" } });
  assert.equal(aggregateGallagherBookings([legacy()], [unrelated], today, policy).bookings.length, 2);
});

test("unrelated One Angel Court records stay excluded", () => {
  const unrelated = fika({ client: { name: "Other", email: "other@example.com", companyName: "Other Co", requester: { name: "Other", email: "other@example.com", companyName: "Other Co" } } });
  assert.equal(fikaBookingMatches(unrelated, policy), false);
  assert.equal(aggregateGallagherBookings([legacy({ ClientCompany: "Other", HostEmail: "other@example.com" })], [unrelated], today, policy).bookings.length, 0);
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
