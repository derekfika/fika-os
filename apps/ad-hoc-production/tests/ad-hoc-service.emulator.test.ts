import assert from "node:assert/strict";
import test from "node:test";
import { archiveRequest, cancelRequest, createRequest, downstreamState, duplicateRequest, getRequest, listRequests, sendToCpu, updateRequest } from "../lib/ad-hoc-service";
import { blankDraft, type AdHocDraft } from "../lib/ad-hoc-domain";
import { FakeHub } from "./support/fake-hub";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const actor = { uid: "adhoc-service-test", name: "Ad-Hoc test" };
const serviceDate = "2099-01-05";
const oneOff = (name: string): AdHocDraft => ({
  ...blankDraft(serviceDate), eventName: name, guestCount: 12, destination: { mode: "one_off", label: "Client residence", address: "1 Test Street, London", contactName: "A", identity: "ignored-by-server" },
  lines: [{ id: "line:1", description: "Buffet", quantity: 12, unit: "portions", sortOrder: 0 }, { id: "line:2", description: "Drinks", quantity: 2, unit: "boxes", sortOrder: 1 }],
});
const edited = (name: string, quantity: number): AdHocDraft => ({ ...oneOff(name), serviceDate, lines: [{ id: "line:1", description: "Buffet", quantity, unit: "portions", sortOrder: 0 }] });

test("emulator: draft create, edit and optimistic concurrency", { skip: !emulatorEnabled }, async () => {
  const created = await createRequest(oneOff("Draft test"), actor);
  assert.equal(created.status, "DRAFT");
  assert.match(created.reference, /^REQ-\d{4}-\d{3,}$/);
  assert.equal(created.destination.identity, `adhoc-destination:${created.id}`, "one-off identity is request-scoped and server-assigned");
  const next = await updateRequest(created.id, created.version, { ...oneOff("Draft test edited"), serviceDate }, actor);
  assert.equal(next.version, 2);
  await assert.rejects(updateRequest(created.id, created.version, oneOff("Stale"), actor), (error: any) => error.status === 409);
  assert.ok((await listRequests("2099-01-01", 14)).some(item => item.id === created.id));
});

test("emulator: send is idempotent, edits flag Needs update, and an update revises the same order", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const draft = await createRequest(oneOff("Send test"), actor);
  const first = await sendToCpu(draft.id, draft.version, actor, hub);
  assert.equal(first.sent, true);
  assert.equal(first.request.status, "SENT_TO_CPU");
  const replay = await sendToCpu(draft.id, first.request.version, actor, hub);
  assert.equal(replay.sent, false, "a repeat of the same version never reaches the Hub");
  assert.equal(hub.calls.filter(call => call.op === "send").length, 1);
  const changed = await updateRequest(draft.id, first.request.version, edited("Send test", 15), actor);
  assert.equal(changed.status, "NEEDS_UPDATE");
  const updated = await sendToCpu(draft.id, changed.version, actor, hub);
  assert.equal(updated.request.status, "SENT_TO_CPU");
  assert.equal(hub.orders.size, 1, "a revision amends the same Production Order");
  assert.equal(hub.orders.get(draft.id)!.quantity, 15);
});

test("emulator: an incomplete request is never sent and nothing reaches the Hub", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const draft = await createRequest({ ...oneOff("Incomplete"), destination: { mode: "one_off", label: "", address: "", identity: "" } }, actor);
  await assert.rejects(sendToCpu(draft.id, draft.version, actor, hub), (error: any) => error.status === 422 && /Destination provided/.test(error.message));
  assert.equal(hub.calls.filter(call => call.op === "send").length, 0);
});

test("emulator: concurrent double send reaches one order and ends Sent, recorded once", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub().slow();
  const draft = await createRequest(oneOff("Concurrent send"), actor);
  const results = await Promise.allSettled([1, 2, 3].map(() => sendToCpu(draft.id, draft.version, actor, hub)));
  assert.ok(results.some(result => result.status === "fulfilled"));
  const stored = (await getRequest(draft.id))!;
  assert.equal(stored.status, "SENT_TO_CPU", "a duplicate send must not flip the request to Needs update");
  assert.equal(hub.orders.size, 1);
  assert.equal(stored.audit.filter(entry => entry.action === "sent-to-cpu").length, 1);
});

test("emulator: a lost Hub response never marks the request sent, and a retry converges on one order", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub().failNext("send", "after");
  const draft = await createRequest(oneOff("Lost response"), actor);
  await assert.rejects(sendToCpu(draft.id, draft.version, actor, hub), (error: any) => /did not confirm/.test(error.message));
  const unchanged = (await getRequest(draft.id))!;
  assert.equal(unchanged.status, "DRAFT", "the request does not claim a send the Hub never confirmed");
  assert.equal(unchanged.version, draft.version);
  assert.equal(hub.orders.size, 1, "the Hub did commit");
  // The requester edits before retrying: still one order, carrying the latest content.
  const changed = await updateRequest(draft.id, draft.version, edited("Lost response", 30), actor);
  const sent = await sendToCpu(draft.id, changed.version, actor, hub);
  assert.equal(sent.request.status, "SENT_TO_CPU");
  assert.equal(hub.orders.size, 1);
  assert.equal(hub.orders.get(draft.id)!.quantity, 30);
});

