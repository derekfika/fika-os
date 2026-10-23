import assert from "node:assert/strict";
import test from "node:test";
import {
  packingFingerprint,
  packingHash,
  packingView,
  validatePackingOrder,
} from "../lib/packing-checklist";
import type { ProductionOrder } from "../lib/production-types";
const order = {
  canonicalId: "order:1",
  version: 1,
  status: "planned",
  serviceDate: "2026-10-23",
  requiredBy: "2026-10-23T12:00:00Z",
  lines: [
    {
      canonicalId: "line:1",
      itemName: "Dish",
      customerQuantity: 10,
      customerUnit: "portions",
      dietaries: {},
      allergenEvidenceStatus: "missing",
      status: "ready",
      sortOrder: 0,
    },
  ],
} as ProductionOrder;
const head = {
  orderId: order.canonicalId,
  revision: 1,
  entries: {
    [packingHash("line:1")]: {
      fingerprint: packingFingerprint(order, order.lines[0]),
      packed: true,
      at: "2026-10-23T09:00:00Z",
      actorId: "authid:test",
    },
  },
};
test("removed/replaced lines and different orders never inherit checklist completion", () => {
  assert.equal(packingView({ ...order, lines: [] }, head).packedCount, 0);
  assert.equal(
    packingView(
      { ...order, lines: [{ ...order.lines[0], canonicalId: "line:new" }] },
      head,
    ).packedCount,
    0,
  );
  assert.throws(
    () => packingView({ ...order, canonicalId: "order:other" }, head),
    /identity mismatch/,
  );
});
test("status-only refresh retains ticks; changed allergen, dietary, instruction, quantity or destination invalidates", () => {
  assert.equal(
    packingView({ ...order, version: 2, status: "in_production" }, head)
      .packedCount,
    1,
  );
  for (const changes of [
    { customerQuantity: 11 },
    { productionInstructions: "Separate packing" },
    { dietaries: { vegan: 2 } },
    { allergenEvidenceStatus: "confirmed" as const },
  ]) {
    assert.equal(
      packingView(
        { ...order, lines: [{ ...order.lines[0], ...changes }] },
        head,
      ).packedCount,
      0,
    );
  }
  assert.equal(
    packingView({ ...order, destinationOplocId: "oploc:other" }, head)
      .packedCount,
    0,
  );
});
test("cancelled, superseded or ambiguous line identities fail closed", () => {
  assert.throws(
    () => validatePackingOrder({ ...order, status: "cancelled" }),
    /cancelled/,
  );
  assert.throws(
    () => validatePackingOrder({ ...order, supersededBy: "order:new" }),
    /superseded/,
  );
  assert.throws(
    () =>
      validatePackingOrder({
        ...order,
        lines: [...order.lines, ...order.lines],
      }),
    /identities/,
  );
});
