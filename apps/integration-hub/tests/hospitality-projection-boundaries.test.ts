import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/production/route.ts", import.meta.url), "utf8");
const bookingRoute = readFileSync(new URL("../app/api/hospitality-bookings/route.ts", import.meta.url), "utf8");

test("Hospitality workspace reads use explicit date and row bounds", () => {
  assert.match(service, /WORKSPACE_BOOKING_LIMIT = 200/);
  assert.match(service, /WORKSPACE_FUTURE_DAYS = 366/);
  assert.match(service, /WORKSPACE_ARCHIVE_LOOKBACK_DAYS = 365/);
  assert.match(service, /where\("service\.eventDate", ">=", fromDate\)/);
  assert.match(service, /where\("service\.eventDate", "<", toDate\)/);
  assert.match(service, /limit\(WORKSPACE_BOOKING_LIMIT \+ 1\)/);
});

test("Hospitality menu reads target menu-item lifecycle states", () => {
  assert.match(service, /where\("entityType", "==", "Hospitality Menu Item"\)/);
  assert.match(service, /where\("lifecycleStatus", "in", \["draft", "published"\]\)/);
  assert.match(service, /operation: "hospitality-menu\.read"/);
  assert.doesNotMatch(service, /export async function mnkMenuReadContract\(\) \{\s*const snapshot = await canonical\(\)\.get\(\)/);
});

test("Hospitality portal mapping authorization uses an exact bounded lookup", () => {
  assert.match(service, /where\("sourceIdentifier", "in", \[\.\.\.portalSourceIdentifiers\]\)/);
  assert.match(service, /operation: "hospitality-booking\.authorisation-mapping"/);
  assert.doesNotMatch(service, /const mappingSnapshot = await sourceMappings\(\)\.get\(\)/);
});

test("Hospitality booking ingest does not enumerate canonical or source-mapping collections", () => {
  const ingest = service.slice(service.indexOf("export async function ingestMnkBooking"));
  assert.doesNotMatch(ingest, /transaction\.get\(canonical\(\)\)/);
  assert.doesNotMatch(ingest, /transaction\.get\(sourceMappings\(\)\)/);
  assert.match(ingest, /where\("entityType", "==", "Hospitality Menu Item"\)/);
  assert.match(ingest, /where\("sourceIdentifier", "in", mappingIdentifiers\)/);
  assert.match(ingest, /canonical\(\)\.doc\(stableDocumentId\(destinationId\)\)/);
});

test("Hospitality workspace uses bounded batch production reads instead of an N+1 loop", () => {
  assert.match(service, /productionOrdersForBookings\(/);
  assert.match(service, /where\("sourceBookingId", "in", chunk\)/);
  assert.match(service, /db\.getAll\(\.\.\.ids\.map/);
  assert.doesNotMatch(service, /rows\.map\(async/);
  assert.doesNotMatch(service, /latestProductionOrderForBooking\(booking\.canonicalId\)/);
});

test("Hospitality handoff, amendment, and cancellation share CPU propagation", () => {
  assert.match(service, /changeType: "created"/);
  assert.match(service, /changeType: "amended"/);
  assert.match(service, /changeType: "withdrawn"/);
  assert.match(service, /propagateProductionChanges\(result\.projectionChanges\)/);
  assert.match(service, /propagateProductionChanges\(\[\{ order, changeType: "created"/);
});

test("CPU is the single downstream fanout owner for Hub production mutations", () => {
  assert.match(route, /notifyCpuProjection/);
  assert.doesNotMatch(route, /notifyLogisticsProjection/);
  assert.match(bookingRoute, /createProductionOrder/);
});

test("Hospitality API and direct reads are included in the shared attribution trace", () => {
  assert.match(bookingRoute, /withDataTrace\(\{ app: "integration-hub", action: "integration-hub\.hospitality-bookings\.read"/);
  assert.match(service, /hospitality\.workspace\.bookings/);
  assert.match(service, /hospitality\.production-orders\.by-bookings/);
  assert.match(service, /hospitality\.quote-settings\.by-dashboard/);
});
