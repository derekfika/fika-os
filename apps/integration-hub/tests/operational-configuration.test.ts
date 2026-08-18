import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  activeAllocationIdsForAsset,
  validateOperationalScope,
} from "../lib/operational-configuration-service";
import { parseCanonical } from "../lib/schemas";
import type { CanonicalRecord } from "../lib/types";

const oploc = record("OPLOC", "oploc:one", { approvedName: "One", primaryLocationType: "Site", locationTypeHistory: [], lifecycleState: "active", aliases: [] });
const area = record("Operational Area", "operational-area:one", { areaId: "operational-area:one", oplocId: "oploc:one", name: "Coffee Bar", areaTypeId: "operational-area-type:one", floorLevel: 3, lifecycleState: "active", aliases: [] });
const otherArea = record("Operational Area", "operational-area:two", { areaId: "operational-area:two", oplocId: "oploc:other", name: "Other", areaTypeId: "operational-area-type:one", floorLevel: 1, lifecycleState: "active", aliases: [] });

test("service arrangements require an active area belonging to their OPLOC", () => {
  assert.doesNotThrow(() => validateOperationalScope([oploc, area], "oploc:one", "operational-area:one"));
  assert.throws(() => validateOperationalScope([oploc, otherArea], "oploc:one", "operational-area:two"), /must be active and belong/);
  const service = { ...base("Service Arrangement", "service-arrangement:one"), oplocId: "oploc:one", operationalAreaId: "operational-area:one", serviceDefinitionId: "service-definition:coffee", lifecycleState: "active", effectiveFrom: "2026-07-30", ownership: { providerOwned: {}, fikaOwned: {} } };
  assert.equal(parseCanonical("Service Arrangement", service).success, true);
});

test("equipment allocation movement preserves the durable asset and identifies prior history", () => {
  const prior = record("Equipment Allocation", "equipment-allocation:old", { equipmentAssetId: "equipment-asset:eversys", oplocId: "oploc:one", operationalAreaId: "operational-area:one", lifecycleState: "active", effectiveFrom: "2026-01-01" });
  const archived = record("Equipment Allocation", "equipment-allocation:archived", { equipmentAssetId: "equipment-asset:eversys", oplocId: "oploc:one", lifecycleState: "archived", effectiveFrom: "2025-01-01", effectiveTo: "2025-12-31" });
  assert.deepEqual(activeAllocationIdsForAsset([prior, archived], "equipment-asset:eversys"), ["equipment-allocation:old"]);
  assert.deepEqual(activeAllocationIdsForAsset([prior], "equipment-asset:eversys", "equipment-allocation:old"), []);
});

test("the typed Connection registry exposes all five supported choices without a generic record", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "app/ui/Connections.tsx"), "utf8");
  for (const label of ["Operational Area", "Staffing requirement", "Legend / site-role assignment", "Service arrangement", "Equipment allocation"]) assert.match(source, new RegExp(label));
  assert.doesNotMatch(source, /custom connection.*object/i);
});

test("services and equipment remain subordinate configuration rather than OPLOC identities", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "lib/schemas.ts"), "utf8");
  assert.match(source, /"Service Arrangement"/);
  assert.match(source, /"Equipment Allocation"/);
  assert.match(source, /operationalAreaId: Id\.optional/);
  assert.doesNotMatch(source, /entityType: z\.literal\("Service OPLOC"/);
});

function base(entityType: string, canonicalId: string) { return { schemaVersion: "0.1.0" as const, version: 1, createdAt: "2026-07-30T09:00:00.000Z", createdBy: "person:admin", updatedAt: "2026-07-30T09:00:00.000Z", updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], entityType, canonicalId }; }
function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord { return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "needs-review", record: { ...base(entityType, canonicalId), ownership: { providerOwned: {}, fikaOwned: {} }, ...values } }; }
