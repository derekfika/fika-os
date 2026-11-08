import assert from "node:assert/strict";
import test from "node:test";
import { createCpuProductionOrder, externalProductionStatus, materialiseExternalProductionOrder, materialisedProductionId, productionOrderV1Id, productionRequirementId, saveHospitalityKitchenNotes } from "../lib/production-domain";
import { transitionProductionOrder } from "../lib/production-domain";
import { db } from "../lib/firebase-admin";
import type { ProductionLine } from "../lib/production-domain";
import { listDomainEvents } from "../lib/domain-event-outbox";
import { stableDocumentId } from "../lib/canonical-editor";
import { CPU_SITE_OPLOC_ID } from "../../shared/production-location";
import { productionOrderRequiresFulfilment } from "../../shared/fulfilment-requirement";
import { kitchenNotesEventId } from "../lib/hospitality-kitchen-notes-outbox";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";

test("emulator: kitchen notes update only the canonical order note and retry CPU projection durably", { skip: !emulatorEnabled }, async () => {
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  const bookingId = `booking:kitchen-notes:${Date.now()}:${process.pid}`;
  const orderId = productionOrderV1Id(bookingId);
  const booking = { canonicalId: bookingId, entityType: "Booking", schemaVersion: "0.1.0", version: 7, lifecycleStatus: "Sent to CPU", createdAt: "2026-10-30T09:00:00.000Z", createdBy: actor.uid, updatedAt: "2026-10-30T09:00:00.000Z", updatedBy: actor.uid, client: { name: "Host", email: "host@example.com", companyName: "Client" }, service: { eventDate: "2026-12-01", startTime: "12:00", guestCount: 10, oplocId: "oploc:kitchen-notes" }, order: { eventType: "Lunch", items: [{ itemId: "item:1", itemName: "Soup", unitPrice: 10, quantity: 10 }] }, dietaries: {}, acknowledgements: {}, notes: "Customer-visible note", kitchenNotes: "Old kitchen note", attachments: [], statusHistory: [], audit: [], quoteState: { currentRevisionId: "quote:test", revisions: [{ id: "quote:test", snapshot: { notes: "Customer-visible note" }, stale: false }] } };
  const lines = [{ canonicalId: `${orderId}:line:1`, sourceBookingLineId: `${bookingId}:line:1`, itemName: "Soup", customerQuantity: 10, customerUnit: "portion", productionQuantity: 10, productionUnit: "portion", dietaries: {}, status: "ready", sortOrder: 0 }];
  const order = { canonicalId: orderId, entityType: "Production Order", schemaVersion: "0.1.0", version: 3, requirementIds: [], sourceBookingId: bookingId, sourceQuoteRevisionId: "quote:test", requiredBy: "2026-12-01T12:00:00", serviceDate: "2026-12-01", serviceWindow: { startTime: "12:00" }, status: "planned", workflowStatus: "planned", priority: "normal", lines, exceptions: [], bookingNotes: "Customer-visible note", kitchenNotes: "Old kitchen note", allergenSignoff: { status: "signed", signedBy: "test" }, origin: "hospitality_booking", currentRevision: 2, createdAt: "2026-10-30T09:00:00.000Z", createdBy: actor.uid, idempotencyKey: "handoff:test", externalReferences: [], audit: [], destinationOplocId: "oploc:kitchen-notes" };
  const bookingRef = db.collection("fikaBookings").doc(bookingId);
  const orderRef = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId));
  await bookingRef.set(booking); await orderRef.set(order);
  const originalFetch = globalThis.fetch;
  let calls = 0; const payloads: Array<Record<string, unknown>> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    calls++; payloads.push(JSON.parse(String(init?.body || "{}")));
    return new Response(calls <= 2 ? "CPU unavailable" : JSON.stringify({ applied: true }), { status: calls <= 2 ? 503 : 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    const failed = await saveHospitalityKitchenNotes(actor, bookingId, 7, "Keep warm\nLabel for service");
    assert.equal(failed.propagation, "pending");
    const savedOrder = (await orderRef.get()).data()!;
    assert.equal(savedOrder.canonicalId, orderId); assert.equal(savedOrder.version, 4); assert.equal(savedOrder.status, "planned"); assert.equal(savedOrder.currentRevision, 2);
    assert.deepEqual(savedOrder.lines, lines); assert.equal(savedOrder.kitchenNotes, "Keep warm\nLabel for service");
    const savedBooking = (await bookingRef.get()).data()!;
    assert.equal(savedBooking.notes, "Customer-visible note"); assert.equal(savedBooking.quoteState.revisions[0].snapshot.notes, "Customer-visible note");
    assert.equal(savedBooking.kitchenNotesPropagation.status, "pending");
    await assert.rejects(saveHospitalityKitchenNotes(actor, bookingId, 7, "stale write"), /changed elsewhere/);
    assert.equal((await db.collection("fikaBookingNotifications").where("bookingId", "==", bookingId).get()).size, 0);
    const retried = await saveHospitalityKitchenNotes(actor, bookingId, savedBooking.version, "Keep warm\nLabel for service");
    assert.equal(retried.propagation, "delivered"); assert.equal(retried.unchanged, true);
    const finalOrder = (await orderRef.get()).data()!;
    assert.equal(finalOrder.version, 4); assert.deepEqual(finalOrder.lines, lines); assert.equal(finalOrder.status, "planned");
    assert.deepEqual(finalOrder.allergenSignoff, { status: "signed", signedBy: "test" });
    assert.equal((await db.collection("fikaHospitalityKitchenNotesOutboxV1").doc(kitchenNotesEventId(bookingId, 8)).get()).get("delivery.status"), "delivered");
    assert.equal(payloads.at(-1)?.changeType, "kitchen-notes-updated");
    const cleared = await saveHospitalityKitchenNotes(actor, bookingId, savedBooking.version, "");
    assert.equal(cleared.propagation, "delivered");
    const clearedBooking = (await bookingRef.get()).data()!; const clearedOrder = (await orderRef.get()).data()!;
    assert.equal(clearedBooking.kitchenNotes, ""); assert.equal(clearedOrder.kitchenNotes, "");
    assert.equal(clearedOrder.canonicalId, orderId); assert.equal(clearedOrder.version, 5); assert.equal(clearedOrder.status, "planned");
    assert.deepEqual(clearedOrder.lines, lines); assert.deepEqual(clearedOrder.allergenSignoff, { status: "signed", signedBy: "test" });
    assert.equal((await db.collection("fikaHospitalityKitchenNotesOutboxV1").doc(kitchenNotesEventId(bookingId, 9)).get()).get("delivery.status"), "delivered");
  } finally {
    globalThis.fetch = originalFetch;
    const batch = db.batch(); batch.delete(bookingRef); batch.delete(orderRef); batch.delete(db.collection("fikaBookingAudit").doc(`${bookingId.replace(/[^A-Za-z0-9_-]/g, "_")}:kitchen-notes:v8`)); batch.delete(db.collection("fikaBookingAudit").doc(`${bookingId.replace(/[^A-Za-z0-9_-]/g, "_")}:kitchen-notes:v9`)); batch.delete(db.collection("fikaHospitalityKitchenNotesOutboxV1").doc(kitchenNotesEventId(bookingId, 8))); batch.delete(db.collection("fikaHospitalityKitchenNotesOutboxV1").doc(kitchenNotesEventId(bookingId, 9)));
    await batch.commit();
  }
});

