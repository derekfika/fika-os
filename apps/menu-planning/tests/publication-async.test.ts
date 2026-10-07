import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";

const directory = mkdtempSync(join(tmpdir(), "menu-async-"));
const originalDirectory = process.cwd();
process.chdir(directory);
mkdirSync(join(directory, "local-data/menu-planning"), { recursive: true });
writeFileSync(join(directory, "local-data/menu-planning/canonical-menu-items.json"), JSON.stringify({ items: [{ canonicalId: "dish:async", displayName: "Async soup", sourceName: "Async soup", sourceReference: { workbook: "isolated fixture", sheet: "test" }, weekId: "test", dayId: "", revision: 1, category: "soup", reviewStatus: "approved", allergenEvidence: [{ allergen: "milk", value: "contains", source: "isolated fixture" }], mayContainReviewed: true, audit: [] }] }));
process.env.MENU_PLANNING_TEST_MODE = "1";
process.env.MENU_PLANNING_DB_PATH = join(directory, "operational.sqlite");
process.env.FIKA_RUNTIME_MODE = "local";
process.on("exit", () => { process.chdir(originalDirectory); rmSync(directory, { recursive: true, force: true }); });
const { POST: publish } = await import("../app/api/rolling-menu/route");
const { GET: status, POST: publicationCommand } = await import("../app/api/rolling-menu/publications/route");
const { POST: worker } = await import("../app/api/internal/menu-publication-outbox/route");
const { emptyWeek, saveSnapshot } = await import("../lib/rolling-menu");
const { getMenuPlanningEvent, listMenuPlanningEventIdsForPublication, updateMenuPlanningEvent } = await import("../lib/operational-store");
const { getPublicationHandoff } = await import("../lib/publication-handoff");
const { replayMenuPublicationOutbox } = await import("../lib/menu-publication");
const { middleware } = await import("../middleware");
function fixture(date: string) {
  const snapshot = emptyWeek(date, "test-publisher");
  const day = snapshot.days[0];
  const entry = { id: `${snapshot.week.id}:entry:test`, dayId: day.id, date: day.date, slot: "SOUP", itemId: "dish:async", itemLabel: "Async soup", portions: 1, allocations: [{ destinationId: "oploc:async", destinationLabel: "Async site", quantity: 1 }], allergens: {}, audit: [] };
  day.entryIds = [entry.id]; snapshot.week.entryIds = [entry.id]; snapshot.entries = [entry];
  return snapshot;
}
const post = (path: string, body: unknown, token?: string) => new NextRequest(`http://menu.test${path}`, { method: "POST", headers: { "content-type": "application/json", ...(token ? { "x-fika-internal-token": token } : {}) }, body: JSON.stringify(body) });
const internalPath = "/api/internal/menu-publication-outbox";

test("publish returns pending before delivery, survives closed request, and concurrent workers settle each stable event once", async () => {
  const originalFetch = globalThis.fetch;
  let downstreamCalls = 0;
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.includes("/api/menu-planning/access")) return Response.json({ principal: { identityId: "test-publisher" }, canPublish: true, scope: { all: true } });
    if (url.includes("/api/service-arrangements")) return Response.json({ arrangements: [{ oplocId: "oploc:async", lifecycleState: "active", serviceLabel: "Delivered-In" }], oplocs: [{ canonicalId: "oploc:async", label: "Async site" }] });
    downstreamCalls += 1;
    throw new Error("Downstream must never run inline");
  }) as typeof fetch;
  try {
    const source = fixture("2097-04-01");
    await saveSnapshot(source);
    const response = await publish(post("/api/rolling-menu", { action: "publish", weekId: source.week.id }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.handoff.status, "pending");
    assert.ok(body.handoff.pending > 0);
    assert.equal(downstreamCalls, 0);
    const publicationId = body.publication.publicationId;
    const ids = await listMenuPlanningEventIdsForPublication(publicationId);
    assert.equal(ids.length, body.handoff.pending);
    assert.ok((await getMenuPlanningEvent(ids[0]))?.delivery.status === "pending");
    // No response/request/browser object is used by recovery; reopen durable storage.
    const calls = new Map<string, number>();
    const consume = async (event: { eventId: string }) => { calls.set(event.eventId, (calls.get(event.eventId) || 0) + 1); await Promise.resolve(); };
    await Promise.all([replayMenuPublicationOutbox(consume), replayMenuPublicationOutbox(consume)]);
    assert.equal((await getPublicationHandoff(publicationId)).status, "delivered");
    assert.ok([...calls.values()].every(count => count === 1));
    const repeated = await replayMenuPublicationOutbox(() => { throw new Error("Must not redeliver"); });
    assert.equal(repeated.delivered, 0);
    const retried = await publicationCommand(post("/api/rolling-menu/publications", { action: "retry-handoff", publicationId }));
    assert.equal((await retried.json()).handoff.status, "delivered");
    const withdrawn = await publicationCommand(post("/api/rolling-menu/publications", { action: "withdraw-week", publicationId, reason: "Owned test withdrawal" }));
    assert.equal(withdrawn.status, 200);
    assert.equal((await withdrawn.json()).handoff.status, "pending");
    assert.equal(downstreamCalls, 0);
    await replayMenuPublicationOutbox(consume);
    const fresh = await status(new NextRequest(`http://menu.test/api/rolling-menu/publications?publicationId=${encodeURIComponent(publicationId)}`));
    const refreshed = await fresh.json();
    assert.equal(refreshed.handoff.status, "delivered");
    assert.ok(refreshed.publication.days.every((day: { status: string }) => day.status === "withdrawn"));
  } finally { globalThis.fetch = originalFetch; }
});

