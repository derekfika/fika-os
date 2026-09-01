import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { chartTickIndexes } from "../lib/usage-chart";
import { aggregateAttribution, cloudLoggingRequest, createCloudLoggingClient, parseTraceLogLine, CLOUD_LOGGING_MAX_PAGES, reconcileUsage } from "../lib/usage-attribution";
import { aggregateDaily, calculateBaseline, calculateStatus, compareUsagePeriods, loadUsageDashboard, londonDayStart, monitoringQueryParameters, monitoringRequestShape, normalizeMonitoringError, normalizeMonitoringPoints, parseUsageRange, resolutionForDuration } from "../lib/usage-observatory";

const config = { projectId: "fika-os-local", watchPercent: 0.5, highPercent: 0.75, criticalPercent: 0.9, spikeMultiplier: 2, maxWindowDays: 31, cacheTtlMs: 180000 };

test("custom ranges validate and preserve narrow diagnostic windows", () => {
  const range = parseUsageRange({ start: "2026-08-29T13:05:00+01:00", end: "2026-08-29T13:20:00+01:00" }, new Date("2026-08-29T14:00:00Z"), config);
  assert.equal(range.timezone, "Europe/London");
  assert.equal(Date.parse(range.end) - Date.parse(range.start), 15 * 60000);
  assert.throws(() => parseUsageRange({ start: range.end, end: range.start }, new Date(), config), /after/);
  assert.throws(() => parseUsageRange({ start: "2026-01-01T00:00:00Z", end: "2026-03-01T00:00:00Z" }, new Date("2026-03-02T00:00:00Z"), config), /too large/);
});

test("resolution is centralised by duration", () => {
  assert.equal(resolutionForDuration(2 * 3600000), "1m");
  assert.equal(resolutionForDuration(24 * 3600000), "5m");
  assert.equal(resolutionForDuration(7 * 86400000), "1h");
  assert.equal(resolutionForDuration(8 * 86400000), "1d");
});

test("short diagnostic windows use fine-grained resolutions", () => {
  assert.equal(resolutionForDuration(15 * 60000), "1m");
  assert.equal(resolutionForDuration(30 * 60000), "1m");
  assert.equal(resolutionForDuration(60 * 60000), "1m");
});

test("normalizes a 15-minute range to fifteen complete one-minute buckets", () => {
  const range = { start: "2026-08-29T18:41:00.000Z", end: "2026-08-29T18:56:00.000Z", timezone: "Europe/London" as const };
  const points = normalizeMonitoringPoints([{ timestamp: "2026-08-29T18:42:00.000Z", value: 11 }, { timestamp: "2026-08-29T18:46:00.000Z", value: 4 }], range, "1m");
  assert.equal(points.length, 15);
  assert.equal(points[0]?.timestamp, range.start);
  assert.equal(points.at(-1)?.timestamp, "2026-08-29T18:55:00.000Z");
  assert.equal(points[0]?.value, 11);
  assert.equal(points[4]?.value, 4);
  assert.equal(points.filter(point => point.value === 0).length, 13);
});

test("an empty range retains its complete domain and all metric rows share timestamps", async () => {
  const range = { start: "2026-08-29T18:41:00.000Z", end: "2026-08-29T18:56:00.000Z", timezone: "Europe/London" as const };
  const data = await loadUsageDashboard({ range, config, client: { query: async () => [] } });
  assert.deepEqual(Object.values(data.timeline).map(points => points.length), [15, 15, 15]);
  assert.deepEqual(data.timeline.reads.map(point => point.timestamp), data.timeline.writes.map(point => point.timestamp));
  assert.deepEqual(data.timeline.reads.map(point => point.timestamp), data.timeline.deletes.map(point => point.timestamp));
  assert.equal(data.timeline.reads.every(point => point.value === 0), true);
  assert.deepEqual(data.totals, { reads: 0, writes: 0, deletes: 0 });
});

