import assert from "node:assert/strict";
import test from "node:test";
import { fetchProjectionWithRecovery } from "../lib/projection-fetch";
import type { LogisticsDayProjection } from "../lib/types";

const projection = (sequence: number): LogisticsDayProjection => ({
  serviceDate: "2026-09-17",
  revision: 1,
  lastChangeSequence: sequence,
  state: "CURRENT",
  planningQueue: [],
  deliveryLoads: [],
  runs: [],
  exceptions: [],
  summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 },
  rebuiltAt: "2026-09-17T08:00:00.000Z",
});

test("missing projections reconcile once and reject an older visible projection", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const responses = [
    Response.json({ error: { code: "LOGISTICS_PROJECTION_NOT_MATERIALIZED" } }, { status: 503 }),
    Response.json({ projection: projection(8) }),
    Response.json({ projection: projection(7) }),
    Response.json({ projection: projection(8) }),
  ];
  const delays: number[] = [];
  const result = await fetchProjectionWithRecovery({
    serviceDate: "2026-09-17",
    retryDelays: [0, 25],
    sleep: async (delay) => { delays.push(delay); },
    fetcher: async (input, init) => {
      calls.push({ url: String(input), method: init?.method || "GET" });
      return responses.shift()!;
    },
  });
  assert.equal(result.body?.projection?.lastChangeSequence, 8);
  assert.deepEqual(calls.map((call) => call.method), ["GET", "POST", "GET", "GET"]);
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.deepEqual(delays, [25]);
});

test("a valid empty day completes recovery without inventing work", async () => {
  const responses = [
    Response.json({ error: { code: "LOGISTICS_PROJECTION_NOT_MATERIALIZED" } }, { status: 503 }),
    Response.json({ projection: projection(3) }),
    Response.json({ projection: null, projectionState: "VALID_EMPTY" }),
  ];
  const result = await fetchProjectionWithRecovery({
    serviceDate: "2026-09-17",
    retryDelays: [0],
    sleep: async () => undefined,
    fetcher: async () => responses.shift()!,
  });
  assert.equal(result.response.ok, true);
  assert.equal(result.body?.projectionState, "VALID_EMPTY");
  assert.equal(result.body?.projection, null);
});

test("a stale projection triggers one explicit reconciliation and returns current state", async () => {
  const calls: string[] = [];
  const responses = [
    Response.json({ projection: { ...projection(4), state: "STALE" }, projectionState: "STALE" }),
    Response.json({ projection: projection(5) }),
    Response.json({ projection: projection(5), projectionState: "CURRENT" }),
  ];
  const result = await fetchProjectionWithRecovery({
    serviceDate: "2026-09-17",
    retryDelays: [0],
    sleep: async () => undefined,
    fetcher: async (input, init) => {
      calls.push(`${init?.method || "GET"} ${String(input)}`);
      return responses.shift()!;
    },
  });
  assert.equal(result.body?.projectionState, "CURRENT");
  assert.deepEqual(calls.map((call) => call.split(" ")[0]), ["GET", "POST", "GET"]);
});
