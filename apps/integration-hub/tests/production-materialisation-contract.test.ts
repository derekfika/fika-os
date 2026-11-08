import assert from "node:assert/strict";
import test from "node:test";
import { parseExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { projectExternalProductionLine } from "../lib/production-domain";

test("the Menu Planning publisher payload, including publicationId, is accepted by the Hub contract", () => {
  const payload = {
    sourceDomain: "menu-planning" as const,
    sourceEntityId: "rolling-week:2026-09-07:day:0",
    publicationId: "menu-publication:2026-09-07",
    sourcePublicationDayId: "menu-publication:2026-09-07:day:0:v1",
    sourceVersion: 1,
    sourceContentHash: "a".repeat(64),
    destinationOplocId: "oploc:haleon",
    destinationLabel: "Haleon",
    serviceDate: "2026-09-07",
    status: "published" as const,
    lines: [{
      sourceLineId: "entry:salad",
      canonicalItemId: "dish:salad",
      itemName: "Mixed Leaf",
      quantity: 7,
      unit: "portion",
      menuOrderVersion: "fika.menu-order.v1",
      slot: "SALAD 1",
      canonicalSlotId: "SALAD 1",
      canonicalOrderIndex: 0,
      isCoreSalad: true,
      workstream: "delivered_in" as const,
      approvedAllergenSnapshot: {
        allergens: { milk: "clear" },
        sourcePublicationDayId: "menu-publication:2026-09-07:day:0:v1",
        sourceVersion: 1,
        sourceContentHash: "a".repeat(64),
      },
    }],
  };

  assert.deepEqual(parseExternalProductionMaterialisation(payload), payload);
  assert.throws(() => parseExternalProductionMaterialisation({ ...payload, unexpected: true }), /Unrecognized key/);
  assert.throws(() => parseExternalProductionMaterialisation({ ...payload, lines: [{ ...payload.lines[0], canonicalOrderIndex: undefined }] }), /Canonical menu slot metadata requires/);
  const parsed = parseExternalProductionMaterialisation(payload);
  const productionLine = projectExternalProductionLine(parsed, "production-order:menu", 0, "menu_available");
  assert.deepEqual([productionLine.menuOrderVersion, productionLine.slot, productionLine.canonicalSlotId, productionLine.canonicalOrderIndex, productionLine.sortOrder], ["fika.menu-order.v1", "SALAD 1", "SALAD 1", 0, 0]);
  assert.equal(productionLine.isCoreSalad, true);
  assert.deepEqual(productionLine.approvedAllergenSnapshot?.allergens, { milk: "clear" }, "Core metadata does not alter allergen evidence");
  const legacy = { ...payload, lines: [{ ...payload.lines[0], isCoreSalad: undefined }] };
  assert.equal(projectExternalProductionLine(parseExternalProductionMaterialisation(legacy), "production-order:legacy", 0, "menu_available").isCoreSalad, undefined);
});
