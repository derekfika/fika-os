import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("CPU authoritative submenu/allergen state hydrates from the server before any cache", async () => {
  const detail = await readFile(new URL("../app/ui/HospitalityAllergenDetail.tsx", import.meta.url), "utf8");
  assert.match(detail, /\/api\/production-plan\?orderId=/);
  assert.match(detail, /mergeOriginalItems\(order, body\.plan\.menuItems\)/);
  assert.match(detail, /setSignatures\(body\.plan\.signatures \|\| \[\]\)/);
});

test("CPU projection cache is IndexedDB-only, scoped, versioned, and non-authoritative", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const cache = await readFile(new URL("../app/lib/cpu-indexeddb.ts", import.meta.url), "utf8");
  assert.match(page, /readCpuProjection/);
  assert.match(page, /projectionHead=1/);
  assert.doesNotMatch(page, /localStorage\.setItem\(cacheKey/);
  assert.match(cache, /schemaVersion/);
  assert.match(cache, /cacheScope/);
  assert.match(cache, /catch \{[\s\S]*Cache failures are deliberately non-fatal/);
});

test("CPU cache scope is established by the authenticated server", async () => {
  const route = await readFile(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
  assert.match(route, /cacheScope.*actor\.uid/);
  assert.match(route, /FIKA_RUNTIME_MODE/);
  assert.match(route, /FIREBASE_PROJECT_ID/);
});
