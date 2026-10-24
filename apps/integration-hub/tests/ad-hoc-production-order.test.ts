import assert from "node:assert/strict";
import test from "node:test";
import { adHocProductionOrderId, amendAdHocProductionOrder, createCpuProductionOrder, transitionProductionOrder, type CpuCreatedProductionInput } from "../lib/production-domain";
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
