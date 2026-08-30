import assert from "node:assert/strict";
import test from "node:test";
import { fetchPlannerGet } from "../lib/planner-fetch";

test("planner GET requests share one in-flight response and preserve both consumers", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ projection: { serviceDate: "2026-08-24" } });
  }) as typeof fetch;
  try {
    const [first, second] = await Promise.all([
      fetchPlannerGet("https://logistics.test/api/logistics?projection=1&serviceDate=2026-08-24"),
      fetchPlannerGet("https://logistics.test/api/logistics?projection=1&serviceDate=2026-08-24"),
    ]);
    assert.equal(calls, 1);
    assert.deepEqual(await first.json(), await second.json());
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("planner GET dedupe does not suppress a later explicit refresh", async () => {
  let calls = 0;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => {
    calls += 1;
    return Response.json({ calls });
  }) as typeof fetch;
  try {
    await (await fetchPlannerGet("https://logistics.test/api/logistics?projection=1&serviceDate=2026-08-25")).json();
    await (await fetchPlannerGet("https://logistics.test/api/logistics?projection=1&serviceDate=2026-08-25")).json();
    assert.equal(calls, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
