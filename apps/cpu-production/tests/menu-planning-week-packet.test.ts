import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { decodeMenuPlanningWeekPacket, packetPublication } from "../lib/menu-planning-week-packet";
import { encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";

const snapshot = {
  schemaVersion: 1,
  publicationId: "menu-publication:2026-09-07",
  sourceWeekId: "rolling-week:2026-09-07",
  sourceWeekVersion: 12,
  publicationVersion: 3,
  week: { weekCommencing: "2026-09-07", weekEnding: "2026-09-13" },
  days: [{
    publicationDayId: "publication-day:mon:v3",
    sourceDayId: "rolling-week:2026-09-07:day:mon",
    date: "2026-09-07",
    dayName: "Monday",
    version: 3,
    entries: [{
      sourceEntryId: "entry:1",
      slot: "SALAD 1",
      canonicalDishId: "dish:salad:1",
      dishName: "House salad",
      portions: 25,
      allocations: [{ destinationId: "oploc:haleon", destinationLabel: "Haleon", quantity: 10 }],
      allergens: { milk: "clear" },
    }],
  }],
};

function envelope(value = snapshot) {
  const compressed = gzipSync(Buffer.from(JSON.stringify(value), "utf8"), { level: 9 });
  return {
    packet: {
      encoding: "gzip+base64",
      payloadBase64: compressed.toString("base64"),
      contentHash: createHash("sha256").update(compressed).digest("hex"),
      compressedSize: compressed.byteLength,
      uncompressedSize: Buffer.byteLength(JSON.stringify(value), "utf8"),
    },
  };
}

test("CPU weekly packet consumer decompresses and validates a single packet", () => {
  const packet = decodeMenuPlanningWeekPacket(envelope(), snapshot.publicationId);
  assert.equal(packet.publicationId, snapshot.publicationId);
  assert.equal(packet.days[0].entries[0].portions, 25);
  assert.equal(packet.days[0].entries[0].allocations[0].destinationId, "oploc:haleon");
  assert.equal(packetPublication(packet).days[0].status, "published");
});

test("CPU weekly packet consumer rejects corrupt gzip/base64 content and wrong publication identity", () => {
  const corrupt = envelope();
  corrupt.packet.payloadBase64 = corrupt.packet.payloadBase64.slice(0, -4) + "AAAA";
  assert.throws(() => decodeMenuPlanningWeekPacket(corrupt), /integrity|gzip|base64/i);
  assert.throws(() => decodeMenuPlanningWeekPacket(envelope(), "menu-publication:other"), /identity/);
});

test("CPU weekly packet consumer remains compatible with the plain compiled snapshot", () => {
  const packet = decodeMenuPlanningWeekPacket(snapshot, snapshot.publicationId);
  assert.equal(packet.days[0].entries[0].allocations[0].quantity, 10);
});

test("CPU canonicalizes historical OPLOC IDs after packet integrity verification", () => {
  const legacy = { ...snapshot, days: [{ ...snapshot.days[0], entries: [{ ...snapshot.days[0].entries[0], allocations: [{ destinationId: "oploc:46701265-15af-48f4-a230-1d27ca21bc59", destinationLabel: "Haleon", quantity: 10 }] }] }] };
  const packet = decodeMenuPlanningWeekPacket(legacy, snapshot.publicationId);
  assert.equal(packet.days[0].entries[0].allocations[0].destinationId, "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b");
});

test("CPU consumes the shared Menu Planning packet envelope stored on the publication document", () => {
  const encoded = encodeWeeklyPublicationPacket(snapshot);
  const packet = decodeMenuPlanningWeekPacket(encoded, snapshot.publicationId);
  assert.equal(packet.publicationId, snapshot.publicationId);
  assert.equal(packet.days[0].entries[0].portions, 25);
});
