import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import type { Transaction } from "firebase-admin/firestore";
import { createDomainEvent } from "../../../shared/domain-events";
import { RCOA_HOSPITALITY_OPLOC_ID } from "../../lib/booking-email-site-identities";
import { dueHospitalityMirrorQuery } from "../../lib/cpux-mirror/outbox-query";
import { stageHospitalityMirrorIntent } from "../../lib/cpux-mirror/queue";
import { db } from "../../lib/firebase-admin";

test("emulator: Calendar intent commits with authority and a replay cannot reset delivery", {
  skip: process.env.FIREBASE_PROJECT_ID !== "demo-fika-os" || !/^(?:127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || ""),
}, async () => {
  const ping = await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/`, { signal: AbortSignal.timeout(1000) });
  assert.ok(ping.status < 500, "the isolated Firestore emulator is reachable");
  const orderId = `production-order:rcoa:emulator-${randomUUID()}`;
  const occurredAt = "2026-11-20T12:00:00.000Z";
  const event = createDomainEvent({
    eventType: "production.order.created", sourceAggregateId: orderId, sourceVersion: 1, occurredAt,
    payload: { productionOrder: {
      canonicalId: orderId, sourceBookingId: "booking:rcoa:emulator", origin: "hospitality_booking",
      destinationOplocId: RCOA_HOSPITALITY_OPLOC_ID, version: 1, lines: [], serviceDate: "2026-11-20",
    } },
  });
  const env: NodeJS.ProcessEnv = {
    FIKA_RUNTIME_MODE: "production", FIREBASE_PROJECT_ID: "fika-os", NODE_ENV: "production",
    FIKA_CPUX_HOSPITALITY_ALLOWED_OPLOC: RCOA_HOSPITALITY_OPLOC_ID,
  };
  const outbox = db.collection("fikaCpuXHospitalityMirrorOutboxV1");
  const obligation = outbox.doc(event.eventId);
  const authority = db.collection("fikaDomainEventsV1").doc(event.eventId);
  const legacy = outbox.doc("legacy-" + event.eventId);
  const stage = (tx: Transaction) => {
    tx.set(authority, event);
    stageHospitalityMirrorIntent(tx, event, env);
  };

  try {
    await assert.rejects(db.runTransaction(async tx => { stage(tx); throw new Error("aborted"); }), /aborted/);
    assert.equal((await obligation.get()).exists, false);
    assert.equal((await authority.get()).exists, false);
    await db.runTransaction(async tx => { stage(tx); });
    await legacy.create({ outboxStatus: "pending", nextEligibleAt: "2026-11-19T12:00:00.000Z" });
    const due = await dueHospitalityMirrorQuery(outbox, occurredAt, 5).get();
    assert.ok(due.docs.some(row => row.id === obligation.id));
    assert.ok(!due.docs.some(row => row.id === legacy.id));
    await obligation.update({ delivery: { status: "delivered", attempts: 1 }, outboxStatus: "delivered" });
    await assert.rejects(db.runTransaction(async tx => { stage(tx); }));
    assert.equal((await obligation.get()).get("delivery.status"), "delivered");
  } finally {
    await Promise.all([obligation.delete(), authority.delete(), legacy.delete()]);
  }
});
