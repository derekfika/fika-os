import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Liana production-item hydration is parent-menu scoped, never an unbounded library read", async () => {
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
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
    "../app/ui/HospitalityAllergenDetail.tsx",
    "../app/ui/DeliveredMenuPlanner.tsx",
    "../app/page.tsx",
  ];
  for (const file of files) {
    const source = await readFile(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /fetch\("\/api\/sandwiches",\s*\{\s*cache/);
    assert.doesNotMatch(source, /fikaCpuProductionItemsV1/);
  }
});

test("booking cards show item names and quantities in the concise presentation", async () => {
  const card = await readFile(new URL("../app/ui/ProductionCalendar.tsx", import.meta.url), "utf8");
  assert.match(card, /<b>\{line\.itemName\}<\/b>/);
  assert.match(card, /production-card-quantities/);
});

test("Liana selection persists stable submenu identity and uses the authoritative plan mutation", async () => {
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  const plan = await readFile(new URL("../app/lib/production-plan.ts", import.meta.url), "utf8");
  assert.match(plan, /productionItemId\?: string/);
  assert.match(detail, /productionItemId: productionItem\.id/);
  assert.match(detail, /void planCommand\("save-plan", \{\}, nextItems\)/);
  assert.match(detail, /value=\{sub\.productionItemId \|\| ""\}/);
  assert.match(detail, /subItems: item\.subItems\.map/);
});

test("multiple submenu rows remain independently addressable under one parent", async () => {
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /candidate\.id === sub\.id/);
  assert.match(detail, /productionItemId: productionItem\.id/);
  assert.match(detail, /key=\{sub\.id\}/);
});
