import assert from "node:assert/strict";
import test from "node:test";
import { hasCurrentPublishedWorkingDraft } from "../lib/menu-publication";

test("working-draft publication guard matches only currently published day lineage", () => {
  const publication = { days: [
    { sourceDayId: "day:one", publicationDayId: "pub:one:v1", status: "published" },
    { sourceDayId: "day:two", publicationDayId: "pub:two:v2", status: "published" },
    { sourceDayId: "day:old", publicationDayId: "pub:old:v1", status: "superseded" },
  ] } as any;
  const week = { audit: [
    { action: "week-draft-saved", at: "2026-11-06T10:00:00Z", by: "person:1", workingDraftLineage: [{ dayId: "day:one", publicationDayId: "pub:one:v1", publicationVersion: 2 }] },
  ] } as any;
  assert.equal(hasCurrentPublishedWorkingDraft(week, publication, "day:one"), true);
  assert.equal(hasCurrentPublishedWorkingDraft(week, publication, "day:two"), false);
  assert.equal(hasCurrentPublishedWorkingDraft(week, publication), true);
  const republished = { days: [{ sourceDayId: "day:one", publicationDayId: "pub:one:v2", status: "published" }] } as any;
  assert.equal(hasCurrentPublishedWorkingDraft(week, republished), false);
  const noMarker = { audit: [{ action: "week-draft-saved", at: "2026-11-06T10:00:00Z", by: "person:1" }] } as any;
  assert.equal(hasCurrentPublishedWorkingDraft(noMarker, publication), false);
});
