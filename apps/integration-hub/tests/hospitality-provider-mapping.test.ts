import test from "node:test";
import assert from "node:assert/strict";
import { planProviderItemLink } from "../lib/hospitality-provider-mapping";
import type { CanonicalRecord } from "../lib/types";
export const mappingItem = (id = "item:company", extra: Record<string, unknown> = {}): CanonicalRecord => ({ canonicalId: id, entityType: "Hospitality Menu Item", lifecycleStatus: "published", publicationStatus: "published", dataHash: "synthetic", record: { canonicalId: id, version: 3, lifecycleState: "active", name: "Synthetic canonical Item", defaultMinimumQuantity: 8, configuration: { rules: { productionConversion: { productionUnit: "pieces", factor: 3 } } }, providerMappings: [{ provider: "mnk-booking-platform", sourceItemId: "original" }], ...extra } });
const link = { itemId: "item:company", expectedVersion: 3, provider: "cfc-hospitality-brochure", sourceItemId: "deli-sandwich-lunch", sourceVersion: "source-v1" };
test("explicit provider linking preserves Item identity, unrelated aliases and all business fields", () => {
  const item = mappingItem(); const before = structuredClone(item);
  const plan = planProviderItemLink([item], link);
  assert.equal(plan.item.canonicalId, item.canonicalId); assert.equal(plan.unchanged, false);
  assert.deepEqual(item, before); assert.equal(plan.providerMappings.length, 2);
  assert.deepEqual(plan.providerMappings[1], { provider: link.provider, sourceItemId: link.sourceItemId, sourceVersion: link.sourceVersion });
});
test("same current association is a no-op, stale versions and duplicate active ownership reject", () => {
  const linked = mappingItem("item:company", { providerMappings: [link] });
  assert.equal(planProviderItemLink([linked], link).unchanged, true);
  assert.throws(() => planProviderItemLink([linked], { ...link, expectedVersion: 2 }), /changed elsewhere/);
  assert.throws(() => planProviderItemLink([mappingItem(), mappingItem("item:other", { providerMappings: [link] })], link), /another active/);
  assert.throws(() => planProviderItemLink([mappingItem("item:company", { providerMappings: [link, link] })], link), /duplicated/);
});
test("unknown provider/source, missing, withdrawn or archived canonical Item never gets linked", () => {
  for (const patch of [{ provider: "invented" }, { sourceItemId: "invented" }]) assert.throws(() => planProviderItemLink([mappingItem()], { ...link, ...patch }));
  assert.throws(() => planProviderItemLink([], link), /active canonical/);
  assert.throws(() => planProviderItemLink([mappingItem("item:company", { lifecycleState: "archived" })], link), /active canonical/);
  assert.throws(() => planProviderItemLink([{ ...mappingItem(), publicationStatus: "withdrawn" }], link), /active canonical/);
  const retiredHolder = mappingItem("item:old", { lifecycleState: "archived", providerMappings: [link] });
  assert.equal(planProviderItemLink([mappingItem(), retiredHolder], link).unchanged, false);
});
