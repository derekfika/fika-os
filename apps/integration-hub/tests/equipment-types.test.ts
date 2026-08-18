import assert from "node:assert/strict";
import test from "node:test";
import { equipmentTypeCatalogue, equipmentTypeUsage } from "../lib/operational-configuration-service";
import type { CanonicalRecord } from "../lib/types";

const activeType = equipmentType("equipment-type:active", "Espresso machine", "active");
const retiredType = equipmentType("equipment-type:retired", "Legacy grinder", "retired");

test("only active Equipment Types are available to a new Equipment Asset", () => {
  const active = equipmentTypeCatalogue([activeType, retiredType], [], "active");
  assert.deepEqual(active.map(type => type.canonicalId), [activeType.canonicalId]);
});

test("archiving and restoring preserve the immutable Equipment Type identity", () => {
  const archived = { ...activeType, record: { ...activeType.record, lifecycleState: "retired", version: 2 } } as CanonicalRecord;
  const restored = { ...archived, record: { ...archived.record, lifecycleState: "active", version: 3 } } as CanonicalRecord;
  assert.equal(archived.canonicalId, activeType.canonicalId);
  assert.equal(restored.canonicalId, activeType.canonicalId);
  assert.equal(equipmentTypeCatalogue([archived], [], "active").length, 0);
  assert.equal(equipmentTypeCatalogue([restored], [], "active").length, 1);
});

test("an unused Equipment Type can be deleted, while current asset usage blocks deletion", () => {
  assert.equal(equipmentTypeCatalogue([activeType], [], "all")[0].canDelete, true);
  const asset = record("Equipment Asset", "equipment-asset:one", { assetName: "Machine", equipmentTypeId: activeType.canonicalId, lifecycleState: "active" });
  const item = equipmentTypeCatalogue([activeType, asset], [], "all")[0];
  assert.equal(item.assetUsageCount, 1);
  assert.equal(item.canDelete, false);
});

test("historic asset references block deletion even when no current asset remains", () => {
  const revision = { entityType: "Equipment Asset", previous: record("Equipment Asset", "equipment-asset:old", { assetName: "Old machine", equipmentTypeId: activeType.canonicalId, lifecycleState: "retired" }), current: null };
  assert.deepEqual(equipmentTypeUsage([activeType], [revision], activeType.canonicalId), { assetUsageCount: 0, historicUsage: true });
  assert.equal(equipmentTypeCatalogue([activeType], [revision], "all")[0].canDelete, false);
});

function equipmentType(canonicalId: string, name: string, lifecycleState: "active" | "retired"): CanonicalRecord { return record("Equipment Type", canonicalId, { name, lifecycleState }); }
function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord { const now = "2026-07-30T09:00:00.000Z"; return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "needs-review", record: { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values } }; }
