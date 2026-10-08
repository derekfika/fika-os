import assert from "node:assert/strict";
import test from "node:test";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";
import { applyFulfilmentEvent, reconcileProductionFulfilmentForServiceDate } from "../lib/fulfilment-projection";
import { ensureLogisticsProjectionEvent, logisticsProjectionRequirementRevision } from "../lib/logistics-projection-outbox";
import { createDomainEvent } from "../../shared/domain-events";
import { fulfilmentFromProductionOrder, withdrawFulfilmentRequirement, type FulfilmentRequirement } from "../../shared/fulfilment-requirement";
import { logisticsProjectionEventId } from "../../shared/logistics-projection";
import { markEventDelivered, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import type { ProductionOrder, ProductionStatus } from "../lib/production-domain";

const suffix = `event-identity:${Date.now()}:${process.pid}`;
const requirementsCollection = () => db.collection("fikaFulfilmentRequirementsV1");
const outboxCollection = () => db.collection("fikaLogisticsProjectionOutboxV1");

function order(input: { name: string; serviceDate: string; status: ProductionStatus; version?: number; destinationOplocId?: string }): ProductionOrder {
  const canonicalId = `production-order:${suffix}:${input.name}`;
  const version = input.version || 1;
  return {
    canonicalId, entityType: "Production Order", schemaVersion: "0.1.0", version, requirementIds: [],
    sourceBookingId: canonicalId, sourceQuoteRevisionId: "quote:test", productionLocationId: "oploc:cpu",
    destinationOplocId: input.destinationOplocId || `oploc:${input.name}`, destinationLabel: input.name,
    serviceDate: input.serviceDate, requiredBy: `${input.serviceDate}T09:00:00.000Z`, serviceWindow: { startTime: "09:00" },
    status: input.status, priority: "normal",
    lines: [{ canonicalId: `${canonicalId}:line:1`, sourceBookingLineId: `${canonicalId}:source:1`, itemName: "Test dish", customerQuantity: 1, customerUnit: "portion", productionQuantity: 1, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }],
    exceptions: [], origin: "menu_planning", currentRevision: version,
    createdAt: "2099-01-01T09:00:00.000Z", createdBy: "event-identity-test", updatedAt: `${input.serviceDate}T09:00:00.000Z`,
    idempotencyKey: `${canonicalId}:v${version}`, externalReferences: [], audit: [],
  };
}

const putOrder = (source: ProductionOrder) => db.collection("fikaProductionOrdersV1").doc(stableDocumentId(source.canonicalId)).set(source);
const requirementFor = async (source: ProductionOrder) => (await requirementsCollection().doc(stableDocumentId(fulfilmentFromProductionOrder(source, "probe").canonicalId)).get()).data() as FulfilmentRequirement | undefined;
const eventsFor = async (requirementId: string) => (await outboxCollection().where("sourceAggregateId", "==", requirementId).get()).docs.map(document => ({ id: document.id, data: document.data() }));
const raw = (value: unknown) => JSON.stringify(value);

async function markOriginalsDelivered(serviceDate: string) {
  const snapshot = await outboxCollection().where("payload.serviceDate", "==", serviceDate).get();
  for (const document of snapshot.docs) {
    if (!String(document.data().payload?.sourceEntityId || "").includes(suffix)) continue;
    await document.ref.set(outboxRecord(markEventDelivered(document.data() as DurableDomainEvent, "2099-01-01T10:00:00.000Z")));
  }
}

async function cleanup(serviceDate: string, orders: ProductionOrder[]) {
  const requirementSnapshot = await requirementsCollection().where("serviceDate", "==", serviceDate).get();
  const outboxSnapshot = await outboxCollection().where("payload.serviceDate", "==", serviceDate).get();
  const batch = db.batch();
  for (const source of orders) batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(source.canonicalId)));
  for (const document of requirementSnapshot.docs) if (String(document.data().sourceEntityId || "").includes(suffix)) batch.delete(document.ref);
  for (const document of outboxSnapshot.docs) if (String(document.data().payload?.sourceEntityId || "").includes(suffix)) batch.delete(document.ref);
  await batch.commit();
}

