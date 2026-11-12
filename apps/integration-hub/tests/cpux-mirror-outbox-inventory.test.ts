import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { classifyHospitalityMirrorOutboxRecord } from "../lib/cpux-mirror/outbox-inventory";
import { handleHospitalityOutboxInventoryPost } from "../lib/cpux-mirror/outbox-inventory-http";
import { OutboxInventoryReadError, classifyOutboxInventoryError } from "../lib/cpux-mirror/outbox-inventory-errors";

const asOf = "2026-11-12T12:00:00.000Z";
function event(delivery: Record<string, unknown>, top: Record<string, unknown> = {}) {
  return {
    eventId: "production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1",
    eventType: "cpux.calendar.hospitality",
    sourceAggregateId: "production-order:v1:booking:rcoa:fixture:r1",
    sourceVersion: 1,
    occurredAt: "2026-11-12T10:00:00.000Z",
    payload: { bookingId: "booking:rcoa:fixture", orderId: "production-order:v1:booking:rcoa:fixture:r1" },
    delivery: { status: "pending", attempts: 0, ...delivery },
    outboxStatus: delivery.status || "pending",
    ...top,
  };
}

test("inventory uses the durable worker eligibility and lease rules, not status labels alone", () => {
  const pendingDue = classifyHospitalityMirrorOutboxRecord("production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1", event({ status: "pending" }, { nextEligibleAt: asOf }), asOf, 1);
  assert.equal(pendingDue.workerQueryDue, true);
  assert.equal(pendingDue.eventIsDueAtSnapshot, true);
  assert.equal(pendingDue.workerEligibleAtSnapshot, true);
  assert.equal(pendingDue.wouldBeClaimedIfUnchanged, true);
  assert.equal(pendingDue.operationalClass, "pending-eligible");

  const failedDue = classifyHospitalityMirrorOutboxRecord("production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1", event({ status: "failed", attempts: 4, nextAttemptAt: asOf, nextEligibleAt: asOf }, { nextEligibleAt: asOf, outboxStatus: "failed" }), asOf, 1);
  assert.equal(failedDue.workerEligibleAtSnapshot, true);
  assert.equal(failedDue.operationalClass, "retry-eligible");

  const leased = classifyHospitalityMirrorOutboxRecord("production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1", event({ status: "pending", claimId: "claim", leaseExpiresAt: "2026-11-12T12:03:00.000Z", nextEligibleAt: "2026-11-12T12:03:00.000Z" }, { nextEligibleAt: "2026-11-12T12:03:00.000Z" }), asOf, 1);
  assert.equal(leased.leaseState, "active");
  assert.equal(leased.operationalClass, "leased");
  assert.equal(leased.eventIsDueAtSnapshot, false);
  assert.equal(leased.wouldBeClaimedIfUnchanged, false);

  for (const status of ["delivered", "dead-letter"]) {
    const terminal = classifyHospitalityMirrorOutboxRecord("production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1", event({ status, deliveredAt: asOf }, { nextEligibleAt: asOf }), asOf, 1);
    assert.equal(terminal.eventIsDueAtSnapshot, false);
    assert.equal(terminal.wouldBeClaimedIfUnchanged, false);
    assert.equal(terminal.operationalClass, status);
  }
});

test("inventory marks malformed, orphan-prone and status-inconsistent records instead of dropping them", () => {
  const malformed = classifyHospitalityMirrorOutboxRecord("doc-id", { payload: { bookingId: "bad/id" }, delivery: { status: "mystery", attempts: -1 }, outboxStatus: "pending" }, asOf);
  assert.equal(malformed.recordShape, "malformed");
  assert.ok(malformed.anomalies.includes("event-id-missing"));
  assert.ok(malformed.anomalies.includes("booking-id-missing-or-invalid"));
  assert.ok(malformed.anomalies.includes("delivery-status-invalid"));
  assert.equal(malformed.documentId, "doc-id");

  const mismatch = classifyHospitalityMirrorOutboxRecord("production.order.created:production-order:v1:booking:rcoa:fixture:r1:v1", event({ status: "failed", attempts: 2 }, { outboxStatus: "pending", nextEligibleAt: asOf }), asOf);
  assert.equal(mismatch.statusConsistent, false);
  assert.ok(mismatch.anomalies.includes("delivery-outbox-status-mismatch"));
});

