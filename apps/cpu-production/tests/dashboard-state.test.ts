import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU dashboard reloads when production scope changes and scopes its cache entries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const cacheKey = `\$\{isDayProjection \? "day" : "week"\}:\$\{projectionDate\}:\$\{productionScope\}`/);
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*void load\(\);[\s\S]*\}, \[view, date, dayDate, weekCommencing, productionScope, todayKey, totalsPreset, customFrom, customTo\]\)/);
  assert.match(page, /setProductionScope\(scope\.id\)/);
  assert.match(page, /&scope=\$\{productionScope\}/);
  assert.match(page, /filterCpuProjectionForScope\(cached\.value, productionScope\)/);
  assert.match(page, /filterCpuProjectionForScope\(projection, productionScope\)/);
});

test("CPU dashboard clears a stale package error only on successful cached or authoritative loads", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const load = page.slice(page.indexOf("const load = async"), page.indexOf("useEffect(() =>", page.indexOf("const load = async")));
  assert.match(load, /setError\(""\)/);
  assert.match(load, /if \(!response\.ok\) \{ setOrders\(\[\]\); setError\(/);
  assert.match(load, /if \(!scopeResponse\.ok[^\n]*setError\(/);
});

test("CPU dashboard ignores out-of-order loads and never presents stale cache as current after failed revalidation", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const load = page.slice(page.indexOf("const load = async"), page.indexOf("useEffect(() =>", page.indexOf("const load = async")));
  assert.match(load, /const requestId = \+\+loadGeneration\.current/);
  assert.match(load, /if \(!isCurrentRequest\(\)\) return \[\]/);
  assert.match(load, /setOrders\(\[\]\); setError\("Production freshness could not be verified\./);
  assert.doesNotMatch(load, /return cpuProjectionToOrders\(filterCpuProjectionForScope\(cached\.value, productionScope\)\);[\s\S]*?catch \{ return/);
});
