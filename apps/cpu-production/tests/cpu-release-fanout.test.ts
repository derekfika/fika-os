import assert from "node:assert/strict";
import test from "node:test";
import { cpuReleaseMaterializationEventId, currentMenuReleaseOrders, groupCurrentMenuReleaseOrders } from "../lib/cpu-release-fanout";
import type { ProductionOrder } from "../lib/production-types";
import { allergenReleaseLineageMatchesOrder } from "../app/lib/production-plan";

const makeOrder = (id: string, oploc: string, overrides: Partial<ProductionOrder> = {}) => ({
  canonicalId: id,
  origin: "menu_planning",
  destinationOplocId: oploc,
  serviceDate: "2026-09-14",
  requiredBy: "2026-09-14T12:00:00Z",
  ...overrides,
} as ProductionOrder);

test("fan-out scope includes every current OPLOC and excludes superseded or unassigned orders", () => {
  const orders = [
    makeOrder("order:haleon", "oploc:haleon"),
    makeOrder("order:xchange", "oploc:xchange"),
    makeOrder("order:old", "oploc:old", { supersededBy: "order:new" }),
    makeOrder("order:unassigned", "", {}),
  ];
  const current = currentMenuReleaseOrders(orders, "2026-09-14");
  assert.deepEqual(current.map(order => order.canonicalId), ["order:haleon", "order:xchange"]);
  assert.deepEqual([...groupCurrentMenuReleaseOrders(orders, "2026-09-14").keys()], ["oploc:haleon", "oploc:xchange"]);
});

test("materialization identity remains independent for equal release IDs", () => {
  const releaseId = "release:2026-09-14:v1";
  const haleon = cpuReleaseMaterializationEventId(releaseId, { canonicalId: "order:haleon", destinationOplocId: "oploc:haleon" });
  const xchange = cpuReleaseMaterializationEventId(releaseId, { canonicalId: "order:xchange", destinationOplocId: "oploc:xchange" });
  assert.notEqual(haleon, xchange);
  assert.match(haleon, /oploc:oploc:haleon/);
  assert.match(xchange, /oploc:oploc:xchange/);
});

test("materialization lineage is fail-closed when the canonical order advances", () => {
  const items = [{ id: "item:1", name: "Dish", note: "", subItems: [{ id: "sub:1", name: "Dish", quantity: 1, allergens: { milk: "clear" as const }, note: "", evidenceStatus: "completed" as const }] }];
  const order = makeOrder("order:haleon", "oploc:haleon", { sourceEntityId: "menu-day:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 2, sourceContentHash: "a".repeat(64) });
  const release = { serviceDate: "2026-09-14", sourceDayId: "menu-day:1", sourcePublicationDayId: "publication-day:1", sourceVersion: 2, sourceContentHash: "a".repeat(64) } as never;
  assert.equal(allergenReleaseLineageMatchesOrder(release, order, items), true);
  assert.equal(allergenReleaseLineageMatchesOrder(release, { ...order, sourceVersion: 3 }, items), false);
  assert.equal(allergenReleaseLineageMatchesOrder(release, { ...order, sourcePublicationDayId: "publication-day:2" }, items), false);
});

test("a service date with no governed allocations has no release fan-out scope", () => {
  assert.equal(currentMenuReleaseOrders([makeOrder("order:unassigned", "", {})], "2026-09-14").length, 0);
  assert.equal(groupCurrentMenuReleaseOrders([], "2026-09-14").size, 0);
});
