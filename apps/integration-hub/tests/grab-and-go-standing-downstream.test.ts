/**
 * Downstream reconciliation for Grab & Go standing orders. A standing order produces ordinary Grab & Go source versions
 * (v1 create, v2 amend, v3 cancel) through Delivered-In's existing handoff. This proves the Hub's canonical Production Order
 * and the Fulfilment Requirement consumed by Logistics follow those versions exactly, including replay and out-of-order delivery.
 * Needs the Firestore emulator (apps/integration-hub: firebase emulators:exec --only firestore ...).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { parseExternalProductionMaterialisation, type ExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { materialiseExternalProductionOrder, materialisedProductionId, type ProductionOrder } from "../lib/production-domain";
import { reconcileProductionFulfilmentForServiceDate } from "../lib/fulfilment-projection";
import type { FulfilmentRequirement } from "../../shared/fulfilment-requirement";

const skip = process.env.FIRESTORE_EMULATOR_HOST || process.env.FIKA_RUNTIME_MODE === "local" ? false : "Firestore emulator is not running.";
const actor = { uid: "grab-go-standing-test", name: "Standing order test", role: "integration-admin", synthetic: true } as never;
const serviceDate = "2099-11-02";
const oplocId = `oploc:standing-downstream-${process.pid}`;
const sourceEntityId = `grab-and-go:${oplocId}:${serviceDate}`;
/** Mirrors Delivered-In grabHandoffEvent(): same field mapping for every source version. */
const payload = (version: number, status: "submitted" | "cancelled", quantities: Record<string, number>): ExternalProductionMaterialisation => ({
  sourceDomain: "grab-and-go", sourceEntityId, sourceVersion: version, destinationOplocId: oplocId, destinationLabel: oplocId, serviceDate, requiredBy: `${serviceDate}T08:00`, status,
  lines: Object.entries(quantities).map(([productId, quantity]) => ({ sourceLineId: `${sourceEntityId}:line:${productId}`, canonicalItemId: productId, itemName: productId, quantity, unit: "item", workstream: "grab_and_go" as const })),
});
const productionOrder = async () => (await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(materialisedProductionId({ sourceDomain: "grab-and-go", sourceEntityId, destinationOplocId: oplocId }))).get()).data() as ProductionOrder | undefined;
const requirements = async () => (await db.collection("fikaFulfilmentRequirementsV1").where("serviceDate", "==", serviceDate).get()).docs.map(document => document.data() as FulfilmentRequirement).filter(requirement => requirement.sourceEntityId === sourceEntityId);
const quantities = (order: ProductionOrder) => Object.fromEntries(order.lines.map(line => [line.sourceMenuItemId, line.productionQuantity]));

test("standing-order source versions reconcile exactly through the Production Order and the Logistics fulfilment requirement", { skip }, async () => {
  try {
    for (const version of [payload(1, "submitted", { "product:a": 5, "product:b": 2 }), payload(2, "submitted", { "product:a": 9 }), payload(3, "cancelled", { "product:a": 9 })]) assert.deepEqual(parseExternalProductionMaterialisation(version), version, "payload passes the shared intake contract");
    const v1 = await materialiseExternalProductionOrder(actor, payload(1, "submitted", { "product:a": 5, "product:b": 2 }));
    assert.equal(v1.created, true); let order = (await productionOrder())!;
    assert.deepEqual([order.status, order.sourceVersion, order.serviceDate, order.destinationOplocId, order.origin, order.version], ["planned", 1, serviceDate, oplocId, "grab_and_go", 1]); assert.deepEqual(quantities(order), { "product:a": 5, "product:b": 2 });
    let requirement = (await requirements()).find(item => item.status !== "withdrawn")!; assert.equal(requirement.sourceVersion, 1); assert.equal(requirement.status, "ready_for_planning"); assert.equal(requirement.destinationOplocId, oplocId);

    await materialiseExternalProductionOrder(actor, payload(2, "submitted", { "product:a": 9 })); order = (await productionOrder())!;
    assert.deepEqual([order.sourceVersion, order.version, order.status], [2, 2, "planned"]); assert.deepEqual(quantities(order), { "product:a": 9 }, "v2 replaces the quantities; the dropped product is gone");
    requirement = (await requirements()).filter(item => item.status !== "withdrawn").sort((a, b) => b.version - a.version)[0]; assert.equal(requirement.sourceVersion, 2); assert.equal(requirement.lines.length, 1, "Logistics sees the v2 single-product requirement");

    const replay = await materialiseExternalProductionOrder(actor, payload(2, "submitted", { "product:a": 9 })); assert.equal(replay.duplicate, true, "replay is idempotent");
    const stale = await materialiseExternalProductionOrder(actor, payload(1, "submitted", { "product:a": 5, "product:b": 2 })); assert.equal(stale.duplicate, true, "a delayed v1 never overwrites v2"); assert.equal((await productionOrder())!.sourceVersion, 2);

    await materialiseExternalProductionOrder(actor, payload(3, "cancelled", { "product:a": 9 })); order = (await productionOrder())!; assert.deepEqual([order.sourceVersion, order.status], [3, "cancelled"]);
    assert.ok((await requirements()).every(item => item.status === "withdrawn"), "cancellation withdraws the Logistics requirement");
    const late = await materialiseExternalProductionOrder(actor, payload(2, "submitted", { "product:a": 9 })); assert.equal(late.duplicate, true, "a late v2 cannot resurrect a cancelled order"); assert.equal((await productionOrder())!.status, "cancelled");
    const again = await reconcileProductionFulfilmentForServiceDate(serviceDate); assert.equal(again.created + again.updated + again.withdrawn, 0, "reconciliation is stable");
  } finally {
    const order = await productionOrder(); const batch = db.batch();
    if (order) batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(order.canonicalId)));
    for (const requirement of await requirements()) batch.delete(db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(requirement.canonicalId)));
    const outbox = await db.collection("fikaLogisticsProjectionOutboxV1").where("payload.serviceDate", "==", serviceDate).get(); for (const document of outbox.docs) if (document.data().payload?.sourceEntityId === sourceEntityId) batch.delete(document.ref);
    await batch.commit();
  }
});
