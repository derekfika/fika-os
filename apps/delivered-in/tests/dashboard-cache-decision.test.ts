import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  awaitDeliveredInCacheWithin,
  selectDeliveredInCachedDays,
  selectScopedCachedValues,
} from "../lib/dashboard-cache-decision";
import { readCachedDeliveredInDays } from "../app/lib/delivered-in-indexeddb";

const entry = (serviceDate: string, overrides: Record<string, unknown> = {}) => ({
  serviceDate,
  projectionVersion: 1,
  contentHash: `hash-${serviceDate}`,
  ...overrides,
});
const day = (date: string, overrides: Record<string, unknown> = {}) => ({
  date,
  projectionVersion: 1,
  contentHash: `hash-${date}`,
  ...overrides,
});

test("a valid cache hit that arrives quickly is used and avoids the full request", async () => {
  const cached = [day("2026-10-26")];
  const read = await awaitDeliveredInCacheWithin(Promise.resolve(cached), [] as typeof cached, 200);
  assert.equal(read.outcome, "settled");
  const decision = selectDeliveredInCachedDays({ entries: [entry("2026-10-26")], projectionState: "current", cachedDays: read.value });
  assert.equal(decision.matches, true);
  assert.deepEqual(decision.visibleCachedDays.map(item => item.date), ["2026-10-26"]);
});

test("a cache miss leaves the dashboard to the authoritative request", async () => {
  const read = await awaitDeliveredInCacheWithin(Promise.resolve([] as ReturnType<typeof day>[]), [], 200);
  assert.equal(read.outcome, "settled");
  const decision = selectDeliveredInCachedDays({ entries: [entry("2026-10-26")], projectionState: "current", cachedDays: read.value });
  assert.equal(decision.matches, false);
  assert.deepEqual(decision.visibleCachedDays, []);
});

test("a rejected cache read falls back to the miss path without throwing", async () => {
  const read = await awaitDeliveredInCacheWithin(Promise.reject(new Error("blocked")), [] as ReturnType<typeof day>[], 200);
  assert.equal(read.outcome, "rejected");
  assert.deepEqual(read.value, []);
});

test("a hung cache read times out inside its bounded wait and falls back", async () => {
  const started = Date.now();
  const read = await awaitDeliveredInCacheWithin(new Promise<ReturnType<typeof day>[]>(() => undefined), [] as ReturnType<typeof day>[], 20);
  assert.equal(read.outcome, "timed-out");
  assert.deepEqual(read.value, []);
  assert.ok(Date.now() - started < 2_000, "the wait must be bounded");
});

test("a late cache result never changes an outcome that has already been decided", async () => {
  let release: (value: ReturnType<typeof day>[]) => void = () => undefined;
  const late = new Promise<ReturnType<typeof day>[]>((resolve) => { release = resolve; });
  const read = await awaitDeliveredInCacheWithin(late, [] as ReturnType<typeof day>[], 10);
  assert.equal(read.outcome, "timed-out");
  release([day("2026-10-26")]);
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.deepEqual(read.value, []);
  assert.equal(read.outcome, "timed-out");
});

test("a stale cached day is not treated as a hit and is shown only as stale", () => {
  const decision = selectDeliveredInCachedDays({
    entries: [entry("2026-10-26", { projectionVersion: 2 })],
    projectionState: "current",
    cachedDays: [day("2026-10-26", { projectionVersion: 1 })],
  });
  assert.equal(decision.matches, false);
});

test("withdrawn entries are excluded from both the hit decision and the visible cache", () => {
  const decision = selectDeliveredInCachedDays({
    entries: [entry("2026-10-26"), entry("2026-10-27", { state: "withdrawn" })],
    projectionState: "current",
    cachedDays: [day("2026-10-26"), day("2026-10-27")],
  });
  assert.equal(decision.matches, true, "a withdrawn date must not block a hit on the active date");
  assert.deepEqual(decision.visibleCachedDays.map(item => item.date), ["2026-10-26"]);
});

test("a non-current projection never counts as a cache hit", () => {
  const decision = selectDeliveredInCachedDays({ entries: [entry("2026-10-26")], projectionState: "partial", cachedDays: [day("2026-10-26")] });
  assert.equal(decision.matches, false);
});

test("cached records are scoped to the requesting account and OPLOC", () => {
  const values = [
    { accountScope: "a@fikacatering.com", oplocId: "oploc:one", serviceDate: "2026-10-26" },
    { accountScope: "b@fikacatering.com", oplocId: "oploc:one", serviceDate: "2026-10-26" },
    { accountScope: "a@fikacatering.com", oplocId: "oploc:two", serviceDate: "2026-10-26" },
  ];
  assert.deepEqual(selectScopedCachedValues(values, "a@fikacatering.com", "oploc:one"), [values[0]]);
});

test("the authoritative load path is unaffected when IndexedDB is unavailable", async () => {
  // The Node test runtime has no indexedDB global, so the cache resolves empty and the page falls back to the API.
  assert.equal(typeof (globalThis as { indexedDB?: unknown }).indexedDB, "undefined");
  const cached = await readCachedDeliveredInDays("a@fikacatering.com", "oploc:one");
  assert.deepEqual(cached, []);
  const read = await awaitDeliveredInCacheWithin(Promise.resolve(cached), [] as ReturnType<typeof day>[], 200);
  const decision = selectDeliveredInCachedDays({ entries: [entry("2026-10-26")], projectionState: "current", cachedDays: read.value });
  assert.equal(decision.matches, false);
});

test("the page waits for the cache under a bounded wait and checks the generation guard before using it", () => {
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /awaitDeliveredInCacheWithin\(\s*readCachedDeliveredInDays\(accountScope, nextSite\)/);
  assert.doesNotMatch(page, /withDeliveredInLoadTimeout\(\(\) =>\s*readCachedDeliveredInDays/);
  const guardIndex = page.indexOf("const { matches, visibleCachedDays } = selectDeliveredInCachedDays", page.indexOf("awaitDeliveredInCacheWithin("));
  const beforeDecision = page.slice(page.indexOf("awaitDeliveredInCacheWithin("), guardIndex);
  assert.match(beforeDecision, /if \(!current\(\)\) return;/);
});
