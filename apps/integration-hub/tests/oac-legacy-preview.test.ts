import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildOacLegacyPreview,
  oacLegacyCanonicalBookingId,
  type OacLegacyPreviewInput,
} from "../lib/oac-legacy-preview";

const base = (): OacLegacyPreviewInput => ({
  source: {
    spreadsheetId: "redacted-fixture",
    sheetName: "Dashboard Data",
    range: "'Dashboard Data'!A1:AM3",
    modifiedTime: "2026-11-07T17:06:01.977Z",
    rows: [
      {
        bookingId: "AC-TEST-000001",
        sourceBookingId: "AC-TEST-000001",
        status: "CONFIRMED",
        sourceStatus: "CONFIRMED",
        sourceSiteId: "angel_court",
        eventDate: "2026-11-10",
        sourceEventDate: "2026-11-10",
        guestCount: 10,
        sourceGuestCount: 10,
        startTime: "10:00",
        items: [{ legacyItemId: "deli_working_lunch", quantity: 10 }],
        dashboardItems: [{ legacyItemId: "deli_working_lunch", quantity: 10 }],
        originalItems: [{ legacyItemId: "deli_working_lunch", quantity: 10 }],
        manuallyEdited: false,
        quoteReferenceId: "redacted-doc-id",
        quoteDocumentStatus: "draft",
        quoteCreatedAt: "2026-11-02T11:02:24.000Z",
        calendarEventId: "redacted-event-id",
        calendarCreatedAt: "2026-11-02T11:27:53.000Z",
        calendarCurrentState: "unverified",
      },
    ],
  },
  aliases: [{ legacyItemId: "deli_working_lunch", status: "approved", canonicalItemId: "hospitality-menu-item:mnk:deli_sandwich_lunch" }],
  existing: [],
  authority: { confirmedStatusMappingApproved: false },
});

test("current identity is the Hub non-RCoA deterministic canonical ID", () => {
  assert.equal(oacLegacyCanonicalBookingId(" AC-TEST-000001 "), "booking:mnk:d72bd6ca7f287381134b6d653431f2b3");
});

test("preview is stable, hash-bound, fail-closed, and performs no writes", () => {
  const input = base();
  const first = buildOacLegacyPreview(input);
  const repeated = buildOacLegacyPreview(structuredClone(input));
  assert.equal(first.planHash, repeated.planHash);
  assert.equal(first.sourceProjectionFingerprint, repeated.sourceProjectionFingerprint);
  assert.equal(first.contextFingerprint, repeated.contextFingerprint);
  assert.deepEqual(first.summary.actions, { preview_create: 0, exact_existing: 0, hold: 1, excluded: 0 });
  assert.equal(first.summary.writes, 0);
  assert.equal(first.summary.downstreamEffects, 0);
  assert.ok(first.entries[0].reasons.some(reason => reason.includes("QuoteRevision")));
  assert.ok(first.entries[0].reasons.some(reason => reason.includes("Calendar event state is unverified")));
  assert.ok(first.entries[0].reasons.some(reason => reason.includes("lifecycle/handoff")));
  assert.equal(first.entries[0].warnings.some(reason => reason.includes("end time absent")), true);
  assert.equal(first.entries[0].reasons.some(reason => reason.toLowerCase().includes("end time")), false);
  assert.equal("target" in first.entries[0], false);
});

test("a known optional source end time does not block a fully reviewed preview", () => {
  const input = base();
  Object.assign(input.source.rows[0], {
    quoteDocumentStatus: "hub-saved-pdf",
    quoteRevisionId: "quote-rev:reviewed",
    calendarCurrentState: "verified",
    endTime: "11:00",
  });
  input.authority.confirmedStatusMappingApproved = true;
  const plan = buildOacLegacyPreview(input);
  assert.equal(plan.entries[0].action, "preview_create");
  assert.equal(plan.summary.writes, 0);
  assert.equal(plan.summary.downstreamEffects, 0);
});

test("duplicates and exact current documents are held or identified without mutation", () => {
  const input = base();
  const row = input.source.rows[0];
  input.source.rows.push(structuredClone(row));
  const duplicated = buildOacLegacyPreview(input);
  assert.equal(duplicated.summary.actions.hold, 2);
  assert.ok(duplicated.entries.every(entry => entry.reasons.includes("The source contains a duplicate stable booking reference.")));

  input.source.rows = [row];
  input.authority.confirmedStatusMappingApproved = true;
  Object.assign(row, { quoteDocumentStatus: "hub-saved-pdf", quoteRevisionId: "quote-rev:reviewed", calendarCurrentState: "verified" });
  input.existing.push({
    canonicalId: oacLegacyCanonicalBookingId(row.bookingId),
    lifecycleStatus: "New",
    source: { sourceBookingId: row.bookingId },
    service: { portalSiteId: "angel-court" },
  } as OacLegacyPreviewInput["existing"][number]);
  const exact = buildOacLegacyPreview(input);
  assert.equal(exact.entries[0].action, "exact_existing");
  assert.equal(exact.summary.writes, 0);
});

test("date, status, and aliases are validated without guessing", () => {
  const input = base();
  input.source.rows[0].sourceEventDate = "2026-12-12";
  input.source.rows[0].items.push({ legacyItemId: "exotic_fruit_8", quantity: 1 });
  const plan = buildOacLegacyPreview(input);
  assert.ok(plan.entries[0].reasons.some(reason => reason.includes("dates disagree")));
  assert.ok(plan.entries[0].reasons.some(reason => reason.includes("exotic_fruit_8")));
});

test("manual edits require reviewed amendment provenance", () => {
  const input = base();
  input.source.rows[0].manuallyEdited = true;
  const held = buildOacLegacyPreview(input);
  assert.ok(held.entries[0].reasons.some(reason => reason.includes("reviewed amendment provenance")));
  input.source.rows[0].amendmentReviewed = true;
  const reviewed = buildOacLegacyPreview(input);
  assert.equal(reviewed.entries[0].reasons.some(reason => reason.includes("reviewed amendment provenance")), false);
});

test("source row, ParsedJSON, and original order item lines must agree", () => {
  const input = base();
  input.source.rows[0].dashboardItems = [{ legacyItemId: "deli_working_lunch", quantity: 9 }];
  const plan = buildOacLegacyPreview(input);
  assert.ok(plan.entries[0].reasons.some(reason => reason.includes("Dashboard ItemsJSON and ParsedJSON")));
});
