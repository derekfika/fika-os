import assert from "node:assert/strict";
import test from "node:test";
import { resolveHospitalityRouting } from "../lib/hospitality-menu-routing";

function reader(routes: Record<string, Record<string, unknown> | undefined> = {}, merges: Record<string, Record<string, unknown> | undefined> = {}) {
  const reads: string[] = [];
  return { reads, routing: async (id: string) => { reads.push(`routing:${id}`); return routes[id]; }, merge: async (id: string) => { reads.push(`merge:${id}`); return merges[id]; } };
}
const merge = (sourceMenuItemId: string, survivorMenuItemId: string) => ({ sourceMenuItemId, survivorMenuItemId });

test("current item keeps current routing and reads only that identity", async () => {
  const store = reader({ current: { workstreams: ["hospitality"] } });
  assert.deepEqual(await resolveHospitalityRouting(["current"], store, {}), { current: ["hospitality"] });
  assert.deepEqual(store.reads, ["merge:current", "routing:current"]);
});

for (const ids of [["old"], ["old", "current", "old"]]) test(`merged-away item resolves survivor routing when requesting ${ids}`, async () => {
  const store = reader({ old: { workstreams: ["sandwiches"], supersededBy: "current" }, current: { workstreams: ["hospitality"] } }, { old: merge("old", "current") });
  const expected = Object.fromEntries(ids.map(id => [id, ["hospitality"]]));
  assert.deepEqual(await resolveHospitalityRouting(ids, store, { old: ["sandwiches"] }), expected);
  assert.equal(store.reads.filter(read => read === "routing:current").length, 1);
  assert.equal(store.reads.filter(read => read === "merge:current").length, 1);
  assert.ok(!store.reads.includes("routing:old"), "superseded source decision is never active");
  assert.ok(store.reads.every(read => /:(old|current)$/.test(read)), "no collection scan or unrelated document reads");
});

test("survivor without routing never falls back to a source's old decision", async () => {
  const store = reader({ old: { workstreams: ["hospitality"], supersededBy: "current" } }, { old: merge("old", "current") });
  assert.deepEqual(await resolveHospitalityRouting(["old"], store, { old: ["hospitality"] }), {});
});

test("superseded routing without a valid merge is not exposed", async () => {
  assert.deepEqual(await resolveHospitalityRouting(["old"], reader({ old: { supersededBy: "current", workstreams: ["hospitality"] } }), { old: ["hospitality"] }), {});
});

test("multi-hop mappings resolve terminal routing independently of mapping order", async () => {
  const store = reader({ last: { workstreams: ["sandwiches"] } }, { middle: merge("middle", "last"), old: merge("old", "middle") });
  assert.deepEqual(await resolveHospitalityRouting(["old"], store, {}), { old: ["sandwiches"] });
});

test("cycles, malformed mappings and excessive depth fail closed with bounded reads", async () => {
  for (const merges of [{ old: merge("old", "middle"), middle: merge("middle", "old") }, { old: merge("wrong", "last") }, { old: { sourceMenuItemId: "old" } }]) {
    const store = reader({ old: { workstreams: ["hospitality"] } }, merges);
    assert.deepEqual(await resolveHospitalityRouting(["old"], store, { old: ["hospitality"] }), {});
    assert.ok(store.reads.length <= 2);
  }
  const store = reader({}, Object.fromEntries(Array.from({ length: 40 }, (_, i) => [String(i), merge(String(i), String(i + 1))])));
  assert.deepEqual(await resolveHospitalityRouting(["0"], store, {}), {});
  assert.equal(store.reads.length, 32);
});

test("legacy views adapt, explicit empty routing wins, and unknown workstreams reject", async () => {
  assert.deepEqual(await resolveHospitalityRouting(["current"], reader({ current: { views: ["craig"] } }), {}), { current: ["hospitality"] });
  assert.deepEqual(await resolveHospitalityRouting(["current"], reader({ current: { workstreams: [] } }), { current: ["hospitality"] }), { current: [] });
  await assert.rejects(resolveHospitalityRouting(["current"], reader({ current: { workstreams: ["invalid"] } }), {}), /Unknown CPU production workstream/);
});
