import assert from "node:assert/strict";
import test from "node:test";
import type { DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { OutboundGateError } from "@fika/server-shared/outbound-environment";
import { gmailRawMessage, resolveBookingOutbound, routeBookingMessage, type BookingSender } from "../lib/booking-email-delivery";
import { runBookingEmailWorker, type EmailOutboxStore } from "../lib/booking-email-outbox";
import type { BookingNotificationKind, BookingNotificationRecord } from "../lib/booking-notifications";
import { createRcoaEmailTestFixture } from "../lib/booking-email-test-fixture";

const SINK = "sink-inbox@example.test";
const ROOT = "rootFolder0001", QUOTES = "quotesFolder01", MENUS = "menusFolder001", ALLERGENS = "allergenFolder1";
const stagingEnv = (over: Record<string, string | undefined> = {}): Record<string, string | undefined> => ({
  FIKA_RUNTIME_MODE: "staging", FIREBASE_PROJECT_ID: "fika-os-dev", FIKA_OUTBOUND_SERVICE_IDENTITY: "mail-worker@fika-os-dev.iam.gserviceaccount.com",
  FIKA_STAGING_OWNER_INBOX: SINK,
  ...over,
});
const proof = { driveRootFolderId: ROOT, destinations: { quotes: QUOTES, menus: MENUS, allergenPdfs: ALLERGENS }, driveVerification: { method: "staging-root-ancestry" as const, rootFolderId: ROOT, approvedStagingRootFolderIds: [ROOT], verifiedStagingChildIds: [QUOTES, MENUS, ALLERGENS] } };
const verifier = () => proof;
const sender: BookingSender = { from: "rcoa@fikacatering.com", replyTo: "rcoa-replies@fikacatering.com", displayName: "RCoA Hospitality", authenticatedAccount: "rcoa@fikacatering.com", verifiedSendAs: true, enabled: ["submitted", "confirmed", "amended", "cancelled"] };
const kinds: BookingNotificationKind[] = ["submitted", "confirmed", "amended", "cancelled"];
const customer = (kind: BookingNotificationKind): BookingNotificationRecord => ({ ...createRcoaEmailTestFixture(kind), to: ["customer@customer.example"], cc: ["boss@customer.example"], delivery: { status: "pending", attempts: 0 } });

/** In-memory store + injected transport: nothing here can reach Gmail or the network. */
function harness(messages: BookingNotificationRecord[]) {
  const sent: string[] = [], finished = new Map<string, DurableDomainEvent<BookingNotificationRecord>>(), armed: unknown[] = [];
  const store: EmailOutboxStore = {
    async candidates() { return messages.map(m => m.notificationId).filter(id => !finished.has(id)); },
    async claim(id) { return messages.find(m => m.notificationId === id); },
    async arm(_id, _claim, _at, evidence) { armed.push(evidence); return true; },
    async finish(id, _claim, event) { finished.set(id, event); },
  };
  const deps = (outbound: () => ReturnType<typeof resolveBookingOutbound>) => ({ sender: () => sender, token: async () => "mock-token", send: async (raw: string) => { sent.push(raw); return "mock-receipt"; }, outbound });
  return { store, sent, finished, armed, deps };
}
const header = (raw: string, name: string) => raw.split("\r\n").filter(line => line.toLowerCase().startsWith(`${name.toLowerCase()}:`));
const subject = (raw: string) => Buffer.from(header(raw, "Subject")[0].match(/B\?(.*)\?=/)![1], "base64").toString();

test("staging routes every lifecycle path only to the sink; customer To/Cc/Bcc/Reply-To are gone and subject is prefixed", async () => {
  const messages = kinds.map(customer), h = harness(messages);
  await runBookingEmailWorker(h.store, 25, h.deps(() => resolveBookingOutbound(stagingEnv(), verifier)));
  assert.equal(h.sent.length, kinds.length);
  for (const raw of h.sent) {
    assert.deepEqual(header(raw, "To"), [`To: ${SINK}`]);
    assert.deepEqual([...header(raw, "Cc"), ...header(raw, "Bcc"), ...header(raw, "Reply-To")], []);
    assert.match(subject(raw), /^\[STAGING\] /);
    assert.ok(!raw.includes("customer.example") && !raw.includes("rcoa-replies@"));
  }
  for (const m of messages) assert.equal(h.finished.get(m.notificationId)?.delivery.status, "delivered");
  assert.deepEqual(h.armed.map(e => (e as { replyTo: string }).replyTo), kinds.map(() => ""));
});

test("cancellation notification path (single and consolidated group) reroutes to the sink", async () => {
  const group = { ...customer("cancelled"), notificationId: "group:cancel:1", bookingGroupId: "group:1", groupBookingIds: ["a", "b"] };
  const h = harness([customer("cancelled"), group]);
  await runBookingEmailWorker(h.store, 25, h.deps(() => resolveBookingOutbound(stagingEnv(), verifier)));
  assert.equal(h.sent.length, 2);
  for (const raw of h.sent) { assert.deepEqual(header(raw, "To"), [`To: ${SINK}`]); assert.match(subject(raw), /^\[STAGING\] /); assert.deepEqual(header(raw, "Cc"), []); }
});

test("production is byte-for-byte unchanged", async () => {
  for (const env of [{ FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os" }]) {
    const message = customer("submitted"), h = harness([message]);
    assert.equal(resolveBookingOutbound(env), undefined);
    assert.equal(routeBookingMessage(message, undefined), message);
    await runBookingEmailWorker(h.store, 25, h.deps(() => resolveBookingOutbound(env)));
    assert.deepEqual(h.sent, [gmailRawMessage(message, sender)]);
    assert.deepEqual(header(h.sent[0], "To"), ["To: customer@customer.example"]);
    assert.deepEqual(header(h.sent[0], "Reply-To"), ["Reply-To: rcoa-replies@fikacatering.com"]);
  }
});

test("missing or malformed sink / gate config fails closed: nothing sent, record left retryable", async () => {
  const bad: Array<Record<string, string | undefined>> = [
    stagingEnv({ FIKA_STAGING_OWNER_INBOX: undefined }), stagingEnv({ FIKA_STAGING_OWNER_INBOX: "" }), stagingEnv({ FIKA_STAGING_OWNER_INBOX: "not-an-email" }),
    stagingEnv({ FIKA_STAGING_OWNER_INBOX: "a@b.test, customer@customer.example" }), stagingEnv({ FIREBASE_PROJECT_ID: "fika-os" }), stagingEnv({ FIKA_OUTBOUND_SERVICE_IDENTITY: undefined }),
    stagingEnv({ FIKA_RUNTIME_MODE: "stagging" }), stagingEnv({ FIKA_RUNTIME_MODE: undefined }), stagingEnv({ FIKA_RUNTIME_MODE: "" }),
    { FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os-dev" }, { FIKA_RUNTIME_MODE: "production" },
  ];
  for (const env of bad) {
    assert.throws(() => resolveBookingOutbound(env, verifier), OutboundGateError);
    const h = harness([customer("confirmed")]);
    const result = await runBookingEmailWorker(h.store, 25, h.deps(() => resolveBookingOutbound(env, verifier)));
    assert.equal(h.sent.length, 0); assert.equal(h.armed.length, 0); assert.equal(result.attempted, 1);
    const event = [...h.finished.values()][0];
    assert.equal(event.delivery.status, "failed"); assert.ok(event.delivery.nextAttemptAt || event.delivery.nextEligibleAt);
    assert.ok(!JSON.stringify(event.delivery).includes("customer.example"));
  }
});

test("local mode is blocked by the gate: nothing sent, record retryable", async () => {
  for (const env of [{ FIKA_RUNTIME_MODE: "local" }, { FIKA_RUNTIME_MODE: "local", FIREBASE_PROJECT_ID: "demo-fika-os" }]) {
    const h = harness([customer("submitted")]);
    await runBookingEmailWorker(h.store, 25, h.deps(() => resolveBookingOutbound(env, verifier)));
    assert.equal(h.sent.length, 0); assert.equal(h.armed.length, 0);
    assert.equal([...h.finished.values()][0].delivery.status, "failed");
  }
  assert.throws(() => routeBookingMessage(customer("submitted"), resolveBookingOutbound({ FIKA_RUNTIME_MODE: "local" })), /blocked in local/);
});

test("plain env JSON can never supply the Drive proof; with no trusted verifier staging fails closed", () => {
  const forged = JSON.stringify({ driveRootFolderId: ROOT, destinations: proof.destinations, driveVerification: proof.driveVerification });
  assert.throws(() => resolveBookingOutbound(stagingEnv({ FIKA_OUTBOUND_STAGING_DRIVE_JSON: forged })), /not verified as isolated|Drive/);
  assert.throws(() => resolveBookingOutbound(stagingEnv()), OutboundGateError);
  assert.throws(() => resolveBookingOutbound(stagingEnv(), () => ({ ...proof, driveVerification: { ...proof.driveVerification, verifiedStagingChildIds: [QUOTES] } })), OutboundGateError);
  assert.doesNotThrow(() => resolveBookingOutbound(stagingEnv(), verifier));
});

test("default worker deps use the gate: unset mode or staging without verifier sends nothing (no transport reached)", async () => {
  const saved = { ...process.env };
  try {
    for (const mode of [undefined, "staging"]) {
      for (const key of Object.keys(stagingEnv())) delete process.env[key];
      if (mode) process.env.FIKA_RUNTIME_MODE = mode;
      const h = harness([customer("submitted")]);
      await runBookingEmailWorker(h.store, 25);
      assert.equal(h.armed.length, 0);
      assert.equal([...h.finished.values()][0].delivery.status, "failed");
    }
  } finally { process.env = saved; }
});

test("subject prefix is idempotent and routing is a pure copy of the message", () => {
  const decision = resolveBookingOutbound(stagingEnv(), verifier)!;
  const once = routeBookingMessage(customer("submitted"), decision), twice = routeBookingMessage(once, decision);
  assert.equal(twice.subject, once.subject);
  assert.deepEqual(twice.to, [SINK]); assert.deepEqual(twice.cc, []);
});
