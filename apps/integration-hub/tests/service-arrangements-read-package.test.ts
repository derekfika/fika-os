import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decodeReadPackage, encodeReadPackage } from "@fika/server-shared/read-package";
import { filterServiceArrangements, isServiceArrangementEffectiveOn, serviceArrangementsFromRecords } from "../lib/service-arrangements-service";
import type { ServiceArrangementsReadPackage } from "../lib/service-arrangements-read-package";
import type { CanonicalRecord } from "../lib/types";

const definition = record("Service Definition", "service-definition:delivery", { serviceName: "Delivered-In", lifecycleState: "active" });
const oplocA = record("OPLOC", "oploc:a", { approvedName: "A", lifecycleState: "active" });
const oplocB = record("OPLOC", "oploc:b", { approvedName: "B", lifecycleState: "active" });

function arrangement(id: string, values: Record<string, unknown>) { return record("Service Arrangement", id, { serviceDefinitionId: definition.canonicalId, oplocId: oplocA.canonicalId, effectiveFrom: "2026-08-01", lifecycleState: "active", ...values }); }

test("Service Arrangement package round-trips and preserves integrity metadata", () => {
  const overview = serviceArrangementsFromRecords([definition, oplocA, arrangement("service-arrangement:one", {})], "2026-08-31");
  const value: ServiceArrangementsReadPackage = { serviceDefinitions: overview.serviceDefinitions, oplocs: overview.oplocs, areas: overview.areas, arrangements: overview.arrangements };
  const encoded = encodeReadPackage("integration-hub/service-arrangements", 3, value, value.arrangements.length, { contractVersion: "integration-hub.service-arrangements.v1", sourceVersion: "canonical:3" });
  assert.equal(encoded.manifest.dataset, "integration-hub/service-arrangements");
  assert.equal(encoded.manifest.recordCount, 1);
  assert.deepEqual(decodeReadPackage(encoded.manifest, encoded.bytes), JSON.parse(JSON.stringify(value)));
  assert.throws(() => decodeReadPackage(encoded.manifest, Uint8Array.from(encoded.bytes, (byte, index) => index === 0 ? byte ^ 1 : byte)), /integrity check failed/);
});

test("effective-date semantics are inclusive, open-ended, and lifecycle-aware", () => {
  const active = { effectiveFrom: "2026-08-10", effectiveTo: "2026-08-31", lifecycleState: "active" as const };
  assert.equal(isServiceArrangementEffectiveOn(active, "2026-08-10"), true);
  assert.equal(isServiceArrangementEffectiveOn(active, "2026-08-31"), true);
  assert.equal(isServiceArrangementEffectiveOn(active, "2026-09-01"), false);
  assert.equal(isServiceArrangementEffectiveOn({ ...active, effectiveFrom: "2026-09-01" }, "2026-08-31"), false);
  assert.equal(isServiceArrangementEffectiveOn({ ...active, effectiveTo: undefined }, "2099-12-31"), true);
  assert.equal(isServiceArrangementEffectiveOn({ ...active, lifecycleState: "archived" }, "2026-08-20"), false);
});

test("OPLOC and service filtering preserves valid overlapping arrangements", () => {
  const records = [definition, oplocA, oplocB, arrangement("service-arrangement:one", { effectiveFrom: "2026-08-01" }), arrangement("service-arrangement:two", { oplocId: oplocB.canonicalId, effectiveFrom: "2026-08-15" }), record("Service Definition", "service-definition:other", { serviceName: "Other", lifecycleState: "active" }), arrangement("service-arrangement:three", { serviceDefinitionId: "service-definition:other", effectiveFrom: "2026-08-20" })];
  const overview = serviceArrangementsFromRecords(records, "2026-08-31");
  const filtered = filterServiceArrangements(overview, { oplocIds: new Set(["oploc:b"]), serviceDefinitionId: definition.canonicalId, serviceDate: "2026-08-31" });
  assert.deepEqual(filtered.arrangements.map(item => item.canonicalId), ["service-arrangement:two"]);
  assert.deepEqual(filtered.oplocs.map(item => item.canonicalId), ["oploc:b"]);
});

test("steady-state route reads the package, while rebuild is the only canonical source read", () => {
  const route = readFileSync(new URL("../app/api/service-arrangements/route.ts", import.meta.url), "utf8");
  const packageSource = readFileSync(new URL("../lib/service-arrangements-read-package.ts", import.meta.url), "utf8");
  assert.match(route, /getServiceArrangementsReadPackage/);
  assert.doesNotMatch(route, /integrationHubCanonical.*\.get\(\)/);
  assert.match(packageSource, /integrationHubCanonical/);
  assert.match(packageSource, /service-arrangements\.package\.rebuild\.source/);
});

test("Delivered-In access resolves service enablement from the immutable package", () => {
  const route = readFileSync(new URL("../app/api/delivered-in/access/route.ts", import.meta.url), "utf8");
  assert.match(route, /getServiceArrangementsReadPackage/);
  assert.match(route, /validateServiceArrangementsReadPackage/);
  assert.doesNotMatch(route, /integrationHubCanonical/);
  assert.match(route, /Europe\/London/);
});

test("successful Service Definition and Arrangement mutations trigger package rebuild", () => {
  const configuration = readFileSync(new URL("../lib/operational-configuration-service.ts", import.meta.url), "utf8");
  const catalogue = readFileSync(new URL("../lib/service-catalogue-service.ts", import.meta.url), "utf8");
  assert.match(configuration, /rebuildServiceArrangementsReadPackage/);
  assert.match(configuration, /entityType === "Service Definition"[\s\S]*entityType === "Service Arrangement"/);
  assert.match(catalogue, /await rebuildServiceArrangementsReadPackage\(\)/);
});

test("package filtering is independent from authorization state", () => {
  const overview = serviceArrangementsFromRecords([definition, oplocA, arrangement("service-arrangement:one", {})]);
  const filtered = filterServiceArrangements(overview, { oplocIds: new Set<string>() });
  assert.equal(filtered.arrangements.length, 0);
  assert.equal(JSON.stringify(filtered).includes("authority"), false);
});

function record(entityType: CanonicalRecord["entityType"], canonicalId: string, values: Record<string, unknown>): CanonicalRecord {
  const now = "2026-08-31T09:00:00.000Z";
  return { canonicalId, entityType, dataHash: "test", lifecycleStatus: "published", publicationStatus: "published", record: { schemaVersion: "0.1.0", version: 1, createdAt: now, createdBy: "person:admin", updatedAt: now, updatedBy: "person:admin", active: true, externalIdentities: [], provenanceIds: [], ownership: { providerOwned: {}, fikaOwned: {} }, entityType, canonicalId, ...values } };
}
