import assert from "node:assert/strict";
import test from "node:test";
import { notifyCpuProjection } from "../lib/cpu-projection-client";

const order = { canonicalId: "production-order:v1:booking:test", version: 3, serviceDate: "2026-09-01", updatedAt: "2026-09-01T10:00:00.000Z", createdAt: "2026-09-01T09:00:00.000Z" };

test("hosted CPU projection propagation fails closed when CPU URL is absent", async () => {
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousUrl = process.env.CPU_PRODUCTION_BASE_URL;
  process.env.FIKA_RUNTIME_MODE = "staging";
  delete process.env.CPU_PRODUCTION_BASE_URL;
  try { await assert.rejects(() => notifyCpuProjection(order, "created", "projection:test:v3"), /CPU_PRODUCTION_BASE_URL is required/); }
  finally { if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode; if (previousUrl === undefined) delete process.env.CPU_PRODUCTION_BASE_URL; else process.env.CPU_PRODUCTION_BASE_URL = previousUrl; }
});

test("CPU projection propagation retries with the same idempotency key", async () => {
  const previousMode = process.env.FIKA_RUNTIME_MODE;
  const previousUrl = process.env.CPU_PRODUCTION_BASE_URL;
  const previousFetch = globalThis.fetch;
  let calls = 0;
  let payload: Record<string, unknown> | undefined;
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.CPU_PRODUCTION_BASE_URL = "https://cpu.example.test";
  globalThis.fetch = (async (_input, init) => { calls += 1; payload = JSON.parse(String(init?.body)) as Record<string, unknown>; return calls === 1 ? new Response("failed", { status: 503 }) : Response.json({ applied: true }); }) as typeof fetch;
  try {
    const result = await notifyCpuProjection(order, "amended", "projection:test:v3");
    assert.equal(calls, 2);
    assert.equal("attempts" in result ? result.attempts : undefined, 2);
    assert.equal(payload?.idempotencyKey, "projection:test:v3");
    assert.equal(payload?.changeType, "amended");
  } finally { globalThis.fetch = previousFetch; if (previousMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previousMode; if (previousUrl === undefined) delete process.env.CPU_PRODUCTION_BASE_URL; else process.env.CPU_PRODUCTION_BASE_URL = previousUrl; }
});