test("activity in one minute does not shrink the requested chart domain", async () => {
  const range = { start: "2026-08-29T18:41:00.000Z", end: "2026-08-29T18:56:00.000Z", timezone: "Europe/London" as const };
  const data = await loadUsageDashboard({ range, config, client: { query: async metricType => metricType.endsWith("read_ops_count") ? [{ timestamp: "2026-08-29T18:45:00.000Z", value: 9 }] : [] } });
  assert.equal(data.timeline.reads.length, 15);
  assert.equal(data.timeline.reads[3]?.value, 9);
  assert.equal(data.timeline.reads.at(-1)?.timestamp, "2026-08-29T18:55:00.000Z");
  assert.equal(data.totals.reads, 9);
  assert.equal(data.totals.writes, 0);
  assert.equal(data.totals.deletes, 0);
});

test("custom ranges preserve start and end coverage without an off-by-one bucket", async () => {
  const range = { start: "2026-08-29T13:05:30.000Z", end: "2026-08-29T13:20:30.000Z", timezone: "Europe/London" as const };
  const data = await loadUsageDashboard({ range, config, client: { query: async () => [{ timestamp: "2026-08-29T13:06:00.000Z", value: 2 }] } });
  assert.equal(data.timeline.reads.length, 15);
  assert.equal(data.timeline.reads[0]?.timestamp, range.start);
  assert.equal(data.timeline.reads.at(-1)?.timestamp, "2026-08-29T13:19:30.000Z");
  assert.equal(data.totals.reads, 2);
});

test("chart tick density stays readable for each selected resolution", () => {
  assert.deepEqual(chartTickIndexes(15, "1m"), [0, 7, 14]);
  assert.equal(chartTickIndexes(289, "5m").length, 4);
  assert.equal(chartTickIndexes(169, "1h").length, 5);
  assert.equal(chartTickIndexes(8, "1d").length, 7);
  assert.deepEqual(chartTickIndexes(0, "1m"), [0]);
});

test("London day start handles BST and GMT deliberately", () => {
  assert.equal(londonDayStart(new Date("2026-08-29T12:00:00Z")).toISOString(), "2026-08-28T23:00:00.000Z");
  assert.equal(londonDayStart(new Date("2026-01-29T12:00:00Z")).toISOString(), "2026-01-29T00:00:00.000Z");
});

test("quota status and baseline are explainable", () => {
  assert.equal(calculateStatus(0.6, config), "watch");
  assert.equal(calculateStatus(undefined, config), "unknown");
  assert.equal(calculateBaseline([{ timestamp: "1", value: 10 }, { timestamp: "2", value: 10 }, { timestamp: "3", value: 20 }, { timestamp: "4", value: 10 }, { timestamp: "5", value: 30 }], 2).available, true);
  assert.equal(calculateBaseline([{ timestamp: "1", value: 0 }, { timestamp: "2", value: 1 }], 2).message, "Not enough baseline data");
});

test("daily aggregation is bounded to seven London-labelled buckets", () => {
  const now = new Date("2026-08-29T12:00:00Z");
  const result = aggregateDaily([{ timestamp: "2026-08-29T10:00:00Z", value: 12 }, { timestamp: "2026-08-28T10:00:00Z", value: 8 }], now);
  assert.equal(result.length, 7);
  assert.equal(result.at(-1)?.value, 12);
});

