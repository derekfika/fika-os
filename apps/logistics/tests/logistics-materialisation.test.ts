import assert from "node:assert/strict";
import { test } from "node:test";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import { activeLogisticsRequirements, logisticsJobForRequirement } from "../lib/logistics-materialisation";

function requirement(status: FulfilmentRequirement["status"] = "pending", destinationOplocId = "oploc:customer"): FulfilmentRequirement {
  return {
    canonicalId: `fulfilment:${status}`,
    entityType: "Fulfilment Requirement",
    schemaVersion: "0.1.0",
    version: 1,
    sourceDomain: "cpu-production",
    sourceEntityId: "production-order:planning-1",
    sourceVersion: 1,
    destinationOplocId,
    destinationLabelSnapshot: "Customer site",
    serviceDate: "2026-09-22",
    requiredDeliveryWindow: { startTime: "10:00", endTime: "10:30" },
    lines: [{ canonicalId: "line:1", sourceLineId: "line:1", displayNameSnapshot: "Lunch", quantity: 10, unit: "portion", sortOrder: 0 }],
    status,
    createdAt: "2026-09-22T08:00:00.000Z",
    createdBy: "test",
    updatedAt: "2026-09-22T08:00:00.000Z",
    updatedBy: "test",
    audit: [],
    idempotencyKey: "test:1",
  };
}

test("CPU Fulfilment Requirements remain Logistics work when CPU enrichment is empty", () => {
  const pending = requirement("pending");
  const amended = { ...pending, canonicalId: "fulfilment:amended", status: "amended" as const };
  const ready = { ...pending, canonicalId: "fulfilment:ready", status: "ready_for_planning" as const };
  const active = activeLogisticsRequirements([pending, amended, ready]);
  assert.deepEqual(active.map((item) => item.canonicalId), [pending.canonicalId, amended.canonicalId, ready.canonicalId]);
  assert.equal(logisticsJobForRequirement(pending, undefined, "test", "2026-09-22T08:01:00.000Z").productionReadiness, "pending");
  assert.equal(logisticsJobForRequirement(ready, undefined, "test", "2026-09-22T08:01:00.000Z").productionReadiness, "ready");
});

test("withdrawn requirements are excluded but governed CPU-site fulfilment remains Logistics work", () => {
  const withdrawn = requirement("withdrawn");
  const local = requirement("pending", CPU_SITE_OPLOC_ID);
  assert.deepEqual(activeLogisticsRequirements([withdrawn, local]).map((item) => item.canonicalId), [local.canonicalId]);
});

test("reconciliation preserves an existing job identity while updating its source version", () => {
  const prior = logisticsJobForRequirement(requirement("pending"), undefined, "test", "2026-09-22T08:00:00.000Z");
  const nextRequirement = { ...requirement("ready_for_planning"), sourceVersion: 2, version: 2 };
  const next = logisticsJobForRequirement(nextRequirement, prior, "test", "2026-09-22T08:02:00.000Z");
  assert.equal(next.id, prior.id);
  assert.equal(next.sourceVersion, 2);
  assert.equal(next.version, prior.version + 1);
});
