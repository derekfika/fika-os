import assert from "node:assert/strict";
import test from "node:test";
import type { Firestore } from "firebase-admin/firestore";
import { stableDocumentId } from "@fika/server-shared/stable-document-id";
import fixture from "../fixtures/mnk-legacy-menu-import.candidates.json";
import { applyCanonicalisationGroup } from "../lib/hospitality-catalogue-apply";
import { buildCanonicalisationPlan, type CatalogueSnapshot } from "../lib/hospitality-catalogue-canonicalisation";
import type { CanonicalRecord } from "../lib/types";

const CANONICAL = "integrationHubCanonical";
const ROUTING = "integrationHubHospitalityMenuProductionRouting";
const MERGES = "integrationHubHospitalityMenuItemMerges";
type Data = Record<string, any>;
const path = (collection: string, id: string) => `${collection}/${stableDocumentId(id)}`;

function snapshot(): CatalogueSnapshot {
  const wrap = (record: Data) => ({ canonicalId: record.canonicalId, entityType: record.entityType, record, dataHash: "fixture", lifecycleStatus: "published" }) as CanonicalRecord;
  const a = structuredClone(fixture.items[0]);
  const b = { ...structuredClone(a), canonicalId: a.canonicalId.replace(":mnk:", ":rcoa:"), providerMappings: [{ provider: "rcoa-source", sourceItemId: a.providerMappings[0].sourceItemId }] };
  const offerA = structuredClone(fixture.offerings[0]);
  const offerB = { ...structuredClone(offerA), canonicalId: offerA.canonicalId.replace(":mnk:", ":rcoa:"), hospitalityMenuItemId: b.canonicalId, oplocId: "oploc:rcoa-test" };
  return { items: [wrap(a), wrap(b)], offerings: [wrap(offerA), wrap(offerB)], routing: [a, b].map(item => ({ menuItemId: item.canonicalId, workstreams: ["hospitality"], version: 1 })), merges: [] };
}

/** Isolated transaction adapter: queries enforce filters, reads after writes fail, and rejected callbacks commit nothing. */
function store(before: CatalogueSnapshot) {
  const data = new Map<string, Data>();
  for (const item of [...before.items, ...before.offerings]) data.set(path(CANONICAL, item.canonicalId), structuredClone(item));
  for (const route of before.routing) data.set(path(ROUTING, route.menuItemId), structuredClone(route));
  for (const merge of before.merges || []) data.set(path(MERGES, merge.sourceMenuItemId), structuredClone(merge));
  const reads: string[] = [];
  let commits = 0;
  const collection = (id: string, filters: Array<[string, unknown, string?]> = []): any => ({
    id, filters,
    doc: (docId: string) => ({ path: `${id}/${docId}`, id: docId, parent: { id } }),
    where: (field: string, operator: string, value: unknown) => { assert.ok(operator === "==" || operator === "in"); return collection(id, [...filters, [field, value, operator]]); },
  });
  const doc = (ref: any) => ({ ref, id: ref.id, exists: data.has(ref.path), data: () => structuredClone(data.get(ref.path)) });
  const db = {
    collection,
    async runTransaction(callback: (transaction: any) => Promise<unknown>) {
      const writes = new Map<string, Data>();
      const result = await callback({
        get: async (ref: any) => {
          assert.equal(writes.size, 0, "all transaction reads precede writes");
          if (ref.path) { reads.push(ref.path); return doc(ref); }
          assert.equal(ref.id, CANONICAL);
          assert.ok(ref.filters.length >= 1, "relation reads must be scoped by a stable ID field");
          reads.push(`query:${String(ref.filters[ref.filters.length - 1][1])}`);
          return { docs: [...data.entries()].filter(([key, value]) => key.startsWith(`${ref.id}/`) && ref.filters.every(([field, expected, operator]: [string, unknown, string?]) => { const actual = field.split(".").reduce((value: any, part: string) => value?.[part], value); return operator === "in" ? (expected as unknown[]).includes(actual) : actual === expected; })).map(([key]) => doc(collection(ref.id).doc(key.split("/")[1]))) };
        },
        set: (ref: any, value: Data) => writes.set(ref.path, structuredClone(value)),
        create: (ref: any, value: Data) => { assert.ok(!data.has(ref.path)); writes.set(ref.path, structuredClone(value)); },
      });
      for (const [key, value] of writes) data.set(key, value);
      if (writes.size) commits++;
      return result;
    },
  } as unknown as Firestore;
  return { db, data, reads, commits: () => commits };
}

