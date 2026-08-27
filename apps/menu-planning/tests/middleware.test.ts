import assert from "node:assert/strict";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const requestFor = (pathname: string) => new NextRequest(`https://menu-planning.example${pathname}`);

test("diagnostic middleware bypass is exact and does not call the access service", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "staging";
  let calls = 0;
  globalThis.fetch = (async () => { calls += 1; return new Response(null, { status: 401 }); }) as typeof fetch;
  try {
    const response = await middleware(requestFor("/api/internal/menu-planning-diagnostic"));
    assert.equal(response.status, 200);
    assert.equal(calls, 0);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = originalMode;
  }
});

test("ordinary rolling-menu APIs still require normal Menu Planning access", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalHub = process.env.FIKA_HUB_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://hub.example";
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
  try {
    const response = await middleware(requestFor("/api/rolling-menu"));
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalHub === undefined) delete process.env.FIKA_HUB_BASE_URL;
    else process.env.FIKA_HUB_BASE_URL = originalHub;
  }
});

test("other internal APIs are not automatically bypassed", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalHub = process.env.FIKA_HUB_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://hub.example";
  globalThis.fetch = (async () => new Response(null, { status: 401 })) as typeof fetch;
  try {
    const response = await middleware(requestFor("/api/internal/other-diagnostic"));
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE;
    else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalHub === undefined) delete process.env.FIKA_HUB_BASE_URL;
    else process.env.FIKA_HUB_BASE_URL = originalHub;
  }
});
