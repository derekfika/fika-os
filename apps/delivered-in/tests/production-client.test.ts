import assert from "node:assert/strict";
import test from "node:test";
import { forwardProductionMaterialisation } from "../lib/production-client";
import type { ExternalProductionMaterialisation } from "@fika/server-shared/external-production";

const input: ExternalProductionMaterialisation = {
  sourceDomain: "grab-and-go" as const,
  sourceEntityId: "grab-and-go:site:one:2026-09-07",
  sourceVersion: 1,
  destinationOplocId: "oploc:site-one",
  destinationLabel: "oploc:site-one",
  serviceDate: "2026-09-07",
  requiredBy: "2026-09-07T08:00",
  status: "submitted" as const,
  lines: [{ sourceLineId: "line-1", canonicalItemId: "grab:item-1", itemName: "Fruit pot", quantity: 2, unit: "item", workstream: "grab_and_go" }],
};

test("G&G production handoff accepts the successful Hub/CPU response", async () => {
  const originalFetch = globalThis.fetch;
  const originalBase = process.env.INTEGRATION_HUB_BASE_URL;
  const originalToken = process.env.FIKA_INTERNAL_API_TOKEN;
  let request: { url: string; init?: RequestInit } | undefined;
  process.env.INTEGRATION_HUB_BASE_URL = "https://hub.example";
  process.env.FIKA_INTERNAL_API_TOKEN = "staging-token";
  globalThis.fetch = (async (url, init) => {
    request = { url: String(url), init };
    return new Response(JSON.stringify({ cpuHandoff: "delivered" }), { status: 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  try {
    await forwardProductionMaterialisation(input);
    assert.equal(request?.url, "https://hub.example/api/production/materialise");
    assert.equal(request?.init?.method, "POST");
    assert.equal((request?.init?.headers as Record<string, string>)["x-fika-internal-token"], "staging-token");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalBase === undefined) delete process.env.INTEGRATION_HUB_BASE_URL; else process.env.INTEGRATION_HUB_BASE_URL = originalBase;
    if (originalToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = originalToken;
  }
});

test("a pending CPU handoff remains visible to the caller", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ cpuHandoff: "pending" }), { status: 200 })) as typeof fetch;
  try {
    await assert.rejects(() => forwardProductionMaterialisation(input), /CPU projection handoff is pending/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a durable G&G save can report a pending downstream handoff without becoming a false save failure", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ cpuHandoff: "pending" }), { status: 200 })) as typeof fetch;
  try {
    assert.equal(await forwardProductionMaterialisation(input, { allowPending: true }), "pending");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