test("production identifiers are stable and distinct by source booking and quote", () => {
  assert.equal(productionOrderV1Id("booking:mnk:one"), "production-order:v1:booking:mnk:one");
  assert.equal(productionOrderV1Id("booking:mnk:one", 2), "production-order:v1:booking:mnk:one:r2");
  assert.equal(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), "production-requirement:booking:mnk:one:quote:booking:mnk:one:r1");
  assert.notEqual(productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r1"), productionRequirementId("booking:mnk:one", "quote:booking:mnk:one:r2"));
});

test("external production identities are deterministic per source and destination", () => {
  const input = { sourceDomain: "grab-and-go" as const, sourceEntityId: "UAT-WC240826:haleon:2026-08-24", destinationOplocId: "oploc:haleon" };
  assert.equal(materialisedProductionId(input), materialisedProductionId(input));
  assert.notEqual(materialisedProductionId(input), materialisedProductionId({ ...input, destinationOplocId: "oploc:xchange" }));
});

test("Grab & Go external production is immediately plannable without CPU acceptance", () => {
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "submitted" }), "planned");
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "amended" }), "planned");
  assert.equal(externalProductionStatus({ sourceDomain: "grab-and-go", status: "cancelled" }), "cancelled");
  assert.equal(externalProductionStatus({ sourceDomain: "menu-planning", status: "published" }), "menu_available");
});

