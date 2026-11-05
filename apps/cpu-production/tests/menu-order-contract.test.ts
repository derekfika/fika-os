import assert from "node:assert/strict";
import test from "node:test";
import { parseExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { fulfilmentDeliveryContentEqual, fulfilmentFromProductionOrder, fulfilmentFromPublishedMenuDay } from "../../shared/fulfilment-requirement";
import type { ProductionOrder } from "../lib/production-types";

test("versioned Menu slot identity survives Hub input, CPU order, and fulfilment projection", () => {
  const input = parseExternalProductionMaterialisation({
    sourceDomain: "menu-planning",
    sourceEntityId: "rolling-week:2031-01-06:day:0",
    publicationId: "menu-publication:2031-01-06",
    sourcePublicationDayId: "menu-publication:2031-01-06:day:0:v1",
    sourceVersion: 1,
    sourceContentHash: "a".repeat(64),
    destinationOplocId: "oploc:test",
    destinationLabel: "Synthetic test site",
    serviceDate: "2031-01-06",
    status: "published",
    lines: [
      { sourceLineId: "entry:salad", canonicalItemId: "dish:salad", itemName: "Leaf Salad", quantity: 12, unit: "portion", menuOrderVersion: "fika.menu-order.v1", slot: "SALAD 1", canonicalSlotId: "SALAD 1", canonicalOrderIndex: 0 },
      { sourceLineId: "entry:side", canonicalItemId: "dish:side", itemName: "Roast Potatoes", quantity: 12, unit: "portion", menuOrderVersion: "fika.menu-order.v1", slot: "STARCH/SIDE 1", canonicalSlotId: "STARCH/SIDE 1", canonicalOrderIndex: 13 },
      { sourceLineId: "entry:legacy", itemName: "Historical item", quantity: 3, unit: "portion", menuOrderVersion: "fika.menu-order.v1", slot: "EXTRAS 6" },
    ],
  });
  const order = {
    canonicalId: "production-order:menu:synthetic",
    version: 1,
    origin: "menu_planning",
    destinationOplocId: "oploc:test",
    destinationLabel: "Synthetic test site",
    serviceDate: "2031-01-06",
    requiredBy: "2031-01-06T12:00:00.000Z",
    status: "menu_available",
    sourceEntityId: input.sourceEntityId,
    sourcePublicationDayId: input.sourcePublicationDayId,
    sourceVersion: input.sourceVersion,
    sourceContentHash: input.sourceContentHash,
    lines: input.lines.map((line, index) => ({
      canonicalId: `production-line:${index + 1}`,
      sourceBookingLineId: line.sourceLineId,
      ...(line.canonicalItemId ? { sourceMenuItemId: line.canonicalItemId } : {}),
      itemName: line.itemName,
      customerQuantity: line.quantity,
      customerUnit: line.unit,
      productionQuantity: line.quantity,
      productionUnit: line.unit,
      dietaries: {},
      status: "ready" as const,
      sortOrder: index,
      ...(line.menuOrderVersion ? { menuOrderVersion: line.menuOrderVersion } : {}),
      ...(line.slot ? { slot: line.slot } : {}),
      ...(line.canonicalSlotId ? { canonicalSlotId: line.canonicalSlotId, canonicalOrderIndex: line.canonicalOrderIndex } : {}),
    })),
  } as unknown as ProductionOrder;

  assert.deepEqual(order.lines.map(line => line.canonicalOrderIndex), [0, 13, undefined]);
  const requirement = fulfilmentFromProductionOrder(order, "test");
  assert.deepEqual(requirement.lines.map(line => [line.sortOrder, line.slot, line.canonicalSlotId, line.canonicalOrderIndex]), [
    [0, "SALAD 1", "SALAD 1", 0],
    [1, "STARCH/SIDE 1", "STARCH/SIDE 1", 13],
    [2, "EXTRAS 6", undefined, undefined],
  ]);
  const changedOrder = { ...order, lines: order.lines.map((line, index) => index === 1 ? { ...line, canonicalOrderIndex: 14 } : line) };
  const amended = fulfilmentFromProductionOrder(changedOrder, "test", "2031-01-06T12:01:00.000Z", requirement);
  assert.equal(fulfilmentDeliveryContentEqual(requirement, amended), false, "a canonical slot amendment is retained in the downstream delivery projection");
  assert.equal(amended.audit.at(-1)?.action, "fulfilment-amended");
});

test("published Menu day fulfils each line with its exact order metadata", () => {
  const requirement = fulfilmentFromPublishedMenuDay({
    publicationDayId: "publication-day:v1",
    sourceDayId: "menu-day:2031-01-06",
    version: 1,
    contentHash: "b".repeat(64),
    date: "2031-01-06",
    status: "published",
    entries: [{
      sourceEntryId: "entry:fish",
      canonicalDishId: "dish:fish",
      dishName: "Baked Fish",
      slot: "COLD PROTEIN FISH",
      menuOrderVersion: "fika.menu-order.v1",
      canonicalSlotId: "COLD PROTEIN FISH",
      canonicalOrderIndex: 7,
      allocations: [{ destinationId: "oploc:test", destinationLabel: "Synthetic test site", quantity: 8 }],
    }],
  }, "oploc:test");
  assert.deepEqual(requirement.lines.map(line => [line.slot, line.canonicalSlotId, line.canonicalOrderIndex]), [["COLD PROTEIN FISH", "COLD PROTEIN FISH", 7]]);
});
