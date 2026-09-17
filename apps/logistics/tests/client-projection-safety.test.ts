import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { isUsableCachedProjection, upgradeLogisticsCacheSchema } from "../lib/logistics-cache";
import { logisticsJobMaterialisationEqual } from "../lib/logistics-materialisation";
import { summarizeLogisticsProjection } from "../lib/store";
import type { LogisticsJob, MovementRequest } from "../lib/types";

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

test("corrupt, cross-date, or incompatible cache entries are ignored", () => {
  const valid = { serviceDate: "2026-09-17", revision: 1, lastChangeSequence: 2, state: "CURRENT", planningQueue: [], deliveryLoads: [], runs: [], exceptions: [], summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: "now" };
  assert.equal(isUsableCachedProjection(valid, "2026-09-17"), true);
  assert.equal(isUsableCachedProjection({ ...valid, serviceDate: "2026-09-18" }, "2026-09-17"), false);
  assert.equal(isUsableCachedProjection({ ...valid, lastChangeSequence: "broken" }, "2026-09-17"), false);
  assert.equal(isUsableCachedProjection({ ...valid, planningQueue: null }, "2026-09-17"), false);
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

test("week projection summaries include manual movement and schedule state", () => {
  const movement: MovementRequest = { canonicalId: "movement:one", entityType: "Movement Request", type: "transfer", serviceDate: "2026-09-17", fromOplocId: "oploc:a", toOplocId: "oploc:b", requiredTime: "10:00", items: [{ description: "Crates", quantity: 2 }], createdBy: "actor", status: "open", version: 1, createdAt: "now", updatedAt: "now", audit: [] };
  const summary = summarizeLogisticsProjection("2026-09-17", {
    serviceDate: "2026-09-17", revision: 1, lastChangeSequence: 1, state: "CURRENT",
    planningQueue: [], deliveryLoads: [], runs: [], movements: [movement], exceptions: [],
    summary: { queuedJobs: 0, loads: 0, assignedJobs: 0, collectedJobs: 0 }, rebuiltAt: "now",
  });
  assert.equal(summary.loads, 1);
  assert.equal(summary.transfers, 1);
  assert.equal(summary.queue, 1);
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

test("desktop and mobile automatically use the bounded missing-projection recovery path", () => {
  const planner = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
  const recovery = readFileSync(new URL("../lib/projection-fetch.ts", import.meta.url), "utf8");
  assert.match(planner, /fetchProjectionWithRecovery/);
  assert.match(mobile, /fetchProjectionWithRecovery/);
  assert.match(recovery, /LOGISTICS_PROJECTION_NOT_MATERIALIZED/);
  assert.match(recovery, /action: "reconcile-logistics-day"/);
  assert.match(recovery, /projection\.lastChangeSequence >= expectedSequence/);
  assert.match(recovery, /\[0, 100, 250, 500\]/);
});