test("usage API is administrator guarded and does not scan operational Firestore", () => {
  const route = readFileSync(new URL("../app/api/usage/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAuthmodAdminContext/);
  assert.match(route, /withDataTrace/);
  assert.match(route, /usage-observatory-control-plane/);
  assert.doesNotMatch(route, /collection\(|getDocs\(|onSnapshot\(/);
});

test("Monitoring request shape uses exact Firestore database metrics and nested REST fields", () => {
  const range = { start: "2026-08-29T12:05:00.000Z", end: "2026-08-29T12:20:00.000Z", timezone: "Europe/London" as const };
  const shape = monitoringRequestShape("reads", range, "1m", "fika-os-dev");
  assert.equal(shape.metricType, "firestore.googleapis.com/document/read_ops_count");
  assert.equal(shape.resourceType, "firestore.googleapis.com/Database");
  assert.equal(shape.projectId, "fika-os-dev");
  assert.equal(shape.startTime, range.start);
  assert.equal(shape.endTime, range.end);
  assert.equal(shape.alignmentPeriod, "60s");
  assert.equal(shape.perSeriesAligner, "ALIGN_SUM");
  assert.equal(shape.crossSeriesReducer, "REDUCE_SUM");
  assert.deepEqual(shape.groupByFields, []);
  const params = monitoringQueryParameters("reads", range, "1m", "fika-os-dev");
  assert.equal(params.get("aggregation.alignmentPeriod"), "60s");
  assert.equal(params.get("aggregation.perSeriesAligner"), "ALIGN_SUM");
  assert.equal(params.get("aggregation.crossSeriesReducer"), "REDUCE_SUM");
  assert.equal(params.get("aggregation"), null);
  assert.match(params.get("filter") || "", /metric\.type = \"firestore\.googleapis\.com\/document\/read_ops_count\"/);
  assert.match(params.get("filter") || "", /resource\.type = \"firestore\.googleapis\.com\/Database\"/);
  assert.equal(monitoringRequestShape("writes", range, "5m", "fika-os-dev").metricType, "firestore.googleapis.com/document/write_ops_count");
  assert.equal(monitoringRequestShape("deletes", range, "5m", "fika-os-dev").metricType, "firestore.googleapis.com/document/delete_ops_count");
});

test("structured Monitoring errors retain rejected query details without credentials", () => {
  const message = normalizeMonitoringError({ error: { code: 400, status: "INVALID_ARGUMENT", message: "Invalid value at 'aggregation'", details: [{ fieldViolations: [{ field: "aggregation" }] }] } }, 400);
  assert.match(message, /code=400/);
  assert.match(message, /INVALID_ARGUMENT/);
  assert.match(message, /aggregation/);
  assert.doesNotMatch(message, /Bearer|token|secret/i);
});

test("metric failures are isolated and successful operation totals remain available", async () => {
  const config = { projectId: "fika-os-local", watchPercent: 0.5, highPercent: 0.75, criticalPercent: 0.9, spikeMultiplier: 2, maxWindowDays: 31, cacheTtlMs: 180000 };
  const client = { query: async (metricType: string) => {
    if (metricType.endsWith("delete_ops_count")) throw new Error("delete metric rejected");
    return [{ timestamp: "2026-08-29T12:00:00.000Z", value: metricType.endsWith("read_ops_count") ? 7 : 3 }];
  } };
  const data = await loadUsageDashboard({ now: new Date("2026-08-29T12:30:00.000Z"), config, client });
  assert.equal(data.totals.reads, 7);
  assert.equal(data.totals.writes, 3);
  assert.equal(data.totals.deletes, null);
  assert.equal(data.metricErrors.deletes, "delete metric rejected");
});

test("Cloud Logging request is bounded to the selected project and window", () => {
  const range = { start: "2026-08-29T12:05:00.000Z", end: "2026-08-29T12:20:00.000Z", timezone: "Europe/London" as const };
  const request = cloudLoggingRequest(range, "fika-os-dev");
  assert.deepEqual(request.body.resourceNames, ["projects/fika-os-dev"]);
  assert.equal(request.body.pageSize, 200);
  assert.match(request.body.filter, /timestamp >= "2026-08-29T12:05:00.000Z"/);
  assert.match(request.body.filter, /timestamp <= "2026-08-29T12:20:00.000Z"/);
  assert.match(request.body.filter, /resource\.type = "cloud_run_revision"/);
  assert.match(request.body.filter, /firebaseapphosting\.googleapis\.com\/Backend/);
  assert.match(request.body.filter, /FIKA_DATA_TRACE_TOTAL/);
});

test("Cloud Logging parser handles valid, malformed, and compatibility records without alias double counting", () => {
  assert.equal(parseTraceLogLine("[FIKA_DATA_TRACE_TOTAL] {\"app\":\"logistics\"}")?.kind, "total");
  assert.equal(parseTraceLogLine("[FIKA_DATA_TRACE_TOTAL] not-json"), undefined);
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const result = aggregateAttribution([
    { timestamp: "2026-08-29T12:03:00.000Z", textPayload: "[FIKA_DATA_TRACE_TOTAL] {\"app\":\"logistics\",\"action\":\"day.load\",\"traceId\":\"t1\",\"firestoreReads\":9,\"firestoreDocuments\":4,\"clientCacheDocuments\":2,\"durationMs\":12,\"level\":\"WARN\",\"records\":[{\"operation\":\"runs.service-date\",\"source\":\"FIRESTORE\",\"firestoreReads\":9,\"documents\":4}]}" },
    { timestamp: "2026-08-29T12:04:00.000Z", textPayload: "[FIKA_DATA_TRACE_TOTAL] malformed" },
  ], range, "1m", 10);
  assert.equal(result.traceCount, 1);
  assert.equal(result.parseFailures, 1);
  assert.equal(result.estimatedFirestoreBillableReads, 9);
  assert.equal(result.apps.find(app => app.app === "logistics")?.firestoreReturnedDocuments, 4);
  assert.equal(result.apps.find(app => app.app === "logistics")?.clientCacheRecords, 2);
  assert.equal(result.operations[0]?.operation, "runs.service-date");
  assert.equal(result.operations[0]?.sourceClass, "FIRESTORE_CANONICAL");
  assert.doesNotMatch(JSON.stringify(result), /traceId|requestId|documentId|email/i);
});

test("attribution exposes highest-read request details for controlled UAT windows", () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const result = aggregateAttribution([
    { timestamp: "2026-08-29T12:04:00.000Z", textPayload: "[FIKA_DATA_TRACE_TOTAL] {\"app\":\"menu-planning\",\"action\":\"menu-planning.week.open\",\"path\":\"/api/rolling-menu\",\"traceId\":\"trace-1\",\"durationMs\":42,\"estimatedFirestoreBillableReads\":8,\"records\":[{\"operation\":\"week.entries\",\"source\":\"FIRESTORE\",\"documents\":8}]}" },
  ], range, "1m", 10);
  assert.equal(result.traceDetailsTotal, 1);
  assert.equal(result.traceDetails.length, 1);
  assert.deepEqual(result.traceDetails[0], { timestamp: "2026-08-29T12:04:00.000Z", app: "menu-planning", action: "menu-planning.week.open", route: "/api/rolling-menu", durationMs: 42, level: "NORMAL", estimatedBillableReads: 8, returnedDocuments: 8, estimatedWrites: 0, estimatedDeletes: 0, operationCount: 1, operations: ["week.entries"], cacheHits: 0, cacheMisses: 0 });
  assert.equal(result.traceDetailsTruncated, false);
});

test("attribution coverage floors overage and aligns complete zero-filled buckets", () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const result = aggregateAttribution([{ timestamp: "2026-08-29T12:05:00.000Z", textPayload: "[FIKA_DATA_TRACE_TOTAL] {\"app\":\"integration-hub\",\"action\":\"oploc.load\",\"traceId\":\"t2\",\"estimatedFirestoreBillableReads\":11}" }], range, "1m", 10);
  assert.equal(result.buckets.length, 15);
  assert.equal(result.buckets[0]?.attributedEstimatedReads, 0);
  assert.equal(result.buckets[5]?.attributedEstimatedReads, 11);
  assert.equal(result.unattributedReads, 0);
  assert.equal(result.coveragePercent, 110);
  assert.equal(result.overAttribution, true);
});

test("Cloud Logging client follows multiple pages through the final page", async () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const requests: Array<{ pageToken?: string }> = [];
  const client = createCloudLoggingClient(async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { pageToken?: string };
    requests.push(request);
    return new Response(JSON.stringify(request.pageToken ? { entries: [{ insertId: "two" }] } : { entries: [{ insertId: "one" }], nextPageToken: "next" }), { status: 200 });
  }, "fika-os-dev", async () => "test-token");
  const result = await client.list(range);
  assert.deepEqual(result.entries.map(entry => entry.insertId), ["one", "two"]);
  assert.equal(result.truncated, false);
  assert.equal(requests.length, 2);
});

test("Cloud Logging pagination deduplicates IDs, enforces a bound, and preserves failures", async () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  let calls = 0;
  const bounded = createCloudLoggingClient(async () => { calls += 1; return new Response(JSON.stringify({ entries: [{ insertId: "same" }], nextPageToken: `next-${calls}` }), { status: 200 }); }, "fika-os-dev", async () => "test-token");
  const result = await bounded.list(range);
  assert.equal(result.entries.length, 1);
  assert.equal(result.truncated, true);
  assert.equal(calls, CLOUD_LOGGING_MAX_PAGES);
  const failing = createCloudLoggingClient(async () => new Response(JSON.stringify({ error: { message: "denied" } }), { status: 403 }), "fika-os-dev", async () => "test-token");
  await assert.rejects(failing.list(range), /HTTP 403.*denied/);
});

test("attribution recognises all canonical OS app IDs and aggregates cache outcomes", () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const apps = ["integration-hub", "menu-planning", "logistics", "cpu-production", "delivered-in", "hospitality-booking", "ad-hoc-production", "events-dashboard"];
  const entries = apps.map((app, index) => ({ timestamp: `2026-08-29T12:0${index}:00.000Z`, textPayload: `[FIKA_DATA_TRACE_TOTAL] ${JSON.stringify({ schemaVersion: 1, app, action: "test", traceId: app, cache: { HIT: 1 } })}` }));
  const result = aggregateAttribution(entries, range, "1m", 0);
  assert.deepEqual(result.appsSeenInWindow, [...apps].sort());
  assert.equal(result.cache.HIT, apps.length);
  assert.equal(result.apps.some(app => app.app === "unknown/other"), false);
});

test("reconciliation preserves exact, unattributed, over-attributed, unavailable, and incomplete states", () => {
  const actual = { reads: 100, writes: 10, deletes: 0 } as const;
  const exact = reconcileUsage(actual, { reads: 100, writes: 10, deletes: 0 }, false);
  assert.deepEqual(exact.unattributed, { reads: 0, writes: 0, deletes: 0 });
  assert.deepEqual(exact.status, { reads: "COMPLETE", writes: "COMPLETE", deletes: "COMPLETE" });
  const partial = reconcileUsage(actual, { reads: 80, writes: 4, deletes: 0 }, true);
  assert.equal(partial.coveragePercent.reads, 80);
  assert.equal(partial.status.reads, "INCOMPLETE");
  const over = reconcileUsage(actual, { reads: 101, writes: 11, deletes: 1 }, false);
  assert.equal(over.unattributed.reads, -1);
  assert.equal(over.status.reads, "OVER_ATTRIBUTED");
  const unavailable = reconcileUsage({ reads: null, writes: null, deletes: null }, { reads: 4, writes: 2, deletes: 1 }, false);
  assert.deepEqual(unavailable.coveragePercent, { reads: null, writes: null, deletes: null });
  assert.deepEqual(unavailable.status, { reads: "UNAVAILABLE", writes: "UNAVAILABLE", deletes: "UNAVAILABLE" });
});

test("dashboard keeps zero-activity canonical apps and reconciles writes/deletes", async () => {
  const range = { start: "2026-08-29T12:00:00.000Z", end: "2026-08-29T12:15:00.000Z", timezone: "Europe/London" as const };
  const data = await loadUsageDashboard({ range, config, client: { query: async metric => [{ timestamp: "2026-08-29T12:01:00.000Z", value: metric.includes("read") ? 10 : metric.includes("write") ? 5 : 2 }] }, loggingClient: { list: async () => ({ entries: [{ timestamp: range.start, textPayload: `[FIKA_DATA_TRACE_TOTAL] ${JSON.stringify({ app: "logistics", action: "x", traceId: "x", estimatedFirestoreBillableReads: 7, estimatedFirestoreWrites: 3, estimatedFirestoreDeletes: 1 })}` }], truncated: false }) } });
  assert.equal(data.appUsage.rows.some(row => row.app === "events-dashboard" && row.traceCount === 0), true);
  assert.equal(data.attribution.reconciliation.attributed.writes, 3);
  assert.equal(data.attribution.reconciliation.attributed.deletes, 1);
  assert.equal(data.attribution.reconciliation.actual.writes, 5);
});

test("period comparison is bounded and avoids zero-denominator NaN values", () => {
  const base = { actual: { reads: 100, writes: 5, deletes: 0 }, attributed: { reads: 80, writes: 4, deletes: 0 }, cache: { HIT: 8, MISS: 2 } };
  const comparison = compareUsagePeriods(base, { actual: { reads: 50, writes: 5, deletes: 0 }, attributed: { reads: 40, writes: 2, deletes: 0 }, cache: { HIT: 0, MISS: 0 } });
  assert.deepEqual(comparison.actualDelta, { reads: 50, writes: 0, deletes: 0 });
  assert.deepEqual(comparison.attributedDelta, { reads: 40, writes: 2, deletes: 0 });
  assert.equal(comparison.cacheHitRateDelta, null);
  assert.equal(Number.isNaN(comparison.unattributedShareDelta as number), false);
});