test("emulator: late Grab & Go and Menu source deliveries cannot overwrite a newer cancellation or its history", { skip: !emulatorEnabled }, async () => {
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  for (const sourceDomain of ["grab-and-go", "menu-planning"] as const) {
    const input = { sourceDomain, sourceEntityId: `late-source:${sourceDomain}:${Date.now()}:${process.pid}`, destinationOplocId: "oploc:haleon", serviceDate: "2026-10-12", sourceVersion: 1, status: sourceDomain === "grab-and-go" ? "submitted" as const : "published" as const, lines: [{ sourceLineId: "line:owned", itemName: "Owned item", quantity: 1, unit: "item" }] };
    const orderId = materialisedProductionId(input);
    try {
      await materialiseExternalProductionOrder(actor, input);
      await materialiseExternalProductionOrder(actor, { ...input, sourceVersion: 2, lines: [{ ...input.lines[0], quantity: 2 }] });
      const cancelled = await materialiseExternalProductionOrder(actor, { ...input, sourceVersion: 3, status: sourceDomain === "grab-and-go" ? "cancelled" : "withdrawn" });
      for (const sourceVersion of [1, 2]) {
        const replay = await materialiseExternalProductionOrder(actor, { ...input, sourceVersion });
        assert.equal(replay.duplicate, true); assert.deepEqual(replay.order, cancelled.order);
      }
      const persisted = (await db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)).get()).data();
      assert.equal(persisted?.status, "cancelled"); assert.equal(persisted?.sourceVersion, 3); assert.equal(persisted?.version, 3); assert.equal(persisted?.audit.length, 3);
    } finally {
      const [requirements, receipts] = await Promise.all([
        db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
        db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
      ]);
      const batch = db.batch(); batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)));
      for (const [index, action] of ["created", "amended", "withdrawn"].entries()) batch.delete(db.collection("fikaDomainEventsV1").doc(`production.order.${action}:${orderId}:v${index + 1}`));
      for (const document of [...requirements.docs, ...receipts.docs]) batch.delete(document.ref);
      await batch.commit();
    }
  }
});

test("emulator: Menu withdrawal dominates replay of the same content version and permits a newer republish", { skip: !emulatorEnabled }, async () => {
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  const input = { sourceDomain: "menu-planning" as const, sourceEntityId: `same-content-withdrawal:${Date.now()}:${process.pid}`, destinationOplocId: "oploc:haleon", serviceDate: "2026-10-12", sourceVersion: 4, sourceContentHash: "a".repeat(64), status: "amended" as const, lines: [{ sourceLineId: "owned-line", itemName: "Owned item", quantity: 15, unit: "portion" }] };
  await materialiseExternalProductionOrder(actor, input);
  const withdrawn = await materialiseExternalProductionOrder(actor, { ...input, status: "withdrawn" });
  const replays = await Promise.all([input, { ...input, status: "published" as const }, { ...input, status: "withdrawn" as const }].map(value => materialiseExternalProductionOrder(actor, value)));
  assert.ok(replays.every(result => result.duplicate));
  for (const replay of replays) assert.deepEqual(replay.order, withdrawn.order);
  const republished = await materialiseExternalProductionOrder(actor, { ...input, sourceVersion: 5, status: "published" });
  assert.equal(republished.duplicate, false);
  assert.equal(republished.order.status, "menu_available");
  assert.equal(republished.order.sourceVersion, 5);
  assert.equal(republished.order.audit.length, 3);
});

