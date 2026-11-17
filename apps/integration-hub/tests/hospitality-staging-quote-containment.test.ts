import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("generic booking responses stay redacted while authorized scoped reads can restore verified staging links", () => {
  const bookingRoute = source("../app/api/hospitality-bookings/route.ts");
  assert.match(bookingRoute, /allowScopedQuoteLinks\s*\?\s*await stagingDriveOperationsBlocked\(\)\s*:\s*await stagingDriveAccessBlocked\(\)/);
  assert.match(bookingRoute, /bookingWorkspace\(site, oploc, includeArchive\), hospitalityAdminAuthority \}, Boolean\(site && oploc\)\)/);
  assert.match(bookingRoute, /change\.action === "quote-pdf-status" && change\.status === "saved"/);
  assert.match(bookingRoute, /change\.action === "quote-pdf-status" \? await verifyStagingQuotePdfStatus\(change, booking\)/);
  assert.match(bookingRoute, /executeBookingWorkflow\(actor, change\.canonicalId, change\.expectedVersion, verifiedChange/);
  const genericDetailBranch = bookingRoute.slice(bookingRoute.indexOf("if (canonicalId)"), bookingRoute.indexOf("const site ="));
  assert.match(genericDetailBranch, /return bookingJson\(\{ booking, quoteSettings: await getDashboardQuoteSettingsForBooking\(booking\) \}\);/);
  assert.doesNotMatch(genericDetailBranch, /bookingJson\([^\n]+,\s*true\)/, "unscoped canonical detail reads remain redacted");

  for (const path of [
    "../app/api/hospitality-booking-groups/amend/route.ts",
    "../app/api/hospitality-booking-groups/cancel/route.ts",
    "../app/api/hospitality-booking-groups/charges/route.ts",
  ]) {
    assert.match(source(path), /redactHospitalityQuoteDriveLinks\(value, await stagingDriveAccessBlocked\(\)\)/, path);
  }
});

test("group quote generation uses the verified staging operation gate before workflow side effects", () => {
  const route = source("../app/api/hospitality-booking-groups/quote/route.ts");
  const guard = route.indexOf("if (await stagingDriveOperationsBlocked())");
  const generate = route.indexOf("generateHospitalityGroupQuote(command");
  const reconcile = route.indexOf("queueGroupConfirmation(command.bookingGroupId)");
  assert.notEqual(guard, -1);
  assert.ok(generate > guard, "the Drive-isolation guard must run before quote persistence or replay");
  assert.ok(reconcile > guard, "the Drive-isolation guard must run before reconciliation side effects");
  assert.match(route, /resolveGroupQuoteTarget\(booking, settings\)/);
  assert.match(route, /redactHospitalityQuoteDriveLinks\([\s\S]*?await stagingDriveAccessBlocked\(\)/, "group staging Drive URLs remain redacted from generic responses");
});
