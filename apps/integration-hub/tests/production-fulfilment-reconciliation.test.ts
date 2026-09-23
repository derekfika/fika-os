import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { reconcileProductionFulfilmentForServiceDate } from "../lib/fulfilment-projection";
import { fulfilmentFromProductionOrder, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import type { ProductionOrder, ProductionStatus } from "../lib/production-domain";

const serviceDate = "2099-12-31";
const suffix = `reconciliation:${Date.now()}:${process.pid}`;

function order(input: { name: string; destinationOplocId: string; status: ProductionStatus; version?: number; requiresDelivery?: boolean }): ProductionOrder {
  const canonicalId = `production-order:${suffix}:${input.name}`;
  const version = input.version || 1;
  return {
    canonicalId,
    entityType: "Production Order",
    schemaVersion: "0.1.0",
    version,
    requirementIds: [],
    sourceBookingId: canonicalId,
    sourceQuoteRevisionId: "quote:test",
    productionLocationId: "oploc:cpu",
    ...(input.requiresDelivery === undefined ? {} : { requiresDelivery: input.requiresDelivery }),
    destinationOplocId: input.destinationOplocId,
    destinationLabel: input.name,
    serviceDate,
    requiredBy: `${serviceDate}T09:00:00.000Z`,
    serviceWindow: { startTime: "09:00" },
    status: input.status,
    priority: "normal",
    lines: [{ canonicalId: `${canonicalId}:line:1`, sourceBookingLineId: `${canonicalId}:source:1`, itemName: "Test dish", customerQuantity: 1, customerUnit: "portion", productionQuantity: 1, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }],
    exceptions: [],
    origin: "menu_planning",
    currentRevision: version,
    createdAt: "2099-12-30T09:00:00.000Z",
    createdBy: "reconciliation-test",
    updatedAt: "2099-12-31T09:00:00.000Z",
    idempotencyKey: `${canonicalId}:v${version}`,
    externalReferences: [],
    audit: [],
  };
}

async function writeRequirement(requirement: FulfilmentRequirement) {
  await db.collection("fikaFulfilmentRequirementsV1").doc(stableDocumentId(requirement.canonicalId)).set(requirement);
}

test("bounded Production Order reconciliation repairs missing/stale work and excludes local CPU production", async () => {
  const draft = order({ name: "draft", destinationOplocId: "oploc:draft", status: "draft", requiresDelivery: false });
  const ready = order({ name: "ready", destinationOplocId: "oploc:ready", status: "planned" });
  const staleCurrent = order({ name: "stale", destinationOplocId: "oploc:stale", status: "planned", version: 2 });
  const stalePrior = order({ name: "stale", destinationOplocId: "oploc:stale", status: "planned", version: 1 });
  const local = order({ name: "local", destinationOplocId: CPU_SITE_OPLOC_ID, status: "ready" });
  const cancelled = order({ name: "cancelled", destinationOplocId: "oploc:cancelled", status: "cancelled", version: 2 });
  const cancelledPrior = order({ name: "cancelled", destinationOplocId: "oploc:cancelled", status: "planned", version: 1 });
  const missingDestination = { ...order({ name: "missing-destination", destinationOplocId: "oploc:missing", status: "draft" }), destinationOplocId: undefined };
  const orders = [draft, ready, staleCurrent, local, cancelled, missingDestination];
  try {
    for (const source of orders) await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(source.canonicalId)).set(source);
    await writeRequirement(fulfilmentFromProductionOrder(stalePrior, "seed"));
    await writeRequirement(fulfilmentFromProductionOrder(local, "seed"));
    await writeRequirement(fulfilmentFromProductionOrder(cancelledPrior, "seed"));

    const first = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(first.productionOrders, 6);
    assert.equal(first.fikaXExcluded, 1);
    assert.equal(first.expectedFulfilmentRequirements, 3);
    assert.equal(first.created, 2);
    assert.equal(first.updated, 1);
    assert.equal(first.withdrawn, 2);
    assert.deepEqual(first.missingDestinationProductionOrders, [missingDestination.canonicalId]);
    assert.ok(first.missingRequirements.length >= 2);

    const current = await db.collection("fikaFulfilmentRequirementsV1").where("serviceDate", "==", serviceDate).get();
    const bySource = new Map(current.docs.map(document => [document.data().sourceEntityId, document.data() as FulfilmentRequirement]));
    assert.equal(bySource.get(draft.canonicalId)?.status, "pending");
    assert.equal(bySource.get(ready.canonicalId)?.status, "ready_for_planning");
    assert.equal(bySource.get(staleCurrent.canonicalId)?.sourceVersion, 2);
    assert.equal(bySource.get(local.canonicalId)?.status, "withdrawn");
    assert.equal(bySource.get(cancelled.canonicalId)?.status, "withdrawn");

    const replay = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(replay.created, 0);
    assert.equal(replay.updated, 0);
    assert.equal(replay.withdrawn, 0);
    assert.equal(replay.missingRequirements.length, 0);
    assert.equal(replay.staleRequirements.length, 0);
  } finally {
    const requirementSnapshot = await db.collection("fikaFulfilmentRequirementsV1").where("serviceDate", "==", serviceDate).get();
    const outboxSnapshot = await db.collection("fikaLogisticsProjectionOutboxV1").where("payload.serviceDate", "==", serviceDate).get();
    const batch = db.batch();
    for (const source of orders) batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(source.canonicalId)));
    for (const document of requirementSnapshot.docs) if (String(document.data().sourceEntityId || "").includes(suffix)) batch.delete(document.ref);
    for (const document of outboxSnapshot.docs) if (String(document.data().payload?.sourceEntityId || "").includes(suffix)) batch.delete(document.ref);
    await batch.commit();
  }
});
