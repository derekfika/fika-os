import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { applyCpuXCalendarOrder, boundedBackfillDates, buildCpuXCalendarEventResource, cpuxCalendarEventId, scanCpuXCalendarBackfill, shouldQueueCpuXCalendarOrder } from "../lib/cpux-calendar-publisher";

function order(overrides: Partial<ProductionOrder> = {}): ProductionOrder {
  return {
    canonicalId: "po:calendar-test-1", entityType: "Production Order", schemaVersion: "0.1.0", version: 7,
    requirementIds: [], sourceBookingId: "booking:1", sourceQuoteRevisionId: "quote:1", requiredBy: "2026-11-03T12:00:00",
    serviceDate: "2026-11-03", serviceWindow: { startTime: "12:00", endTime: "12:45" }, status: "accepted", priority: "normal",
    lines: [{ canonicalId: "line:1", sourceBookingLineId: "source:1", itemName: "Sandwich platter", customerQuantity: 12, customerUnit: "portions", dietaries: {}, status: "ready", sortOrder: 0, workstream: "sandwiches" }],
    exceptions: [], origin: "hospitality_booking", currentRevision: 7, createdAt: "2026-11-01T10:00:00.000Z", createdBy: "fixture", updatedAt: "2026-11-02T10:00:00.000Z", idempotencyKey: "fixture:1", externalReferences: [], audit: [],
    clientName: "Example Customer", guestCount: 12, destinationLabel: "FIKA Kitchen", ...overrides,
  };
}

test("CPU X Calendar event uses one deterministic ID, only sandwich lines, and no attendees or attachments", () => {
  const first = order({ serviceDate: "2026-01-15" });
  const resource = buildCpuXCalendarEventResource(first);
  assert.equal(cpuxCalendarEventId(first.canonicalId), cpuxCalendarEventId(first.canonicalId));
  assert.match(resource.id, /^fika[a-f0-9]{64}$/);
  assert.equal(resource.summary, "FIKA Sandwich Lunch — Example Customer x 12");
  assert.equal(resource.start.dateTime, "2026-01-15T12:00:00+00:00");
  assert.equal(resource.end.dateTime, "2026-01-15T12:45:00+00:00");
  assert.match(resource.description, /Sandwich platter: 12 portions/);
  assert.equal("attendees" in resource, false);
  assert.equal("attachments" in resource, false);

  const summer = buildCpuXCalendarEventResource(order({ serviceDate: "2026-07-15" }));
  assert.equal(summer.start.dateTime, "2026-07-15T12:00:00+01:00");
  const withOtherWorkstream = order({ lines: [...order().lines, { ...order().lines[0], canonicalId: "line:2", itemName: "Soup", workstream: "hospitality" }] });
  assert.doesNotMatch(buildCpuXCalendarEventResource(withOtherWorkstream).description, /Soup/);
  assert.throws(() => buildCpuXCalendarEventResource(order({ serviceDate: "2026-03-29", serviceWindow: { startTime: "01:30", endTime: "02:30" } })), /does not exist in Europe\/London/);
});

test("Calendar delivery patches a deterministic event or inserts it once after a 404", async () => {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  const result = await applyCpuXCalendarOrder(order(), {
    calendarId: "cpux-calendar",
    getAccessToken: async () => "test-token",
    fetcher: async (input, init) => {
      calls.push({ method: init?.method || "GET", url: String(input), ...(init?.body ? { body: JSON.parse(String(init.body)) } : {}) });
      return new Response("{}", { status: calls.length === 1 ? 404 : 200 });
    },
  });
  assert.equal(result.applied, true);
  assert.deepEqual(calls.map(call => call.method), ["PATCH", "POST"]);
  assert.match(calls[0].url, /events\/fika[a-f0-9]{64}\?sendUpdates=none$/);
  assert.equal(calls[1].body?.id, cpuxCalendarEventId("po:calendar-test-1"));
  assert.equal("attendees" in (calls[1].body || {}), false);
});

