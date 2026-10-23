import assert from "node:assert/strict";
import test from "node:test";
import { fulfilmentFromProductionOrder } from "../../shared/fulfilment-requirement";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { applyOrderedQuantityBackfill, applyPlannedBackfill, BACKFILL_AUDIT_COLLECTION, planOrderedQuantityBackfill } from "../lib/ordered-quantity-backfill";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";

// Runs against the local Firestore emulator (local runtime mode); never production.
const orderId = `production-order:v1:booking:mnk:backfill-${Date.now()}`;
const order = {
  canonicalId: orderId, version: 3, origin: "hospitality_booking" as const, productionLocationId: "oploc:cpux", destinationOplocId: "oploc:angel", destinationLabel: "One Angel Court",
  serviceDate: "2026-11-24", requiredBy: "2026-11-24T10:00:00", serviceWindow: { startTime: "10:00" }, status: "accepted",
  lines: [
    { canonicalId: "line:deli", itemName: "Deli Style Sandwich Lunch", customerQuantity: 10, customerUnit: "Per person", productionQuantity: 30, productionUnit: "piece", sortOrder: 0 },
    { canonicalId: "line:juice", itemName: "Fresh Squeezed & Pressed Juice", customerQuantity: 4, customerUnit: "Per bottle", sortOrder: 1 },
  ],
};

async function seed(mutate?: (lines: Array<Record<string, unknown>>) => void) {
  const requirement = fulfilmentFromProductionOrder(order as never, "cpu");
  // A requirement written before the ordered fields existed.
  const legacy = { ...requirement, lines: requirement.lines.map(({ orderedQuantity: _a, orderedUnit: _b, ...rest }) => rest) };
  mutate?.(legacy.lines as never);
  await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)).set(order);
  await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(requirement.canonicalId)).set(legacy);
  await db.collection("fikaLogisticsJobsV1").doc(`logistics-job:${requirement.canonicalId}`).set({ id: `logistics-job:${requirement.canonicalId}`, requirementId: requirement.canonicalId, version: 7, contents: legacy.lines.map((line) => ({ description: line.displayNameSnapshot, quantity: line.quantity, unit: line.unit })) });
  return { requirementId: requirement.canonicalId, legacy };
}
const read = async (path: string, id: string) => (await db.collection(path).doc(id).get()).data() as Record<string, any>;

test("dry run reports the exact diff and writes nothing", { skip: !emulatorEnabled }, async () => {
  const { requirementId } = await seed();
  const before = await read("fikaFulfilmentRequirementsV1", stableDocumentId(requirementId));
  const plan = await planOrderedQuantityBackfill(db, orderId);
  assert.deepEqual(plan.refusals, []);
  assert.equal(plan.upToDate, false);
  assert.deepEqual(plan.changes.map((change) => [change.target, change.name, change.operational, change.before, change.after]), [
    ["requirement", "Deli Style Sandwich Lunch", "30 piece", null, "10 Per person"],
    ["job", "Deli Style Sandwich Lunch", "30 piece", null, "10 Per person"],
    ["requirement", "Fresh Squeezed & Pressed Juice", "4 Per bottle", null, "4 Per bottle"],
    ["job", "Fresh Squeezed & Pressed Juice", "4 Per bottle", null, "4 Per bottle"],
  ]);
  assert.deepEqual(await read("fikaFulfilmentRequirementsV1", stableDocumentId(requirementId)), before, "nothing was written");
});

test("apply adds only the ordered fields: version, hash, status, quantities and units are unchanged; a repeat is a no-op", { skip: !emulatorEnabled }, async () => {
  const { requirementId, legacy } = await seed();
  const result = await applyOrderedQuantityBackfill(db, orderId, "test-operator", "2026-10-19T09:00:00.000Z");
  assert.equal(result.written, true);
  const requirement = await read("fikaFulfilmentRequirementsV1", stableDocumentId(requirementId));
  assert.equal(requirement.version, legacy.version);
  assert.equal(requirement.status, legacy.status);
  assert.equal(requirement.sourceContentHash, legacy.sourceContentHash);
  assert.equal(requirement.idempotencyKey, legacy.idempotencyKey);
  assert.deepEqual(requirement.lines.map((line: any) => [line.quantity, line.unit, line.orderedQuantity, line.orderedUnit]), [[30, "piece", 10, "Per person"], [4, "Per bottle", 4, "Per bottle"]]);
  const job = await read("fikaLogisticsJobsV1", `logistics-job:${requirementId}`);
  assert.equal(job.version, 7, "job version untouched");
  assert.deepEqual(job.contents.map((item: any) => [item.quantity, item.unit, item.orderedQuantity, item.orderedUnit]), [[30, "piece", 10, "Per person"], [4, "Per bottle", 4, "Per bottle"]]);
  const audit = await db.collection(BACKFILL_AUDIT_COLLECTION).get();
  assert.ok(audit.docs.some((doc) => doc.data().orderId === orderId && doc.data().by === "test-operator"), "durable audit record");
  const again = await applyOrderedQuantityBackfill(db, orderId, "test-operator");
  assert.equal(again.written, false);
  assert.equal(again.upToDate, true);
});

test("it refuses to write when the requirement does not match the Production Order", { skip: !emulatorEnabled }, async () => {
  await seed((lines) => { lines[0].quantity = 31; });
  await assert.rejects(applyOrderedQuantityBackfill(db, orderId, "test-operator"), /Refusing to write:.*operational quantity/);
});

test("it refuses to write if the documents changed since the dry run", { skip: !emulatorEnabled }, async () => {
  const { requirementId } = await seed();
  const plan = await planOrderedQuantityBackfill(db, orderId);
  assert.ok(plan.changes.length);
  // Someone amends the requirement between the dry run and the apply.
  await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(requirementId)).update({ version: 99 });
  await assert.rejects(applyPlannedBackfill(db, plan, "test-operator"), /version changed since the dry run; nothing was written/);
  const current = await read("fikaFulfilmentRequirementsV1", stableDocumentId(requirementId));
  assert.equal(current.lines[0].orderedQuantity, undefined, "nothing was written");
});
