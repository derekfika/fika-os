import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { ANGEL_COURT_GMAIL_QUERY, buildAngelCourtInboxQuery, makeAngelCourtSourceKey, parseAngelCourtWorkbook, scanAngelCourtAttachments } from "../lib/angel-court-inbox";
import { collectGmailParts, gmailQueryUrl } from "../lib/gmail-client";
import { londonScanSlot, londonScanWindow } from "../lib/angel-court-gmail-runner";

test("scheduled Gmail scans run only on London weekdays between 07:00 and 17:00", () => {
  assert.equal(londonScanWindow(new Date("2026-08-14T06:59:00+01:00")), false);
  assert.equal(londonScanWindow(new Date("2026-08-14T07:00:00+01:00")), true);
  assert.equal(londonScanWindow(new Date("2026-08-14T17:00:00+01:00")), true);
  assert.equal(londonScanWindow(new Date("2026-08-14T17:01:00+01:00")), false);
  assert.equal(londonScanWindow(new Date("2026-08-15T10:00:00+01:00")), false);
  assert.equal(londonScanSlot(new Date("2026-08-14T07:14:00+01:00")), "2026-08-14T07:00");
  assert.equal(londonScanSlot(new Date("2026-08-14T07:15:00+01:00")), "2026-08-14T07:15");
});

test("Gmail adapter builds a bounded mailbox query and finds nested XLSX parts", () => {
  const url = gmailQueryUrl(ANGEL_COURT_GMAIL_QUERY);
  assert.match(url, /filename%3Axlsx/);
  assert.match(url, /maxResults=100/);
  const parts = collectGmailParts({ parts: [{ filename: "booking.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }, { filename: "notes.txt" }] });
  assert.equal(parts.length, 1);
  assert.equal(parts[0]?.filename, "booking.xlsx");
});

test("builds the legacy Angel Court Gmail query and preserves incremental dates", () => {
  assert.equal(buildAngelCourtInboxQuery(), `${ANGEL_COURT_GMAIL_QUERY} newer_than:90d`);
  assert.equal(buildAngelCourtInboxQuery({ earliestScanDate: "2026-08-01" }), `${ANGEL_COURT_GMAIL_QUERY} after:2026/08/01`);
  assert.equal(makeAngelCourtSourceKey("m-1", "booking.xlsx"), "m-1|booking.xlsx");
});

test("parses Angel Court source evidence without writing canonical data", () => {
  const rows = [
    ["Company Name:", "Angel Court"],
    ["Name:", "Site Manager"],
    ["Email:", "manager@example.test"],
    ["Date of event:", "17/08/2026"],
    ["Service time:", "12:30"],
    ["Delivery time:", "11:30"],
    ["Total Number of people:", 12],
    ["Floor Level", "Boardroom"],
    [],
    ["Item", "Quantity", "Details"],
    ["Deli Style Sandwich Lunch", 12, "Lunch"],
    ["Fruit platter", 1, ""],
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Booking");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const candidate = parseAngelCourtWorkbook(buffer, { messageId: "msg-1", attachmentName: "angel.xlsx" });
  assert.equal(candidate.sourceKey, "msg-1|angel.xlsx");
  assert.equal(candidate.location, "One Angel Court");
  assert.equal(candidate.eventDate, "2026-08-17");
  assert.equal(candidate.serviceTime, "12:30");
  assert.equal(candidate.deliveryTime, "11:30");
  assert.equal(candidate.guestCount, 12);
  assert.deepEqual(candidate.items.map((item) => item.name), ["Deli Style Sandwich Lunch", "Fruit platter"]);
  assert.equal(candidate.items[0]?.quantity, 12);
  assert.equal(candidate.warnings.length, 0);
});

test("deduplicates the legacy message and attachment processing key", () => {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Company Name:", "Angel Court"]]), "Booking");
  const content = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const attachment = { messageId: "msg-2", attachmentName: "booking.xlsx", content };
  const result = scanAngelCourtAttachments([attachment, attachment]);
  assert.equal(result.candidates.length, 1);
  assert.deepEqual(result.skipped, ["msg-2|booking.xlsx"]);
});
