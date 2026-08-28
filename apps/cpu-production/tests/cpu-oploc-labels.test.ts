import { strict as assert } from "node:assert";
import test from "node:test";
import { NextRequest } from "next/server";
import { withReadableDestinations } from "../lib/cpu-oploc-labels";
import type { ProductionOrder } from "@fika/contracts";

const order = (destinationLabel: string | undefined) => ({
  canonicalId: "production-order:test",
  version: 1,
  destinationOplocId: "oploc:site",
  ...(destinationLabel === undefined ? {} : { destinationLabel }),
  lines: [{ itemName: "test dish" }],
} as unknown as ProductionOrder);

test("readable destination labels skip the OPLOC Hub lookup", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ oplocs: [] }), { status: 200 }); }) as typeof fetch;
  try {
    const result = await withReadableDestinations(new NextRequest("http://localhost"), [order("Site One")]);
    assert.equal(calls, 0);
    assert.equal(result[0].destinationLabel, "Site One");
    assert.equal(result[0].lines[0].itemName, "Test Dish");
  } finally { globalThis.fetch = originalFetch; }
});

test("ID-only destination labels still use OPLOC enrichment", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response(JSON.stringify({ oplocs: [{ canonicalId: "oploc:site", label: "Site One" }] }), { status: 200 }); }) as typeof fetch;
  try {
    const result = await withReadableDestinations(new NextRequest("http://localhost"), [order("oploc:site")]);
    assert.equal(calls, 1);
    assert.equal(result[0].destinationLabel, "Site One");
  } finally { globalThis.fetch = originalFetch; }
});
