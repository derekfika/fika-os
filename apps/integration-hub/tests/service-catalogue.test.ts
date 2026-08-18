import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { serviceDefinitionCatalogue, serviceDefinitionUsage } from "../lib/service-catalogue-service";
import { serviceArrangementsFromRecords } from "../lib/service-arrangements-service";
import type { CanonicalRecord } from "../lib/types";

const definition = record("Service Definition", "service-definition:coffee", { serviceName: "Coffee Bar", lifecycleState: "active" });

test("Service Definitions are independently managed and unused definitions are deletable", () => {
  const item = serviceDefinitionCatalogue([definition], [])[0];
  assert.equal(item.arrangementUsageCount, 0);
  assert.equal(item.canDelete, true);
});

test("current and historic Service Arrangements block Service Definition deletion", () => {
  const arrangement = record("Service Arrangement", "service-arrangement:coffee", { oplocId: "oploc:one", serviceDefinitionId: definition.canonicalId, lifecycleState: "archived", effectiveFrom: "2026-07-01" });
  assert.equal(serviceDefinitionCatalogue([definition, arrangement], [])[0].canDelete, false);
  const historical = { entityType: "Service Arrangement", previous: arrangement, current: null };
  assert.deepEqual(serviceDefinitionUsage([definition], [historical], definition.canonicalId), { arrangementUsageCount: 0, historicUsage: true });
});

test("Services opens in an independent catalogue and its arrangement form owns delivery context", () => {
  const workspace = fs.readFileSync(path.join(process.cwd(), "app/ui/ServicesWorkspace.tsx"), "utf8");
  const arrangements = fs.readFileSync(path.join(process.cwd(), "app/ui/ServiceArrangementsPanel.tsx"), "utf8");
  const catalogue = fs.readFileSync(path.join(process.cwd(), "app/ui/ServiceCataloguePanel.tsx"), "utf8");
  const css = fs.readFileSync(path.join(process.cwd(), "app/globals.css"), "utf8");
  assert.match(workspace, /useState<"catalogue" \| "arrangements">\("catalogue"\)/);
  assert.match(workspace, /Service Catalogue/);
  assert.match(arrangements, /Add service arrangement/);
  assert.match(arrangements, /Service type/);
  assert.match(arrangements, /OPLOC/);
  assert.match(arrangements, /Operational Area/);
  assert.match(arrangements, /This is OPLOC-wide/);
  assert.doesNotMatch(catalogue, /oplocId|operationalAreaId/);
  assert.match(css, /100dvh/);
  assert.match(css, /\.detail-modal>\.connection-dialog-body[^}]*overflow:auto/);
});

test("existing Service Arrangements retain immutable references and delivery scope", () => {
  const oploc = record("OPLOC", "oploc:one", { approvedName: "One" });
  const area = record("Operational Area", "operational-area:coffee", { name: "Coffee bar", oplocId: oploc.canonicalId });
  const arrangement = record("Service Arrangement", "service-arrangement:coffee", { serviceDefinitionId: definition.canonicalId, oplocId: oploc.canonicalId, operationalAreaId: area.canonicalId, effectiveFrom: "2026-07-01", lifecycleState: "active" });
  const overview = serviceArrangementsFromRecords([definition, oploc, area, arrangement]);
  assert.equal(overview.arrangements[0]?.canonicalId, "service-arrangement:coffee");
  assert.equal(overview.arrangements[0]?.oplocId, "oploc:one");
  assert.equal(overview.arrangements[0]?.operationalAreaId, "operational-area:coffee");
});

function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord { const now = "2026-07-30T09:00:00.000Z"; return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "needs-review", record: { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values } }; }
