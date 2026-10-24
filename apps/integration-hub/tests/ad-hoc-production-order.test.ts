import assert from "node:assert/strict";
import test from "node:test";
import { adHocOrderStatus, adHocProductionOrderId, amendAdHocProductionOrder, cancelAdHocProductionOrder, createCpuProductionOrder, submitAdHocProductionOrder, transitionProductionOrder, type CpuCreatedProductionInput } from "../lib/production-domain";
import { db } from "../lib/firebase-admin";
import { stableDocumentId } from "../lib/canonical-editor";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const actor = { uid: "adhoc-test", name: "Ad-Hoc test", role: "integration-admin" as const, synthetic: true };

const input = (requestId: string, version: number, overrides: Partial<CpuCreatedProductionInput> = {}): CpuCreatedProductionInput => ({
  clientName: "Board lunch", productionCategory: "hospitality", serviceDate: "2026-11-02", deliveryDateTime: "2026-11-02T12:00", requiredBy: "2026-11-02T12:00", serviceWindow: { startTime: "12:00" },
  destinationOplocId: `adhoc-destination:${requestId}`, requiresDelivery: true, deliveryLocation: "Client residence", destinationAddress: { identity: `adhoc-destination:${requestId}`, label: "Client residence", address: "1 Test Street" },
  serviceType: "Ad-hoc · Board meeting catering", pax: 20, sourceReference: "REQ-2026-001", sourceEntityId: requestId, sourceVersion: version,
  lines: [{ sourceLineId: "line:a", itemName: "Sandwich platters", customerQuantity: 5, customerUnit: "platters", productionQuantity: 5, productionUnit: "platters" }, { sourceLineId: "line:b", itemName: "Fruit", customerQuantity: 2, customerUnit: "platters", productionQuantity: 2, productionUnit: "platters" }],
  ...overrides,
});
const requirementsFor = async (orderId: string) => (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs.map(doc => doc.data());

test("emulator: Ad-Hoc first send is idempotent and uses a request-scoped one-off destination", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const first = await createCpuProductionOrder(actor, input(requestId, 1), `adhoc-send:${requestId}:v1`);
  const replay = await createCpuProductionOrder(actor, input(requestId, 1), `adhoc-send:${requestId}:v1`);
  assert.equal(first.created, true);
  assert.equal(replay.created, false);
  assert.equal(replay.order.canonicalId, first.order.canonicalId);
  assert.equal(first.order.destinationOplocId, `adhoc-destination:${requestId}`);
  assert.equal(first.order.destinationAddress?.address, "1 Test Street");
  assert.equal(first.order.lines[0].allergenEvidenceStatus, undefined, "no allergen evidence is invented by the requester");
  assert.equal((await requirementsFor(first.order.canonicalId)).length, 1, "exactly one Logistics requirement");
});

test("emulator: an Ad-Hoc amendment revises the same order and requirement, and replay is a no-op", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const created = (await createCpuProductionOrder(actor, input(requestId, 1), `adhoc-send:${requestId}:v1`)).order;
  // CPU records allergen evidence on line A only.
  const ref = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(created.canonicalId));
  const reviewed = { ...created, lines: created.lines.map((line, index) => index === 0 ? { ...line, dietaries: { gluten: "contains" }, allergenEvidenceStatus: "confirmed" as const } : line) };
  await ref.set(reviewed);

  const amended = input(requestId, 3, { lines: [
    { sourceLineId: "line:a", itemName: "Sandwich platters", customerQuantity: 8, customerUnit: "platters", productionQuantity: 8, productionUnit: "platters" },
    { sourceLineId: "line:b", itemName: "Seasonal fruit", customerQuantity: 2, customerUnit: "platters", productionQuantity: 2, productionUnit: "platters" },
  ] });
  const result = await amendAdHocProductionOrder(actor, created.canonicalId, amended, `adhoc-send:${requestId}:v3`);
  assert.equal(result.status, "amended");
  assert.equal(result.order.canonicalId, created.canonicalId);
  assert.equal(result.order.version, created.version + 1);
  assert.equal(result.order.lines[0].customerQuantity, 8);
  assert.equal(result.order.lines[0].allergenEvidenceStatus, "confirmed", "unchanged item keeps its CPU allergen evidence");
  assert.equal(result.order.lines[1].allergenEvidenceStatus, undefined, "a renamed item returns to allergen review");

  const requirements = await requirementsFor(created.canonicalId);
  assert.equal(requirements.length, 1, "no duplicate Logistics requirement after a revision");
  assert.equal(requirements[0].sourceVersion, result.order.version);

  const replay = await amendAdHocProductionOrder(actor, created.canonicalId, amended, `adhoc-send:${requestId}:v3`);
  assert.equal(replay.status, "already_applied");
  assert.equal(replay.order.version, result.order.version);
});

