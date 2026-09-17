import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { upgradeLogisticsCacheSchema } from "../lib/logistics-cache";
import { logisticsJobMaterialisationEqual } from "../lib/logistics-materialisation";
import { summarizeLogisticsProjection } from "../lib/store";
import type { LogisticsJob } from "../lib/types";

function fakeDatabase(existing: string[] = []) {
  const stores = new Set(existing);
  const created: string[] = [];
  return {
    database: {
      objectStoreNames: { contains: (name: string) => stores.has(name) },
      createObjectStore: (name: string) => { stores.add(name); created.push(name); return {}; },
    } as unknown as Pick<IDBDatabase, "objectStoreNames" | "createObjectStore">,
    created,
  };
}

test("IndexedDB upgrade preserves the store created by the immediately previous schema", () => {
  const fake = fakeDatabase(["day-projections"]);
  upgradeLogisticsCacheSchema(fake.database);
  assert.deepEqual(fake.created, []);
});

test("IndexedDB upgrade creates the store once for a new database and is safe when current", () => {
  const fake = fakeDatabase();
  upgradeLogisticsCacheSchema(fake.database);
  upgradeLogisticsCacheSchema(fake.database);
  assert.deepEqual(fake.created, ["day-projections"]);
});

const job = (overrides: Partial<LogisticsJob> = {}): LogisticsJob => ({
  id: "logistics-job:requirement:one",
  sourceType: "cpu-production",
  sourceId: "production-order:one",
  sourceVersion: 3,
  sourceContentHash: "hash-v3",
  serviceDate: "2026-09-17",
  originOplocId: "oploc:cpu",
  destinationOplocId: "oploc:site",
  destinationLabelSnapshot: "Site",
  requestedWindow: { startTime: "11:00" },
  productionReadiness: "ready",
  collectionStatus: "awaiting",
  contents: [{ description: "Lunch", quantity: 5, unit: "portion" }],
  createdAt: "2026-09-17T08:00:00.000Z",
  updatedAt: "2026-09-17T08:00:00.000Z",
  version: 1,
  audit: [],
  ...overrides,
});

test("Logistics materialisation is idempotent for unchanged source identity and content", () => {
  assert.equal(logisticsJobMaterialisationEqual(job(), job({ updatedAt: "later", version: 2, audit: [{ action: "replayed", at: "later", by: "test", version: 2 }] })), true);
  assert.equal(logisticsJobMaterialisationEqual(job(), job({ sourceVersion: 4, sourceContentHash: "hash-v4" })), false);
  assert.equal(logisticsJobMaterialisationEqual(job(), job({ destinationOplocId: "oploc:other" })), false);
});

test("projection summaries distinguish authoritative zero from missing data", () => {
  const missing = summarizeLogisticsProjection("2026-09-17");
  assert.equal(missing.projectionState, "MISSING");
  assert.equal("loads" in missing, false);
  const empty = summarizeLogisticsProjection("2026-09-17", {
    serviceDate: "2026-09-17", revision: 1, lastChangeSequence: 0, state: "VALID_EMPTY",
    planningQueue: [], deliveryLoads: [], runs: [], exceptions: [],
    summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: "now",
  });
  assert.equal(empty.projectionState, "VALID_EMPTY");
  assert.equal(empty.loads, 0);
});

test("Logistics clients do not render a time-dependent date before hydration", () => {
  const planner = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
  assert.match(planner, /const \[date, setDate\] = useState\(""\)/);
  assert.match(planner, /Loading operational workspace/);
  assert.match(mobile, /const \[selectedDate, setSelectedDate\] = useState\(""\)/);
  assert.match(mobile, /const \[hydrated, setHydrated\] = useState\(false\)/);
});

test("an upstream invalidation can bootstrap a missing day through the canonical materialiser", () => {
  const route = readFileSync(new URL("../app/api/logistics/invalidate/route.ts", import.meta.url), "utf8");
  assert.match(route, /result\.reason === "missing-projection"/);
  assert.match(route, /reconcileLogisticsDay\(/);
  assert.match(route, /materialised: true/);
  assert.match(route, /body as LogisticsProjectionInvalidation/);
});

test("an operator retry explicitly materialises a missing day before retrying the projection read", () => {
  const planner = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
  assert.match(planner, /LOGISTICS_PROJECTION_NOT_MATERIALIZED/);
  assert.match(planner, /action: "reconcile-logistics-day"/);
  assert.match(planner, /projectionNeedsMaterialisation/);
  assert.match(mobile, /action: "reconcile-logistics-day"/);
  assert.match(mobile, /Materialise and retry/);
});
