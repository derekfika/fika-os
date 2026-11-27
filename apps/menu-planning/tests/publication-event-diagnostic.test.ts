import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isPublicationEventForPublication, publicationEventDiagnostic } from "../lib/publication-event-diagnostic";
import type { DurableDomainEvent } from "../lib/fika-contracts";

const event: DurableDomainEvent<{ publicationId: string; destinationOplocId: string; status: string }> = {
  eventId: "production.materialise:publication:day:published:oploc:munich:v1",
  eventType: "production.materialise",
  sourceAggregateId: "publication:day:published:oploc:munich",
  sourceVersion: 1,
  occurredAt: "2026-11-26T21:49:12.049Z",
  schemaVersion: "0.1.0",
  payload: { publicationId: "publication", destinationOplocId: "oploc:munich", status: "published" },
  delivery: {
    status: "dead-letter",
    attempts: 10,
    lastAttemptAt: "2026-11-27T00:00:00.000Z",
    deadLetteredAt: "2026-11-27T00:00:00.000Z",
    lastError: "Integration Hub materialised the Production Order, but CPU projection handoff is pending or unconfirmed.",
    leaseOwner: "worker-secret",
    leaseExpiresAt: "2026-11-27T00:01:00.000Z",
  },
};

test("diagnostic is bound to its publication and returns persisted attempt evidence without worker leases", () => {
  assert.equal(isPublicationEventForPublication(event, "publication"), true);
  assert.equal(isPublicationEventForPublication(event, "another-publication"), false);
  const result = publicationEventDiagnostic(event);
  assert.equal(result.payload, event.payload);
  assert.equal(result.delivery.status, "dead-letter");
  assert.equal(result.delivery.attempts, 10);
  assert.equal(result.delivery.lastAttemptAt, "2026-11-27T00:00:00.000Z");
  assert.equal(result.delivery.deadLetteredAt, "2026-11-27T00:00:00.000Z");
  assert.match(result.delivery.lastError || "", /CPU projection handoff is pending or unconfirmed/);
  assert.equal("leaseOwner" in result.delivery, false);
  assert.equal("leaseExpiresAt" in result.delivery, false);
});

test("event diagnostic GET requires organisation-wide publish authority and cannot replay", () => {
  const route = readFileSync(new URL("../app/api/rolling-menu/publications/route.ts", import.meta.url), "utf8");
  const diagnostic = route.slice(route.indexOf("if (eventId !== null)"), route.indexOf("if (publicationId)"));
  assert.match(diagnostic, /actorCanWriteOneOff\(actor, "publish"\)/);
  assert.match(diagnostic, /getMenuPlanningEvent\(eventId\)/);
  assert.match(diagnostic, /isPublicationEventForPublication\(event, publicationId\)/);
  assert.match(diagnostic, /Cache-Control.*no-store/);
  assert.doesNotMatch(diagnostic, /replayMenuPublicationOutbox|updateMenuPlanningEvent|resetMenuPlanningEvent/);
});
