import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { NextRequest } from "next/server";
import { resolveMenuActor } from "../lib/auth";
import { middleware } from "../middleware";

test("hosted mutation auth uses FIKA_HUB_BASE_URL and forwards the session cookie", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalFikaHub = process.env.FIKA_HUB_BASE_URL;
  const originalIntegrationHub = process.env.INTEGRATION_HUB_BASE_URL;
  const originalFetch = globalThis.fetch;
  let calledUrl = "";
  let calledCookie = "";
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://fika-hub-staging.example/";
  process.env.INTEGRATION_HUB_BASE_URL = "http://localhost:3200";
  globalThis.fetch = (async (input, init) => { calledUrl = String(input); calledCookie = new Headers(init?.headers).get("cookie") || ""; return Response.json({ principal: { identityId: "staff-1", email: "staff@example.com" }, canManage: true, canPublish: false }); }) as typeof fetch;
  try {
    const actor = await resolveMenuActor(new NextRequest("https://menu.example/api/rolling-menu", { headers: { cookie: "fika_os_session=session-value" } }));
    assert.equal(actor.role, "reviewer");
    assert.equal(calledUrl, "https://fika-hub-staging.example/api/menu-planning/access");
    assert.equal(calledCookie, "fika_os_session=session-value");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalFikaHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = originalFikaHub;
    if (originalIntegrationHub === undefined) delete process.env.INTEGRATION_HUB_BASE_URL; else process.env.INTEGRATION_HUB_BASE_URL = originalIntegrationHub;
  }
});

test("staging auth outage never falls back to a synthetic administrator", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const env = process.env as Record<string, string | undefined>;
  const originalNodeEnv = env.NODE_ENV;
  const originalFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "staging";
  env.NODE_ENV = "development";
  globalThis.fetch = (async () => { throw new Error("Hub unavailable"); }) as typeof fetch;
  try {
    await assert.rejects(() => resolveMenuActor(new NextRequest("https://menu.example/api/rolling-menu")), error => (error as { status?: number }).status === 503);
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = originalNodeEnv;
  }
});

test("cross-subdomain staging admission forwards the shared parent-domain session", async () => {
  const originalMode = process.env.FIKA_RUNTIME_MODE;
  const originalHub = process.env.FIKA_HUB_BASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIKA_HUB_BASE_URL = "https://staging-os.fikacatering.com";
  let forwardedCookie = "";
  globalThis.fetch = (async (_input, init) => { forwardedCookie = new Headers(init?.headers).get("cookie") || ""; return Response.json({ principal: { identityId: "staff-1", email: "staff@example.com" }, canManage: true, canPublish: false }); }) as typeof fetch;
  try {
    await middleware(new NextRequest("https://menu-planning-staging.fikacatering.com/", { headers: { cookie: "fika_os_session=shared-session" } }));
    assert.equal(forwardedCookie, "fika_os_session=shared-session");
  } finally {
    globalThis.fetch = originalFetch;
    if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
    if (originalHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = originalHub;
  }
});

test("hosted mutation auth has an explicit missing-Hub configuration failure", () => {
  const source = readFileSync(new URL("../lib/hub-url.ts", import.meta.url), "utf8");
  assert.match(source, /hosted\(\) && !configured/);
  assert.match(source, /MENU_HUB_ENDPOINT_NOT_CONFIGURED/);
  assert.match(source, /menuPlanningHubBaseUrl/);
});
