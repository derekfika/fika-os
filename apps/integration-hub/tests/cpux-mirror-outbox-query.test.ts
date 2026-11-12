import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { CollectionReference, DocumentData } from "firebase-admin/firestore";
import { eventIsDue, markEventDelivered, outboxRecord, type DurableDomainEvent } from "@fika/server-shared/durable-outbox";
import { dueHospitalityMirrorQuery } from "../lib/cpux-mirror/outbox-query";

const asOf = "2026-11-12T13:00:00.000Z";
const batchLimit = 3;
type RecordData = DurableDomainEvent<{ bookingId: string; orderId: string }> & {
  outboxStatus: string;
  aggregateSequence: number;
  nextEligibleAt?: string;
};
type FakeDoc = { id: string; data: RecordData };

function event(id: string, status: "pending" | "failed" | "delivered" | "dead-letter", nextEligibleAt: string, extra: Partial<DurableDomainEvent["delivery"]> = {}) {
  const durable: DurableDomainEvent<{ bookingId: string; orderId: string }> = {
    eventId: id,
    eventType: "cpux.calendar.hospitality",
    sourceAggregateId: "production-order:fixture",
    sourceVersion: 1,
    occurredAt: "2026-11-11T10:00:00.000Z",
    schemaVersion: "v1",
    payload: { bookingId: "booking:rcoa:fixture", orderId: "production-order:fixture" },
    delivery: { status, attempts: status === "failed" ? 2 : 0, nextEligibleAt: status === "delivered" || status === "dead-letter" ? undefined : nextEligibleAt, ...extra },
  };
  const stored = outboxRecord(durable) as RecordData;
  // Older terminal rows can retain a stale root timestamp; the production
  // inventory demonstrated that these still appear in the time-only query.
  if (status === "delivered" || status === "dead-letter") stored.nextEligibleAt = nextEligibleAt;
  return stored;
}

function fixtureCollection(rows: FakeDoc[]) {
  const filters: Array<{ field: string; op: string; value: unknown }> = [];
  let orderField = "";
  let batch = 0;
  const query = {
    where(field: string, op: string, value: unknown) { filters.push({ field, op, value }); return query; },
    orderBy(field: string) { orderField = field; return query; },
    limit(value: number) { batch = value; return query; },
    async get() {
      let selected = [...rows];
      for (const filter of filters) {
        if (filter.op === "in") selected = selected.filter(row => (filter.value as unknown[]).includes((row.data as Record<string, unknown>)[filter.field]));
        if (filter.op === "<=") selected = selected.filter(row => {
          const value = (row.data as Record<string, unknown>)[filter.field];
          return typeof value === "string" && value <= String(filter.value);
        });
      }
      selected.sort((a, b) => String((a.data as Record<string, unknown>)[orderField]).localeCompare(String((b.data as Record<string, unknown>)[orderField])) || a.id.localeCompare(b.id));
      return { docs: selected.slice(0, batch).map(row => ({ id: row.id, ref: { id: row.id }, data: () => row.data })) };
    },
  };
  return { collection: query as unknown as CollectionReference<DocumentData>, filters, get orderField() { return orderField; }, get batch() { return batch; } };
}

function realisticTwelve() {
  const rows: FakeDoc[] = [];
  for (let index = 0; index < 8; index++) {
    const id = `failed-${index}`;
    const lease = index === 0 ? {
      claimedAt: "2026-11-12T12:59:00.000Z",
      leaseExpiresAt: "2026-11-12T13:03:00.000Z",
      nextEligibleAt: "2026-11-12T13:03:00.000Z",
    } : {};
    const due = index === 0 ? lease.nextEligibleAt! : `2026-11-11T10:${String(index).padStart(2, "0")}:00.000Z`;
    rows.push({ id, data: event(id, "failed", due, lease) });
  }
  rows.push({ id: "pending-0", data: event("pending-0", "pending", "2026-11-12T10:14:18.945Z") });
  for (const [id, status] of [["delivered-0", "delivered"], ["delivered-1", "delivered"], ["dead-letter-0", "dead-letter"]] as const) {
    rows.push({ id, data: event(id, status, "2026-11-10T08:00:00.000Z", status === "delivered" ? { deliveredAt: asOf } : { deadLetteredAt: asOf }) });
  }
  return rows;
}

