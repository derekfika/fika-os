import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { orderedQuantityLabel } from "../lib/ordered-quantity";

const productionDetail = readFileSync(new URL("../app/ui/ProductionOrderDetail.tsx", import.meta.url), "utf8");
const grabAndGoDetail = readFileSync(new URL("../app/ui/GrabAndGoOrderDetail.tsx", import.meta.url), "utf8");

test("order detail views keep each customer's recorded unit and flag missing legacy evidence", () => {
  const lines = [
    { customerQuantity: 15, customerUnit: "Per person" },
    { customerQuantity: 2, customerUnit: "boxes" },
    { customerQuantity: 3, customerUnit: "trays" },
    { customerQuantity: 7, customerUnit: "pieces" },
    { customerQuantity: undefined, customerUnit: undefined },
    { customerQuantity: 15, customerUnit: " " },
  ] as unknown as Parameters<typeof orderedQuantityLabel>[0][];
  assert.deepEqual(lines.map(line => orderedQuantityLabel(line)), [
    "15 pax", "2 boxes", "3 trays", "7 pieces", "Needs verification", "Needs verification",
  ]);
});

test("generic and Grab and Go details format each line without summing unlike units", () => {
  for (const source of [productionDetail, grabAndGoDetail]) {
    assert.match(source, /order\.lines\.length\.toLocaleString\(\).*ordered line/);
    assert.match(source, /orderedQuantityLabel\(line\)/);
    assert.doesNotMatch(source, /order\.lines\.reduce\(/);
    assert.doesNotMatch(source, /line\.customerQuantity|line\.customerUnit/);
  }
});
