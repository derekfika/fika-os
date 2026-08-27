import { readFileSync } from "node:fs";
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { productionItemId } from "../src/production-item-id";
import { normaliseOperationalAllergens } from "../src/allergen-contract";
import { fulfilmentRequirementIdentity } from "../src/fulfilment-requirement";
import { createDomainEvent } from "../src/domain-events";

test("neutral contracts preserve representative deterministic outputs", () => {
  assert.equal(productionItemId("Roast Chicken", "Lunch Menu"), "sandwich:lunch-menu:roast-chicken");
  const allergens = normaliseOperationalAllergens({ noKeyAllergens: "contains", milk: "contains" });
  assert.equal(allergens.no_key_allergens, "contains");
  assert.equal(allergens.milk, "clear");
  assert.equal(allergens.peanuts, "clear");
  assert.equal(fulfilmentRequirementIdentity("cpu-production", "order:1", "oploc:1"), "fulfilment-requirement:cpu-production:order:1:oploc:1");
  assert.equal(createDomainEvent({ eventType: "test", sourceAggregateId: "order:1", sourceVersion: 2, occurredAt: "2026-01-01T00:00:00.000Z", payload: {} }).eventId, "test:order:1:v2");
});

test("neutral package has no application runtime imports", () => {
  const source = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/production.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/allergen-contract.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/fulfilment-requirement.ts", import.meta.url), "utf8") + readFileSync(new URL("../src/domain-events.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /firebase-admin|next\/server|apps\/(integration-hub|menu-planning|delivered-in)|node:fs|node:path/);
});
