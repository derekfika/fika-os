import assert from "node:assert/strict";
import test from "node:test";
import { applyBookingAdditionalCharges, applyQuotePdfPersistence, assertBookingExpectedVersion, hospitalityCancellationRequiresCpuReview, assertWorkflowCommand, isQuoteStale } from "../lib/booking-workflow";
import { productionOrderId } from "../lib/hospitality-booking-service";
import { assertPermission } from "../lib/authmod";
import type { Actor } from "../lib/auth";

const quote = { id: "quote:booking:test:r1", revision: 1, createdAt: "2026-07-30T12:00:00Z", createdBy: "actor", commercialVersion: 1, snapshot: {}, documentReference: "quote:booking:test:r1", stale: false, pdfStatus: "saved" as const, driveFileId: "drive-file" };
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
test("completion is available after a saved quote and completed bookings can still record cancellation", () => {
  const ready = { lifecycleStatus: "Quoted" as const, quoteState: { currentRevisionId: quote.id, revisions: [quote] } };
  assert.doesNotThrow(() => assertWorkflowCommand(ready, { action: "complete" }));
  assert.doesNotThrow(() => assertWorkflowCommand({ ...ready, lifecycleStatus: "Approved" as const }, { action: "complete" }));
  assert.throws(() => assertWorkflowCommand({ lifecycleStatus: "Reviewed" as const }, { action: "complete" }));
  assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Completed" as const }, { action: "cancel", reason: "x" }));
});
test("production-order identity is deterministic for idempotent hand-off", () => { assert.equal(productionOrderId("booking:mnk:one"), productionOrderId("booking:mnk:one")); });
test("booking cancellation can always be recorded while late CPU work requires review", () => {
  assert.equal(hospitalityCancellationRequiresCpuReview(["received", "needs_review"]), false);
  assert.equal(hospitalityCancellationRequiresCpuReview(["cancelled", "amended"]), false);
  for (const state of ["accepted", "planning", "planned", "scheduled", "in_production", "partially_complete", "ready", "complete", "dispatched"]) {
    assert.equal(hospitalityCancellationRequiresCpuReview([state]), true, state);
  }
});
test("Hub cancellation permission is limited to edit-capable roles", () => {
  assert.doesNotThrow(() => assertPermission({ uid: "reviewer", role: "reviewer" } as Actor, "canonical.edit"));
  assert.doesNotThrow(() => assertPermission({ uid: "admin", role: "integration-admin" } as Actor, "canonical.edit"));
  assert.throws(() => assertPermission({ uid: "viewer", role: "viewer" } as Actor, "canonical.edit"), (error: unknown) => (error as { status?: number }).status === 403);
});
test("an amendment can reopen a completed or cancelled Booking while retaining commercial history", () => { const patch = { client: { name: "Host", email: "host@example.test", companyName: "Client" }, service: { eventDate: "2026-08-01", startTime: "12:00", guestCount: 10 }, order: { items: [{ itemId: "lunch", unitPrice: 9, quantity: 10 }] }, deliveryChargeRequired: true }; assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Quoted" }, { action: "amend", reason: "Client changed delivery room.", patch })); assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Completed" }, { action: "amend", reason: "Client amended the booking after completion.", patch })); assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus: "Cancelled" }, { action: "amend", reason: "Client reinstated the booking.", patch })); });

test("additional charges are directly editable in the active quoting lifecycle and on Completed bookings", () => {
  for (const lifecycleStatus of ["New", "Reviewed", "Quoted", "Completed"] as const) {
    assert.doesNotThrow(() => assertWorkflowCommand({ lifecycleStatus }, { action: "set-additional-charges", charges: [] }));
  }
  for (const lifecycleStatus of ["Sent to CPU", "Cancelled"] as const) {
    assert.throws(() => assertWorkflowCommand({ lifecycleStatus }, { action: "set-additional-charges", charges: [] }), /governed amendment workflow/);
  }
});

test("stale expected versions return 409 for charge saves before transaction writes", () => {
  assert.throws(() => assertBookingExpectedVersion(8, 7, "set-additional-charges"), (error: unknown) => (error as { status?: number }).status === 409);
  assert.doesNotThrow(() => assertBookingExpectedVersion(8, 8, "set-additional-charges"));
});

test("saving additional charges bumps both versions and stales the current quote without changing its snapshot", () => {
  const snapshot = { totals: { net: { currency: "GBP", amount: 150 } }, charges: [{ label: "Old charge", amount: 25 }] };
  const current = { version: 8, commercialVersion: 3, additionalCharges: [], quoteState: { currentRevisionId: quote.id, revisions: [{ ...quote, snapshot }] } };
  const beforeSnapshot = structuredClone(snapshot);
  const next = applyBookingAdditionalCharges(current, []);
  assert.equal(next.version, 9);
  assert.equal(next.commercialVersion, 4);
  assert.equal(next.quoteState.currentRevisionId, quote.id);
  assert.equal(next.quoteState.revisions[0].stale, true);
  assert.deepEqual(next.quoteState.revisions[0].snapshot, beforeSnapshot);
});