const changes: Array<[string, (before: CatalogueSnapshot, group: ReturnType<typeof buildCanonicalisationPlan>["groups"][number], data: Map<string, Data>) => void]> = [
  ["survivor provider mappings", (_before, group, data) => { data.get(path(CANONICAL, group.survivorId))!.record.providerMappings.push({ provider: "new", sourceItemId: "new" }); }],
  ["source item without a version bump", (_before, group, data) => { data.get(path(CANONICAL, group.sourceIds[0]))!.record.allergenInformation = ["nuts"]; }],
  ["survivor routing", (_before, group, data) => { data.get(path(ROUTING, group.survivorId))!.workstreams = ["sandwiches"]; }],
  ["source routing", (_before, group, data) => { data.get(path(ROUTING, group.sourceIds[0]))!.version++; }],
  ["offering target", (before, group, data) => { const offer = before.offerings.find(row => row.record.hospitalityMenuItemId === group.sourceIds[0])!; data.get(path(CANONICAL, offer.canonicalId))!.record.hospitalityMenuItemId = "hospitality-menu-item:elsewhere"; }],
  ["survivor offering state", (before, group, data) => { const offer = before.offerings.find(row => row.record.hospitalityMenuItemId === group.survivorId)!; data.get(path(CANONICAL, offer.canonicalId))!.record.configuration = { displayName: "Changed" }; }],
  ["new merge mapping", (_before, group, data) => { data.set(path(MERGES, group.sourceIds[0]), { sourceMenuItemId: group.sourceIds[0], survivorMenuItemId: "hospitality-menu-item:elsewhere" }); }],
  ["existing merge mapping", (_before, group, data) => { data.get(path(MERGES, group.sourceIds[0]))!.survivorMenuItemId = "hospitality-menu-item:elsewhere"; }],
  ["new survivor offering", (before, group, data) => { const extra = structuredClone(before.offerings[0]); extra.canonicalId = "hospitality-menu-offering:new"; extra.record.hospitalityMenuItemId = group.survivorId; data.set(path(CANONICAL, extra.canonicalId), extra); }],
];

for (const [name, change] of changes) test(`apply refuses stale ${name} with no partial writes`, async () => {
  const before = snapshot();
  if (name === "existing merge mapping") before.merges = [{ sourceMenuItemId: before.items[1].canonicalId, survivorMenuItemId: before.items[0].canonicalId }];
  const plan = buildCanonicalisationPlan(before); const group = plan.groups[0];
  assert.ok(group);
  const live = store(before); change(before, group, live.data);
  const changed = structuredClone(live.data);
  await assert.rejects(applyCanonicalisationGroup(live.db, group), /Stale catalogue plan\/conflict.*Regenerate and review a new plan/);
  assert.deepEqual(live.data, changed);
  assert.equal(live.commits(), 0);
});

test("unchanged group applies atomically and retry changes no versions, routing history or audit evidence", async () => {
  const before = snapshot(); const group = buildCanonicalisationPlan(before).groups[0]; const live = store(before);
  assert.equal(await applyCanonicalisationGroup(live.db, group), "applied");
  assert.equal(live.data.get(path(MERGES, group.sourceIds[0]))!.survivorMenuItemId, group.survivorId);
  assert.equal(live.data.get(path(ROUTING, group.sourceIds[0]))!.supersededBy, group.survivorId);
  const applied = structuredClone(live.data);
  assert.equal(await applyCanonicalisationGroup(live.db, group), "already-applied");
  assert.deepEqual(live.data, applied);
  assert.equal(live.commits(), 1);
  assert.equal([...live.data.keys()].filter(key => key.startsWith("integrationHubGovernanceAudit/")).length, 1);
  live.data.get(path(CANONICAL, group.survivorId))!.record.description = "Changed after apply";
  await assert.rejects(applyCanonicalisationGroup(live.db, group), /Stale catalogue plan/);
  assert.equal(live.commits(), 1);
});

test("approval hash covers reviewed state even when declarative operations are unchanged", () => {
  const before = snapshot(); const plan = buildCanonicalisationPlan(before);
  before.items[0].record.version = 2;
  const changed = buildCanonicalisationPlan(before);
  assert.deepEqual(changed.groups[0].operations, plan.groups[0].operations);
  assert.notEqual(changed.planHash, plan.planHash);
  assert.equal(plan.groups[0].expectedState.items[0].record.version, 1, "reviewed snapshot is detached from mutable inputs");
});
