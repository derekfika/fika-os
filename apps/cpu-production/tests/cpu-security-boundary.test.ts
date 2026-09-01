import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { internalCpuRequestAllowed } from "../lib/cpu-internal-auth";
import { requireCpuActor } from "../lib/cpu-access-client";
import { POST as invalidatePublication } from "../app/api/menu-publications/invalidate/route";

const route = (name: string) => readFileSync(new URL(`../app/api/${name}/route.ts`, import.meta.url), "utf8");
const menuPlans = route("menu-plans");
const sandwiches = route("sandwiches");
const grabAndGo = route("grab-and-go");
const invalidate = route("menu-publications/invalidate");
const events = route("menu-publications/events");

function request(cookie?: string) {
  return { headers: new Headers(cookie ? { cookie } : {}) } as never;
}

test("CPU user-facing operational routes use server-side CPU admission", () => {
  assert.match(menuPlans, /requireCpuActor\(request\)/);
  assert.match(sandwiches, /requireCpuActor\(request\)/);
  assert.match(grabAndGo, /requireCpuActor\(request\)/);
  assert.match(events, /requireCpuActor\(request\)/);
});

test("anonymous CPU admission is rejected outside explicit local development", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousRuntime = env.FIKA_RUNTIME_MODE;
  const previousHub = env.FIKA_HUB_BASE_URL;
  const previousFetch = globalThis.fetch;
  env.NODE_ENV = "production";
  env.FIKA_RUNTIME_MODE = "staging";
  env.FIKA_HUB_BASE_URL = "https://hub.example";
  globalThis.fetch = async () => new Response(JSON.stringify({ error: { message: "Authentication is required." } }), { status: 401, headers: { "content-type": "application/json" } });
  try {
    await assert.rejects(() => requireCpuActor(request()), error => (error as { status?: number }).status === 401);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv;
    if (previousRuntime === undefined) delete env.FIKA_RUNTIME_MODE; else env.FIKA_RUNTIME_MODE = previousRuntime;
    if (previousHub === undefined) delete env.FIKA_HUB_BASE_URL; else env.FIKA_HUB_BASE_URL = previousHub;
  }
});

test("authenticated CPU admission remains functional", async () => {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ principal: { id: "chef-1", displayName: "Chef" } }), { status: 200, headers: { "content-type": "application/json" } });
  try {
    assert.deepEqual(await requireCpuActor(request("fika_os_session=session")), { uid: "chef-1", name: "Chef", role: "cpu-production" });
  } finally { globalThis.fetch = previousFetch; }
});

test("publication invalidation requires the configured token and fails closed when missing", () => {
  assert.match(invalidate, /internalCpuRequestAllowed\(request\)/);
  assert.equal(internalCpuRequestAllowed(request(), { FIKA_RUNTIME_MODE: "staging", NODE_ENV: "production" }), false);
  assert.equal(internalCpuRequestAllowed(request(), { FIKA_RUNTIME_MODE: "staging", NODE_ENV: "development", FIKA_INTERNAL_API_TOKEN: "secret" }), false);
  assert.equal(internalCpuRequestAllowed({ headers: new Headers({ "x-fika-internal-token": "secret" }) } as never, { FIKA_RUNTIME_MODE: "staging", NODE_ENV: "production", FIKA_INTERNAL_API_TOKEN: "secret" }), true);
});

test("publication invalidation accepts the valid internal token", async () => {
  const previous = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "secret";
  try {
    const response = await invalidatePublication(new Request("http://localhost/api/menu-publications/invalidate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-fika-internal-token": "secret" },
      body: JSON.stringify({ event: "publication_changed", publicationDayId: "day-1", serviceDate: "2026-09-01", version: 1, action: "amended" }),
    }) as never);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { accepted: true });
  } finally {
    if (previous === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previous;
  }
});

test("local synthetic access remains limited to the existing development guard", async () => {
  const env = process.env as Record<string, string | undefined>;
  const previousNodeEnv = env.NODE_ENV;
  const previousRuntime = env.FIKA_RUNTIME_MODE;
  const previousFetch = globalThis.fetch;
  env.NODE_ENV = "development";
  env.FIKA_RUNTIME_MODE = "local";
  globalThis.fetch = async () => { throw new Error("Hub should not be contacted for the explicit local fallback."); };
  try {
    assert.deepEqual(await requireCpuActor(request()), { uid: "local-cpu", name: "Production chef (local)", role: "integration-admin", synthetic: true });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNodeEnv === undefined) delete env.NODE_ENV; else env.NODE_ENV = previousNodeEnv;
    if (previousRuntime === undefined) delete env.FIKA_RUNTIME_MODE; else env.FIKA_RUNTIME_MODE = previousRuntime;
  }
});

test("publication SSE performs admission before opening the stream", () => {
  assert.match(events, /await requireCpuActor\(request\)/);
  assert.ok(events.indexOf("await requireCpuActor(request)") < events.indexOf("new ReadableStream"));
});
