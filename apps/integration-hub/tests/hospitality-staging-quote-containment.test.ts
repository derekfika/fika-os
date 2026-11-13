import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("booking and group booking responses use runtime-scoped quote pointer redaction", () => {
  const bookingRoute = source("../app/api/hospitality-bookings/route.ts");
  assert.match(bookingRoute, /redactHospitalityQuoteDriveLinks\(value, await stagingDriveAccessBlocked\(\)\)/);
  assert.match(bookingRoute, /change\.action === "quote-pdf-status" \? await verifyStagingQuotePdfStatus\(change, booking\)/);
  assert.match(bookingRoute, /executeBookingWorkflow\(actor, change\.canonicalId, change\.expectedVersion, verifiedChange/);

  for (const path of [
    "../app/api/hospitality-booking-groups/amend/route.ts",
    "../app/api/hospitality-booking-groups/cancel/route.ts",
    "../app/api/hospitality-booking-groups/charges/route.ts",
  ]) {
    assert.match(source(path), /redactHospitalityQuoteDriveLinks\(value, await stagingDriveAccessBlocked\(\)\)/, path);
  }
});

test("staging refuses group quote generation and replay before workflow side effects", () => {
  const route = source("../app/api/hospitality-booking-groups/quote/route.ts");
  const guard = route.indexOf("if (await stagingDriveAccessBlocked())");
  const generate = route.indexOf("generateHospitalityGroupQuote(command");
  const reconcile = route.indexOf("queueGroupConfirmation(command.bookingGroupId)");
  assert.notEqual(guard, -1);
  assert.ok(generate > guard, "the Drive-isolation guard must run before quote persistence or replay");
  assert.ok(reconcile > guard, "the Drive-isolation guard must run before reconciliation side effects");
});
