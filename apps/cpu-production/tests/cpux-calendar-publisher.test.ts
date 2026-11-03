import assert from "node:assert/strict";
import test from "node:test";
import type { ProductionOrder } from "../lib/production-types";
import { applyCpuXCalendarOrder, boundedBackfillDates, buildCpuXCalendarEventResource, claimCpuXCalendarOrder, cpuXCalendarBackfillEnabled, cpuXCalendarWritesEnabled, cpuxCalendarEventId, enqueueCpuXCalendarOrder, previewCpuXCalendarBackfill, scanCpuXCalendarBackfill, shouldQueueCpuXCalendarOrder, stageCpuXCalendarOrder } from "../lib/cpux-calendar-publisher";

const productionEnvironment = {
  FIKA_RUNTIME_MODE: "production",
  FIREBASE_PROJECT_ID: "fika-os",
  GCLOUD_PROJECT: "fika-os",
  GOOGLE_CLOUD_PROJECT: "fika-os",
  FIKA_CPUX_CALENDAR_WRITES_ENABLED: "true",
  FIKA_CPUX_CALENDAR_BACKFILL_ENABLED: "true",
  FIKA_CPUX_CALENDAR_ID: "cpux-calendar",
  CPU_PUBLIC_BASE_URL: "https://cpu.fikacatering.com",
};

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
  const resource = buildCpuXCalendarEventResource(first, productionEnvironment.CPU_PUBLIC_BASE_URL, "production");
  assert.equal(cpuxCalendarEventId(first.canonicalId), cpuxCalendarEventId(first.canonicalId));
  assert.match(resource.id, /^fika[a-f0-9]{64}$/);
  assert.equal(resource.summary, "FIKA Sandwich Lunch — Example Customer x 12");
  assert.equal(resource.start.dateTime, "2026-01-15T12:00:00+00:00");
  assert.equal(resource.end.dateTime, "2026-01-15T12:45:00+00:00");
  assert.match(resource.description, /Sandwich platter: 12 portions/);
  assert.ok(resource.description.includes("Open FIKA OS order: https://cpu.fikacatering.com/?order=po%3Acalendar-test-1&date=2026-01-15"));
  assert.equal("attendees" in resource, false);
  assert.equal("attachments" in resource, false);

  const summer = buildCpuXCalendarEventResource(order({ serviceDate: "2026-07-15" }), productionEnvironment.CPU_PUBLIC_BASE_URL, "production");
  assert.equal(summer.start.dateTime, "2026-07-15T12:00:00+01:00");
  const withOtherWorkstream = order({ lines: [...order().lines, { ...order().lines[0], canonicalId: "line:2", itemName: "Soup", workstream: "hospitality" }] });
  assert.doesNotMatch(buildCpuXCalendarEventResource(withOtherWorkstream, productionEnvironment.CPU_PUBLIC_BASE_URL, "production").description, /Soup/);
  assert.throws(() => buildCpuXCalendarEventResource(order({ serviceDate: "2026-03-29", serviceWindow: { startTime: "01:30", endTime: "02:30" } }), productionEnvironment.CPU_PUBLIC_BASE_URL, "production"), /does not exist in Europe\/London/);
  assert.throws(() => buildCpuXCalendarEventResource(first, "http://cpu.fikacatering.com", "production"), /must be the HTTPS origin/);
});

test("Calendar event shape is ignored by the legacy CPUX import scanner", async () => {
  const event = buildCpuXCalendarEventResource(order(), productionEnvironment.CPU_PUBLIC_BASE_URL, "production");
  const scanner = await (await import("node:fs/promises")).readFile(new URL("../../../shared/cpu-dashboard/04_CalendarScanner.js", import.meta.url), "utf8");
  const hospitalitySummaryPattern = /^([^_]+)_([^_]+)_([^x]+)\s+x\s*\d+/i;
  const text = `${event.summary} ${event.description}`.toLowerCase();
  assert.match(scanner, /!\(event\.attachments\s*\|\|\s*\[\]\)\.length\s*&&\s*!looksLikeCpuHospitalityEvent_\(event\)/);
  assert.equal(hospitalitySummaryPattern.test(event.summary), false);
  assert.doesNotMatch(text, /hospitality|delivery\s+(?:scheduled|schedule|reminder|collection)/i);
  assert.equal("attachments" in event, false);
});

