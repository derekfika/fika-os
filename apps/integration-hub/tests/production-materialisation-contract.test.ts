import assert from "node:assert/strict";
import test from "node:test";
import { parseExternalProductionMaterialisation } from "../lib/production-materialisation-contract";

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
});