test("emulator: an Ad-Hoc amendment is refused once CPU has started production", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const created = (await createCpuProductionOrder(actor, input(requestId, 1), `adhoc-send:${requestId}:v1`)).order;
  const accepted = await transitionProductionOrder(actor, created.canonicalId, created.version, "needs_review", "Review.");
  const inProduction = await transitionProductionOrder(actor, created.canonicalId, accepted.version, "accepted", "Accept.");
  await transitionProductionOrder(actor, created.canonicalId, inProduction.version, "scheduled", "Schedule.");
  const next = await transitionProductionOrder(actor, created.canonicalId, inProduction.version + 1, "in_production", "Start.");
  assert.equal(next.status, "in_production");
  await assert.rejects(amendAdHocProductionOrder(actor, created.canonicalId, input(requestId, 5), `adhoc-send:${requestId}:v5`), (error: any) => /already moved this order to in_production/.test(error.message));
});

test("emulator: cancelling an Ad-Hoc order withdraws its Logistics requirement", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const created = (await createCpuProductionOrder(actor, input(requestId, 1), `adhoc-send:${requestId}:v1`)).order;
  await transitionProductionOrder(actor, created.canonicalId, created.version, "cancelled", "Ad-Hoc request cancelled.");
  const [requirement] = await requirementsFor(created.canonicalId);
  assert.equal(requirement.status, "withdrawn");
});

test("amendment rejects a different request's order and requires a source version", async () => {
  await assert.rejects(amendAdHocProductionOrder(actor, "production-order:v1:ad-hoc:x:v1", { ...input("x", 2), sourceEntityId: undefined }, "key"), (error: any) => /source request and version/.test(error.message));
  await assert.rejects(amendAdHocProductionOrder(actor, "production-order:v1:ad-hoc:x:v1", input("x", 2), " "), (error: any) => /idempotency key/i.test(error.message));
});

test("emulator: a stable-identity Ad-Hoc order has one canonical id across request versions", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const created = (await createCpuProductionOrder(actor, { ...input(requestId, 1), stableSourceIdentity: true }, `adhoc-send:${requestId}:v1`)).order;
  assert.equal(created.canonicalId, adHocProductionOrderId(requestId));
  // A different version and key against the same request cannot create a second order.
  await assert.rejects(createCpuProductionOrder(actor, { ...input(requestId, 2), stableSourceIdentity: true }, `adhoc-send:${requestId}:v2`));
  assert.equal((await requirementsFor(created.canonicalId)).length, 1);
});

test("emulator: Ad-Hoc orders stay outside the signed Delivered-In release chain and quantity-only amendments keep line evidence", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const created = (await createCpuProductionOrder(actor, { ...input(requestId, 1), stableSourceIdentity: true }, `adhoc-send:${requestId}:v1`)).order;
  // Signed releases, master review and packets only select origin "menu_planning" orders keyed by menu items.
  assert.equal(created.origin, "cpu_created");
  assert.ok(created.lines.every(line => !line.sourceMenuItemId && !line.sourceOfferingId));
  const ref = db.collection("fikaProductionOrdersV1").doc(stableDocumentId(created.canonicalId));
  await ref.set({ ...created, lines: created.lines.map(line => ({ ...line, dietaries: { gluten: "contains" }, approvedAllergenSnapshot: { allergens: { gluten: "contains" } }, allergenEvidenceStatus: "confirmed" as const })) });
  const quantityOnly = await amendAdHocProductionOrder(actor, created.canonicalId, input(requestId, 2, { lines: input(requestId, 2).lines.map(line => ({ ...line, customerQuantity: line.customerQuantity + 1, productionQuantity: (line.productionQuantity || 0) + 1 })) }), `adhoc-send:${requestId}:v2`);
  assert.ok(quantityOnly.order.lines.every(line => line.allergenEvidenceStatus === "confirmed" && line.approvedAllergenSnapshot?.allergens.gluten === "contains"), "an unchanged item keeps its CPU evidence");
  const renamed = await amendAdHocProductionOrder(actor, created.canonicalId, input(requestId, 3, { lines: input(requestId, 3).lines.map(line => ({ ...line, itemName: `${line.itemName} (new recipe)` })) }), `adhoc-send:${requestId}:v3`);
  assert.ok(renamed.order.lines.every(line => line.allergenEvidenceStatus === undefined && !line.approvedAllergenSnapshot && Object.keys(line.dietaries).length === 0), "a changed item returns to allergen review with no stale evidence");
  assert.equal(renamed.order.status, "draft");
});

