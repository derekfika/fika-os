import assert from "node:assert/strict";
import test from "node:test";
import { eventsOperatingReadContractFromRecords } from "../lib/events-read-contract";
import type { CanonicalRecord } from "../lib/types";

const record = (entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>, lifecycleStatus = "published"): CanonicalRecord => ({ canonicalId, entityType, lifecycleStatus: lifecycleStatus as CanonicalRecord["lifecycleStatus"], dataHash: "test", record: { canonicalId, entityType, schemaVersion: "0.1.0", version: 1, createdAt: "2026-07-30T00:00:00.000Z", createdBy: "person:test", updatedAt: "2026-07-30T00:00:00.000Z", updatedBy: "person:test", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, lifecycleState: "active", ...values } });

test("Events read contract exposes active references and retains archived IDs only for history", () => {
  const activeOploc = record("OPLOC", "oploc:active", { approvedName: "Active OPLOC" });
  const archivedOploc = record("OPLOC", "oploc:old", { approvedName: "Old OPLOC", lifecycleState: "decommissioned" });
  const area = record("Operational Area", "operational-area:active", { name: "Main Bar", oplocId: activeOploc.canonicalId });
  const definition = record("Service Definition", "service-definition:coffee", { serviceName: "Coffee Service" });
  const arrangement = record("Service Arrangement", "service-arrangement:coffee", { serviceDefinitionId: definition.canonicalId, oplocId: activeOploc.canonicalId, operationalAreaId: area.canonicalId, effectiveFrom: "2020-01-01" });
  const inactiveArrangement = record("Service Arrangement", "service-arrangement:ended", { serviceDefinitionId: definition.canonicalId, oplocId: activeOploc.canonicalId, effectiveFrom: "2020-01-01", lifecycleState: "archived" });
  const asset = record("Equipment Asset", "equipment-asset:machine", { assetName: "Machine" });
  const allocation = record("Equipment Allocation", "equipment-allocation:machine", { equipmentAssetId: asset.canonicalId, oplocId: activeOploc.canonicalId, effectiveFrom: "2020-01-01" });
  const inactiveAllocation = record("Equipment Allocation", "equipment-allocation:old", { equipmentAssetId: asset.canonicalId, oplocId: activeOploc.canonicalId, effectiveFrom: "2020-01-01", lifecycleState: "archived" });
  const view = eventsOperatingReadContractFromRecords([activeOploc, archivedOploc, area, definition, arrangement, inactiveArrangement, asset, allocation, inactiveAllocation], [archivedOploc.canonicalId]);
  assert.deepEqual(view.oplocs.map(item => item.canonicalId), [activeOploc.canonicalId]);
  assert.equal(view.serviceArrangements[0]?.operationalAreaId, area.canonicalId);
  assert.deepEqual(view.serviceArrangements.map(item => item.canonicalId), [arrangement.canonicalId]);
  assert.deepEqual(view.equipmentAssets.map(item => item.assetId), [asset.canonicalId]);
  assert.equal(view.historical[0]?.canonicalId, archivedOploc.canonicalId);
  assert.equal(view.historical[0]?.current, false);
});
