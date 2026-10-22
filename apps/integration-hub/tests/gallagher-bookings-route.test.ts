import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/gallagher-bookings/route";
import { projectGallagherDashboardBookings, type CanonicalBooking } from "../lib/hospitality-booking-service";

function booking(id: string, input: { companyName: string; email: string; clientCompany?: string }) {
  return {
    canonicalId: id, lifecycleStatus: "Quoted", createdAt: "c", updatedAt: "u", createdBy: "staff@fika", updatedBy: "staff@fika",
    source: { provider: "angel-court-hospitality", sourceBookingId: `SRC-${id}`, originalPayload: { legacyBookingReference: "AC-OLD", internal: "x" } },
    client: {
      name: "N", email: input.email, companyName: input.companyName, requester: { name: "N", email: input.email, companyName: input.companyName },
      ...(input.clientCompany === undefined ? {} : { clientName: "C", clientCompany: input.clientCompany }),
    },
    service: { eventDate: "2026-11-01", startTime: "09:00", guestCount: 5, portalSiteId: "angel-court" },
    order: { items: [], grossTotal: 10 }, quoteState: { revisions: [] }, notes: "n",
    statusHistory: [{ changedBy: "staff@fika" }], audit: [{ by: "staff@fika" }], attachments: ["gs://private"], dietaries: { allergy: "x" }, dashboardWorkflow: { review: {} },
  } as unknown as CanonicalBooking;
}

const originalToken = process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;

test("canonical Gallagher read bridge rejects missing or incorrect server token", async () => {
  delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  const missing = await GET(new NextRequest("https://hub.example/api/gallagher-bookings"));
  assert.equal(missing.status, 503);

  process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = "expected-server-only-token";
  const wrong = await GET(new NextRequest("https://hub.example/api/gallagher-bookings", { headers: { "x-fika-gallagher-bridge-token": "wrong" } }));
  assert.equal(wrong.status, 401);
});

test("bridge returns a bounded customer-safe projection and never leaks internal fields", () => {
  const rows = projectGallagherDashboardBookings([booking("1", { companyName: "Redington", email: "p@redington.co.uk" })]);
  const serialised = JSON.stringify(rows);
  for (const leaked of ["staff@fika", "gs://private", "allergy", "statusHistory", "audit", "dashboardWorkflow", "internal"]) assert.equal(serialised.includes(leaked), false, leaked);
  assert.equal(rows[0].source.originalPayload.legacyBookingReference, "AC-OLD");
});

// Parity table: the same cases are asserted against the Hospitality dashboard gate
// (apps/hospitality-booking/tests/gallagher-dashboard.test.ts). Keep both in sync.
test("Hub candidate filter matches the confirmed rule: exact redington.co.uk domain OR Gallagher booking company", () => {
  const ids = (docs: CanonicalBooking[]) => projectGallagherDashboardBookings(docs).map((row) => row.canonicalId);
  const visible = [
    booking("redington-for-qinetiq", { companyName: "Redington", email: "frontofhouse@redington.co.uk", clientCompany: "Qinetiq" }),
    booking("redington-upper", { companyName: "Other", email: " P@REDINGTON.CO.UK ", clientCompany: "Thames Water" }),
    booking("gallagher-for-royal-mail", { companyName: "Gallagher", email: "someone@ajg.example", clientCompany: "Royal Mail" }),
    booking("gallagher-punctuation", { companyName: " GALLAGHER. ", email: "someone@ajg.example", clientCompany: "Qinetiq" }),
    booking("domain-undistinguished", { companyName: "Whoever", email: "p@redington.co.uk" }),
  ];
  const hidden = [
    booking("subdomain", { companyName: "Other", email: "p@mail.redington.co.uk", clientCompany: "Qinetiq" }),
    booking("lookalike", { companyName: "Other", email: "p@redington.co.uk.evil.test", clientCompany: "Qinetiq" }),
    booking("wrong-tld", { companyName: "Other", email: "p@redington.com", clientCompany: "Qinetiq" }),
    booking("end-client-gallagher", { companyName: "Qinetiq", email: "p@qinetiq.example", clientCompany: "Gallagher" }),
    booking("unverified-company", { companyName: "Gallagher", email: "p@example.com" }),
    booking("non-gallagher", { companyName: "Royal Mail", email: "p@royalmail.example", clientCompany: "Royal Mail" }),
    booking("multi-address", { companyName: "Other", email: "p@redington.co.uk, q@example.com", clientCompany: "Qinetiq" }),
  ];
  assert.deepEqual(ids([...visible, ...hidden]), visible.map((row) => row.canonicalId));
});

test.after(() => {
  if (originalToken === undefined) delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  else process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = originalToken;
});