test("identity: the first revision keeps the sourceVersion identity and a same-version transition is distinct and deterministic", () => {
  const source = order({ name: "identity-unit", serviceDate: "2099-12-10", status: "planned" });
  const created = fulfilmentFromProductionOrder(source, "seed");
  const withdrawn = withdrawFulfilmentRequirement(created, "recovery", "stale", "2099-12-10T10:00:00.000Z");
  assert.equal(logisticsProjectionRequirementRevision(created), undefined);
  assert.equal(logisticsProjectionRequirementRevision(withdrawn), 2);
  const base = logisticsProjectionEventId({ serviceDate: created.serviceDate, sourceDomain: created.sourceDomain, sourceEntityId: created.sourceEntityId, sourceVersion: created.sourceVersion, destinationOplocId: created.destinationOplocId });
  const transition = logisticsProjectionEventId({ serviceDate: created.serviceDate, sourceDomain: created.sourceDomain, sourceEntityId: created.sourceEntityId, sourceVersion: created.sourceVersion, destinationOplocId: created.destinationOplocId, requirementRevision: 2 });
  assert.match(base, /:v1$/);
  assert.equal(transition, `${base}:r2`);
  assert.notEqual(base, transition);
  // A new upstream sourceVersion keeps the original identity shape.
  const amended = fulfilmentFromProductionOrder({ ...source, version: 2 }, "seed", undefined, created);
  assert.equal(logisticsProjectionRequirementRevision(amended), undefined);
});

test("historical retirement stages a distinct withdrawal event and leaves the original delivered v1 event byte-identical", async () => {
  const serviceDate = "2099-12-11";
  const active = order({ name: "retire-me", serviceDate, status: "planned" });
  const cancelled = { ...active, status: "cancelled" as ProductionStatus };
  try {
    await putOrder(active);
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    await markOriginalsDelivered(serviceDate);
    const requirement = (await requirementFor(active))!;
    const [original] = await eventsFor(requirement.canonicalId);
    assert.ok(original, "original v1 outbox event exists");
    assert.equal(original.data.outboxStatus, "delivered");
    assert.match(original.id, /:v1$/);
    const originalBytes = raw(original.data);

    await putOrder(cancelled); // sourceVersion stays 1; the requirement is withdrawn at requirement v2
    const retired = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(retired.withdrawn, 1);
    const withdrawn = (await requirementFor(active))!;
    assert.equal(withdrawn.status, "withdrawn");
    assert.equal(withdrawn.sourceVersion, requirement.sourceVersion, "sourceVersion is unchanged by governed retirement");
    assert.equal(withdrawn.version, requirement.version + 1);

    const events = await eventsFor(requirement.canonicalId);
    assert.equal(events.length, 2);
    const stillOriginal = events.find(event => event.id === original.id)!;
    assert.equal(raw(stillOriginal.data), originalBytes, "original v1 record/payload is byte-for-byte unchanged");
    const transition = events.find(event => event.id !== original.id)!;
    assert.equal(transition.id, `${original.id}:r${withdrawn.version}`);
    assert.equal(transition.data.payload.changeType, "withdrawn");
    assert.equal(transition.data.outboxStatus, "pending");
    assert.equal(stillOriginal.data.payload.changeType, "created");
  } finally { await cleanup(serviceDate, [active]); }
});