test("emulator: Menu publication materialisation is idempotent and preserves publication lineage", { skip: !emulatorEnabled }, async () => {
  const suffix = `${Date.now()}:${process.pid}`;
  const input = {
    sourceDomain: "menu-planning" as const,
    sourceEntityId: `rolling-week:handoff:${suffix}:day:0`,
    publicationId: `menu-publication:handoff:${suffix}`,
    sourcePublicationDayId: `menu-publication:handoff:${suffix}:day:0:v1`,
    sourceVersion: 1,
    sourceContentHash: "b".repeat(64),
    destinationOplocId: "oploc:haleon",
    destinationLabel: "Haleon",
    serviceDate: "2026-09-07",
    status: "published" as const,
    lines: [{ sourceLineId: `entry:${suffix}`, canonicalItemId: "dish:salad", itemName: "Mixed Leaf", quantity: 7, unit: "portion", workstream: "delivered_in" as const, approvedAllergenSnapshot: { allergens: { milk: "clear" }, sourcePublicationDayId: `menu-publication:handoff:${suffix}:day:0:v1`, sourceVersion: 1, sourceContentHash: "b".repeat(64) } }],
  };
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  try {
    const first = await materialiseExternalProductionOrder(actor, input);
    const replay = await materialiseExternalProductionOrder(actor, input);
    assert.equal(first.created, true);
    assert.equal(replay.duplicate, true);
    assert.equal(first.order.sourcePublicationId, input.publicationId);
    assert.equal(first.order.sourcePublicationDayId, input.sourcePublicationDayId);
    assert.match(first.order.idempotencyKey, new RegExp(`${input.sourceEntityId}.*${input.destinationOplocId}`));
    const event = (await listDomainEvents()).find(item => item.sourceAggregateId === first.order.canonicalId);
    assert.equal(event?.correlationId, first.order.idempotencyKey);
    assert.equal((event?.payload as { productionOrder?: { sourcePublicationId?: string } })?.productionOrder?.sourcePublicationId, input.publicationId);
  } finally {
    const orderId = materialisedProductionId(input);
    const eventId = `production.order.created:${orderId}:v1`;
    const [requirementsSnapshot, receiptsSnapshot] = await Promise.all([
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const batch = db.batch();
    batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)));
    batch.delete(db.collection("fikaDomainEventsV1").doc(eventId));
    for (const doc of requirementsSnapshot.docs) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) batch.delete(doc.ref);
    await batch.commit();
  }
});

