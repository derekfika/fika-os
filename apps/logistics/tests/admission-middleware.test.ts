import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { middleware } from "../middleware";

const requestFor = (path: string) => new NextRequest(`https://logistics.example${path}`);
async function withEnv(status: number, path: string) { const oldMode = process.env.FIKA_RUNTIME_MODE; const oldProject = process.env.FIREBASE_PROJECT_ID; const oldHub = process.env.FIKA_HUB_BASE_URL; const oldFetch = globalThis.fetch; process.env.FIKA_RUNTIME_MODE = "staging"; process.env.FIREBASE_PROJECT_ID = "fika-os-test"; process.env.FIKA_HUB_BASE_URL = "https://hub.example"; globalThis.fetch = (async () => Response.json({ error: { code: status === 403 ? "AUTHMOD_IDENTITY_NOT_FOUND" : "AUTHMOD_STORE_UNAVAILABLE" } }, { status })) as typeof fetch; try { return await middleware(requestFor(path)); } finally { globalThis.fetch = oldFetch; if (oldMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = oldMode; if (oldProject === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = oldProject; if (oldHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = oldHub; } }

test("browser 403 rewrites to a local readable error page and never redirects to the launcher", async () => { const response = await withEnv(403, "/"); assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null); assert.match(response.headers.get("x-middleware-rewrite") || "", /admission-error/); });
test("browser 503 rewrites locally and cannot create an app-launcher loop", async () => { const response = await withEnv(503, "/"); assert.equal(response.status, 200); assert.equal(response.headers.get("location"), null); assert.match(response.headers.get("x-middleware-rewrite") || "", /admission-error/); });
test("API admission failures preserve status and structured safe error", async () => { const response = await withEnv(403, "/api/logistics"); assert.equal(response.status, 403); const body = await response.json(); assert.equal(body.error.code, "APP_ACCOUNT_NOT_SET_UP"); assert.match(body.error.message, /not been set up/); assert.ok(body.error.requestId); });
test("valid internal projection requests bypass browser admission and reach the route", async () => {
  const oldMode = process.env.FIKA_RUNTIME_MODE;
  const oldProject = process.env.FIREBASE_PROJECT_ID;
  const oldHub = process.env.FIKA_HUB_BASE_URL;
  const oldToken = process.env.FIKA_INTERNAL_API_TOKEN;
  const oldFetch = globalThis.fetch;
  let admissionCalled = false;
  process.env.FIKA_RUNTIME_MODE = "staging";
  process.env.FIREBASE_PROJECT_ID = "fika-os-test";
  process.env.FIKA_HUB_BASE_URL = "https://hub.example";
  process.env.FIKA_INTERNAL_API_TOKEN = "internal-test-token";
  globalThis.fetch = (async () => { admissionCalled = true; return Response.json({}, { status: 401 }); }) as typeof fetch;
  try {
    const response = await middleware(new NextRequest("https://logistics.example/api/logistics/invalidate", { headers: { "x-fika-internal-token": "internal-test-token" } }));
    assert.equal(response.status, 200);
    assert.equal(admissionCalled, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = oldMode;
    if (oldProject === undefined) delete process.env.FIREBASE_PROJECT_ID; else process.env.FIREBASE_PROJECT_ID = oldProject;
    if (oldHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = oldHub;
    if (oldToken === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = oldToken;
  }
});
