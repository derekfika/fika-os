import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveDeliveredInAccess } from "../lib/delivered-in-access";

const haleon = "oploc:46701265-15af-48f4-a230-1d27ca21bc59";
const xchange = "oploc:b835d8ee-b187-49d1-9072-7348b04bfd2d";

test("Delivered-In synthetic access is explicit and OPLOC-ID based", () => {
  assert.deepEqual(resolveDeliveredInAccess({ email: "viewer@local.fika", role: "viewer" }).access.oplocIds, [haleon]);
  assert.deepEqual(resolveDeliveredInAccess({ email: "reviewer@local.fika", role: "reviewer" }).access.oplocIds, [haleon, xchange]);
  assert.equal(resolveDeliveredInAccess({ email: "unknown@local.fika", role: "viewer" }).access.oplocIds.length, 0);
});

test("integration admins receive all active canonical OPLOCs", () => {
  const result = resolveDeliveredInAccess({ email: "admin@local.fika", role: "integration-admin" }, [
    { canonicalId: haleon, entityType: "OPLOC", record: { approvedName: "Haleon", lifecycleState: "active" }, dataHash: "a", lifecycleStatus: "published", publicationStatus: "published" },
    { canonicalId: "oploc:archived", entityType: "OPLOC", record: { approvedName: "Archived", lifecycleState: "active" }, dataHash: "b", lifecycleStatus: "archived", publicationStatus: "published" },
  ]);
  assert.deepEqual(result.access.oplocIds, [haleon]);
  assert.equal(result.sites[0].label, "Haleon");
});
