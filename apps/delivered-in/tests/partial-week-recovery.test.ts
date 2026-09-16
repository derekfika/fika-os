import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import test from "node:test";
import { markDeliveredInProjectionDayUnavailable, readDeliveredInProjectionIndex, writeDeliveredInProjection } from "../lib/delivered-in-projection-store";
import { packetPublicationsForRange, type MenuPlanningWeekPacket } from "../lib/menu-planning-week-packet";
import { recoverableRequestedWeekDates } from "../lib/server";

const week = "2026-09-14";
const dates = ["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"];

function projection(serviceDate: string) {
  return {
    publicationId: "publication:wc14",
    weekCommencing: week,
    weekEnding: "2026-09-20",
    publicationDayId: `day:${serviceDate}`,
    sourceDayId: `source:${serviceDate}`,
    date: serviceDate,
    dayName: "Day",
    version: 1,
    contentHash: `hash:${serviceDate}`,
    entries: [],
    allergenSignoff: {},
    projectionId: `delivered-in:oploc:test:${serviceDate}`,
    projectionVersion: 0,
    contractVersion: "delivered-in.day.v1" as const,
    oplocId: "oploc:test",
    oplocLabel: "Test site",
    serviceDate,
    sourceLineage: { menu: { publicationId: "publication:wc14", publicationDayId: `day:${serviceDate}`, sourceDayId: `source:${serviceDate}`, version: 1, contentHash: `hash:${serviceDate}` }, cpu: { orderIds: [] }, deliveredIn: { generatedAt: new Date().toISOString() } },
    generatedAt: new Date().toISOString(),
    siteMenu: { status: "none" as const },
    state: { freshness: "current" as const, completeness: "complete" as const, menu: "empty" as const, cpu: "present" as const, exceptions: [] },
  };
}

test("concurrent day recovery preserves every valid day and marks one failed day unavailable", async () => {
  const root = await mkdtemp(`${tmpdir()}\\fika-delivered-in-partial-week-`);
  const previousRoot = process.env.FIKA_SNAPSHOT_DIR;
  process.env.FIKA_SNAPSHOT_DIR = root;
  try {
    await Promise.all(dates.slice(1).map(date => writeDeliveredInProjection(projection(date))));
    await markDeliveredInProjectionDayUnavailable({ oplocId: "oploc:test", serviceDate: dates[0], weekCommencing: week });
    const index = await readDeliveredInProjectionIndex("oploc:test");
    assert.deepEqual(index?.value.entries.map(entry => entry.serviceDate), dates);
    assert.deepEqual(index?.value.entries.filter(entry => entry.completeness === "complete").map(entry => entry.serviceDate), dates.slice(1));
    assert.deepEqual(index?.value.entries.filter(entry => entry.completeness === "unavailable").map(entry => entry.serviceDate), [dates[0]]);
  } finally {
    if (previousRoot === undefined) delete process.env.FIKA_SNAPSHOT_DIR; else process.env.FIKA_SNAPSHOT_DIR = previousRoot;
    await rm(root, { recursive: true, force: true });
  }
});

test("week packet selection uses an exclusive upper boundary and retains remaining published days", () => {
  const packet = (weekCommencing: string, publicationId: string, dayDates: string[]): MenuPlanningWeekPacket => ({ schemaVersion: 1, publicationId, sourceWeekId: `source:${publicationId}`, week: { weekCommencing, weekEnding: weekCommencing === week ? "2026-09-20" : "2026-09-27" }, days: dayDates.map(date => ({ publicationDayId: `day:${date}`, sourceDayId: `source:${date}`, date, dayName: "Day", version: 1, status: "published", contentHash: `hash:${date}`, entries: [] })) });
  const publications = packetPublicationsForRange([packet(week, "publication:wc14", dates), packet("2026-09-21", "publication:wc15", ["2026-09-21"])], week, "2026-09-21");
  assert.deepEqual(publications.map(value => value.publicationId), ["publication:wc14"]);
  assert.deepEqual(publications[0].days.map(value => value.date), dates);
});

test("requested-week recovery selects only missing or unavailable published days", () => {
  const entries = dates.slice(1).map(serviceDate => ({ serviceDate, state: "available" as const, freshness: "current" as const, completeness: "complete" as const }));
  assert.deepEqual(recoverableRequestedWeekDates(dates, [{ serviceDate: dates[0], state: "available", freshness: "stale", completeness: "unavailable" }, ...entries], [dates[0]], week), [dates[0]]);
  assert.deepEqual(recoverableRequestedWeekDates(dates, entries, [], week), [dates[0]]);
  assert.deepEqual(recoverableRequestedWeekDates(dates, dates.map(serviceDate => ({ serviceDate, state: "available" as const, freshness: "current" as const, completeness: "complete" as const })), [], week), []);
});
