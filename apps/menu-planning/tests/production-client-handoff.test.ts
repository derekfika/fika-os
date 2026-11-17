import assert from "node:assert/strict";
import test from "node:test";
import { forwardProductionMaterialisation } from "../lib/production-client";

const input = {
  sourceDomain: "menu-planning",
  sourceEntityId: "day:handoff-test",
  sourceVersion: 2,
  destinationOplocId: "oploc:handoff-test",
  serviceDate: "2097-05-06",
  status: "amended",
  lines: [],
} as never;

async function withHubResponse(body: unknown, run: () => Promise<void>) {
  const previousFetch = globalThis.fetch;
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousHubUrl = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_HUB_BASE_URL = "http://hub.test";
  globalThis.fetch = (async input => {
    assert.equal(String(input), "http://hub.test/api/production/materialise");
    return Response.json(body);
  }) as typeof fetch;
  try { await run(); }
  finally {
    globalThis.fetch = previousFetch;
    if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode;
    if (previousHubUrl === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = previousHubUrl;
  }
}

test("materialisation acknowledges only confirmed CPU and Logistics delivery", async () => {
  await withHubResponse({ cpuHandoff: "delivered", logisticsHandoff: "delivered" }, async () => {
    await forwardProductionMaterialisation(input);
  });
});

test("pending Logistics projection keeps the Menu Planning outbox attempt unsuccessful", async () => {
  await withHubResponse({ cpuHandoff: "delivered", logisticsHandoff: "pending" }, async () => {
    await assert.rejects(() => forwardProductionMaterialisation(input), /Logistics projection handoff is pending or unconfirmed/);
  });
});

test("legacy or incomplete Hub responses do not falsely acknowledge Logistics delivery", async () => {
  await withHubResponse({ cpuHandoff: "delivered" }, async () => {
    await assert.rejects(() => forwardProductionMaterialisation(input), /Logistics projection handoff is pending or unconfirmed/);
  });
});

test("pending CPU projection remains a retryable delivery failure", async () => {
  await withHubResponse({ cpuHandoff: "pending", logisticsHandoff: "delivered" }, async () => {
    await assert.rejects(() => forwardProductionMaterialisation(input), /CPU projection handoff is pending/);
  });
});
