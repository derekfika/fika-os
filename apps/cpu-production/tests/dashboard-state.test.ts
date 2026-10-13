import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU dashboard reloads when production scope changes and scopes its cache entries", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const loader = await readFile(new URL("../app/lib/cpu-dashboard-projection-loader.ts", import.meta.url), "utf8");
  assert.match(loader, /const cacheKey = `\$\{isDay \? "day" : "week"\}:\$\{input\.date\}:\$\{input\.scope\}`/);
  assert.match(page, /useEffect\(\(\) => \{[\s\S]*void load\(\);[\s\S]*\}, \[view, dayDate, weekCommencing, productionScope\]\)/);
  assert.match(page, /setProductionScope\(scope\.id\)/);
  assert.match(loader, /&scope=\$\{input\.scope\}/);
  assert.match(page, /filterCpuProjectionForScope\(cachedProjection as any, productionScope\)/);
  assert.match(page, /filterCpuProjectionForScope\(result\.projection as any, productionScope\)/);
});

test("CPU dashboard clears a stale package error only on successful cached or authoritative loads", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const load = page.slice(page.indexOf("const load = async"), page.indexOf("useEffect(() =>", page.indexOf("const load = async")));
  const loader = await readFile(new URL("../app/lib/cpu-dashboard-projection-loader.ts", import.meta.url), "utf8");
  assert.match(load, /setError\(""\)/);
  assert.match(load, /if \(result\.error\) \{ setError\(result\.error\)/);
  assert.match(loader, /if \(!response\.ok\) return \{ error:/);
  assert.match(loader, /if \(!scopeResponse\.ok[^\n]*return \{ error:/);
});
