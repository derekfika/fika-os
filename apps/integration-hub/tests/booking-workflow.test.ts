import assert from "node:assert/strict";
import test from "node:test";
import { applyQuotePdfPersistence, assertWorkflowCommand, isQuoteStale } from "../lib/booking-workflow";
import { productionOrderId } from "../lib/hospitality-booking-service";

const quote = { id: "quote:booking:test:r1", revision: 1, createdAt: "2026-07-30T12:00:00Z", createdBy: "actor", commercialVersion: 1, snapshot: {}, documentReference: "quote:booking:test:r1", stale: false };
test("manager review is a lightweight record rather than a second approval gate", () => { assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "New" }, { action: "review", checks: { commercialIntent: true } })); assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "New" }, { action: "review", checks: { commercialIntent: false } })); });
test("quote approval is retired while stale detection remains active", () => { const booking = { lifecycleStatus: "Quoted" as const, commercialVersion: 1, quoteState: { currentRevisionId: quote.id, revisions: [quote] } }; assert.throws(() => assertWorkflowCommand(booking, { action: "approve", quoteRevisionId: quote.id }), /approval has been removed/); assert.equal(isQuoteStale({ ...booking, commercialVersion: 2 }), true); });
test("quote PDF persistence gates readiness and records failures without a new commercial revision", () => {
  const saved = applyQuotePdfPersistence([quote], quote.id, quote.id, "saved", "drive-file", "https://drive.google.test/file");
  assert.equal(saved[0].pdfStatus, "saved");
  assert.equal(saved[0].driveFileId, "drive-file");
  const failed = applyQuotePdfPersistence([quote], quote.id, quote.id, "failed", undefined, undefined, "Drive unavailable");
  assert.equal(failed[0].pdfStatus, "failed");
  assert.equal(failed[0].pdfError, "Drive unavailable");
  assert.throws(() => applyQuotePdfPersistence([quote], quote.id, quote.id, "saved"));
});
test("completion and cancellation enforce lifecycle boundaries", () => { assert.throws(() => assertWorkflowCommand({ lifecycleStatus: "Reviewed" as const }, { action: "complete" })); assert.throws(() => assertWorkflowCommand({ lifecycleStatus: "Completed" as const }, { action: "cancel", reason: "x" })); });
test("production-order identity is deterministic for idempotent hand-off", () => { assert.equal(productionOrderId("booking:mnk:one"), productionOrderId("booking:mnk:one")); });
test("an amendment can reopen a completed or cancelled Booking while retaining commercial history", () => { const patch = { client: { name: "Host", email: "host@example.test", companyName: "Client" }, service: { eventDate: "2026-08-01", startTime: "12:00", guestCount: 10 }, order: { items: [{ itemId: "lunch", unitPrice: 9, quantity: 10 }] }, deliveryChargeRequired: true }; assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Quoted" }, { action: "amend", reason: "Client changed delivery room.", patch })); assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Completed" }, { action: "amend", reason: "Client amended the booking after completion.", patch })); assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Cancelled" }, { action: "amend", reason: "Client reinstated the booking.", patch })); });
