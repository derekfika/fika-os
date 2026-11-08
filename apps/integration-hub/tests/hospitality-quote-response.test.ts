import assert from "node:assert/strict";
import test from "node:test";
import { redactHospitalityQuoteDriveLinks } from "../lib/hospitality-quote-response";

test("staging response redaction hides standalone and grouped quote pointers without mutating stored data", () => {
  const source = {
    bookings: [{
      canonicalId: "booking:synthetic-1",
      quoteState: { currentRevisionId: "quote:1", revisions: [{ id: "quote:1", pdfStatus: "saved", driveFileId: "production-file-id", driveUrl: "https://drive.google.com/file/d/production-file-id/view" }] },
      attachments: [{ name: "customer-upload", driveUrl: "https://drive.google.com/file/d/customer-upload/view" }],
    }],
    groups: [{ quote: { id: "group-quote:1", status: "complete", driveUrl: "https://drive.google.com/file/d/group-file-id/view", artifact: { fileId: "group-file-id" } } }],
  };
  const original = structuredClone(source);

  const result = redactHospitalityQuoteDriveLinks(source, true);

  assert.deepEqual(source, original, "redaction operates on the response copy only");
  assert.deepEqual(result.bookings[0].quoteState, { currentRevisionId: "quote:1", revisions: [{ id: "quote:1", pdfStatus: "saved" }] });
  assert.deepEqual(result.bookings[0].attachments, original.bookings[0].attachments, "non-quote attachments retain their established behavior");
  assert.deepEqual(result.groups[0].quote, { id: "group-quote:1", status: "complete", artifact: {} });
});

test("redaction is response-scoped and does not rewrite production quote state", () => {
  const booking = { quoteState: { revisions: [{ id: "quote:1", driveFileId: "production-file-id", driveUrl: "https://drive.google.com/file/d/production-file-id/view" }] } };
  assert.deepEqual(redactHospitalityQuoteDriveLinks(booking, false), booking);
});