test("emulator: same-content Menu republication advances only the active lineage pointer and rejects replay", { skip: !emulatorEnabled }, async () => {
  const suffix = `${Date.now()}:${process.pid}:pointer`;
  const publicationId = `menu-publication:${suffix}`;
  const sourceEntityId = `rolling-week:${suffix}:day:2`;
  const v5DayId = `${publicationId}:v5:day:2`;
  const v6DayId = `${publicationId}:v6:day:2`;
  const input = {
    sourceDomain: "menu-planning" as const, sourceEntityId, publicationId, sourcePublicationDayId: v5DayId,
    sourceVersion: 2, sourceContentHash: "d".repeat(64), destinationOplocId: "oploc:haleon",
    destinationLabel: "Haleon", serviceDate: "2026-11-10", status: "published" as const,
    lines: [{ sourceLineId: `entry:${suffix}`, canonicalItemId: "dish:salad", itemName: "Mixed Leaf",
      quantity: 7, unit: "portion", workstream: "delivered_in" as const,
      approvedAllergenSnapshot: { allergens: { milk: "contains", no_key_allergens: "unrecorded" },
        sourcePublicationDayId: v5DayId, sourceVersion: 2, sourceContentHash: "d".repeat(64) } }],
  };
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  const orderId = materialisedProductionId(input);
  const orderRef = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId));
  try {
    const initial = await materialiseExternalProductionOrder(actor, input);
    const advanced = await materialiseExternalProductionOrder(actor, { ...input, sourcePublicationDayId: v6DayId });
    assert.equal(advanced.created, false); assert.equal(advanced.duplicate, false);
    assert.equal(advanced.order.canonicalId, initial.order.canonicalId);
    assert.equal(advanced.order.version, initial.order.version + 1);
    assert.equal(advanced.order.currentRevision, initial.order.currentRevision + 1);
    assert.equal(advanced.order.sourcePublicationDayId, v6DayId);
    assert.equal(advanced.order.sourceVersion, 2); assert.equal(advanced.order.sourceContentHash, input.sourceContentHash);
    assert.equal(advanced.order.status, "menu_available");
    assert.deepEqual(advanced.order.lines, initial.order.lines);
    assert.deepEqual(advanced.order.exceptions, initial.order.exceptions);
    assert.equal(advanced.order.audit.at(-1)?.action, "menu-publication-pointer-advanced");
    assert.equal(advanced.order.audit.at(-1)?.previousState, v5DayId);
    assert.equal(advanced.order.audit.at(-1)?.newState, v6DayId);
    const event = (await db.collection("fikaDomainEventsV1").doc(`production.order.amended:${orderId}:v2`).get()).data();
    assert.equal(event?.payload?.productionOrder?.sourcePublicationDayId, v6DayId);
    const requirement = (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs[0]?.data();
    assert.equal(requirement?.sourceVersion, advanced.order.version);
    const logisticsEvent = (await db.collection("fikaLogisticsProjectionOutboxV1").where("sourceAggregateId", "==", requirement?.canonicalId).get()).docs.find(doc => doc.get("sourceVersion") === advanced.order.version);
    assert.ok(logisticsEvent);
    for (const replay of [input, { ...input, sourcePublicationDayId: v6DayId }]) {
      const result = await materialiseExternalProductionOrder(actor, replay);
      assert.equal(result.duplicate, true); assert.deepEqual(result.order, advanced.order);
    }
    const withdrawn = await materialiseExternalProductionOrder(actor, { ...input, sourcePublicationDayId: v6DayId, status: "withdrawn" });
    assert.equal(withdrawn.order.status, "cancelled");
    for (const dayId of [v5DayId, v6DayId]) {
      const replay = await materialiseExternalProductionOrder(actor, { ...input, sourcePublicationDayId: dayId });
      assert.equal(replay.duplicate, true); assert.deepEqual(replay.order, withdrawn.order);
    }
    assert.equal((await orderRef.get()).get("status"), "cancelled");
  } finally {
    const [requirements, receipts] = await Promise.all([
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const logisticsEvents = await Promise.all(requirements.docs.map(doc =>
      db.collection("fikaLogisticsProjectionOutboxV1").where("sourceAggregateId", "==", doc.get("canonicalId")).get()));
    const batch = db.batch(); batch.delete(orderRef);
    for (const [action, version] of [["created", 1], ["amended", 2], ["withdrawn", 3]] as const)
      batch.delete(db.collection("fikaDomainEventsV1").doc(`production.order.${action}:${orderId}:v${version}`));
    for (const doc of [...requirements.docs, ...receipts.docs, ...logisticsEvents.flatMap(snapshot => snapshot.docs)]) batch.delete(doc.ref);
    await batch.commit();
  }
});

test("emulator: Menu publication materialisation preserves all canonical No Key Allergens states on the CPU order", { skip: !emulatorEnabled }, async () => {
  const suffix = `${Date.now()}:${process.pid}:no-key`;
  const input = {
    sourceDomain: "menu-planning" as const,
    sourceEntityId: `rolling-week:${suffix}:day:0`,
    publicationId: `menu-publication:${suffix}`,
    sourcePublicationDayId: `menu-publication:${suffix}:day:0:v1`,
    sourceVersion: 1,
    sourceContentHash: "c".repeat(64),
    destinationOplocId: "oploc:haleon",
    destinationLabel: "Haleon",
    serviceDate: "2026-09-14",
    status: "published" as const,
    lines: ["contains", "clear", "unrecorded"].map((noKeyAllergens, index) => ({
      sourceLineId: `entry:${suffix}:${index + 1}`,
      canonicalItemId: `dish:no-key:${index + 1}`,
      itemName: `No Key Dish ${index + 1}`,
      quantity: 10,
      unit: "portion",
      workstream: "delivered_in" as const,
      approvedAllergenSnapshot: { allergens: { no_key_allergens: noKeyAllergens }, sourcePublicationDayId: `menu-publication:${suffix}:day:0:v1`, sourceVersion: 1, sourceContentHash: "c".repeat(64) },
    })),
  };
  const actor = { uid: "integration-test", name: "Integration Test", role: "integration-admin" as const, synthetic: true as const };
  try {
    const result = await materialiseExternalProductionOrder(actor, input);
    assert.deepEqual(result.order.lines.map(line => line.approvedAllergenSnapshot?.allergens.no_key_allergens), ["contains", "clear", "unrecorded"]);
  } finally {
    const orderId = materialisedProductionId(input);
    const [requirementsSnapshot, receiptsSnapshot] = await Promise.all([
      db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get(),
      db.collection("fikaDomainEventInboxV1").where("sourceAggregateId", "==", orderId).get(),
    ]);
    const batch = db.batch();
    batch.delete(db.collection("fikaProductionOrdersV1").doc(stableDocumentId(orderId)));
    batch.delete(db.collection("fikaDomainEventsV1").doc(`production.order.created:${orderId}:v1`));
    for (const doc of requirementsSnapshot.docs) batch.delete(doc.ref);
    for (const doc of receiptsSnapshot.docs) batch.delete(doc.ref);
    await batch.commit();
  }
});

test("production contracts keep customer and preparation quantities separate", async () => {
  const line: ProductionLine = { canonicalId: "line:1", sourceBookingLineId: "booking:1:line:1", itemName: "Platters", customerQuantity: 4, customerUnit: "platter", productionQuantity: 48, productionUnit: "portion", conversionSnapshot: { quantity: 48, unit: "portion", rule: "Explicit configured production conversion." }, dietaries: {}, status: "ready", sortOrder: 0 };
  assert.equal(line.customerQuantity, 4);
  assert.equal(line.productionQuantity, 48);
});

test("CPU delivery creation requires a canonical destination OPLOC", async () => {
  await assert.rejects(
    createCpuProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, {
      clientName: "Delivery",
      serviceDate: "2026-08-24",
      deliveryDateTime: "2026-08-24T09:00:00Z",
      requiredBy: "2026-08-24T09:00:00Z",
      serviceWindow: { startTime: "09:00" },
      deliveryLocation: "Unknown venue",
      serviceType: "Delivered-in",
      pax: 1,
      lines: [{ itemName: "Dish", customerQuantity: 1, customerUnit: "portion" }],
    }, "cpu-destination-test"),
    (error: any) => error.status === 422 && /canonical destination OPLOC/i.test(error.message),
  );
});

