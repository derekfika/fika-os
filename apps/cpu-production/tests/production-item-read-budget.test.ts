import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Liana production-item hydration is parent-menu scoped, never an unbounded library read", async () => {
  const detail = await readFile(new URL("../app/ui/LianaOrderDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /\/api\/sandwiches\?parentMenuItemKey=/);
  assert.doesNotMatch(detail, /fetch\("\/api\/sandwiches",\s*\{\s*cache/);
  assert.match(detail, /Promise\.all\(parentMenuItemKeys\.map/);
});

test("CPU sandwich API preserves the bounded parent-menu query at the HTTP boundary", async () => {
  const route = await readFile(new URL("../app/api/sandwiches/route.ts", import.meta.url), "utf8");
  assert.match(route, /request\.nextUrl\.search/);
  assert.doesNotMatch(route, /collection\(\)\.get\(\)/);
  assert.doesNotMatch(route, /fikaCpuProductionItemsV1/);
});

test("CPU Production Item broad reads are absent from ordinary runtime code", async () => {
  const files = [
    "../app/page.tsx",
    "../app/ui/LianaOrderDetail.tsx",
    "../app/ui/DeliveredMenuPlanner.tsx",
    "../app/page.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\("\/api\/sandwiches",\s*\{\s*cache/);
    assert.doesNotMatch(source, /fikaCpuProductionItemsV1/);
  }
});