test("worker authentication fails closed, rejects unbounded input, and exactly bypasses interactive admission", async () => {
  delete process.env.FIKA_INTERNAL_API_TOKEN;
  assert.equal((await worker(post(internalPath, { limit: 25 }))).status, 503);
  process.env.FIKA_INTERNAL_API_TOKEN = "isolated-test-token";
  assert.equal((await worker(post(internalPath, { limit: 25 }))).status, 401);
  assert.equal((await worker(post(internalPath, { limit: 25 }, "wrong"))).status, 403);
  for (const limit of [0, 26, 1.5, "25"]) assert.equal((await worker(post(internalPath, { limit }, "isolated-test-token"))).status, 422);
  assert.equal((await worker(post(internalPath, { limit: 1 }, "isolated-test-token"))).status, 200);
  process.env.FIKA_RUNTIME_MODE = "staging";
  try { assert.equal((await middleware(post(internalPath, {}))).status, 200); }
  finally { process.env.FIKA_RUNTIME_MODE = "local"; }
});

test("authenticated hosted worker delivers real consumer calls and honours the requested event bound", async () => {
  const source = fixture("2097-05-06");
  await saveSnapshot(source);
  const { createPublishedMenuWeek } = await import("../lib/menu-publication");
  const publication = await createPublishedMenuWeek(source.week.id, {}, "test-publisher", new Set(["oploc:async"]), [{ canonicalId: "oploc:async", label: "Async site" }]);
  const originalFetch = globalThis.fetch;
  let materialisations = 0;
  let invalidations = 0;
  globalThis.fetch = (async input => {
    const url = String(input);
    if (url.endsWith("/api/production/materialise")) { materialisations += 1; return Response.json({ cpuHandoff: "delivered" }); }
    if (url.endsWith("/api/delivered-in/invalidate")) { invalidations += 1; return Response.json({}); }
    throw new Error(`Unexpected consumer URL: ${url}`);
  }) as typeof fetch;
  try {
    const first = await worker(post(internalPath, { limit: 1 }, "isolated-test-token"));
    assert.equal((await first.json()).delivered, 1);
    assert.equal((await getPublicationHandoff(publication.publicationId)).status, "pending");
    assert.equal((await worker(post(internalPath, { limit: 25 }, "isolated-test-token"))).status, 200);
    assert.equal((await getPublicationHandoff(publication.publicationId)).status, "delivered");
    assert.equal(materialisations, 1); assert.equal(invalidations, 1);
    await worker(post(internalPath, { limit: 25 }, "isolated-test-token"));
    assert.equal(materialisations, 1); assert.equal(invalidations, 1);
  } finally { globalThis.fetch = originalFetch; }
});

test("delivery failure retains backoff, dead-letter status and deliberate targeted reset", async () => {
  const source = fixture("2097-04-08");
  await saveSnapshot(source);
  const { createPublishedMenuWeek } = await import("../lib/menu-publication");
  const publication = await createPublishedMenuWeek(source.week.id, {}, "test-publisher", new Set(["oploc:async"]), [{ canonicalId: "oploc:async", label: "Async site" }]);
  const ids = publication.handoffEventIds!;
  const id = ids[0];
  const failure = await replayMenuPublicationOutbox(() => { throw new Error("downstream unavailable"); }, new Date(), { eventIds: [id] });
  assert.equal(failure.failed, 1);
  const event = (await getMenuPlanningEvent(id))!;
  assert.equal(event.delivery.status, "failed");
  assert.ok(event.delivery.nextAttemptAt);
  let calls = 0;
  await replayMenuPublicationOutbox(() => { calls += 1; }, new Date(), { eventIds: [id] });
  assert.equal(calls, 0);
  await updateMenuPlanningEvent(id, current => ({ ...current, delivery: { ...current.delivery, status: "pending", attempts: 9, nextAttemptAt: undefined, nextEligibleAt: undefined } }));
  await replayMenuPublicationOutbox(() => { throw new Error("still unavailable"); }, new Date(), { eventIds: [id] });
  assert.equal((await getMenuPlanningEvent(id))?.delivery.status, "dead-letter");
  assert.equal((await getPublicationHandoff(publication.publicationId)).status, "intervention-required");
  await replayMenuPublicationOutbox(() => { calls += 1; }, new Date(), { eventIds: [id] });
  assert.equal(calls, 0);
  await replayMenuPublicationOutbox(() => { calls += 1; }, new Date(), { eventIds: [id], resetDeadLetter: true });
  assert.equal(calls, 1);
  assert.equal((await getMenuPlanningEvent(id))?.delivery.status, "delivered");
});

test("normal mutation routes have no inline replay and persistent UI offers explicit status refresh without polling", () => {
  const route = readFileSync(new URL("../app/api/rolling-menu/route.ts", import.meta.url), "utf8");
  assert.doesNotMatch(route, /replayMenuPublicationOutbox|forwardProductionMaterialisation/);
  const publications = readFileSync(new URL("../app/api/rolling-menu/publications/route.ts", import.meta.url), "utf8");
  const withdrawals = publications.slice(publications.indexOf('body.action === "withdraw-week"'), publications.indexOf('body.action === "retry-archive"'));
  assert.doesNotMatch(withdrawals, /replayMenuPublicationOutbox/);
  const ui = readFileSync(new URL("../app/publication-handoff-status.tsx", import.meta.url), "utf8");
  assert.match(ui, /role="status"/);
  assert.match(ui, /Refresh handoff status/);
  assert.doesNotMatch(ui, /setInterval|setTimeout/);
});
