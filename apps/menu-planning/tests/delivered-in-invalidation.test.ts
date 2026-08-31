import assert from "node:assert/strict";
import { test } from "node:test";
import { forwardDeliveredInInvalidation } from "../lib/production-client";

test("production materialisation replay sends scoped Delivered-In invalidation metadata", async () => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousUrl = process.env.FIKA_APP_DELIVERED_IN_URL;
  const previousToken = process.env.DELIVERED_IN_INTERNAL_API_TOKEN;
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_APP_DELIVERED_IN_URL = "http://delivered-in.test";
  process.env.DELIVERED_IN_INTERNAL_API_TOKEN = "secret";
  let request: { url: string; init?: RequestInit } | undefined;
  globalThis.fetch = (async (input, init) => { request = { url: String(input), init }; return new Response("{}", { status: 200 }); }) as typeof fetch;
  await forwardDeliveredInInvalidation({ schemaVersion: "0.1.0", delivery: { status: "pending", attempts: 0 }, eventId: "production.materialise:publication:day:oploc:v2", eventType: "production.materialise", sourceAggregateId: "aggregate", sourceVersion: 2, occurredAt: "2026-08-31T10:00:00Z", payload: { sourceDomain: "menu-planning", sourceEntityId: "day-1", publicationId: "publication-1", sourcePublicationDayId: "publication-day-1", sourceVersion: 2, sourceContentHash: "hash", destinationOplocId: "oploc-1", serviceDate: "2026-08-31", status: "amended", lines: [] } });
  const body = JSON.parse(String(request?.init?.body));
  assert.equal(request?.url, "http://delivered-in.test/api/delivered-in/invalidate");
  assert.equal(body.eventType, "amended"); assert.equal(body.publicationId, "publication-1"); assert.equal(body.oplocId, "oploc-1"); assert.equal(body.sourceVersion, "2"); assert.equal(body.contentHash, "hash");
  assert.equal((request?.init?.headers as Record<string, string>)["x-fika-internal-token"], "secret");
  globalThis.fetch = previousFetch; if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode; if (previousUrl === undefined) delete process.env.FIKA_APP_DELIVERED_IN_URL; else process.env.FIKA_APP_DELIVERED_IN_URL = previousUrl; if (previousToken === undefined) delete process.env.DELIVERED_IN_INTERNAL_API_TOKEN; else process.env.DELIVERED_IN_INTERNAL_API_TOKEN = previousToken;
});

test("non-production events are ignored by the invalidation consumer", async () => {
  await forwardDeliveredInInvalidation({ schemaVersion: "0.1.0", delivery: { status: "pending", attempts: 0 }, eventId: "event", eventType: "menu.day.published", sourceAggregateId: "aggregate", sourceVersion: 1, occurredAt: "2026-08-31T10:00:00Z", payload: {} });
  assert.ok(true);
});

test("Delivered-In unavailability rejects the replay attempt", async () => {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousUrl = process.env.FIKA_APP_DELIVERED_IN_URL;
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_APP_DELIVERED_IN_URL = "http://delivered-in.test";
  globalThis.fetch = (async () => new Response("unavailable", { status: 503 })) as typeof fetch;
  try {
    await assert.rejects(() => forwardDeliveredInInvalidation({ schemaVersion: "0.1.0", delivery: { status: "pending", attempts: 0 }, eventId: "event-unavailable", eventType: "production.materialise", sourceAggregateId: "aggregate", sourceVersion: 1, occurredAt: "2026-08-31T10:00:00Z", payload: { sourceDomain: "menu-planning", sourceEntityId: "day-1", sourceVersion: 1, destinationOplocId: "oploc-1", serviceDate: "2026-08-31", status: "published", lines: [] } }));
  } finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode;
    if (previousUrl === undefined) delete process.env.FIKA_APP_DELIVERED_IN_URL; else process.env.FIKA_APP_DELIVERED_IN_URL = previousUrl;
  }
});
