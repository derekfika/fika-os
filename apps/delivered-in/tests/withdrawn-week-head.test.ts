import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../lib/firebase-admin";
import { encodeWeeklyPublicationPacket } from "@fika/server-shared/weekly-publication-packet";
import { readMenuPlanningWeekPackets, packetPublicationsForRange } from "../lib/menu-planning-week-packet";
import { projectPublishedWeeks } from "../lib/projection";
import { readFile } from "node:fs/promises";

test("authoritative withdrawal blocks immutable historical fallback and active republish restores current blank navigation", async () => {
  const snapshot = { schemaVersion: 1, sourceWeekVersion: 1, publicationId: "menu-publication:owned", sourceWeekId: "rolling-week:2026-10-12", publicationVersion: 4, week: { weekCommencing: "2026-10-12", weekEnding: "2026-10-18" }, days: [{ publicationDayId: "owned-day", sourceDayId: "owned-source-day", date: "2026-10-12", dayName: "Monday", version: 4, contentHash: "owned-hash", entries: [] }] };
  let head: Record<string, unknown> = { sourceWeekId: snapshot.sourceWeekId, weekCommencing: snapshot.week.weekCommencing, publicationVersion: 4, weekPacket: encodeWeeklyPublicationPacket(snapshot) };
  const historical = structuredClone(snapshot);
  let historyReads = 0;
  const original = db.collection;
  db.collection = ((collection: string) => {
    const query = { where() { return query; }, limit() { return query; }, async get() {
      if (collection === "fikaMenuPlanningPublications") return { size: 1, docs: [{ id: snapshot.publicationId, data: () => head }] };
      historyReads += 1; return { size: 1, docs: [{ data: () => historical }] };
    }, doc() { return { async get() { historyReads += 1; return { exists: true, data: () => historical }; } }; } };
    return query;
  }) as unknown as typeof db.collection;
  try {
    const project = async () => projectPublishedWeeks(packetPublicationsForRange(await readMenuPlanningWeekPackets("2026-10-12", "2026-10-19"), "2026-10-12", "2026-10-19"), "oploc:haleon", new Set(["oploc:haleon"]), "2026-10-12");
    assert.equal((await project())[0].days.length, 1); // published blank is still a service day
    head = { ...head, publicationStatus: "withdrawn" }; delete head.weekPacket;
    for (let reload = 0; reload < 2; reload++) assert.equal((await project())[0].days.length, 0);
    assert.equal(historyReads, 0);
    assert.deepEqual(historical, snapshot);
    head = { ...head, publicationStatus: "published", publicationVersion: 5, weekPacket: encodeWeeklyPublicationPacket({ ...snapshot, publicationVersion: 5 }) };
    assert.equal((await project())[0].days.length, 1);
    head = { ...head, weekPacket: { encoding: "gzip+base64", payloadBase64: "AAAA", contentHash: "bad" } };
    await assert.rejects(project, /integrity/);
    assert.equal(historyReads, 0);
    delete head.weekPacket; head.compiledSnapshotId = "owned-current-snapshot";
    assert.equal((await project())[0].days.length, 1);
    historical.days[0].contentHash = "";
    await assert.rejects(project, /immutable content hash/);
  } finally { db.collection = original; }
});

test("withdrawal hydration evicts cached days and keeps a distinct operational status without redirecting into history", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /withdrawnServiceDates: head.withdrawnServiceDates/);
  assert.match(page, /evictWithdrawnDeliveredInDays/);
  assert.match(page, /Menu withdrawn for the selected operational week/);
});