test("Calendar worker query excludes terminal rows before its three-record limit", async () => {
  const fake = fixtureCollection(realisticTwelve());
  const result = await dueHospitalityMirrorQuery(fake.collection, asOf, batchLimit).get();

  assert.deepEqual(fake.filters, [
    { field: "outboxStatus", op: "in", value: ["pending", "failed"] },
    { field: "nextEligibleAt", op: "<=", value: asOf },
  ]);
  assert.equal(fake.orderField, "nextEligibleAt");
  assert.equal(fake.batch, batchLimit);
  assert.equal(result.docs.length, batchLimit);
  assert.deepEqual(result.docs.map(row => row.id), ["failed-1", "failed-2", "failed-3"]);
  assert.ok(result.docs.every(row => ["pending", "failed"].includes(row.data().outboxStatus)));
});

test("empty Calendar outbox query resolves to an empty batch", async () => {
  const fake = fixtureCollection([]);
  const result = await dueHospitalityMirrorQuery(fake.collection, asOf, batchLimit).get();
  assert.deepEqual(result.docs, []);
  assert.equal(fake.batch, batchLimit);
});

test("Firestore config contains the exact composite index for the Calendar scheduler query", () => {
  const config = JSON.parse(readFileSync(new URL("../firestore.indexes.json", import.meta.url), "utf8")) as {
    indexes: Array<{ collectionGroup: string; queryScope: string; fields: Array<{ fieldPath: string; order?: string }> }>;
  };
  const index = config.indexes.find(row => row.collectionGroup === "fikaCpuXHospitalityMirrorOutboxV1");
  assert.ok(index, "the Hospitality Mirror outbox must have a dedicated composite index");
  assert.equal(index.queryScope, "COLLECTION");
  assert.deepEqual(index.fields.map(field => [field.fieldPath, field.order]), [
    ["outboxStatus", "ASCENDING"],
    ["nextEligibleAt", "ASCENDING"],
    ["__name__", "ASCENDING"],
  ]);
});

test("a realistic 12-record queue drains due work in fair batches while leased and terminal rows do not starve it", async () => {
  const rows = realisticTwelve();
  const dueAtStart = rows.filter(row => eventIsDue(row.data as unknown as DurableDomainEvent, new Date(asOf)))
    .map(row => row.id).sort();
  const selected: string[] = [];
  let now = asOf;

  for (let round = 0; round < 5; round++) {
    const result = await dueHospitalityMirrorQuery(fixtureCollection(rows).collection, now, batchLimit).get();
    const claimable = result.docs.filter(row => eventIsDue(row.data() as unknown as DurableDomainEvent, new Date(now)));
    if (!claimable.length) break;
    for (const candidate of claimable) {
      selected.push(candidate.id);
      const row = rows.find(item => item.id === candidate.id)!;
      const delivered = markEventDelivered(row.data as unknown as DurableDomainEvent, now);
      row.data = outboxRecord(delivered) as RecordData;
    }
  }

  assert.deepEqual([...selected].sort(), dueAtStart);
  assert.equal(new Set(selected).size, dueAtStart.length);
  assert.ok(selected.every(id => !id.startsWith("delivered-") && !id.startsWith("dead-letter-")));
  assert.ok(selected.includes("pending-0"));
  assert.ok(!selected.includes("failed-0"), "the active lease is not claimed before expiry");

  now = "2026-11-12T13:04:00.000Z";
  const afterLeaseExpiry = await dueHospitalityMirrorQuery(fixtureCollection(rows).collection, now, batchLimit).get();
  assert.ok(afterLeaseExpiry.docs.some(row => row.id === "failed-0"));
  assert.ok(afterLeaseExpiry.docs.some(row => eventIsDue(row.data() as unknown as DurableDomainEvent, new Date(now))));
});
