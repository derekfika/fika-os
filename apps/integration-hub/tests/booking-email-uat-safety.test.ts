import assert from "node:assert/strict";
import test from "node:test";
import { assertStagingEmailCandidate } from "../lib/booking-email-uat-safety";
import type { BookingNotificationRecord } from "../lib/booking-notifications";

const message = { bookingId: "booking:mnk:uat-id", to: ["derek@fikacatering.com"], cc: [] } as unknown as BookingNotificationRecord;
const env = { FIKA_RUNTIME_MODE: "staging", FIKA_HOSPITALITY_EMAIL_UAT_BOOKING_IDS: message.bookingId, FIKA_HOSPITALITY_EMAIL_UAT_RECIPIENT: "derek@fikacatering.com" };

test("staging requires exact stable UAT Booking identity and every To/Cc recipient", () => {
  assert.doesNotThrow(() => assertStagingEmailCandidate(message, env));
  assert.doesNotThrow(() => assertStagingEmailCandidate({ ...message, cc: message.to }, env));
  for (const candidate of [{ ...message, bookingId: "booking:customer" }, { ...message, to: [] }, { ...message, to: ["customer@example.test"] }, { ...message, cc: ["customer@example.test"] }]) {
    assert.throws(() => assertStagingEmailCandidate(candidate, env), /outside the explicit UAT/);
  }
});

test("missing UAT configuration fails closed; other runtime contracts are unchanged", () => {
  assert.throws(() => assertStagingEmailCandidate(message, { ...env, FIKA_HOSPITALITY_EMAIL_UAT_BOOKING_IDS: undefined }));
  assert.throws(() => assertStagingEmailCandidate(message, { ...env, FIKA_HOSPITALITY_EMAIL_UAT_RECIPIENT: undefined }));
  assert.doesNotThrow(() => assertStagingEmailCandidate(message, { FIKA_RUNTIME_MODE: "local" }));
  assert.doesNotThrow(() => assertStagingEmailCandidate(message, { FIKA_RUNTIME_MODE: "production" }));
});
