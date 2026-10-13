import assert from "node:assert/strict";
import test from "node:test";
import { loadCpuAllergenProjection } from "../app/lib/cpu-allergen-projection-loader";
import { loadCpuDashboardProjection } from "../app/lib/cpu-dashboard-projection-loader";
import { PROJECTION_AUTHORITY_BINDING_VERSION } from "../lib/cpu-projection-authority";
import { UNVERIFIED_LEGACY_ATTENTION } from "../lib/cpu-projection-authority";

/**
 * A projection package WITHOUT a valid `authorityBindingVersion` (a historical package) must never be trusted from a warm client
 * cache. The server downgrades its Hospitality Planned entries on every response; a client whose cached copy matches an unchanged
 * manifest head must not keep rendering the old trusted Planned. Driven through the REAL cache-hit paths of both consumers.
 */
const HEAD = { lastChangeSequence: 684, packageVersion: 3, contentHash: "hash-v3", sourceVersion: "cpu-change-684" };
const hospitalityEntry = (state: "planned" | "planning") => ({
  id: "production-order:v1:booking:mnk:warm", origin: "hospitality_booking", status: "accepted", workflowStatus: state, planningReadiness: state === "planned" ? "ready" : "not_ready", allergenReadiness: state === "planned" ? "ready" : "not_ready",
  attention: state === "planned" ? "" : UNVERIFIED_LEGACY_ATTENTION, serviceDate: "2026-10-19", quantities: [],
});
const projectionOf = (state: "planned" | "planning", marker?: number) => ({
  ...(marker === undefined ? {} : { authorityBindingVersion: marker }), serviceDate: "2026-10-19", weekCommencing: "2026-10-19", revision: 2, lastChangeSequence: 684, rebuiltAt: "2026-10-08T00:00:00.000Z",
  orders: [hospitalityEntry(state)], summary: { orders: 1, ready: state === "planned" ? 1 : 0, attention: state === "planned" ? 0 : 1, planned: state === "planned" ? 1 : 0, totalUnits: 0 },
});
const entryFor = (key: string, value: unknown, marker?: number) => ({
  key, schemaVersion: 1, cacheScope: "staging:fika-os-dev:actor-1", fetchedAt: "2026-10-08T10:00:00.000Z", lastChangeSequence: 684, revision: 2, packageVersion: HEAD.packageVersion, contentHash: HEAD.contentHash, sourceVersion: HEAD.sourceVersion,
  ...(marker === undefined ? {} : { authorityBindingVersion: marker }), value,
});

/** `serverProjection` is what the (already deployed, revalidating) API returns for the body request. */
function harness(options: { cached?: ReturnType<typeof entryFor>; serverProjection: unknown }) {
  const calls: string[] = [];
  const writes: Array<{ authorityBindingVersion?: number; value: unknown }> = [];
  let cached = options.cached;
  const deps = {
    fetch: (async (input: RequestInfo | URL) => {
      const url = String(input); calls.push(url);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (url.includes("cacheScope")) return json({ cacheScope: "staging:fika-os-dev:actor-1" });
      if (url.includes("projectionHead")) return json(HEAD);
      return json({ projection: options.serverProjection, package: { packageVersion: HEAD.packageVersion, contentHash: HEAD.contentHash, sourceVersion: HEAD.sourceVersion } });
    }) as typeof fetch,
    read: async () => cached as never,
    write: async (entry: { authorityBindingVersion?: number; value: unknown }) => { writes.push(entry); cached = entry as never; },
  };
  return { deps, calls, writes, bodyRequests: () => calls.filter(url => url.includes("projection=1")).length };
}
const plannedOf = (projection: unknown) => ((projection as { orders: Array<{ workflowStatus: string }> }).orders[0]).workflowStatus;

test("the marker the client compares is the server's marker", () => {
  assert.equal(PROJECTION_AUTHORITY_BINDING_VERSION, 1);
});