test("simultaneous first delivery that wins the deterministic ID turns insert conflict into an update", async () => {
  const methods: string[] = [];
  await applyCpuXCalendarOrder(order(), {
    calendarId: "cpux-calendar", getAccessToken: async () => "test-token",
    fetcher: async (_input, init) => {
      methods.push(init?.method || "GET");
      return new Response("{}", { status: methods.length === 1 ? 404 : methods.length === 2 ? 409 : 200 });
    },
  });
  assert.deepEqual(methods, ["PATCH", "POST", "PATCH"]);
});

test("Calendar updates and cancellations reuse the one event identity and deletion is retry-safe", async () => {
  const calls: Array<{ method: string; url: string }> = [];
  const updated = await applyCpuXCalendarOrder(order({ version: 8 }), {
    calendarId: "cpux-calendar", getAccessToken: async () => "test-token",
    fetcher: async (input, init) => { calls.push({ method: init?.method || "GET", url: String(input) }); return new Response("{}", { status: 200 }); },
  });
  const deleted = await applyCpuXCalendarOrder(order({ status: "cancelled" }), {
    calendarId: "cpux-calendar", getAccessToken: async () => "test-token",
    fetcher: async (input, init) => { calls.push({ method: init?.method || "GET", url: String(input) }); return new Response("", { status: 404 }); },
  });
  assert.equal(updated.eventId, deleted.eventId);
  assert.deepEqual(calls.map(call => call.method), ["PATCH", "DELETE"]);
  assert.equal(deleted.applied, false);
});

test("bounded historical scan queues each canonical order version once and ignores unrelated dates", async () => {
  const canonical = order({ serviceDate: "2026-11-03" });
  const queued = new Map<string, number>();
  const scan = () => scanCpuXCalendarBackfill("2026-11-03", "2026-11-04", async date => date === "2026-11-03" ? [canonical, { ...canonical, canonicalId: "wrong-date", serviceDate: "2026-11-04" }] : [], async candidate => {
    const current = queued.get(candidate.canonicalId);
    if (!shouldQueueCpuXCalendarOrder(current === undefined ? undefined : { desiredVersion: current }, candidate)) return { status: "already-current" as const };
    queued.set(candidate.canonicalId, candidate.version);
    return { status: "queued" as const, eventId: candidate.canonicalId };
  }, async () => ({ status: "delivered" }));
  assert.deepEqual(await scan(), { datesRead: 2, ordersRead: 2, queued: 1, delivered: 1, pending: 0, alreadyCurrent: 0, skipped: 0 });
  assert.deepEqual(await scan(), { datesRead: 2, ordersRead: 2, queued: 0, delivered: 0, pending: 0, alreadyCurrent: 1, skipped: 0 });
  assert.equal(queued.size, 1);
  assert.equal(boundedBackfillDates("2026-11-03", "2026-11-04").length, 2);
  assert.throws(() => boundedBackfillDates("2026-01-01", "2026-02-01"), /limited to 31/);
});

test("calendar state only advances to newer versions and never auto-creates an old delete", () => {
  const cancelled = order({ status: "cancelled" });
  assert.equal(shouldQueueCpuXCalendarOrder(undefined, cancelled), false);
  assert.equal(shouldQueueCpuXCalendarOrder({ desiredVersion: 7 }, order({ version: 7 })), false);
  assert.equal(shouldQueueCpuXCalendarOrder({ desiredVersion: 7 }, order({ version: 8 })), true);
});

test("backfill rejects oversized result sets before staging any order", async () => {
  let staged = 0;
  const tooMany = Array.from({ length: 26 }, (_, index) => order({ canonicalId: `po:${index}`, serviceDate: "2026-11-03" }));
  await assert.rejects(scanCpuXCalendarBackfill("2026-11-03", "2026-11-03", async () => tooMany, async () => { staged += 1; return { status: "queued" as const }; }), /limited to 25 canonical orders/);
  assert.equal(staged, 0);
});
