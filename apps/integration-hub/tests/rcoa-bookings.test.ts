import assert from "node:assert/strict";
import test from "node:test";
import type { CanonicalBooking } from "../lib/hospitality-booking-service";
import { collectBoundedCompletePages, projectRcoaDashboardBooking, resolveRcoaDashboardOploc } from "../lib/rcoa-dashboard-bookings";

const oploc = "oploc:be0becbe-b6cf-4d7f-9c1e-f36e689feab2";
const mapping = { sourceIdentifier: "rcoa", sourceEntityType: "provider-location", mappingStatus: "confirmed", targetCanonicalId: oploc };

test("RCoA dashboard requires one confirmed provider-location mapping and ignores unrelated aliases", () => {
  assert.equal(resolveRcoaDashboardOploc([mapping]), oploc);
  assert.throws(() => resolveRcoaDashboardOploc([]), /one confirmed canonical provider-location/);
  assert.throws(() => resolveRcoaDashboardOploc([mapping, { ...mapping, targetCanonicalId: "oploc:other" }]), /one confirmed canonical provider-location/);
  assert.throws(() => resolveRcoaDashboardOploc([mapping, { ...mapping }]), /one confirmed canonical provider-location/);
  assert.throws(() => resolveRcoaDashboardOploc([{ ...mapping, oplocId: "oploc:other" }]), /conflicting canonical identities/);
  assert.throws(() => resolveRcoaDashboardOploc([{ ...mapping, mappingStatus: "unresolved" }]), /one confirmed canonical provider-location/);
  assert.throws(() => resolveRcoaDashboardOploc([{ ...mapping, sourceEntityType: "label" }]), /one confirmed canonical provider-location/);
});

test("RCoA projection enforces exact site and OPLOC and minimizes customer data", () => {
  const booking = {
    canonicalId: "booking:rcoa:test",
    source: { sourceBookingId: "RCOA-TEST-1" },
    lifecycleStatus: "Approved",
    audit: [{ action: "booking-amended" }],
    client: { name: "Private Booker", email: "private@example.test", invoiceReference: "PO-SECRET" },
    service: { portalSiteId: "rcoa", oplocId: oploc, eventDate: "2026-11-18", startTime: "09:30", endTime: "12:30", roomOrArea: "Boardroom", guestCount: 16 },
    order: { eventType: "Council meeting", grossTotal: 999, items: [{ itemName: "Tea and coffee", quantity: 3, unitPrice: 45, comments: "private note" }] },
    notes: "internal/customer note",
    attachments: [{ name: "private attachment" }],
  } as unknown as CanonicalBooking;
  const projected = projectRcoaDashboardBooking(booking, oploc);
  assert.equal(projected.reference, "RCOA-TEST-1");
  assert.equal(projected.amended, true);
  assert.deepEqual(projected.items, [{ name: "Tea and coffee", quantity: 3 }]);
  assert.deepEqual(Object.keys(projected).sort(), ["amended", "endTime", "eventDate", "eventType", "guestCount", "items", "lifecycleStatus", "location", "reference", "startTime"].sort());
  assert.throws(() => projectRcoaDashboardBooking({ ...booking, service: { ...booking.service, portalSiteId: "angel-court" } }, oploc), /outside its verified site/);
  assert.throws(() => projectRcoaDashboardBooking({ ...booking, service: { ...booking.service, oplocId: "oploc:other" } }, oploc), /outside its verified site/);
});

test("bounded server pagination returns every page and rejects repeated or truncated cursors", async () => {
  const source = ["a", "b", "c", "d", "e"];
  const result = await collectBoundedCompletePages({
    pageSize: 2,
    maxItems: 6,
    cursorKey: (cursor: string) => cursor,
    readPage: async (cursor: string | undefined) => {
      const start = cursor ? source.indexOf(cursor) + 1 : 0;
      const items = source.slice(start, start + 2);
      return { items, ...(items.length ? { nextCursor: items.at(-1) } : {}), hasMore: start + items.length < source.length };
    },
  });
  assert.deepEqual(result, source);
  await assert.rejects(() => collectBoundedCompletePages({ pageSize: 2, maxItems: 3, cursorKey: (cursor: string) => cursor, readPage: async (cursor: string | undefined) => cursor ? { items: ["c"], nextCursor: "c", hasMore: true } : { items: ["a", "b"], nextCursor: "b", hasMore: true } }), /incomplete beyond its retrieval limit/);
  await assert.rejects(() => collectBoundedCompletePages({ pageSize: 2, cursorKey: (cursor: string) => cursor, readPage: async () => ({ items: ["a", "b"], nextCursor: "a", hasMore: true }) }), /repeated cursor/);
  await assert.rejects(() => collectBoundedCompletePages({ pageSize: 2, cursorKey: (cursor: string) => cursor, readPage: async () => ({ items: ["a"], hasMore: true }) }), /could not prove a complete result/);
});
