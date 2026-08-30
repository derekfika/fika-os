import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { classifyDataTraceLevel, endDataTrace, isDataSourceTraceEnabled, recordDataAccess, startDataTrace } from "@fika/server-shared/data-source-meter";
import { recordDataAccess as recordServerDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";

test("data-source meter supports bounded sources and thresholds", () => {
  assert.deepEqual(classifyDataTraceLevel(250), "NORMAL");
  assert.deepEqual(classifyDataTraceLevel(251), "WARN");
  assert.deepEqual(classifyDataTraceLevel(1001), "HIGH");
  assert.equal(isDataSourceTraceEnabled({ FIKA_DATA_SOURCE_TRACE: "1" }), true);
  assert.equal(isDataSourceTraceEnabled({ FIKA_DATA_SOURCE_TRACE: "0" }), false);
});

test("data-source meter aggregates returned documents by source without duplicate physical reads", () => {
  const prior = process.env.FIKA_DATA_SOURCE_TRACE;
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  try {
    const trace = startDataTrace({ app: "logistics", action: "mobile.day.load", path: "/mobile" });
    recordDataAccess(trace, { operation: "jobs.service-date", source: "FIRESTORE", documents: 184 });
    recordDataAccess(trace, { operation: "projection.cache", source: "CLIENT_CACHE", documents: 1, cacheHit: true });
    const summary = endDataTrace(trace);
    assert.equal(summary?.firestoreDocuments, 184);
    assert.equal(summary?.clientCacheDocuments, 1);
    assert.equal(summary?.totalDocuments, 185);
    assert.equal(summary?.operations, 2);
    assert.equal(summary?.level, "NORMAL");
  } finally {
    if (prior === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE; else process.env.FIKA_DATA_SOURCE_TRACE = prior;
  }
});

test("disabled tracing is a no-op and core has no Firestore dependency", () => {
  const prior = process.env.FIKA_DATA_SOURCE_TRACE;
  delete process.env.FIKA_DATA_SOURCE_TRACE;
  try {
    const trace = startDataTrace({ app: "menu-planning", action: "week.next", path: "/" });
    recordDataAccess(trace, { operation: "week.summaries", source: "FIRESTORE", documents: 7 });
    assert.equal(trace, undefined);
    assert.equal(endDataTrace(trace), undefined);
    const source = readFileSync(new URL("../../../packages/server-shared/src/data-source-meter.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /from ["'].*(?:firestore|firebase)/i);
  } finally {
    if (prior !== undefined) process.env.FIKA_DATA_SOURCE_TRACE = prior;
  }
});

test("malformed counts cannot make tracing fail", () => {
  const prior = process.env.FIKA_DATA_SOURCE_TRACE;
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  try {
    const trace = startDataTrace({ app: "integration-hub", action: "oploc.load", path: "/api/oplocs" });
    assert.doesNotThrow(() => recordDataAccess(trace, { operation: "oploc.list", source: "UNKNOWN", documents: Number.NaN }));
    assert.equal(endDataTrace(trace)?.unknownDocuments, 0);
  } finally {
    if (prior === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE; else process.env.FIKA_DATA_SOURCE_TRACE = prior;
  }
});

test("separate app/action traces remain isolated", () => {
  const prior = process.env.FIKA_DATA_SOURCE_TRACE;
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  try {
    const first = startDataTrace({ app: "logistics", action: "mobile.day.load", path: "/mobile" });
    const second = startDataTrace({ app: "menu-planning", action: "week.next", path: "/planner" });
    recordDataAccess(first, { operation: "jobs.service-date", source: "FIRESTORE", documents: 3 });
    recordDataAccess(second, { operation: "week.load", source: "FIRESTORE", documents: 7 });
    assert.equal(endDataTrace(first)?.firestoreDocuments, 3);
    assert.equal(endDataTrace(second)?.firestoreDocuments, 7);
  } finally {
    if (prior === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE; else process.env.FIKA_DATA_SOURCE_TRACE = prior;
  }
});

test("logging failure does not affect traced work", async () => {
  const priorFlag = process.env.FIKA_DATA_SOURCE_TRACE;
  const priorInfo = console.info;
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  console.info = (() => { throw new Error("diagnostic logger unavailable"); }) as typeof console.info;
  try {
    const value = await withDataTrace({ app: "logistics", action: "test", path: "/test" }, async () => {
      recordServerDataAccess({ operation: "test.read", source: "FIRESTORE", documents: 1 });
      return "application result";
    });
    assert.equal(value, "application result");
  } finally {
    console.info = priorInfo;
    if (priorFlag === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE; else process.env.FIKA_DATA_SOURCE_TRACE = priorFlag;
  }
});

test("enabled server traces emit searchable single-line start, operation and total records", async () => {
  const priorFlag = process.env.FIKA_DATA_SOURCE_TRACE;
  const priorInfo = console.info;
  const lines: string[] = [];
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  console.info = ((...args: unknown[]) => lines.push(args.map(String).join(" "))) as typeof console.info;
  try {
    await withDataTrace({ app: "logistics", action: "mobile.day.load", path: "/api/logistics" }, async () => {
      recordServerDataAccess({ operation: "projection.by-service-date", source: "FIRESTORE", documents: 1 });
    });
    assert.equal(lines.filter((line) => line.startsWith("[FIKA_DATA_TRACE] ")).length, 2);
    assert.match(lines[0], /^\[FIKA_DATA_TRACE\] \{"phase":"START"/);
    assert.match(lines[1], /"operation":"projection\.by-service-date"/);
    assert.match(lines[2], /^\[FIKA_DATA_TRACE_TOTAL\] \{/);
  } finally {
    console.info = priorInfo;
    if (priorFlag === undefined) delete process.env.FIKA_DATA_SOURCE_TRACE; else process.env.FIKA_DATA_SOURCE_TRACE = priorFlag;
  }
});

test("trace adapters do not add Firestore access or listeners", () => {
  const server = readFileSync(new URL("../../../packages/server-shared/src/data-source-meter-server.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../../../packages/server-shared/src/data-source-meter-client.ts", import.meta.url), "utf8");
  assert.doesNotMatch(`${server}\n${client}`, /firebase-admin|firebase\/firestore|onSnapshot|\.on\(/i);
  assert.doesNotMatch(`${server}\n${client}`, /\.collection\(|\.doc\(|\.set\(|\.add\(/i);
});
