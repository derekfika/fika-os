import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeliveredInAccess } from "../lib/delivered-in-access";

const haleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
const xchange = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";
const activeRecords = [
  { canonicalId: haleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
  { canonicalId: xchange, entityType: "OPLOC", record: { approvedName: "FIKA Xchange", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "published", publicationStatus: "published" },
] as never[];

test("Delivered-In synthetic access is explicit and OPLOC-ID based", () => {
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }, activeRecords).access.oplocIds, [haleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, activeRecords).access.oplocIds, [haleon, xchange]);
  assert.equal(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }).access.oplocIds.length, 0);
});

test("decommissioned OPLOCs never enter Delivered-In access", () => {
  const result = resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }, [
    ...activeRecords,
    { canonicalId: "oploc:wcc", entityType: "OPLOC", record: { approvedName: "WCC", lifecycleState: "archived" }, dataHash: "c", lifecycleStatus: "published", publicationStatus: "published" },
    { canonicalId: "oploc:databricks", entityType: "OPLOC", record: { approvedName: "Databricks", lifecycleState: "active" }, dataHash: "d", lifecycleStatus: "published", publicationStatus: "withdrawn" },
  ] as never[]);
  assert.deepEqual(result.sites.map(site => site.label), ["Haleon", "FIKA Xchange"]);
});

test("integration admins receive all active canonical OPLOCs", () => {
  const result = resolveDeliveredInAccess({ email: "admin@local.fika", role: "integration-admin" }, [
    { canonicalId: haleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
    { canonicalId: "oploc:archived", entityType: "OPLOC", record: { approvedName: "Archived", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "archived", publicationStatus: "published" },
  ]);
  assert.deepEqual(result.access.oplocIds, [haleon]);
  assert.equal(result.sites[0].label, "Haleon");
});
