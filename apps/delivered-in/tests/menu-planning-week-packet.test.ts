import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { decodeMenuPlanningWeekPacket, packetPublicationsForRange } from "../lib/menu-planning-week-packet";
import { encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";
import { projectPublishedWeeks } from "../lib/projection";

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
      allocations: [
        { destinationId: "oploc:haleon", destinationLabel: "Haleon", quantity: 10 },
        { destinationId: "oploc:other", destinationLabel: "Same display label", quantity: 15 },
      ],
      allergens: { milk: "clear" },
    }],
  }],
};

function encoded(value = snapshot) {
  const plain = Buffer.from(JSON.stringify(value), "utf8");
  const compressed = gzipSync(plain, { level: 9 });
  return { encoding: "gzip+base64", payloadBase64: compressed.toString("base64"), contentHash: createHash("sha256").update(compressed).digest("hex"), compressedSize: compressed.byteLength, uncompressedSize: plain.byteLength };
}

test("Delivered-In consumes one gzip/base64 week packet and retains allocation portions", () => {
  const packet = decodeMenuPlanningWeekPacket({ packet: encoded() });
  const [publication] = packetPublicationsForRange([packet], "2026-09-01", "2026-09-30");
  const [week] = projectPublishedWeeks([publication], "oploc:haleon", new Set(["oploc:haleon"]));
  assert.equal(week.days[0].entries.length, 1);
  assert.equal(week.days[0].entries[0].quantity, 10);
  assert.equal(packet.days[0].entries[0].portions, 25);
  assert.equal(week.days[0].entries[0].canonicalDishId, "dish:salad:1");
});

test("Delivered-In filters by stable OPLOC ID and never by destination label", () => {
  const packet = decodeMenuPlanningWeekPacket(snapshot);
  const [publication] = packetPublicationsForRange([packet], "2026-09-01", "2026-09-30");
  const [week] = projectPublishedWeeks([publication], "oploc:missing", new Set(["oploc:missing"]));
  assert.equal(week.days[0].entries.length, 0);
});

test("Delivered-In rejects a weekly packet whose compressed bytes were changed", () => {
  const value = encoded();
  value.payloadBase64 = value.payloadBase64.slice(0, -8) + "AAAAAAAA";
  assert.throws(() => decodeMenuPlanningWeekPacket({ packet: value }), /integrity|base64|gzip/i);
});

test("Delivered-In consumes the shared Menu Planning packet envelope", () => {
  const packet = decodeMenuPlanningWeekPacket(encodeWeeklyPublicationPacket(snapshot));
  const [publication] = packetPublicationsForRange([packet], "2026-09-01", "2026-09-30");
  const [week] = projectPublishedWeeks([publication], "oploc:haleon", new Set(["oploc:haleon"]));
  assert.equal(week.days[0].entries[0].quantity, 10);
});

test("a newer withdrawn day in the weekly packet hides older published bytes", () => {
  const withdrawn = { ...snapshot, days: [...snapshot.days, { ...snapshot.days[0], publicationDayId: "publication-day:mon:v4-withdrawn", version: 4, status: "withdrawn" as const, entries: [] }] };
  const packet = decodeMenuPlanningWeekPacket(encodeWeeklyPublicationPacket(withdrawn));
  const [publication] = packetPublicationsForRange([packet], "2026-09-01", "2026-09-30");
  const [week] = projectPublishedWeeks([publication], "oploc:haleon", new Set(["oploc:haleon"]));
  assert.equal(week.days.length, 0);
});
