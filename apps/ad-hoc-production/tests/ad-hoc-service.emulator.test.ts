import assert from "node:assert/strict";
import test from "node:test";
import { db } from "@hub/lib/firebase-admin";
import { archiveRequest, cancelRequest, createRequest, duplicateRequest, getRequest, listRequests, sendToCpu, updateRequest } from "../lib/ad-hoc-service";
import { blankDraft, type AdHocDraft } from "../lib/ad-hoc-domain";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const actor = { uid: "adhoc-service-test", name: "Ad-Hoc test", role: "integration-admin" as const, synthetic: true };
const serviceDate = "2099-01-05";
const oneOff = (name: string): AdHocDraft => ({
  ...blankDraft(serviceDate), eventName: name, guestCount: 12, destination: { mode: "one_off", label: "Client residence", address: "1 Test Street, London", contactName: "A", identity: "ignored-by-server" },
  lines: [{ id: "line:1", description: "Buffet", quantity: 12, unit: "portions", sortOrder: 0 }, { id: "line:2", description: "Drinks", quantity: 2, unit: "boxes", sortOrder: 1 }],
});
const requirementsFor = async (orderId: string) => (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs.map(doc => doc.data());

test("emulator: draft create, edit and optimistic concurrency", { skip: !emulatorEnabled }, async () => {
  const created = await createRequest(oneOff("Draft test"), actor);
  assert.equal(created.status, "DRAFT");
  assert.match(created.reference, /^REQ-\d{4}-\d{3,}$/);
  assert.equal(created.destination.identity, `adhoc-destination:${created.id}`, "one-off identity is request-scoped and server-assigned");
  const edited = await updateRequest(created.id, created.version, { ...oneOff("Draft test edited"), serviceDate }, actor);
  assert.equal(edited.version, 2);
  assert.equal(edited.eventName, "Draft test edited");
  await assert.rejects(updateRequest(created.id, created.version, oneOff("Stale"), actor), (error: any) => error.status === 409);
  assert.ok((await listRequests("2099-01-01", 14)).some(item => item.id === created.id));
});

test("emulator: send is idempotent, edits flag Needs update, and an update revises the same order", { skip: !emulatorEnabled }, async () => {
  const draft = await createRequest(oneOff("Send test"), actor);
  const first = await sendToCpu(draft.id, draft.version, actor);
  assert.equal(first.sent, true);
  assert.equal(first.request.status, "SENT_TO_CPU");
  const orderId = first.request.productionOrderId!;
  assert.ok(orderId);
  // A double click / retry of the same version converges: no second send, no second order.
  const replay = await sendToCpu(draft.id, first.request.version, actor);
  assert.equal(replay.sent, false);
  assert.equal(replay.request.productionOrderId, orderId);
  assert.equal((await requirementsFor(orderId)).length, 1);

  const edited = await updateRequest(draft.id, first.request.version, { ...oneOff("Send test"), serviceDate, guestCount: 15, lines: [{ id: "line:1", description: "Buffet", quantity: 15, unit: "portions", sortOrder: 0 }] }, actor);
  assert.equal(edited.status, "NEEDS_UPDATE");
  assert.equal(edited.productionOrderId, orderId, "the link to the canonical order is preserved");
  const updated = await sendToCpu(draft.id, edited.version, actor);
  assert.equal(updated.request.status, "SENT_TO_CPU");
  assert.equal(updated.request.productionOrderId, orderId, "revision amends the same Production Order");
  const requirements = await requirementsFor(orderId);
  assert.equal(requirements.length, 1, "no duplicate fulfilment job after a revision");
  assert.equal(requirements[0].lines.length, 1);
});

test("emulator: an incomplete request cannot be sent and nothing reaches the Hub", { skip: !emulatorEnabled }, async () => {
  const draft = await createRequest({ ...oneOff("Incomplete"), destination: { mode: "one_off", label: "", address: "", identity: "" } }, actor);
  await assert.rejects(sendToCpu(draft.id, draft.version, actor), (error: any) => error.status === 422 && /Destination provided/.test(error.message));
  assert.equal((await getRequest(draft.id))?.productionOrderId, undefined);
});

test("emulator: archive applies to drafts only; cancel applies to sent requests and withdraws logistics work", { skip: !emulatorEnabled }, async () => {
  const draft = await createRequest(oneOff("Archive test"), actor);
  const archived = await archiveRequest(draft.id, draft.version, actor);
  assert.ok(archived.archivedAt);
  await assert.rejects(updateRequest(draft.id, archived.version, oneOff("Edit archived"), actor), (error: any) => error.status === 409);
  await assert.rejects(cancelRequest(draft.id, archived.version, "no", actor), (error: any) => error.status === 409);

  const sent = (await sendToCpu((await createRequest(oneOff("Cancel test"), actor)).id, 1, actor)).request;
  await assert.rejects(archiveRequest(sent.id, sent.version, actor), (error: any) => error.status === 409);
  await assert.rejects(cancelRequest(sent.id, sent.version, "  ", actor), (error: any) => error.status === 422);
  const cancelled = await cancelRequest(sent.id, sent.version, "Client cancelled", actor);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal((await requirementsFor(sent.productionOrderId!))[0].status, "withdrawn");
  assert.equal((await cancelRequest(sent.id, cancelled.version, "again", actor)).status, "CANCELLED", "repeat cancel is a no-op");
  assert.equal(cancelled.audit.at(-1)?.action, "request-cancelled", "history is retained");
});

test("emulator: duplicate creates an independent draft with new line ids and no downstream link", { skip: !emulatorEnabled }, async () => {
  const sent = (await sendToCpu((await createRequest(oneOff("Duplicate source"), actor)).id, 1, actor)).request;
  const copy = await duplicateRequest(sent.id, actor);
  assert.notEqual(copy.id, sent.id);
  assert.equal(copy.status, "DRAFT");
  assert.equal(copy.productionOrderId, undefined);
  assert.equal(copy.duplicatedFrom, sent.reference);
  assert.notEqual(copy.destination.identity, sent.destination.identity);
  assert.ok(copy.lines.every((line, index) => line.id !== sent.lines[index].id));
});
