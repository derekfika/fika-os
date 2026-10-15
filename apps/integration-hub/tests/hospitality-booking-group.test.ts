import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildMnkCanonicalBooking, canonicalBookingId } from "../lib/hospitality-booking-service";
import type { CanonicalRecord } from "../lib/types";

const menu: CanonicalRecord = { canonicalId: "hospitality-menu-item:abc12345", entityType: "Hospitality Menu Item", lifecycleStatus: "published", dataHash: "x", record: { lifecycleState: "active", name: "Breakfast box", unitPrice: 10, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "breakfast_box" }] } } as CanonicalRecord;
const base = { submittedAt: "2026-07-30T10:00:00.000Z", site: "MNK", siteId: "mnk", client: { name: "Host", email: "host@example.com", companyName: "Client" }, event: { eventDate: "2026-08-10", startTime: "12:00", guestCount: 10 }, order: { items: [{ itemId: "breakfast_box", unitPrice: 10, quantity: 1, lineTotal: 10 }], netTotal: 10 } };

test("linked bookings keep ordinary identities, store the group link structurally and in the immutable original payload", () => {
  const group = { id: "RCOA-20261201090000-AB12", size: 2 };
  const one = buildMnkCanonicalBooking({ ...base, bookingId: `${group.id}-01`, bookingGroup: { ...group, sequence: 1 } }, [menu], "2026-07-30T10:01:00.000Z").booking;
  const two = buildMnkCanonicalBooking({ ...base, bookingId: `${group.id}-02`, bookingGroup: { ...group, sequence: 2 } }, [menu], "2026-07-30T10:01:00.000Z").booking;
  assert.equal(one.canonicalId, canonicalBookingId(`${group.id}-01`));
  assert.equal(two.canonicalId, canonicalBookingId(`${group.id}-02`));
  assert.notEqual(one.canonicalId, two.canonicalId);
  assert.deepEqual(one.bookingGroup, { id: group.id, size: 2, sequence: 1 });
  assert.deepEqual(two.source.originalPayload.bookingGroup, { id: group.id, size: 2, sequence: 2 });
});

test("a booking without a group is unchanged: no bookingGroup field is added", () => {
  const plain = buildMnkCanonicalBooking({ ...base, bookingId: "MNK-ONE" }, [menu], "2026-07-30T10:01:00.000Z").booking;
  assert.equal("bookingGroup" in plain, false);
});

test("the Hub booking endpoint accepts the optional bookingGroup and keeps the strict schema otherwise", () => {
  const route = readFileSync(new URL("../app/api/bookings/mnk/route.ts", import.meta.url), "utf8");
  assert.match(route, /bookingGroup: z\.object\(\{ id: z\.string\(\)\.min\(1\)\.max\(240\), sequence: z\.number\(\)\.int\(\)\.min\(1\)\.max\(20\), size: z\.number\(\)\.int\(\)\.min\(2\)\.max\(20\) \}\)\.strict\(\)/);
  assert.match(route, /\}\)\.strict\(\);/);
});
