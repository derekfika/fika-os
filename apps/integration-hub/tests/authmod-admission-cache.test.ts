import assert from "node:assert/strict";
import test from "node:test";
import { cachedAuthmodAdmission, clearAuthmodAdmissionCacheForTests, invalidateAuthmodAdmissionCache, withAuthmodRequestContext } from "../lib/authmod-admission-cache";
import { recordDataAccess, withDataTrace } from "@fika/server-shared/data-source-meter-server";

const totalsFrom = (lines: string[]) => lines
  .filter(line => line.startsWith("[FIKA_DATA_TRACE_TOTAL] "))
  .map(line => JSON.parse(line.slice("[FIKA_DATA_TRACE_TOTAL] ".length)) as Record<string, unknown>);

test.beforeEach(() => {
  process.env.FIKA_DATA_SOURCE_TRACE = "1";
  clearAuthmodAdmissionCacheForTests();
});

test.afterEach(() => {
  clearAuthmodAdmissionCacheForTests();
  delete process.env.FIKA_DATA_SOURCE_TRACE;
});

test("warm admission reuses the scoped result and reports APP_CACHE without Firestore reads", async () => {
  const lines: string[] = [];
  const originalInfo = console.info;
  console.info = (...args: unknown[]) => { lines.push(String(args[0] || "")); };
  let loads = 0;
  try {
    const load = async () => {
      loads += 1;
      recordDataAccess({ app: "integration-hub", operation: "authmod.listAuthorityGrants", source: "FIRESTORE", documents: 21 });
      return { allowed: true };
    };
    await withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission" }, () => cachedAuthmodAdmission({ identityId: "identity-a", appId: "logistics", load }));
    await withDataTrace({ app: "integration-hub", action: "integration-hub.logistics.admission" }, () => cachedAuthmodAdmission({ identityId: "identity-a", appId: "logistics", load }));
  } finally { console.info = originalInfo; }

  assert.equal(loads, 1);
  const totals = totalsFrom(lines);
  assert.equal(totals.length, 2);
  assert.equal(totals[0].estimatedFirestoreBillableReads, 21);
  assert.equal(totals[1].estimatedFirestoreBillableReads, 0);
  assert.equal((totals[1].records as Array<Record<string, unknown>>)[0].source, "APP_CACHE");
});

test("denials are cached without changing the authorization decision", async () => {
  let loads = 0;
  const load = async () => { loads += 1; return { allowed: false, reasonCode: "no-access" }; };
  const first = await cachedAuthmodAdmission({ identityId: "denied", appId: "logistics", load });
  const second = await cachedAuthmodAdmission({ identityId: "denied", appId: "logistics", load });
  assert.deepEqual(second, first);
  assert.equal(loads, 1);
});

test("concurrent admissions deduplicate the cold evaluator", async () => {
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const load = async () => { loads += 1; await gate; return { allowed: true }; };
  const first = cachedAuthmodAdmission({ identityId: "concurrent", appId: "logistics", load });
  const second = cachedAuthmodAdmission({ identityId: "concurrent", appId: "logistics", load });
  release();
  assert.deepEqual(await Promise.all([first, second]), [{ allowed: true }, { allowed: true }]);
  assert.equal(loads, 1);
});

test("authorization mutations invalidate cached decisions", async () => {
  let loads = 0;
  const load = async () => ({ allowed: ++loads === 1 });
  assert.equal((await cachedAuthmodAdmission({ identityId: "mutable", appId: "logistics", load })).allowed, true);
  invalidateAuthmodAdmissionCache();
  assert.equal((await cachedAuthmodAdmission({ identityId: "mutable", appId: "logistics", load })).allowed, false);
  assert.equal(loads, 2);
});

test("dependency failures are retried rather than cached as denials", async () => {
  let loads = 0;
  const load = async () => ({ allowed: false, reasonCode: ++loads === 1 ? "store-unavailable" : "app-not-assigned" });
  assert.equal((await cachedAuthmodAdmission({ identityId: "unavailable", appId: "logistics", load })).reasonCode, "store-unavailable");
  assert.equal((await cachedAuthmodAdmission({ identityId: "unavailable", appId: "logistics", load })).reasonCode, "app-not-assigned");
  assert.equal(loads, 2);
});

test("known authority expiry bounds the short-lived cache", async () => {
  let loads = 0;
  const load = async () => ({ allowed: true, validUntil: new Date(Date.now() + 10).toISOString(), load: ++loads });
  await cachedAuthmodAdmission({ identityId: "expiring", appId: "logistics", load });
  await new Promise(resolve => setTimeout(resolve, 20));
  await cachedAuthmodAdmission({ identityId: "expiring", appId: "logistics", load });
  assert.equal(loads, 2);
});

test("request context reuse is generation-aware", async () => {
  let loads = 0;
  await withAuthmodRequestContext(async () => {
    const load = async () => ({ allowed: true, load: ++loads });
    await cachedAuthmodAdmission({ identityId: "request", appId: "logistics", load });
    await cachedAuthmodAdmission({ identityId: "request", appId: "logistics", load });
    assert.equal(loads, 1);
    invalidateAuthmodAdmissionCache();
    await cachedAuthmodAdmission({ identityId: "request", appId: "logistics", load });
    assert.equal(loads, 2);
  });
});

test("a stale in-flight result cannot delete or repopulate a newer generation", async () => {
  let loads = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = cachedAuthmodAdmission({ identityId: "stale", appId: "logistics", load: async () => { loads += 1; await gate; return { allowed: true, load: loads }; } });
  invalidateAuthmodAdmissionCache();
  const second = cachedAuthmodAdmission({ identityId: "stale", appId: "logistics", load: async () => { loads += 1; return { allowed: true, load: loads }; } });
  assert.deepEqual(await second, { allowed: true, load: 2 });
  release();
  assert.deepEqual(await first, { allowed: true, load: 2 });
  const third = await cachedAuthmodAdmission({ identityId: "stale", appId: "logistics", load: async () => { loads += 1; return { allowed: true, load: loads }; } });
  assert.deepEqual(third, { allowed: true, load: 2 });
  assert.equal(loads, 2);
});

test("identity, app, and scope keys cannot share admission results", async () => {
  let loads = 0;
  const load = async () => ({ allowed: true, load: ++loads });
  await cachedAuthmodAdmission({ identityId: "a", appId: "logistics", scope: "site-1", load });
  await cachedAuthmodAdmission({ identityId: "b", appId: "logistics", scope: "site-1", load });
  await cachedAuthmodAdmission({ identityId: "a", appId: "menu-planning", scope: "site-1", load });
  await cachedAuthmodAdmission({ identityId: "a", appId: "logistics", scope: "site-2", load });
  assert.equal(loads, 4);
});
