import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { buildRcoaDashboardRows, rcoaServiceDisplayName, type RcoaDashboardService } from "../lib/rcoa-dashboard/model";

function service(reference: string, patch: Partial<RcoaDashboardService> = {}): RcoaDashboardService {
  return {
    reference,
    eventType: "Council hospitality",
    eventDate: "2026-11-18",
    startTime: "09:30",
    endTime: "10:30",
    location: "Boardroom · Level 2",
    guestCount: 16,
    lifecycleStatus: "Approved",
    amended: false,
    items: [{ name: "Tea and coffee", quantity: 2 }],
    ...patch,
  };
}

test("All Day children become one row with service context and no summed guest count", () => {
  const rows = buildRcoaDashboardRows([
    service("RCOA-G1-1", { startTime: "09:00", endTime: "10:00", groupId: "internal-group", groupSize: 2, groupSequence: 1 }),
    service("RCOA-G1-2", { startTime: "12:00", endTime: "13:00", eventType: "Working lunch", groupId: "internal-group", groupSize: 2, groupSequence: 2 }),
    service("RCOA-SOLO"),
  ]);
  assert.equal(rows.length, 2);
  const group = rows.find(row => row.services.length === 2)!;
  assert.equal(group.guestCount, 16);
  assert.equal(group.services.length, 2);
  assert.deepEqual(group.services.map(child => child.reference), ["RCOA-G1-1", "RCOA-G1-2"]);
  assert.equal(group.items.length, 2);
  assert.equal(group.totalPrice, null);
  assert.equal(group.bookingReference, "RCOA-G1-1");
  assert.equal(group.company, "All Day Hospitality");
});

test("RCoA canonical service IDs use governed customer labels and grouped guest counts remain per service", () => {
  assert.equal(rcoaServiceDisplayName("meeting_hospitality"), "Meeting Hospitality");
  assert.equal(rcoaServiceDisplayName("breakfast"), "Breakfast");
  const rows = buildRcoaDashboardRows([
    service("RCOA-DAY-1", { eventType: "breakfast", guestCount: 40, groupId: "day", groupSize: 2, groupSequence: 1 }),
    service("RCOA-DAY-2", { eventType: "meeting_hospitality", guestCount: 60, groupId: "day", groupSize: 2, groupSequence: 2 }),
  ]);
  assert.equal(rows[0].company, "All Day Hospitality");
  assert.equal(rows[0].guestCount, null, "different child counts are never summed");
  assert.deepEqual(rows[0].services.map(child => child.guestCount), [40, 60]);
  assert.deepEqual(rows[0].items.map(item => item.notes), ["Breakfast", "Meeting Hospitality"]);
});

test("a group with one repeated guest count retains that count without adding it", () => {
  const rows = buildRcoaDashboardRows([
    service("RCOA-SAME-1", { guestCount: 24, groupId: "same", groupSize: 2, groupSequence: 1 }),
    service("RCOA-SAME-2", { guestCount: 24, groupId: "same", groupSize: 2, groupSequence: 2 }),
  ]);
  assert.equal(rows[0].guestCount, 24);
});

test("RCoA keeps a wide desktop table and uses booking cards before the table becomes cramped", () => {
  const css = readFileSync(new URL("../app/angel-court/gallagher/GallagherDashboard.module.css", import.meta.url), "utf8");
  assert.match(css, /\.rcoaPage \.table\s*\{[^}]*min-width:\s*1200px/);
  assert.match(css, /@media\s*\(max-width:\s*1100px\)\s*\{\s*\.rcoaPage \.tableWrap\s*\{\s*display:\s*none/);
  assert.match(css, /\.rcoaPage \.cards\s*\{\s*display:\s*grid/);
});

test("persisted lifecycle and amendment evidence remain distinct from upcoming/history tabs", () => {
  const rows = buildRcoaDashboardRows([
    service("RCOA-APPROVED", { eventDate: "2026-11-18", lifecycleStatus: "Approved" }),
    service("RCOA-COMPLETE", { eventDate: "2026-11-17", lifecycleStatus: "Completed" }),
    service("RCOA-AMENDED", { eventDate: "2026-11-18", amended: true, lifecycleStatus: "Approved" }),
    service("RCOA-CANCELLED", { eventDate: "2026-11-18", lifecycleStatus: "Cancelled" }),
  ]);
  assert.equal(rows.find(row => row.bookingReference === "RCOA-APPROVED")?.displayStatus, "Approved");
  assert.equal(rows.find(row => row.bookingReference === "RCOA-COMPLETE")?.persistedCompleted, true);
  assert.equal(rows.find(row => row.bookingReference === "RCOA-AMENDED")?.displayStatus, "Amended");
  assert.equal(rows.find(row => row.bookingReference === "RCOA-CANCELLED")?.persistedCancelled, true);
});

test("partial cancellations remain visible and are not counted as a fully cancelled group", () => {
  const rows = buildRcoaDashboardRows([
    service("RCOA-PARTIAL-1", { groupId: "partial", groupSize: 2, groupSequence: 1, lifecycleStatus: "Cancelled" }),
    service("RCOA-PARTIAL-2", { groupId: "partial", groupSize: 2, groupSequence: 2 }),
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].displayStatus, "Partially cancelled");
  assert.equal(rows[0].persistedCancelled, false);
  assert.equal(rows[0].services.length, 2);
});

test("incomplete, inconsistent, and duplicate booking rows fail visibly", () => {
  assert.throws(() => buildRcoaDashboardRows([service("RCOA-G1", { groupId: "group", groupSize: 2, groupSequence: 1 })]), /incomplete or inconsistent/);
  assert.throws(() => buildRcoaDashboardRows([
    service("RCOA-G2-1", { groupId: "group", groupSize: 2, groupSequence: 1 }),
    service("RCOA-G2-2", { groupId: "group", groupSize: 2, groupSequence: 2, eventDate: "2026-11-19" }),
  ]), /incomplete or inconsistent/);
  assert.throws(() => buildRcoaDashboardRows([service("RCOA-DUP"), service("RCOA-DUP")]), /duplicate or missing booking reference/);
});
