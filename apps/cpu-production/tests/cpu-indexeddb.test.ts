import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CPU_ALLERGEN_FRESHNESS_ERROR, loadCpuAllergenProjection } from "../app/lib/cpu-allergen-projection-loader";
import type { CpuDayProjection } from "../lib/cpu-projection";

const projection: CpuDayProjection = {
  serviceDate: "2026-08-31",
  revision: 2,
  lastChangeSequence: 7,
  rebuiltAt: "2026-08-31T10:00:00.000Z",
  orders: [],
  summary: { orders: 0, ready: 0, attention: 0, planned: 0, totalUnits: 0 },
};

function dependencies(overrides: { headStatus?: number; head?: Record<string, unknown>; refreshedProjection?: CpuDayProjection } = {}) {
  const calls: string[] = [];
  const cacheEntry = {
    key: "day:2026-08-31",
    schemaVersion: 1,
    cacheScope: "staging:fika-os-dev:actor-1",
    fetchedAt: "2026-08-31T10:00:00.000Z",
    lastChangeSequence: 7,
    revision: 2,
    packageVersion: 3,
    contentHash: "hash-v3",
    sourceVersion: "cpu-change-7",
    value: projection,
  };
  let written: unknown;
  return {
    calls,
    get written() { return written; },
    deps: {
      fetch: async (input: RequestInfo | URL) => {
        const url = String(input);
        calls.push(url);
        if (url.includes("cacheScope")) return new Response(JSON.stringify({ cacheScope: cacheEntry.cacheScope }), { status: 200 });
        if (url.includes("projectionHead")) return new Response(JSON.stringify(overrides.head || { lastChangeSequence: 7, packageVersion: 3, contentHash: "hash-v3", sourceVersion: "cpu-change-7" }), { status: overrides.headStatus || 200 });
        return new Response(JSON.stringify({ projection: overrides.refreshedProjection || { ...projection, revision: 3, lastChangeSequence: 8 }, package: { packageVersion: 4, contentHash: "hash-v4", sourceVersion: "cpu-change-8" } }), { status: 200 });
      },
      read: async () => cacheEntry,
      write: async (entry: unknown) => { written = entry; },
    },
  };
}

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

test("CPU allergen review reuses the day projection and avoids a warm package refetch", async () => {
  const loader = await readFile(new URL("../app/lib/cpu-allergen-projection-loader.ts", import.meta.url), "utf8");
  assert.match(loader, /cacheKey = `day:\$\{serviceDate\}`/);
  assert.match(loader, /cached\?\.value/);
  assert.match(loader, /projectionHead=1/);
  assert.match(loader, /if \(unchanged\) return/);
  assert.match(loader, /filterCpuProjectionForScope\(cached\.value, scope\)/);
  assert.match(loader, /cache: "no-store"/);
  assert.doesNotMatch(loader, /\/api\/production\?serviceDate=\$\{encodeURIComponent\(serviceDate\)\}/);
});

test("CPU allergen review keeps authoritative review and mutation paths separate from the projection cache", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const matrix = await readFile(new URL("../app/ui/AllergenReviewMatrix.tsx", import.meta.url), "utf8");
  const loader = await readFile(new URL("../app/lib/cpu-allergen-projection-loader.ts", import.meta.url), "utf8");
  assert.match(matrix, /matrixStatus=1&orderIds=/);
  assert.match(page, /action: "sign-matrix"/);
  assert.match(page, /action: "save-matrix"/);
  assert.match(matrix, /action: "batch-plan"/);
  assert.doesNotMatch(loader, /production-plan/);
});

test("matching authoritative projection head makes the cached allergen projection usable", async () => {
  const setup = dependencies();
  const result = await loadCpuAllergenProjection("2026-08-31", "delivered_in", setup.deps);
  assert.equal(result.cacheHit, true);
  assert.equal(result.projection.revision, 2);
  assert.equal(setup.calls.filter((url) => url.includes("projection=1")).length, 0);
});

test("changed authoritative projection head refreshes the allergen package", async () => {
  const setup = dependencies({ head: { lastChangeSequence: 8, packageVersion: 4, contentHash: "hash-v4", sourceVersion: "cpu-change-8" } });
  const result = await loadCpuAllergenProjection("2026-08-31", "delivered_in", setup.deps);
  assert.equal(result.cacheHit, false);
  assert.equal(result.projection.revision, 3);
  assert.ok(setup.written);
  assert.equal(setup.calls.filter((url) => url.includes("projection=1")).length, 1);
});

test("failed projection head fails closed and never uses stale allergen cache", async () => {
  const setup = dependencies({ headStatus: 503 });
  await assert.rejects(() => loadCpuAllergenProjection("2026-08-31", "delivered_in", setup.deps), new RegExp(CPU_ALLERGEN_FRESHNESS_ERROR));
  assert.equal(setup.calls.filter((url) => url.includes("projection=1")).length, 0);
});

test("allergen freshness hardening preserves the dual-sign and invalidation workflow", async () => {
  const page = await readFile(new URL("../app/allergens/page.tsx", import.meta.url), "utf8");
  const planRoute = await readFile(new URL("../app/api/production-plan/route.ts", import.meta.url), "utf8");
  assert.match(page, /action: "sign-matrix"/);
  assert.match(page, /action: "save-matrix"/);
  assert.match(page, /production_chef/);
  assert.match(page, /head_chef_site_manager/);
  assert.match(page, /setOrders\(\[\]\)/);
  assert.match(planRoute, /contentHash/);
  assert.match(planRoute, /signatures/);
  assert.match(planRoute, /matrixArtifact/);
});