test("DASHBOARD: a warm cached LEGACY Hospitality Planned entry with a matching manifest head is NOT trusted: the body is fetched and the downgrade shown", async () => {
  const setup = harness({ cached: entryFor("week:2026-10-19:all", projectionOf("planned") /* no marker */), serverProjection: projectionOf("planning") });
  const rendered: string[] = [];
  const result = await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, projection => rendered.push(plannedOf(projection)), setup.deps as never);
  assert.equal(setup.bodyRequests(), 1, "the head matched, yet the legacy cache was not used as authoritative");
  assert.deepEqual(rendered, [], "the cached trusted Planned entry was never rendered");
  assert.equal(result.cacheHit, undefined);
  assert.equal(plannedOf(result.projection), "planning", "the revalidated (downgraded) server result is what is shown");
});

test("DASHBOARD: cold API and warm-cache results agree semantically for a legacy package", async () => {
  const server = projectionOf("planning");
  const cold = await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, harness({ serverProjection: server }).deps as never);
  const warm = await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, harness({ cached: entryFor("week:2026-10-19:all", projectionOf("planned")), serverProjection: server }).deps as never);
  assert.deepEqual(warm.projection, cold.projection);
  assert.equal(plannedOf(warm.projection), "planning");
});

test("DASHBOARD: a legacy package stays untrusted on every later load (cached WITHOUT the marker, so it is always revalidated)", async () => {
  const setup = harness({ serverProjection: projectionOf("planning") });
  await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, setup.deps as never);
  assert.equal(setup.writes[0].authorityBindingVersion, undefined, "nothing stamps a marker onto a historical payload");
  await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, setup.deps as never);
  assert.equal(setup.bodyRequests(), 2, "a second load fetches the body again");
});

test("DASHBOARD: a modern authority-bound cached package keeps the normal head-match fast path (no body request)", async () => {
  const setup = harness({ cached: entryFor("week:2026-10-19:all", projectionOf("planning", 1), 1), serverProjection: projectionOf("planning", 1) });
  const result = await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, setup.deps as never);
  assert.equal(result.cacheHit, true);
  assert.equal(setup.bodyRequests(), 0, "zero body requests for a modern package");
});

test("DASHBOARD: a freshly fetched modern package is cached WITH the marker and then takes the fast path", async () => {
  const setup = harness({ serverProjection: projectionOf("planning", 1) });
  await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, setup.deps as never);
  assert.equal(setup.writes[0].authorityBindingVersion, 1);
  const again = await loadCpuDashboardProjection({ view: "week", date: "2026-10-19", scope: "all" }, undefined, setup.deps as never);
  assert.equal(again.cacheHit, true);
  assert.equal(setup.bodyRequests(), 1, "only the first (cold) load fetched a body");
});

test("ALLERGEN LOADER: a warm cached legacy projection with a matching head is NOT trusted; cold and warm agree", async () => {
  const server = projectionOf("planning");
  const legacy = harness({ cached: entryFor("day:2026-10-19", projectionOf("planned")), serverProjection: server });
  const warm = await loadCpuAllergenProjection("2026-10-19", "all" as never, legacy.deps as never);
  assert.equal(legacy.bodyRequests(), 1, "head matched but the legacy cache was not used as authoritative");
  assert.notEqual(warm.cacheHit, true);
  assert.equal(plannedOf(warm.projection), "planning");
  const cold = await loadCpuAllergenProjection("2026-10-19", "all" as never, harness({ serverProjection: server }).deps as never);
  assert.deepEqual(warm.projection, cold.projection);
  assert.equal(legacy.writes[0].authorityBindingVersion, undefined, "no marker is stamped onto a legacy payload");
});

test("ALLERGEN LOADER: a modern authority-bound cached projection keeps the fast path; a fresh modern fetch is cached with the marker", async () => {
  const modern = harness({ cached: entryFor("day:2026-10-19", projectionOf("planning", 1), 1), serverProjection: projectionOf("planning", 1) });
  const hit = await loadCpuAllergenProjection("2026-10-19", "all" as never, modern.deps as never);
  assert.equal(hit.cacheHit, true);
  assert.equal(modern.bodyRequests(), 0);
  const fresh = harness({ serverProjection: projectionOf("planning", 1) });
  await loadCpuAllergenProjection("2026-10-19", "all" as never, fresh.deps as never);
  assert.equal(fresh.writes[0].authorityBindingVersion, 1);
  const second = await loadCpuAllergenProjection("2026-10-19", "all" as never, fresh.deps as never);
  assert.equal(second.cacheHit, true);
});