test("repeating the same recovery is idempotent: no further event and no duplicate requirement audit", async () => {
  const serviceDate = "2099-12-12";
  const active = order({ name: "idempotent", serviceDate, status: "planned" });
  try {
    await putOrder(active);
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    await markOriginalsDelivered(serviceDate);
    await putOrder({ ...active, status: "cancelled" });
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    const requirement = (await requirementFor(active))!;
    const before = { events: raw((await eventsFor(requirement.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), audit: requirement.audit.length, requirement: raw(requirement) };

    const again = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(again.withdrawn, 0);
    const third = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(third.withdrawn, 0);
    const after = (await requirementFor(active))!;
    assert.equal(after.audit.length, before.audit);
    assert.equal(raw(after), before.requirement);
    assert.equal(raw((await eventsFor(requirement.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), before.events);
    assert.equal((await eventsFor(requirement.canonicalId)).length, 2);
  } finally { await cleanup(serviceDate, [active]); }
});

test("mixed historical and current state retires only stale work and leaves the current revision untouched", async () => {
  const serviceDate = "2099-12-13";
  const stale = ["a", "b", "c"].map(name => order({ name: `stale-${name}`, serviceDate, status: "planned" }));
  const current = order({ name: "current-r17", serviceDate, status: "planned" });
  try {
    for (const source of [...stale, current]) await putOrder(source);
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    await markOriginalsDelivered(serviceDate);
    const currentBefore = (await requirementFor(current))!;
    const currentEventsBefore = raw((await eventsFor(currentBefore.canonicalId)).sort((a, b) => a.id.localeCompare(b.id)));
    const staleOriginals = await Promise.all(stale.map(async source => ({ source, events: await eventsFor((await requirementFor(source))!.canonicalId) })));
    for (const source of stale) await putOrder({ ...source, status: "cancelled" });

    const result = await reconcileProductionFulfilmentForServiceDate(serviceDate);
    assert.equal(result.withdrawn, 3);
    for (const { source, events } of staleOriginals) {
      const requirement = (await requirementFor(source))!;
      assert.equal(requirement.status, "withdrawn");
      const now = await eventsFor(requirement.canonicalId);
      assert.equal(now.length, 2);
      assert.equal(raw(now.find(event => event.id === events[0].id)!.data), raw(events[0].data), "stale original v1 unchanged");
      assert.ok(now.some(event => event.id === `${events[0].id}:r2` && event.data.payload.changeType === "withdrawn"));
    }
    const currentAfter = (await requirementFor(current))!;
    assert.equal(raw(currentAfter), raw(currentBefore), "current requirement unchanged");
    assert.equal(raw((await eventsFor(currentAfter.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), currentEventsBefore, "current events unchanged");
  } finally { await cleanup(serviceDate, [...stale, current]); }
});

test("replaying the exact older event after retirement neither resurrects work nor overwrites the withdrawal event", async () => {
  const serviceDate = "2099-12-14";
  const active = order({ name: "replay", serviceDate, status: "planned" });
  try {
    await putOrder(active);
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    await markOriginalsDelivered(serviceDate);
    const original = (await requirementFor(active))!;
    await putOrder({ ...active, status: "cancelled" });
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    const withdrawn = (await requirementFor(active))!;
    const eventsBefore = raw((await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id)));

    const replay = createDomainEvent({ eventType: "fulfilment.requirement.created", sourceAggregateId: original.canonicalId, sourceVersion: original.sourceVersion, occurredAt: original.updatedAt, payload: original });
    const first = await applyFulfilmentEvent(replay);
    const second = await applyFulfilmentEvent(replay);
    assert.equal(first.applied, false);
    assert.equal(second.applied, false);
    const after = (await requirementFor(active))!;
    assert.equal(after.status, "withdrawn");
    assert.equal(raw(after), raw(withdrawn));
    assert.equal(raw((await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), eventsBefore);
  } finally {
    await cleanup(serviceDate, [active]);
    await db.collection("fikaFulfilmentInboxV1").doc(`fulfilment-central:${stableDocumentId(`fulfilment.requirement.created:${active.canonicalId}:v1`)}`).delete().catch(() => undefined);
  }
});

test("legacy repair never fabricates a transition identity and an existing transition event can never be overwritten", async () => {
  const serviceDate = "2099-12-15";
  const active = order({ name: "legacy-repair", serviceDate, status: "planned" });
  try {
    await putOrder(active);
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    await markOriginalsDelivered(serviceDate);
    await putOrder({ ...active, status: "cancelled" });
    await reconcileProductionFulfilmentForServiceDate(serviceDate);
    const withdrawn = (await requirementFor(active))!;
    const before = raw((await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id)));
    const ensured = await ensureLogisticsProjectionEvent(withdrawn);
    assert.match(ensured.eventId, /:v1$/, "repair keeps the sourceVersion-level identity");
    assert.equal(raw((await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), before);

    const [, transition] = (await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id));
    await assert.rejects(() => db.runTransaction(async transaction => { transaction.create(outboxCollection().doc(transition.id), { overwritten: true }); }), /ALREADY_EXISTS|already exists/i);
    assert.equal(raw((await eventsFor(withdrawn.canonicalId)).sort((a, b) => a.id.localeCompare(b.id))), before);
  } finally { await cleanup(serviceDate, [active]); }
});
