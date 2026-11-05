import assert from "node:assert/strict";
import test from "node:test";
import type { MenuPublication, PublishedMenuDay } from "../lib/menu-publication";
import { deliveredInMirrorSource } from "../lib/cpux-mirror/source";
import { mirrorEventId } from "../../shared/cpux-calendar/contract";

const date = "2026-11-09";
const day = {
  date, sourceDayId: "day-1", publicationDayId: "pub-day-1", version: 1,
  contentHash: "authority", status: "published", publishedAt: "2026-11-05T08:00:00.000Z",
  entries: [{ dishName: "Roast <chicken>", slot: "Main", allocations: [
    { destinationId: "oploc:site-1", destinationLabel: "Fixture site", destinationAddress: "1 High St", quantity: 22 },
    { destinationLabel: "Genuine one-off", destination: { kind: "one-off", id: "day-1:one-off:a", sourceDayId: "day-1", label: "Genuine one-off", address: "2 High St" }, quantity: 4 },
  ] }],
} as PublishedMenuDay;
const publication = (days: PublishedMenuDay[]): MenuPublication => ({
  publicationId: "pub-1", sourceWeekId: "week-1", weekCommencing: date, weekEnding: "2026-11-15", days, audit: [],
});

test("one service day includes every published allocation, preserving governed IDs, one-offs and exact portions", () => {
  const result = deliveredInMirrorSource(date, [publication([day])])!;
  assert.deepEqual(result.details?.start, { date });
  assert.deepEqual(result.details?.end, { date: "2026-11-10" });
  assert.match(result.details!.description, /oploc:site-1[\s\S]*1 High St[\s\S]*22 portions/);
  assert.match(result.details!.description, /day-1:one-off:a[\s\S]*2 High St[\s\S]*4 portions/);
  assert.match(result.runSheetHtml!, /Roast &lt;chicken&gt;/);
  assert.doesNotMatch(result.runSheetHtml!, /Roast <chicken>/);
});

test("a draft or missing day is not an event; a blank or withdrawn published day cannot resurrect demand", () => {
  assert.equal(deliveredInMirrorSource(date, []), undefined);
  assert.equal(deliveredInMirrorSource(date, [publication([{ ...day, status: "superseded" }])]), undefined);
  const blank = deliveredInMirrorSource(date, [publication([{ ...day, entries: [] }])])!;
  assert.equal(blank.source.withdrawn, true);
  assert.equal(blank.runSheetHtml, undefined);
  const withdrawn = deliveredInMirrorSource(date, [publication([{ ...day, status: "withdrawn", withdrawal: { at: "2026-11-05T09:00:00Z", actor: "fixture", reason: "fixture" } }])])!;
  assert.ok(withdrawn.source.withdrawn);
  assert.ok(withdrawn.source.revision > blank.source.revision);
  assert.equal(mirrorEventId(blank.source.stream, blank.source.identity), mirrorEventId(withdrawn.source.stream, withdrawn.source.identity));
});

test("overlapping active publications and incomplete destination identity fail closed", () => {
  assert.throws(() => deliveredInMirrorSource(date, [publication([day]), { ...publication([day]), publicationId: "other" }]), /Multiple current publications/);
  const wrongDay = structuredClone(day);
  const destination = wrongDay.entries[0].allocations[1].destination;
  if (destination?.kind === "one-off") destination.sourceDayId = "another-day";
  assert.throws(() => deliveredInMirrorSource(date, [publication([wrongDay])]), /does not belong/);
});