test("Calendar delivery patches a deterministic event or inserts it once after a 404", async () => {
  const calls: Array<{ method: string; url: string; body?: Record<string, unknown> }> = [];
  const result = await applyCpuXCalendarOrder(order(), {
    calendarId: "cpux-calendar",
    environment: productionEnvironment,
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
    calendarId: "cpux-calendar", environment: productionEnvironment, getAccessToken: async () => "test-token",
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
    calendarId: "cpux-calendar", environment: productionEnvironment, getAccessToken: async () => "test-token",
    fetcher: async (input, init) => { calls.push({ method: init?.method || "GET", url: String(input) }); return new Response("{}", { status: 200 }); },
  });
  const deleted = await applyCpuXCalendarOrder(order({ status: "cancelled" }), {
    calendarId: "cpux-calendar", environment: productionEnvironment, getAccessToken: async () => "test-token",
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
  }, async () => ({ status: "delivered" }), productionEnvironment);
  assert.deepEqual(await scan(), { datesRead: 2, ordersRead: 2, queued: 1, delivered: 1, pending: 0, alreadyCurrent: 0, skipped: 0 });
  assert.deepEqual(await scan(), { datesRead: 2, ordersRead: 2, queued: 0, delivered: 0, pending: 0, alreadyCurrent: 1, skipped: 0 });
  assert.equal(queued.size, 1);
  assert.equal(boundedBackfillDates("2026-11-03", "2026-11-04").length, 2);
  assert.throws(() => boundedBackfillDates("2026-01-01", "2026-02-01"), /limited to 31/);
});

test("read-only backfill preview reports eligible and skipped candidates without enqueueing", async () => {
  let reads = 0;
  const preview = await previewCpuXCalendarBackfill("2026-11-03", "2026-11-04", async serviceDate => {
    reads += 1;
    if (serviceDate === "2026-11-03") return [order(), order({ canonicalId: "po:cancelled", status: "cancelled" })];
    return [order({ canonicalId: "po:other-date", serviceDate: "2026-11-03" })];
  });
  assert.deepEqual(preview, { datesRead: 2, ordersRead: 3, candidateCount: 1, ineligibleCount: 1, wrongServiceDateCount: 1 });
  assert.equal(reads, 2);
});

test("calendar state only advances to newer versions and never auto-creates an old delete", () => {
  const cancelled = order({ status: "cancelled" });
  assert.equal(shouldQueueCpuXCalendarOrder(undefined, cancelled), false);
  assert.equal(shouldQueueCpuXCalendarOrder({ desiredVersion: 7 }, order({ version: 7 })), false);
  assert.equal(shouldQueueCpuXCalendarOrder({ desiredVersion: 7 }, order({ version: 8 })), true);
  assert.equal(shouldQueueCpuXCalendarOrder(undefined, order({ status: "draft" })), true, "a canonical order in local CPU draft planning state has already crossed the Hub hand-off");
  assert.equal(shouldQueueCpuXCalendarOrder(undefined, order({ status: "cancelled" })), false);
});

test("backfill rejects oversized result sets before staging any order", async () => {
  let staged = 0;
  const tooMany = Array.from({ length: 26 }, (_, index) => order({ canonicalId: `po:${index}`, serviceDate: "2026-11-03" }));
  await assert.rejects(scanCpuXCalendarBackfill("2026-11-03", "2026-11-03", async () => tooMany, async () => { staged += 1; return { status: "queued" as const }; }, undefined, productionEnvironment), /limited to 25 canonical orders/);
  assert.equal(staged, 0);
});