test("emulator: a failure before the Hub change leaves the request untouched and retryable", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub().failNext("send", "before");
  const draft = await createRequest(oneOff("Hub down"), actor);
  await assert.rejects(sendToCpu(draft.id, draft.version, actor, hub));
  assert.equal(hub.orders.size, 0);
  assert.equal((await getRequest(draft.id))!.version, draft.version);
  assert.equal((await sendToCpu(draft.id, draft.version, actor, hub)).request.status, "SENT_TO_CPU");
});

test("emulator: an amendment refused because CPU started leaves the request Needs update", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const sent = (await sendToCpu((await createRequest(oneOff("CPU started"), actor)).id, 1, actor, hub)).request;
  hub.cpuStart(sent.id);
  const changed = await updateRequest(sent.id, sent.version, edited("CPU started", 99), actor);
  await assert.rejects(sendToCpu(sent.id, changed.version, actor, hub), (error: any) => /Contact CPU/.test(error.message));
  assert.equal((await getRequest(sent.id))!.status, "NEEDS_UPDATE");
  assert.equal(hub.orders.get(sent.id)!.quantity, 12, "order untouched");
});

test("emulator: archive applies to drafts only; cancel applies to sent requests and goes through the Hub", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const draft = await createRequest(oneOff("Archive test"), actor);
  const archived = await archiveRequest(draft.id, draft.version, actor);
  assert.ok(archived.archivedAt);
  await assert.rejects(updateRequest(draft.id, archived.version, oneOff("Edit archived"), actor), (error: any) => error.status === 409);
  await assert.rejects(cancelRequest(draft.id, archived.version, "no", actor, hub), (error: any) => error.status === 409);

  const sent = (await sendToCpu((await createRequest(oneOff("Cancel test"), actor)).id, 1, actor, hub)).request;
  await assert.rejects(archiveRequest(sent.id, sent.version, actor), (error: any) => error.status === 409);
  await assert.rejects(cancelRequest(sent.id, sent.version, "  ", actor, hub), (error: any) => error.status === 422);
  const cancelled = await cancelRequest(sent.id, sent.version, "Client cancelled", actor, hub);
  assert.equal(cancelled.status, "CANCELLED");
  assert.equal(hub.orders.get(sent.id)!.status, "cancelled");
  assert.equal((await cancelRequest(sent.id, cancelled.version, "again", actor, hub)).status, "CANCELLED", "repeat cancel is a no-op");
  assert.equal(cancelled.audit.at(-1)?.action, "request-cancelled", "history is retained");
  await assert.rejects(sendToCpu(sent.id, cancelled.version, actor, hub), (error: any) => error.status === 409, "a cancelled request cannot be resurrected");
});

test("emulator: a lost cancel response does not mark the request cancelled; the retry converges", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const sent = (await sendToCpu((await createRequest(oneOff("Cancel retry"), actor)).id, 1, actor, hub)).request;
  hub.failNext("cancel", "after");
  await assert.rejects(cancelRequest(sent.id, sent.version, "Client cancelled", actor, hub));
  assert.equal((await getRequest(sent.id))!.status, "SENT_TO_CPU", "not reported complete without confirmation");
  assert.equal(hub.orders.get(sent.id)!.status, "cancelled", "the Hub did cancel");
  assert.equal((await cancelRequest(sent.id, sent.version, "Client cancelled", actor, hub)).status, "CANCELLED");
});

test("emulator: a CPU-originated cancellation is visible on demand without rewriting the request", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const sent = (await sendToCpu((await createRequest(oneOff("CPU cancels"), actor)).id, 1, actor, hub)).request;
  assert.deepEqual(await downstreamState(sent, hub), { status: "draft", cancelled: false });
  hub.cpuCancel(sent.id);
  assert.deepEqual(await downstreamState(sent, hub), { status: "cancelled", cancelled: true });
  const stored = (await getRequest(sent.id))!;
  assert.equal(stored.version, sent.version, "reading downstream state writes nothing");
  assert.equal(stored.status, "SENT_TO_CPU");
  assert.equal((await cancelRequest(sent.id, sent.version, "CPU cancelled", actor, hub)).status, "CANCELLED");
  assert.equal(await downstreamState((await getRequest(sent.id))!, hub), null, "cancelled requests are not queried");
  assert.equal(await downstreamState(sent, new FakeHub().failNext("status", "before")), null, "an unavailable Hub never breaks opening a request");
});

test("emulator: duplicate creates an independent draft with new line ids and no downstream link", { skip: !emulatorEnabled }, async () => {
  const hub = new FakeHub();
  const sent = (await sendToCpu((await createRequest(oneOff("Duplicate source"), actor)).id, 1, actor, hub)).request;
  const copy = await duplicateRequest(sent.id, actor);
  assert.notEqual(copy.id, sent.id);
  assert.equal(copy.status, "DRAFT");
  assert.equal(copy.productionOrderId, undefined);
  assert.equal(copy.duplicatedFrom, sent.reference);
  assert.notEqual(copy.destination.identity, sent.destination.identity);
  assert.ok(copy.lines.every((line, index) => line.id !== sent.lines[index].id));
});
