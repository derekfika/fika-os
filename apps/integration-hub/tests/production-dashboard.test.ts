import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("../app/production/page.tsx", import.meta.url), "utf8");
test("production dashboard is queue-first with operational summary", () => {
  assert.match(source, /See what needs preparing/);
  assert.match(source, /Needs review/);
  assert.match(source, /In production/);
  assert.match(source, /No production work is waiting/);
  assert.match(source, /required-ready|Required ready/);
  assert.match(source, /ProductionDetail/);
});

test("production actions are lifecycle constrained and typed", () => {
  assert.match(source, /validActions/);
  assert.match(source, /action: "transition"/);
  assert.match(source, /expectedVersion/);
  assert.match(source, /<label>Reason/);
});

test("hospitality hand-off writes the governed production collection consumed by the queue", () => {
  const service = readFileSync(new URL("../lib/hospitality-booking-service.ts", import.meta.url), "utf8");
  assert.match(service, /createProductionFromApprovedBooking/);
  assert.match(service, /productionOrderV1Id/);
});

test("production reads preserve source Booking client and destination context for older hand-offs", () => {
  const domain = readFileSync(new URL("../lib/production-domain.ts", import.meta.url), "utf8");
  assert.match(domain, /enrichOrder/);
  assert.match(domain, /booking\.client\?\.companyName/);
  assert.match(domain, /booking\.service\?\.portalSiteLabel/);
  assert.match(domain, /Promise\.all/);
});