test("emulator: explicitly internal CPU production creates no Fulfilment work on create or transition", { skip: !emulatorEnabled }, async () => {
  const idempotencyKey = `cpu-internal-test:${Date.now()}`;
  const result = await createCpuProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, {
    clientName: "Internal prep",
    serviceDate: "2026-08-24",
    deliveryDateTime: "2026-08-24T09:00:00Z",
    requiredBy: "2026-08-24T09:00:00Z",
    serviceWindow: { startTime: "09:00" },
    requiresDelivery: false,
    destinationOplocId: CPU_SITE_OPLOC_ID,
    deliveryLocation: "CPU internal",
    serviceType: "Internal production",
    pax: 1,
    lines: [{ itemName: "Internal dish", customerQuantity: 1, customerUnit: "portion" }],
  }, idempotencyKey);
  assert.equal(result.order.requiresDelivery, false);
  const receiptsBefore = await db.collection("fikaDomainEventInboxV1").get();
  assert.equal(receiptsBefore.docs.some(doc => doc.data().sourceAggregateId === result.order.canonicalId), false);
  const next = await transitionProductionOrder({ uid: "test", name: "Test", role: "integration-admin", synthetic: true }, result.order.canonicalId, result.order.version, "needs_review", "Review internal work.");
  assert.equal(next.requiresDelivery, false);
  const receiptsAfter = await db.collection("fikaDomainEventInboxV1").get();
  assert.equal(receiptsAfter.docs.some(doc => doc.data().sourceAggregateId === result.order.canonicalId), false);
});

test("legacy requiresDelivery false cannot suppress an external Production Order", () => {
  assert.equal(productionOrderRequiresFulfilment({ requiresDelivery: false, destinationOplocId: "oploc:haleon" }), true);
  assert.equal(productionOrderRequiresFulfilment({ requiresDelivery: false, destinationOplocId: CPU_SITE_OPLOC_ID }), false);
});
