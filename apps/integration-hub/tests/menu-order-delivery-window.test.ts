import assert from "node:assert/strict";
import test from "node:test";
import { materialiseExternalProductionOrder, materialisedProductionId } from "../lib/production-domain";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import { fulfilmentFromProductionOrder } from "../../shared/fulfilment-requirement";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";

const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
const line = { sourceLineId: "line:1", canonicalItemId: "menu-item:local:test-dish", itemName: "Test Dish", quantity: 25, unit: "portion", workstream: "delivered_in" as const };
const stamp = `${Date.now()}:${process.pid}`;

function menuInput(suffix: string, overrides: Record<string, unknown> = {}) {
  return { sourceDomain: "menu-planning" as const, sourceEntityId: `window-test:${stamp}:${suffix}`, publicationId: "menu-publication:test", sourceVersion: 1, sourceContentHash: "hash-1", destinationOplocId: "oploc:haleon", destinationLabel: "Haleon", serviceDate: "2026-10-26", status: "published" as const, lines: [line], ...overrides };
}
type Input = ReturnType<typeof menuInput>;
type Ref = { sourceDomain: "menu-planning" | "grab-and-go"; sourceEntityId: string; destinationOplocId: string };

async function cleanup(inputs: Ref[]) {
  for (const input of inputs) {
    const orderId = materialisedProductionId(input);
    const [requirements, receipts, events] = await Promise.all([
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
      db.collection("fikaDomainEventsV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const batch = db.batch(); batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)));
    for (const document of [...requirements.docs, ...receipts.docs, ...events.docs]) batch.delete(document.ref);
    await batch.commit();
  }
}

const requirementsFor = async (input: Ref) => (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", materialisedProductionId(input)).get()).docs.map(doc => doc.data());

test("a Menu order with no supplied delivery window carries no window and creates an unscheduled Logistics requirement", { skip: !emulatorEnabled }, async () => {
  const input = menuInput("no-window");
  try {
    const { order, created } = await materialiseExternalProductionOrder(actor, input);
    assert.equal(created, true);
    assert.equal("serviceWindow" in order, false, "no synthetic 00:00 service window is invented");
    assert.equal(order.canonicalId, materialisedProductionId(input), "stable order identity is preserved");
    assert.equal(order.serviceDate, "2026-10-26");
    assert.equal(order.destinationOplocId, "oploc:haleon");
    assert.equal(order.status, "menu_available");
    assert.equal(order.lines.length, 1);
    assert.equal(order.lines[0].itemName, "Test Dish");
    const [requirement] = await requirementsFor(input);
    assert.ok(requirement, "the external destination still creates a Logistics requirement");
    assert.equal("requiredDeliveryWindow" in requirement && requirement.requiredDeliveryWindow !== undefined, false, "the requirement is unscheduled");
    assert.equal(requirement.status, "ready_for_planning");
    assert.equal(requirement.lines[0].quantity, 25);
    assert.equal(requirement.destinationOplocId, "oploc:haleon");
  } finally { await cleanup([input]); }
});

test("a genuinely supplied Menu delivery window is preserved end to end", { skip: !emulatorEnabled }, async () => {
  const input = menuInput("real-window", { serviceWindow: { startTime: "11:30", endTime: "12:00" } });
  try {
    const { order } = await materialiseExternalProductionOrder(actor, input);
    assert.deepEqual(order.serviceWindow, { startTime: "11:30", endTime: "12:00" });
    const [requirement] = await requirementsFor(input);
    assert.deepEqual(requirement.requiredDeliveryWindow, { startTime: "11:30", endTime: "12:00" });
  } finally { await cleanup([input]); }
});

test("replaying the same Menu event is idempotent: one order, one requirement, still unscheduled", { skip: !emulatorEnabled }, async () => {
  const input = menuInput("replay");
  try {
    const first = await materialiseExternalProductionOrder(actor, input);
    const replay = await materialiseExternalProductionOrder(actor, input);
    assert.equal(replay.duplicate, true);
    assert.equal(replay.created, false);
    assert.equal(replay.order.canonicalId, first.order.canonicalId);
    assert.equal(replay.order.version, 1);
    assert.equal(replay.order.currentRevision, first.order.currentRevision);
    assert.equal("serviceWindow" in replay.order, false);
    assert.equal((await db.collection("fikaProductionOrdersV1").where("sourceEntityId", "==", input.sourceEntityId).get()).size, 1);
    const requirements = await requirementsFor(input);
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].requiredDeliveryWindow, undefined);
  } finally { await cleanup([input]); }
});

test("FIKA Xchange Menu orders still create a CPU production order but no Logistics requirement", { skip: !emulatorEnabled }, async () => {
  const input = menuInput("xchange", { destinationOplocId: CPU_SITE_OPLOC_ID, destinationLabel: "FIKA Xchange" });
  try {
    const { order } = await materialiseExternalProductionOrder(actor, input);
    assert.equal(order.destinationOplocId, CPU_SITE_OPLOC_ID);
    assert.equal(order.lines.length, 1);
    assert.equal("serviceWindow" in order, false);
    assert.equal((await requirementsFor(input)).length, 0, "local production is not a Logistics delivery");
  } finally { await cleanup([input]); }
});

test("existing Hospitality fulfilment behaviour is unchanged", () => {
  const base = { canonicalId: "production-order:v1:booking:test:one", version: 1, origin: "hospitality_booking", destinationOplocId: "oploc:customer", destinationLabel: "Customer", serviceDate: "2026-10-26", requiredBy: "2026-10-26T09:00", status: "planned", lines: [{ canonicalId: "l1", itemName: "Lunch", customerQuantity: 10, customerUnit: "portion", sortOrder: 0 }] };
  const hospitality = fulfilmentFromProductionOrder({ ...base, serviceWindow: { startTime: "09:00", endTime: "10:00" } } as never, "test");
  assert.deepEqual(hospitality.requiredDeliveryWindow, { startTime: "09:00", endTime: "10:00" });
  assert.equal(fulfilmentFromProductionOrder(base as never, "test").requiredDeliveryWindow, undefined);
});

test("Grab & Go orders keep their existing default window", { skip: !emulatorEnabled }, async () => {
  const input = { sourceDomain: "grab-and-go" as const, sourceEntityId: `window-test:${stamp}:gng`, sourceVersion: 1, sourceContentHash: "g1", destinationOplocId: "oploc:haleon", destinationLabel: "Haleon", serviceDate: "2026-10-26", status: "submitted" as const, lines: [line] };
  try {
    const { order } = await materialiseExternalProductionOrder(actor, input);
    assert.deepEqual(order.serviceWindow, { startTime: "00:00" });
  } finally { await cleanup([input]); }
});
