import assert from "node:assert/strict";
import test from "node:test";
import { isValidDeliveredInInvalidation, MAX_DELIVERED_IN_INVALIDATION_EVENT_ID_LENGTH } from "../lib/delivered-in-invalidation-input";

const publicationId = "menu-publication:rolling-week:2026-11-09:menu:2da088ea-716b-414e-8d8f-dee36a043524";
const oplocId = "oploc:95d84de6-b3f5-4c8f-b3a7-6a313b17d701";
const baseInput = {
  sourceDomain: "menu-planning",
  sourceEntityId: "rolling-week:2026-11-09:menu:2da088ea-716b-414e-8d8f-dee36a043524:day:5",
  publicationId,
  eventType: "changed",
  serviceDate: "2026-11-13",
  oplocId,
  sourceVersion: "1",
};

test("accepts a canonical publication materialisation event ID longer than the old 200-character limit", () => {
  const eventId = ["production.materialise", publicationId, publicationId, "v1", "day", "4", "published", oplocId, "v1"].join(":");
  assert.equal(eventId.length, 253);
  assert.equal(isValidDeliveredInInvalidation({ ...baseInput, eventId }), true);
});

test("keeps the event ID bound while rejecting malformed invalidation input", () => {
  assert.equal(MAX_DELIVERED_IN_INVALIDATION_EVENT_ID_LENGTH, 512);
  assert.equal(isValidDeliveredInInvalidation({ ...baseInput, eventId: `event:${"x".repeat(506)}` }), true);
  assert.equal(isValidDeliveredInInvalidation({ ...baseInput, eventId: `event:${"x".repeat(507)}` }), false);
  assert.equal(isValidDeliveredInInvalidation({ ...baseInput, eventId: "event:1", serviceDate: "13-11-2026" }), false);
});
