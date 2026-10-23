import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeliveredInAccess } from "../lib/delivered-in-access";

const haleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
const xchange = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";
const deliveredInDefinition = "service-definition:delivered-in";
const grabAndGoDefinition = "service-definition:grab-and-go";
const serviceDefinition = (canonicalId: string, serviceName: string) => ({ canonicalId, entityType: "Service Definition", record: { serviceName, lifecycleState: "active" }, dataHash: `definition:${canonicalId}`, lifecycleStatus: "published", publicationStatus: "published" });
const serviceArrangement = (canonicalId: string, oplocId: string, serviceDefinitionId: string, lifecycleState = "active") => ({ canonicalId, entityType: "Service Arrangement", record: { oplocId, serviceDefinitionId, lifecycleState, effectiveFrom: "2020-01-01", effectiveTo: "2099-12-31" }, dataHash: `arrangement:${canonicalId}`, lifecycleStatus: "published", publicationStatus: "published" });
const activeRecords = [
  { canonicalId: haleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: xchange, entityType: "OPLOC", record: { approvedName: "FIKA Xchange", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "published", publicationStatus: "published" },
  serviceDefinition(deliveredInDefinition, "Delivered-In Lunch"),
  serviceDefinition(grabAndGoDefinition, "Grab & Go"),
  serviceArrangement("service-arrangement:delivered-in:haleon", haleon, deliveredInDefinition),
  serviceArrangement("service-arrangement:delivered-in:xchange", xchange, deliveredInDefinition),
  serviceArrangement("service-arrangement:grab-and-go:haleon", haleon, grabAndGoDefinition),
] as never[];

test("Delivered-In synthetic access is explicit and OPLOC-ID based", () => {
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }, activeRecords).access.oplocIds, [haleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, activeRecords).access.oplocIds, [haleon, xchange]);
  assert.equal(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }).access.oplocIds.length, 0);
  assert.deepEqual(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }, activeRecords).access.oplocIds, []);
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }, activeRecords).access.permissions, ["delivered_in.view"]);
});

test("decommissioned OPLOCs never enter Delivered-In access", () => {
  const result = resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, [
    ...activeRecords,
    { canonicalId: "oploc:wcc", entityType: "OPLOC", record: { approvedName: "WCC", lifecycleState: "archived" }, dataHash: "c", lifecycleStatus: "archived", publicationStatus: "withdrawn" },
    { canonicalId: "oploc:databricks", entityType: "OPLOC", record: { approvedName: "Databricks", lifecycleState: "active" }, dataHash: "d", lifecycleStatus: "published", publicationStatus: "withdrawn" },
    { canonicalId: "oploc:service-disabled", entityType: "OPLOC", record: { approvedName: "Service Disabled", lifecycleState: "active" }, dataHash: "e", lifecycleStatus: "published", publicationStatus: "published" },
    serviceArrangement("service-arrangement:inactive", "oploc:service-disabled", deliveredInDefinition, "archived"),
  ] as never[]);
  assert.deepEqual(result.sites.map(site => site.label), ["Haleon", "FIKA Xchange"]);
});

test("integration admins receive all active canonical OPLOCs", () => {
  const result = resolveDeliveredInAccess({ email: "admin@local.fika", role: "integration-admin" }, [
    { canonicalId: haleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
    { canonicalId: "oploc:archived", entityType: "OPLOC", record: { approvedName: "Archived", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "archived", publicationStatus: "published" },
    serviceDefinition(deliveredInDefinition, "Delivered-In Lunch"),
    serviceArrangement("service-arrangement:haleon", haleon, deliveredInDefinition),
  ] as never[]);
  assert.deepEqual(result.access.oplocIds, [haleon]);
  assert.equal(result.sites[0].label, "Haleon");
});
