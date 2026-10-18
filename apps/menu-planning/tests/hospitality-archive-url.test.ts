import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { hospitalityArchiveBase } from "../lib/hospitality-archive-url";

const prod = "https://fika-os-prod-hospitality--fika-os.europe-west4.hosted.app";

test("hosted Menu Planning never falls back to localhost for the Hospitality archive endpoint", () => {
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "production" }), undefined);
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "staging" }), undefined);
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "production", HOSPITALITY_BOOKING_BASE_URL: "  " }), undefined);
});

test("local development keeps the localhost default and an explicit value", () => {
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "local" }), "http://localhost:3300");
  assert.equal(hospitalityArchiveBase({}), "http://localhost:3300");
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "local", HOSPITALITY_BOOKING_BASE_URL: "http://localhost:4300/" }), "http://localhost:4300");
});

test("a configured endpoint must be the environment's own Hospitality service", () => {
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "production", HOSPITALITY_BOOKING_BASE_URL: `${prod}/` }), prod);
  assert.throws(() => hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "production", HOSPITALITY_BOOKING_BASE_URL: "https://hospitality-staging.fikacatering.com" }), /not the approved production service/);
  assert.throws(() => hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "staging", HOSPITALITY_BOOKING_BASE_URL: prod }), /resolves to a production service/);
  assert.equal(hospitalityArchiveBase({ FIKA_RUNTIME_MODE: "staging", HOSPITALITY_BOOKING_BASE_URL: "https://hospitality-staging.fikacatering.com" }), "https://hospitality-staging.fikacatering.com");
});

test("publication archiving reports 'not configured' instead of calling a hard-coded address", () => {
  const source = readFileSync(new URL("../lib/menu-publication.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /HOSPITALITY_BOOKING_BASE_URL \|\| "http:\/\/localhost:3300"/);
  assert.match(source, /hospitalityArchiveBase\(\)/);
  assert.match(source, /archiveEndpointRejected \? "failed" : "not_configured"/);
});