test("Calendar writes require exact production mode, trusted project, explicit enablement and Calendar ID", () => {
  assert.equal(cpuXCalendarWritesEnabled(productionEnvironment), true);
  assert.equal(cpuXCalendarBackfillEnabled(productionEnvironment), true);
  for (const environment of [
    { ...productionEnvironment, FIKA_RUNTIME_MODE: "staging" },
    { ...productionEnvironment, FIKA_RUNTIME_MODE: "preview" },
    { ...productionEnvironment, FIKA_RUNTIME_MODE: "development" },
    { ...productionEnvironment, FIKA_RUNTIME_MODE: undefined },
    { ...productionEnvironment, FIREBASE_PROJECT_ID: "fika-os-dev" },
    { ...productionEnvironment, FIREBASE_CONFIG: JSON.stringify({ projectId: "fika-os-dev" }) },
    { ...productionEnvironment, FIREBASE_CONFIG: "{" },
    { ...productionEnvironment, GCLOUD_PROJECT: "fika-os-dev" },
    { ...productionEnvironment, GOOGLE_CLOUD_PROJECT: "fika-os-dev" },
    { ...productionEnvironment, FIKA_CPUX_CALENDAR_WRITES_ENABLED: "false" },
    { ...productionEnvironment, FIKA_CPUX_CALENDAR_WRITES_ENABLED: undefined },
    { ...productionEnvironment, FIKA_CPUX_CALENDAR_ID: "  " },
    { FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os", FIKA_CPUX_CALENDAR_WRITES_ENABLED: "true" },
  ]) assert.equal(cpuXCalendarWritesEnabled(environment), false);
  assert.equal(cpuXCalendarBackfillEnabled({ ...productionEnvironment, FIKA_CPUX_CALENDAR_BACKFILL_ENABLED: "false" }), false);
});

test("non-production runtimes refuse Calendar enqueue, claim, backfill and direct Google calls", async () => {
  const staging = { ...productionEnvironment, FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev" };
  assert.deepEqual(await enqueueCpuXCalendarOrder(order(), staging), { status: "disabled" });
  assert.deepEqual(await claimCpuXCalendarOrder(order().canonicalId, order().version, new Date(), staging), { status: "disabled" });

  let reads = 0;
  let staged = 0;
  await assert.rejects(scanCpuXCalendarBackfill("2026-11-03", "2026-11-03", async () => { reads += 1; return [order()]; }, async () => { staged += 1; return { status: "queued" as const }; }, async () => ({ status: "delivered" }), staging), /backfill is disabled/);
  assert.equal(reads, 0);
  assert.equal(staged, 0);

  let transactionOperations = 0;
  const result = await stageCpuXCalendarOrder({ get: async () => { transactionOperations += 1; throw new Error("must not read"); }, set: () => { transactionOperations += 1; } } as never, order(), staging);
  assert.deepEqual(result, { status: "disabled" });
  assert.equal(transactionOperations, 0);

  let tokenRequests = 0;
  let calendarRequests = 0;
  await assert.rejects(applyCpuXCalendarOrder(order(), {
    calendarId: "cpux-calendar", environment: staging,
    getAccessToken: async () => { tokenRequests += 1; return "test-token"; },
    fetcher: async () => { calendarRequests += 1; return new Response("{}", { status: 200 }); },
  }), /disabled outside the explicitly enabled production runtime/);
  assert.equal(tokenRequests, 0);
  assert.equal(calendarRequests, 0);

  await assert.rejects(scanCpuXCalendarBackfill("2026-11-03", "2026-11-03", async () => { reads += 1; return [order()]; }, async () => { staged += 1; return { status: "queued" as const }; }, undefined, { ...productionEnvironment, FIKA_CPUX_CALENDAR_BACKFILL_ENABLED: "false" }), /backfill is disabled/);
  assert.equal(reads, 0);
  assert.equal(staged, 0);
});

test("internal Calendar handlers guard before claim or backfill access", async () => {
  const { readFile } = await import("node:fs/promises");
  const delivery = await readFile(new URL("../app/api/internal/cpux-calendar/route.ts", import.meta.url), "utf8");
  const backfill = await readFile(new URL("../app/api/internal/cpux-calendar-backfill/route.ts", import.meta.url), "utf8");
  assert.match(delivery, /cpuXCalendarWritesEnabled\(\)[\s\S]*?claimCpuXCalendarOrder/);
  assert.match(backfill, /body\.mode !== "execute"[\s\S]*?previewCpuXCalendarBackfill[\s\S]*?cpuXCalendarBackfillEnabled\(\)[\s\S]*?scanCpuXCalendarBackfill/);
});
