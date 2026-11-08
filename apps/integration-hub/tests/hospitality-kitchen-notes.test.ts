import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { calculateQuoteSnapshot, defaultDashboardQuoteSettings } from "../lib/quote-engine";

test("customer quote snapshots retain customer notes and exclude independent kitchen notes", () => {
  const snapshot = calculateQuoteSnapshot({
    canonicalId: "booking:kitchen-notes-test",
    client: { name: "Guest", email: "guest@example.com", companyName: "Client" },
    service: { eventDate: "2026-12-01", startTime: "12:00", guestCount: 10 },
    order: { eventType: "Lunch", items: [{ itemId: "item:lunch", itemName: "Lunch", unitPrice: 12, quantity: 10 }] },
    dietaries: {}, notes: "Customer note only", deliveryChargeRequired: true,
  }, defaultDashboardQuoteSettings("mnk"));
  assert.equal(snapshot.notes, "Customer note only");
  assert.equal("kitchenNotes" in snapshot, false);
});

test("kitchen-notes command is authenticated and uses a durable idempotent CPU outbox", () => {
  const route = readFileSync(new URL("../app/api/hospitality-bookings/route.ts", import.meta.url), "utf8");
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  const outbox = readFileSync(new URL("../lib/hospitality-kitchen-notes-outbox.ts", import.meta.url), "utf8");
  const authorize = route.indexOf("assertHospitalityBookingMutationAccess");
  const save = route.indexOf('change.action === "save-kitchen-notes"');
  assert.ok(authorize >= 0 && save > authorize, "server-side OPLOC authorization must precede the notes command");
  assert.match(route, /action: z\.literal\("save-kitchen-notes"\), kitchenNotes: z\.string\(\)\.max\(4000\)/);
  assert.match(domain, /booking\.version !== expectedVersion/);
  assert.match(domain, /stageKitchenNotesPropagation\(transaction, bookingId, nextVersion/);
  assert.match(outbox, /transaction\.create\(ref, outboxRecord\(event\)\)/);
  assert.match(outbox, /booking-kitchen-notes:\$\{bookingId\}:v\$\{sourceVersion\}/);
  assert.match(outbox, /resetEventForReplay/);
});

test("notes-only CPU sync rebuilds CPU projections without calendar, Logistics or allergen review changes", () => {
  const route = readFileSync(new URL("../../cpu-production/app/api/production/route.ts", import.meta.url), "utf8");
  assert.match(route, /const kitchenNotesOnly = changeType === "kitchen-notes-updated"/);
  assert.match(route, /rebuildCpuProjection\(request, serviceDate, event\.sequence\)/);
  assert.match(route, /rebuildCpuWeekProjection\(request, weekCommencingFor\(serviceDate\), event\.sequence\)/);
  assert.match(route, /!kitchenNotesOnly && changedOrder\?\.destinationOplocId \? await rebuildCpuReviewPackage/);
  assert.match(route, /!kitchenNotesOnly && changedOrder \? \{ calendarOrder: changedOrder \} : \{\}/);
  assert.match(route, /logistics: !kitchenNotesOnly/);
});
