import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("Logistics uses a dedicated authenticated Hub OPLOC service boundary", () => {
  const route = readFileSync(new URL("../app/api/internal/oplocs/route.ts", import.meta.url), "utf8");
  const upstream = readFileSync(new URL("../../logistics/lib/upstream.ts", import.meta.url), "utf8");
  assert.match(route, /internalTokenAllowed/);
  assert.match(route, /getOplocReadPackage/);
  assert.match(route, /validateOplocReadPackage/);
  assert.match(upstream, /\/api\/internal\/oplocs/);
  assert.doesNotMatch(upstream, /\/api\/oplocs/);
});
