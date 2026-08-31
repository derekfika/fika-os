import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { applyLogisticsProjectionInvalidation, filterLogisticsProjectionForVehicle } from "../lib/logistics-projection";
import type { LogisticsDayProjection } from "../lib/types";
import { requireLogisticsAccess } from "../lib/auth";

const projection = (overrides: Partial<LogisticsDayProjection> = {}): LogisticsDayProjection => ({
  serviceDate: "2026-08-31", revision: 3, lastChangeSequence: 12, state: "CURRENT",
  planningQueue: [{ id: "job:queued", sourceType: "menu-planning", sourceId: "source:queued", serviceDate: "2026-08-31", destinationOplocId: "oploc:queued", destinationLabelSnapshot: "Queued", productionReadiness: "ready", collectionStatus: "awaiting", contents: [], totalUnits: 1 }],
  deliveryLoads: [
    { id: "load:one", loadIds: ["load:one"], serviceDate: "2026-08-31", originOplocId: "oploc:cpu", destinationOplocId: "oploc:one", destinationLabelSnapshot: "One", scheduledTime: "09:00", status: "planned", runId: "run:one", jobs: [], jobCount: 0, totalUnits: 0, collectedCount: 0, readiness: "ready" },
    { id: "load:two", loadIds: ["load:two"], serviceDate: "2026-08-31", originOplocId: "oploc:cpu", destinationOplocId: "oploc:two", destinationLabelSnapshot: "Two", scheduledTime: "10:00", status: "planned", runId: "run:two", jobs: [], jobCount: 0, totalUnits: 0, collectedCount: 0, readiness: "ready" },
  ],
  runs: [
    { canonicalId: "run:one", status: "planned", vehicleLabel: "Van 1" },
    { canonicalId: "run:two", status: "planned", vehicleLabel: "Van 2" },
  ],
  exceptions: [], summary: { queuedJobs: 1, loads: 2, assignedJobs: 2, collectedJobs: 0 }, rebuiltAt: "2026-08-31T08:00:00.000Z", ...overrides,
});

test("server-side vehicle filtering never exposes another van or organisation queue", () => {
  const van1 = filterLogisticsProjectionForVehicle(projection(), "Van 1");
  const van2 = filterLogisticsProjectionForVehicle(projection(), "Van 2");
  assert.deepEqual(van1.runs.map((run) => run.vehicleLabel), ["Van 1"]);
  assert.deepEqual(van1.deliveryLoads.map((load) => load.id), ["load:one"]);
  assert.deepEqual(van2.runs.map((run) => run.vehicleLabel), ["Van 2"]);
  assert.deepEqual(van2.deliveryLoads.map((load) => load.id), ["load:two"]);
  assert.equal(van1.planningQueue.length, 0);
  assert.equal(van2.planningQueue.length, 0);
});

test("mobile uses the authenticated head/projection path and vehicle-scoped cache", () => {
  const mobile = readFileSync(new URL("../app/mobile/MobileWorkflow.tsx", import.meta.url), "utf8");
  assert.match(mobile, /syncHead=1&serviceDate=/);
  assert.match(mobile, /projection=1&serviceDate=/);
  assert.match(mobile, /readCachedProjection\(cacheScope, date, vehicle\)/);
  assert.match(mobile, /writeCachedProjection\(cacheScope, projection, vehicle\)/);
  assert.doesNotMatch(mobile, /fetch\(`\/api\/logistics\?serviceDate=/);
});

test("projection freshness is explicit and stale data is surfaced", () => {
  const projectionSource = readFileSync(new URL("../lib/logistics-projection.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/logistics/route.ts", import.meta.url), "utf8");
  assert.match(projectionSource, /state: validEmpty \? "VALID_EMPTY" as const : "CURRENT" as const/);
  assert.match(route, /projection\.lastChangeSequence < syncHead\.sequence/);
  assert.match(route, /projectionState/);
  assert.match(route, /state: state === "EMPTY" \? "EMPTY" : "MISSING"/);
});

test("external amendment invalidates only its day and newer source revision wins", () => {
  const current = projection({ sourceLineage: [{ sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 4 }] });
  const amended = applyLogisticsProjectionInvalidation(current, { serviceDate: current.serviceDate, sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 5, changedAt: "2026-08-31T09:00:00Z", changeType: "amended" });
  assert.equal(amended.applied, true);
  assert.equal(amended.projection.state, "STALE");
  assert.equal(amended.projection.reconciliation?.status, "pending");
  const duplicate = applyLogisticsProjectionInvalidation(amended.projection, { serviceDate: current.serviceDate, sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 5, changedAt: "2026-08-31T09:01:00Z", changeType: "amended" });
  assert.equal(duplicate.applied, false);
  const older = applyLogisticsProjectionInvalidation(amended.projection, { serviceDate: current.serviceDate, sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 3, changedAt: "2026-08-31T09:02:00Z", changeType: "cancelled" });
  assert.equal(older.applied, false);
  const unrelated = applyLogisticsProjectionInvalidation(current, { serviceDate: "2026-09-01", sourceDomain: "cpu-production", sourceEntityId: "order:1", sourceVersion: 6, changedAt: "2026-08-31T09:03:00Z", changeType: "cancelled" });
  assert.equal(unrelated.applied, false);
  const oploc = applyLogisticsProjectionInvalidation(current, { serviceDate: current.serviceDate, sourceDomain: "oploc", sourceEntityId: "oploc:destination", sourceVersion: 2, sourceContentHash: "oploc-hash-v2", changedAt: "2026-08-31T09:04:00Z", changeType: "status-changed" });
  assert.equal(oploc.applied, true);
  assert.equal(oploc.projection.deliveryLoads[0].destinationLabelSnapshot, "One");
  assert.equal(oploc.projection.sourceLineage?.at(-1)?.sourceContentHash, "oploc-hash-v2");
});

test("invalidation endpoint and upstream notifier are narrow and internal-only", () => {
  const route = readFileSync(new URL("../app/api/logistics/invalidate/route.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../../integration-hub/lib/logistics-projection-client.ts", import.meta.url), "utf8");
  assert.match(route, /x-fika-internal-token/);
  assert.match(route, /invalidateLogisticsProjection/);
  assert.match(client, /\/api\/logistics\/invalidate/);
  assert.match(client, /sourceVersion/);
});

test("server-authoritative vehicle entitlements isolate fixed-van access", async () => {
  const request = (vehicle: string) => ({ cookies: { get: () => undefined }, headers: { get: () => "" }, nextUrl: { searchParams: { get: (key: string) => key === "vehicle" ? vehicle : null } } });
  const admitted = (permittedVehicleIds: string[]) => requireLogisticsAccess(request("van1"), { sessionReader: async () => ({ firebaseUid: "firebase", authmodIdentityId: "driver", displayName: "Driver", permittedVehicleIds } as never), allowLocalFallback: false });
  await assert.rejects(() => admitted(["van2"]), /not entitled/);
  await assert.doesNotReject(() => admitted(["van1"]));
  await assert.doesNotReject(() => requireLogisticsAccess(request("van2"), { sessionReader: async () => ({ firebaseUid: "firebase", authmodIdentityId: "driver", displayName: "Driver", permittedVehicleIds: ["van1", "van2"] } as never), allowLocalFallback: false }));
  await assert.rejects(() => requireLogisticsAccess(request("van1"), { sessionReader: async () => ({ firebaseUid: "firebase", authmodIdentityId: "driver", displayName: "Driver" } as never), allowLocalFallback: false }), /not entitled/);
});