const stable = (requestId: string, version: number, overrides: Partial<CpuCreatedProductionInput> = {}) => ({ ...input(requestId, version, overrides), stableSourceIdentity: true as const });

test("emulator: submit creates once, replays idempotently and amends the same order", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const first = await submitAdHocProductionOrder(actor, stable(requestId, 1), `adhoc-send:${requestId}:v1`);
  assert.equal(first.outcome, "created");
  assert.equal(first.canonicalId, adHocProductionOrderId(requestId));
  assert.equal((await submitAdHocProductionOrder(actor, stable(requestId, 1), `adhoc-send:${requestId}:v1`)).outcome, "already_applied");
  const amended = await submitAdHocProductionOrder(actor, stable(requestId, 2), `adhoc-send:${requestId}:v2`);
  assert.equal(amended.outcome, "amended");
  assert.equal(amended.canonicalId, first.canonicalId);
  assert.equal(amended.orderVersion, first.orderVersion + 1);
  assert.equal((await requirementsFor(first.canonicalId)).length, 1, "one Logistics requirement across versions");
  assert.deepEqual(await adHocOrderStatus(requestId), { canonicalId: first.canonicalId, orderStatus: "draft", orderVersion: amended.orderVersion, cancelled: false });
});

test("emulator: concurrent submissions, including different versions, converge on one order and one requirement", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const results = await Promise.allSettled([1, 1, 1, 2].map(version => submitAdHocProductionOrder(actor, stable(requestId, version), `adhoc-send:${requestId}:v${version}`)));
  assert.ok(results.some(result => result.status === "fulfilled"));
  for (const result of results) if (result.status === "rejected") assert.doesNotMatch((result.reason as Error).message, /not found/i);
  const ids = new Set(results.flatMap(result => result.status === "fulfilled" ? [result.value.canonicalId] : []));
  assert.deepEqual([...ids], [adHocProductionOrderId(requestId)]);
  assert.equal((await requirementsFor(adHocProductionOrderId(requestId))).length, 1);
  const settled = await submitAdHocProductionOrder(actor, stable(requestId, 3), `adhoc-send:${requestId}:v3`);
  assert.ok(["created", "amended"].includes(settled.outcome));
});

test("emulator: cancel withdraws the requirement, is repeat-safe, and a missing order is a 404", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  await assert.rejects(cancelAdHocProductionOrder(actor, requestId, "x"), (error: any) => error.status === 404 && error.code === "AD_HOC_ORDER_NOT_FOUND");
  await submitAdHocProductionOrder(actor, stable(requestId, 1), `adhoc-send:${requestId}:v1`);
  const first = await cancelAdHocProductionOrder(actor, requestId, "Client cancelled");
  assert.equal(first.outcome, "cancelled");
  assert.equal((await cancelAdHocProductionOrder(actor, requestId, "again")).outcome, "already_cancelled");
  assert.equal((await requirementsFor(first.canonicalId))[0].status, "withdrawn");
  assert.equal((await adHocOrderStatus(requestId))?.cancelled, true);
  await assert.rejects(submitAdHocProductionOrder(actor, stable(requestId, 2), `adhoc-send:${requestId}:v2`), (error: any) => /Contact CPU/.test(error.message), "a cancelled order is never resurrected");
});

test("emulator: a first send adopts an order whose result the caller never recorded, even for a later version", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  await submitAdHocProductionOrder(actor, stable(requestId, 1), `adhoc-send:${requestId}:v1`);
  const later = await submitAdHocProductionOrder(actor, stable(requestId, 4, { lines: input(requestId, 4).lines.map(line => ({ ...line, customerQuantity: 9, productionQuantity: 9 })) }), `adhoc-send:${requestId}:v4`);
  assert.equal(later.outcome, "amended");
  assert.equal((await requirementsFor(later.canonicalId)).length, 1);
  assert.equal((await requirementsFor(later.canonicalId))[0].lines[0].quantity, 9);
});

test("emulator: cancelling an order CPU already cancelled is a repeat-safe success", { skip: !emulatorEnabled }, async () => {
  const requestId = `adhoc-request:${crypto.randomUUID()}`;
  const order = await submitAdHocProductionOrder(actor, stable(requestId, 1), `adhoc-send:${requestId}:v1`);
  await transitionProductionOrder(actor, order.canonicalId, order.orderVersion, "cancelled", "CPU cancelled.");
  assert.equal((await adHocOrderStatus(requestId))?.cancelled, true);
  assert.equal((await cancelAdHocProductionOrder(actor, requestId, "Recording CPU cancellation")).outcome, "already_cancelled");
});
