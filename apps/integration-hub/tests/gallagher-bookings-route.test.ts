import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/gallagher-bookings/route";
import { projectGallagherDashboardBookings, type CanonicalBooking } from "../lib/hospitality-booking-service";

const originalToken = process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;

test("canonical Gallagher read bridge rejects missing or incorrect server token", async () => {
  delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  const missing = await GET(new NextRequest("https://hub.example/api/gallagher-bookings"));
  assert.equal(missing.status, 503);

  process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = "expected-server-only-token";
  const wrong = await GET(new NextRequest("https://hub.example/api/gallagher-bookings", { headers: { "x-fika-gallagher-bridge-token": "wrong" } }));
  assert.equal(wrong.status, 401);
});

test("bridge returns a bounded customer-safe projection of exact Gallagher matches only", () => {
  const base = (id: string, company: string, email: string) => ({
    canonicalId: id, lifecycleStatus: "Quoted", createdAt: "c", updatedAt: "u", createdBy: "staff@fika", updatedBy: "staff@fika",
    source: { provider: "angel-court-hospitality", sourceBookingId: `SRC-${id}`, originalPayload: { legacyBookingReference: "AC-OLD", internal: "x" } },
    client: { name: "N", email, companyName: company },
    service: { eventDate: "2026-11-01", startTime: "09:00", guestCount: 5, portalSiteId: "angel-court" },
    order: { items: [], grossTotal: 10 }, quoteState: { revisions: [] }, notes: "n",
    statusHistory: [{ changedBy: "staff@fika" }], audit: [{ by: "staff@fika" }], attachments: ["gs://private"], dietaries: { allergy: "x" }, dashboardWorkflow: { review: {} },
  }) as unknown as CanonicalBooking;
  const rows = projectGallagherDashboardBookings([
    base("1", "  GALLAGHER ", "a@example.com"),
    base("2", "Other", "p@Redington.co.uk"),
    base("3", "Gallagher Services", "a@example.com"),
    base("4", "Other", "p@redington.co.uk.evil.test"),
    base("5", "Other", "redington.co.uk"),
  ]);
  assert.deepEqual(rows.map((row) => row.canonicalId), ["1", "2"]);
  const serialised = JSON.stringify(rows);
  for (const leaked of ["staff@fika", "gs://private", "allergy", "statusHistory", "audit", "dashboardWorkflow", "internal"]) assert.equal(serialised.includes(leaked), false, leaked);
  assert.equal(rows[0].source.originalPayload.legacyBookingReference, "AC-OLD");
});

test.after(() => {
  if (originalToken === undefined) delete process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN;
  else process.env.GALLAGHER_DASHBOARD_BRIDGE_TOKEN = originalToken;
});
