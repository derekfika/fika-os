import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCachedWeek, getCachedWeekSelection, putCachedWeek, setMenuCacheOpenTimeoutForTests, type CachedMenuWeek } from "../lib/menu-week-cache";
import { applyRollingMutationDelta, MenuLoadError, loadFailureFrom, withMenuRequestTimeout } from "../app/planner-data";

const source = (path: string) => readFile(new URL(path, import.meta.url), "utf8");
const globals = globalThis as unknown as { indexedDB?: unknown };

test("load failures keep the HTTP status for 401, 403 and 503", () => {
  for (const status of [401, 403, 503]) {
    const failure = loadFailureFrom(new MenuLoadError(`Menu could not be loaded (HTTP ${status}).`, status));
    assert.equal(failure.status, status);
    assert.match(failure.message, new RegExp(`HTTP ${status}`));
  }
  assert.deepEqual(loadFailureFrom(new Error("network down")), { message: "network down" });
  assert.equal(loadFailureFrom("odd").message, "Menu could not be loaded.");
});

test("a stalled rolling-menu request aborts and becomes a retryable load error", async () => {
  let aborted = false;
  await assert.rejects(
    withMenuRequestTimeout(signal => new Promise<never>((_resolve, reject) => {
      signal.addEventListener("abort", () => { aborted = true; reject(new Error("aborted")); }, { once: true });
    }), 20),
    /Menu request timed out\. Please retry\./,
  );
  assert.equal(aborted, true);
  assert.match(loadFailureFrom(new Error("Menu request timed out. Please retry.")).message, /Please retry/);
});

test("a completed rolling-menu request clears its timeout", async () => {
  const result = await withMenuRequestTimeout(async () => "loaded", 100);
  assert.equal(result, "loaded");
});

test("rolling mutation deltas advance the week and include newly created entries", () => {
  const before = {
    week: { id: "rolling-week:2099-01-05", version: 96, entryIds: [] },
    days: [{ id: "day:1", entryIds: [] }],
    entries: [],
  } as unknown as Parameters<typeof applyRollingMutationDelta>[0];
  const created = { id: "entry:new", dayId: "day:1", slot: "SALAD 1", itemId: "dish:new", itemLabel: "New salad" } as never;
  const after = applyRollingMutationDelta(before, {
    week: { ...before.week, version: 97, entryIds: ["entry:new"] },
    days: [{ id: "day:1", entryIds: ["entry:new"] } as never],
    entries: [created],
  });
  assert.equal(after.week.version, 97);
  assert.equal(after.entries[0]?.id, "entry:new");
  assert.deepEqual(after.days[0]?.entryIds, ["entry:new"]);
  assert.equal(applyRollingMutationDelta(after, { week: { ...after.week, version: 97 }, days: [], entries: [] }), after, "an already-applied version is not applied twice");
});

test("planner-data surfaces status from readJson and never awaits cache persistence before rendering", async () => {
  const data = await source("../app/planner-data.ts");
  assert.match(data, /throw new MenuLoadError\(/);
  assert.match(data, /withMenuRequestTimeout\(async signal => \{ const response = await fetch\(`\/api\/rolling-menu\$\{query\}`,[^\n]*signal/);
  assert.match(data, /setLoadFailure\(loadFailureFrom\(cause\)\)/);
  assert.match(data, /const load = useCallback\(async \(weekId\?: string\) => \{[^\n]*setLoadFailure\(undefined\)/);
  assert.doesNotMatch(data, /await persistCachedWeek\(next/);
  assert.doesNotMatch(data, /await persistCachedWeek\(value, generation\);\s*\n\s*await putCachedWeekSelection/);
  assert.match(data, /if \(operation !== operationRef\.current && !weekMutation\) return false/);
  assert.match(data, /response\.status === 409 && weekMutation && requestedWeekId/);
  assert.match(data, /The latest week is loaded\. Review it before trying again\./);
  assert.match(data, /The save response was interrupted[\s\S]*Do not retry until the week has been refreshed\./);
});

test("Week Planner shows an alert with Retry instead of loading forever when the first load fails", async () => {
  const planner = await source("../app/week-planner.tsx");
  const start = planner.indexOf("if (!snapshot) {");
  const block = planner.slice(start, planner.indexOf("const current = snapshot.entries", start));
  assert.ok(start > 0);
  assert.match(block, /loadFailure \|\| \(error/);
  assert.match(block, /if \(!failure\) return[^\n]*Loading Week Planner/);
  assert.match(block, /role="alert"/);
  assert.match(block, /failure\.status === 401 \|\| failure\.status === 403/);
  assert.match(block, /Your session expired or you do not have access - sign in again from the FIKA OS Hub\./);
  assert.match(block, /NEXT_PUBLIC_FIKA_HUB_URL/);
  assert.match(block, /onClick=\{\(\) => \{ void load\(\); \}\}>Retry</);
  assert.match(block, /failure\.message/);
});

test("a hung IndexedDB open resolves within the timeout and reads fall through", async () => {
  const original = globals.indexedDB;
  setMenuCacheOpenTimeoutForTests(50);
  globals.indexedDB = { open: () => ({}) }; // never fires any event
  try {
    const started = Date.now();
    assert.equal(await getCachedWeek("w1", "id"), undefined);
    assert.ok(Date.now() - started < 1000);
    // Subsequent cache calls skip the broken database instead of each waiting out the timeout.
    const second = Date.now();
    assert.equal(await getCachedWeekSelection("id"), undefined);
    await putCachedWeek({ weekId: "w1", identity: "id", snapshot: { entries: [] } } as unknown as CachedMenuWeek);
    assert.ok(Date.now() - second < 50);
  } finally { globals.indexedDB = original; setMenuCacheOpenTimeoutForTests(3000); }
});

test("a blocked IndexedDB open fails fast and a late connection is closed", async () => {
  const original = globals.indexedDB;
  setMenuCacheOpenTimeoutForTests(5000);
  let closed = false;
  const request: Record<string, unknown> = {};
  globals.indexedDB = { open: () => request };
  try {
    const pending = getCachedWeek("w1", "id");
    (request.onblocked as () => void)();
    const started = Date.now();
    assert.equal(await pending, undefined);
    assert.ok(Date.now() - started < 500);
    request.result = { close: () => { closed = true; } };
    (request.onsuccess as () => void)();
    assert.equal(closed, true);
  } finally { globals.indexedDB = original; setMenuCacheOpenTimeoutForTests(3000); }
});

test("happy path: a working IndexedDB still opens and serves the cache", async () => {
  const original = globals.indexedDB;
  setMenuCacheOpenTimeoutForTests(200);
  const stored: CachedMenuWeek = { weekId: "w1", weekCommencing: "2026-11-02", version: 1, identity: "id", cachedAt: 1, publicationState: {}, snapshot: { entries: [] } } as unknown as CachedMenuWeek;
  const db = {
    transaction: () => ({ objectStore: () => ({ get: () => { const r: Record<string, unknown> = {}; queueMicrotask(() => { r.result = stored; (r.onsuccess as () => void)(); }); return r; } }) }),
  };
  globals.indexedDB = { open: () => { const r: Record<string, unknown> = { result: db }; queueMicrotask(() => (r.onsuccess as () => void)()); return r; } };
  try {
    const value = await getCachedWeek("w1", "id");
    assert.equal(value?.weekId, "w1");
    assert.equal(await getCachedWeek("w1", "other-identity"), undefined);
  } finally { globals.indexedDB = original; setMenuCacheOpenTimeoutForTests(3000); }
});
