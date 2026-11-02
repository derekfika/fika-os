import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { getCachedWeek, getCachedWeekSelection, putCachedWeek, setMenuCacheOpenTimeoutForTests, type CachedMenuWeek } from "../lib/menu-week-cache";
import { MenuLoadError, loadFailureFrom } from "../app/planner-data";

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

test("planner-data surfaces status from readJson and never awaits cache persistence before rendering", async () => {
  const data = await source("../app/planner-data.ts");
  assert.match(data, /throw new MenuLoadError\(/);
  assert.match(data, /setLoadFailure\(loadFailureFrom\(cause\)\)/);
  assert.match(data, /const load = useCallback\(async \(weekId\?: string\) => \{[^\n]*setLoadFailure\(undefined\)/);
  assert.doesNotMatch(data, /await persistCachedWeek\(next/);
  assert.doesNotMatch(data, /await persistCachedWeek\(value, generation\);\s*\n\s*await putCachedWeekSelection/);
  assert.match(data, /persistInBackground\(next, generation\); if \(operation !== operationRef\.current\) return; setError\(""\); setSnapshot\(next\.snapshot\)/);
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
