import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU dashboard reloads when production scope changes and scopes its cache entries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /const cacheKey = `\$\{isDayProjection \? "day" : "week"\}:\$\{projectionDate\}:\$\{productionScope\}`/);
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*void load\(\);[\s\S]*\}, \[view, dayDate, weekCommencing, productionScope\]\)/);
  assert.match(page, /setProductionScope\(scope\.id\)/);
  assert.match(page, /&scope=\$\{productionScope\}/);
  assert.match(page, /filterCpuProjectionForScope\(cached\.value, productionScope\)/);
  assert.match(page, /filterCpuProjectionForScope\(projection, productionScope\)/);
});

test("CPU dashboard clears a stale package error only on successful cached or authoritative loads", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const load = page.slice(page.indexOf("const load = async"), page.indexOf("useEffect(() =>", page.indexOf("const load = async")));
  assert.match(load, /setError\(""\)/);
  assert.match(load, /if \(!response\.ok\) \{ setError\(/);
  assert.match(load, /if \(!scopeResponse\.ok[^\n]*setError\(/);
});
