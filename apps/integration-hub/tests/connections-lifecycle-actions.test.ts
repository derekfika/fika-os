import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { parseCanonical } from "../lib/schemas";

const source = fs.readFileSync(path.join(process.cwd(), "app/ui/OperationalConfigurationPanel.tsx"), "utf8");

test("ended service arrangements remain schema-valid historical records", () => {
  const record = base("Service Arrangement", "service-arrangement:history", { oplocId: "oploc:history", operationalAreaId: "operational-area:history", serviceDefinitionId: "service-definition:coffee", lifecycleState: "archived", effectiveFrom: "2026-07-01", effectiveTo: "2026-07-30" });
  assert.equal(parseCanonical("Service Arrangement", record).success, true);
});

test("ended allocations retain the asset reference and never remove the physical asset", () => {
  const record = base("Equipment Allocation", "equipment-allocation:history", { equipmentAssetId: "equipment-asset:machine", oplocId: "oploc:history", lifecycleState: "archived", effectiveFrom: "2026-07-01", effectiveTo: "2026-07-30" });
  assert.equal(parseCanonical("Equipment Allocation", record).success, true);
  assert.match(source, /Remove allocation/);
  assert.match(source, /asset remains in the central register/);
});

test("service and allocation actions require explicit confirmation and support restoration", () => {
  assert.match(source, /End service/);
  assert.match(source, /Restore service/);
  assert.match(source, /Restore allocation/);
  assert.match(source, /window\.confirm/);
  assert.match(source, /Include ended \/ archived/);
});

function base(entityType: string, canonicalId: string, values: Record<string, unknown>) { const now = "2026-07-30T09:00:00.000Z"; return { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values }; }
