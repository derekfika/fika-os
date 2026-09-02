import assert from "node:assert/strict";
import { test } from "node:test";
import { decodeWeeklyPublicationPacket, encodeWeeklyPublicationPacket } from "../src/weekly-publication-packet";

const payload = {
  schemaVersion: 1 as const,
  snapshotId: "menu-publication:week-1:snapshot:v1",
  publicationId: "menu-publication:week-1",
  sourceWeekId: "rolling-week:2026-09-07",
  sourceWeekVersion: 12,
  publicationVersion: 1,
  publishedAt: "2026-09-01T10:00:00.000Z",
  publishedBy: "menu-planner-1",
  contentHash: "source-content-hash",
  week: { weekCommencing: "2026-09-07", weekEnding: "2026-09-11" },
  days: [{
    publicationDayId: "menu-publication:week-1:v1:day:0",
    sourceDayId: "rolling-week:2026-09-07:day:0",
    date: "2026-09-07",
    dayName: "Monday",
    version: 1,
    entries: [{ sourceEntryId: "entry:1", canonicalDishId: "dish:1", portions: 20, allocations: [{ destinationId: "oploc:1", destinationLabel: "Haleon", quantity: 20 }] }],
  }],
};

test("weekly publication packet is gzip/base64 self-contained and round-trips", () => {
  const packet = encodeWeeklyPublicationPacket(payload, "2026-09-01T10:00:00.000Z");
  assert.equal(packet.manifest.compression, "gzip");
  assert.equal(packet.manifest.packageVersion, 1);
  assert.equal(packet.manifest.scope, payload.sourceWeekId);
  assert.equal(packet.manifest.recordCount, 1);
  assert.deepEqual(decodeWeeklyPublicationPacket(packet), payload);
});

test("weekly publication packet rejects corruption", () => {
  const packet = encodeWeeklyPublicationPacket(payload);
  const first = packet.payloadBase64[0] === "A" ? "B" : "A";
  assert.throws(() => decodeWeeklyPublicationPacket({ ...packet, payloadBase64: `${first}${packet.payloadBase64.slice(1)}` }), /integrity/i);
});
