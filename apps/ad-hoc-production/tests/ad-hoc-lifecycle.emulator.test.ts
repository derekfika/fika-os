import assert from "node:assert/strict";
import test from "node:test";
import { db } from "@hub/lib/firebase-admin";
import { adHocProductionOrderId, createCpuProductionOrder, productionOrderDetail, transitionProductionOrder } from "@hub/lib/production-domain";
import { cancelRequest, createRequest, getRequest, sendToCpu, updateRequest } from "../lib/ad-hoc-service";
import { blankDraft, toProductionInput, type AdHocDraft } from "../lib/ad-hoc-domain";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const actor = { uid: "adhoc-lifecycle-test", name: "Ad-Hoc test", role: "integration-admin" as const, synthetic: true };
const serviceDate = "2099-02-02";
const oneOff = (name: string): AdHocDraft => ({
  ...blankDraft(serviceDate), eventName: name, guestCount: 12, destination: { mode: "one_off", label: "Client residence", address: "1 Test Street, London", identity: "x" },
  lines: [{ id: "line:1", description: "Buffet", quantity: 12, unit: "portions", sortOrder: 0 }],
});
const requirementsFor = async (orderId: string) => (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs.map(doc => doc.data());

test("emulator: concurrent double send creates one order, one requirement and ends Sent", { skip: !emulatorEnabled }, async () => {
  const draft = await createRequest(oneOff("Concurrent send"), actor);
  const results = await Promise.allSettled([sendToCpu(draft.id, draft.version, actor), sendToCpu(draft.id, draft.version, actor), sendToCpu(draft.id, draft.version, actor)]);
  assert.ok(results.some(result => result.status === "fulfilled"), "at least one send succeeds");
  const stored = (await getRequest(draft.id))!;
  assert.equal(stored.status, "SENT_TO_CPU", "a duplicate send must not flip the request to Needs update");
  assert.equal(stored.sentVersion, draft.version);
  assert.equal((await requirementsFor(stored.productionOrderId!)).length, 1);
  assert.equal(stored.audit.filter(entry => entry.action === "sent-to-cpu").length, 1, "the send is recorded once");
});

test("emulator: a committed Hub order whose result was never recorded is adopted, not duplicated, even after an edit", { skip: !emulatorEnabled }, async () => {
  const draft = await createRequest(oneOff("Lost write"), actor);
  // Simulate a crash after the Hub commit and before the request was updated.
  const hubOrder = (await createCpuProductionOrder(actor, toProductionInput(draft), `adhoc-send:${draft.id}:v${draft.version}`)).order;
  assert.equal(hubOrder.canonicalId, adHocProductionOrderId(draft.id));
  assert.equal((await getRequest(draft.id))?.productionOrderId, undefined, "the request never learned about the order");
  // The requester edits (new version, new idempotency key) and sends again.
  const edited = await updateRequest(draft.id, draft.version, { ...oneOff("Lost write"), serviceDate, lines: [{ id: "line:1", description: "Buffet", quantity: 30, unit: "portions", sortOrder: 0 }] }, actor);
  const sent = await sendToCpu(draft.id, edited.version, actor);
  assert.equal(sent.request.productionOrderId, hubOrder.canonicalId, "adopts the existing canonical order");
  const requirements = await requirementsFor(hubOrder.canonicalId);
  assert.equal(requirements.length, 1, "no second Logistics requirement");
  assert.equal(requirements[0].lines[0].quantity, 30, "the order carries the latest request version");
  assert.equal(sent.request.status, "SENT_TO_CPU");
});

test("emulator: a cancelled request cannot be re-sent and the Hub order stays withdrawn", { skip: !emulatorEnabled }, async () => {
  const sent = (await sendToCpu((await createRequest(oneOff("No resurrection"), actor)).id, 1, actor)).request;
  const cancelled = await cancelRequest(sent.id, sent.version, "Client cancelled", actor);
  await assert.rejects(sendToCpu(sent.id, cancelled.version, actor), (error: any) => error.status === 409);
  assert.equal((await requirementsFor(sent.productionOrderId!))[0].status, "withdrawn");
});

test("emulator: cancel retried after the Hub withdrawal but before the request update converges", { skip: !emulatorEnabled }, async () => {
  const sent = (await sendToCpu((await createRequest(oneOff("Cancel retry"), actor)).id, 1, actor)).request;
  const order = (await productionOrderDetail(sent.productionOrderId!))!;
  await transitionProductionOrder(actor, order.canonicalId, order.version, "cancelled", "Simulated: Hub withdrawn, request not yet updated.");
  const retried = await cancelRequest(sent.id, sent.version, "Client cancelled", actor);
  assert.equal(retried.status, "CANCELLED");
  assert.equal((await requirementsFor(sent.productionOrderId!))[0].status, "withdrawn");
});

test("emulator: an amendment refused by CPU leaves the request Needs update and the order untouched", { skip: !emulatorEnabled }, async () => {
  const sent = (await sendToCpu((await createRequest(oneOff("CPU started"), actor)).id, 1, actor)).request;
  let order = (await productionOrderDetail(sent.productionOrderId!))!;
  for (const status of ["needs_review", "accepted", "scheduled", "in_production"] as const) order = await transitionProductionOrder(actor, order.canonicalId, order.version, status, "CPU progress.") as typeof order;
  const edited = await updateRequest(sent.id, sent.version, { ...oneOff("CPU started"), serviceDate, guestCount: 99 }, actor);
  assert.equal(edited.status, "NEEDS_UPDATE");
  await assert.rejects(sendToCpu(sent.id, edited.version, actor), (error: any) => /Contact CPU/.test(error.message));
  assert.equal((await getRequest(sent.id))!.status, "NEEDS_UPDATE");
  assert.equal((await productionOrderDetail(sent.productionOrderId!))!.version, order.version, "order untouched");
});