test("outbox inventory endpoint requires same-origin AUTHMOD admin and accepts only bounded read requests", async () => {
  let authorized = 0;
  let inspected = 0;
  const deps = {
    async authorize() { authorized++; return { principal: { id: "fixture:admin" } }; },
    async inspect(input: { after?: { documentId: string; asOf: string }; limit: number }) {
      inspected++;
      return { readOnly: true as const, collection: "fikaCpuXHospitalityMirrorOutboxV1", asOf, page: { scanned: 0, stateCounts: {}, fingerprint: "a".repeat(64), records: [] }, nextCursor: null, scheduler: { batchLimit: 3, candidates: [] }, received: input } as never;
    },
  };

  const wrongOrigin = await handleHospitalityOutboxInventoryPost(new Request("https://hub.test/api/internal/cpux-mirror/outbox", {
    method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" }, body: "{}",
  }), deps);
  assert.equal(wrongOrigin.status, 403);
  assert.equal(inspected, 0);

  const authDenied = await handleHospitalityOutboxInventoryPost(new Request("https://hub.test/api/internal/cpux-mirror/outbox", {
    method: "POST", headers: { origin: "https://hub.test", "content-type": "application/json" }, body: "{}",
  }), { ...deps, async authorize() { authorized++; throw new Error("denied"); } });
  assert.equal(authDenied.status, 403);
  assert.equal(inspected, 0);

  const writeCommand = await handleHospitalityOutboxInventoryPost(new Request("https://hub.test/api/internal/cpux-mirror/outbox", {
    method: "POST", headers: { origin: "https://hub.test", "content-type": "application/json" }, body: JSON.stringify({ action: "deliver" }),
  }), deps);
  assert.equal(writeCommand.status, 400);
  assert.equal(inspected, 0);

  const allowed = await handleHospitalityOutboxInventoryPost(new Request("https://hub.test/api/internal/cpux-mirror/outbox", {
    method: "POST", headers: { origin: "https://hub.test", "content-type": "application/json" }, body: JSON.stringify({ limit: 25 }),
  }), deps);
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("cache-control"), "private, no-store, max-age=0");
  assert.equal(inspected, 1);
  assert.equal(authorized, 2);
  assert.deepEqual((await allowed.json() as { received: unknown }).received, { limit: 25 });
});

test("outbox inventory failures expose safe operation and error codes without provider messages", async () => {
  const logCalls: unknown[][] = [];
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logCalls.push(args); };
  try {
    const response = await handleHospitalityOutboxInventoryPost(new Request("https://hub.test/api/internal/cpux-mirror/outbox", {
      method: "POST", headers: { origin: "https://hub.test", "content-type": "application/json" }, body: "{}",
    }), {
      async authorize() { return { principal: { id: "fixture:admin" } }; },
      async inspect() {
        throw new OutboxInventoryReadError("scheduler-candidate-query", "FIRESTORE_INDEX_REQUIRED");
      },
    });
    const body = await response.json() as { error: string; diagnostic: { operation: string; errorCode: string } };
    assert.equal(response.status, 409);
    assert.deepEqual(body.diagnostic, { operation: "scheduler-candidate-query", errorCode: "FIRESTORE_INDEX_REQUIRED" });
    assert.doesNotMatch(JSON.stringify(body), /booking:rcoa|https?:\/\/|token|credential/i);
    assert.deepEqual(logCalls, [["cpux.calendar.hospitality.outbox_inventory_failed", body.diagnostic]]);
  } finally {
    console.error = originalError;
  }
});

test("Firestore inventory error classification distinguishes index, IAM, auth and application failures", () => {
  assert.equal(classifyOutboxInventoryError(Object.assign(new Error("query requires an index: https://sensitive.example/?token=x"), { code: 9 })), "FIRESTORE_INDEX_REQUIRED");
  assert.equal(classifyOutboxInventoryError(Object.assign(new Error("denied"), { code: 7 })), "FIRESTORE_PERMISSION_DENIED");
  assert.equal(classifyOutboxInventoryError(Object.assign(new Error("auth"), { code: 16 })), "FIRESTORE_UNAUTHENTICATED");
  assert.equal(classifyOutboxInventoryError(Object.assign(new Error("other"), { code: 13 })), "FIRESTORE_READ_FAILED");
});

test("route wires only the interactive AUTHMOD administrator guard and read-only inventory", () => {
  const route = readFileSync(new URL("../app/api/internal/cpux-mirror/outbox/route.ts", import.meta.url), "utf8");
  assert.match(route, /requireAuthmodAdminContext/);
  assert.match(route, /readHospitalityMirrorOutboxInventory/);
  assert.doesNotMatch(route, /internalTokenAllowed|hospitalityMirrorSchedulerRequestAllowed|replayHospitalityMirror|mirrorEnabled/);
  const inventory = readFileSync(new URL("../lib/cpux-mirror/outbox-inventory.ts", import.meta.url), "utf8");
  assert.doesNotMatch(inventory, /db\.runTransaction|db\.batch\(|transaction\.|ref\.(set|create|delete|update)\(/);
  assert.match(inventory, /dueHospitalityMirrorQuery\(db\.collection\(OUTBOX_COLLECTION\), asOf, HOSPITALITY_MIRROR_SCHEDULER_BATCH_LIMIT\)/);
});
