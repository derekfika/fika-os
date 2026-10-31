import assert from "node:assert/strict";
import test from "node:test";
import { cpuSessionCode, cpuSignInUrl, fetchCpuApi, type CpuSessionObservation } from "../app/lib/session-recovery";
import { requireCpuActor } from "../lib/cpu-access-client";
import { errorResponse } from "../lib/api";

test("only explicit missing/invalid session 401 responses request sign-in", () => {
  for (const code of ["FIKA_SESSION_MISSING", "FIKA_SESSION_INVALID"] as const) assert.equal(cpuSessionCode(401, { error: { code } }), code);
  for (const status of [200, 403, 500, 503]) assert.equal(cpuSessionCode(status, { error: { code: "FIKA_SESSION_INVALID" } }), undefined);
  for (const body of [undefined, null, {}, { error: { code: "INTERNAL_AUTH_REQUIRED" } }, { error: { message: "Authentication required" } }]) assert.equal(cpuSessionCode(401, body), undefined);
});

test("sign-in reuses the configured Hub root and carries the exact current route", () => {
  const current = "https://cpu-staging.fikacatering.com/?view=day&date=2026-11-02#orders";
  const target = new URL(cpuSignInUrl("https://staging-os.fikacatering.com/", current, "FIKA_SESSION_INVALID")!);
  assert.equal(target.origin, "https://staging-os.fikacatering.com");
  assert.equal(target.pathname, "/");
  assert.equal(target.searchParams.get("returnTo"), current);
  assert.equal(target.searchParams.get("appId"), "cpu-production");
  assert.equal(target.searchParams.get("launchError"), "FIKA_SESSION_INVALID");
  assert.ok(cpuSignInUrl("http://localhost:3200", "http://localhost:14893/?date=2026-11-02", "FIKA_SESSION_MISSING"));
  for (const hub of [undefined, "javascript:alert(1)", "https://user:password@example.com", "http://hub.example", "https://hub.example/wrong-path", "invalid"]) assert.equal(cpuSignInUrl(hub, current, "FIKA_SESSION_MISSING"), undefined);
  assert.equal(cpuSignInUrl("https://staging-os.fikacatering.com", "javascript:alert(1)", "FIKA_SESSION_MISSING"), undefined);
});

test("response observation preserves bodies, distinguishes denial and never retries commands", async () => {
  const saved = globalThis.fetch;
  const observations: CpuSessionObservation[] = [];
  const calls: Array<{ path: string; method?: string }> = [];
  let status = 401;
  let body: unknown = { error: { code: "FIKA_SESSION_MISSING" } };
  globalThis.fetch = async (path, init) => { calls.push({ path: String(path), method: init?.method }); return Response.json(body, { status }); };
  try {
    const response = await fetchCpuApi("/api/production", { method: "POST", body: "synthetic-only" }, value => observations.push(value));
    assert.deepEqual(await response.json(), body);
    assert.equal(calls.length, 1, "an expired mutation must not be replayed");
    assert.equal(observations[0].code, "FIKA_SESSION_MISSING");
    const failureRequest = observations[0].request;
    body = { error: { code: "INTERNAL_AUTH_REQUIRED" } };
    await fetchCpuApi("/api/production", undefined, value => observations.push(value));
    assert.equal(observations.length, 1);
    status = 403;
    await fetchCpuApi("/api/production", undefined, value => observations.push(value));
    assert.equal(observations.at(-1)?.code, "denied");
    status = 200;
    body = { cacheScope: "synthetic:test" };
    await fetchCpuApi("/api/production?cacheScope=1", { cache: "no-store" }, value => observations.push(value));
    assert.equal(observations.at(-1)?.code, "confirmed");
    assert.ok(observations.at(-1)!.request > failureRequest, "request ordering supports rejecting stale session observations");
    const count = observations.length;
    body = {};
    await fetchCpuApi("/api/production?cacheScope=1", undefined, value => observations.push(value));
    assert.equal(observations.length, count, "malformed success cannot dismiss recovery");
    status = 503;
    await fetchCpuApi("/api/production", undefined, value => observations.push(value));
    assert.equal(observations.length, count);
    globalThis.fetch = async () => { throw new TypeError("Network unavailable"); };
    await assert.rejects(fetchCpuApi("/api/production", undefined, value => observations.push(value)), /Network unavailable/);
    assert.equal(observations.length, count, "network failures are not session-expiry evidence");
    globalThis.fetch = async () => Response.json({ cacheScope: "synthetic:other-actor" });
    await assert.rejects(fetchCpuApi("/api/production?cacheScope=1", undefined, value => observations.push(value)), /signed-in account changed/);
    assert.equal(observations.at(-1)?.code, "identity-changed", "another admitted actor must clear the original tab before it continues");
  } finally { globalThis.fetch = saved; }
});

test("CPU admission preserves explicit Hub session codes while retaining rejection", async () => {
  const savedFetch = globalThis.fetch;
  const savedMode = process.env.FIKA_RUNTIME_MODE;
  const savedHub = process.env.FIKA_HUB_BASE_URL;
  process.env.FIKA_RUNTIME_MODE = "local";
  process.env.FIKA_HUB_BASE_URL = "http://localhost:3200";
  const request = { headers: new Headers({ cookie: "synthetic-session=fixture" }) } as never;
  try {
    for (const code of ["FIKA_SESSION_MISSING", "FIKA_SESSION_INVALID"]) {
      globalThis.fetch = async () => Response.json({ error: { code, message: "Sign-in required" } }, { status: 401 });
      const failure = await requireCpuActor(request).then(() => assert.fail("expired sessions must remain rejected"), error => error);
      const response = errorResponse(failure);
      assert.equal(response.status, 401);
      assert.equal((await response.json()).error.code, code);
    }
    globalThis.fetch = async () => Response.json({ error: { code: "FIKA_SESSION_INVALID", message: "Not permitted" } }, { status: 403 });
    await assert.rejects(requireCpuActor(request), error => (error as { status: number; code?: string }).status === 403 && !(error as { code?: string }).code);
  } finally {
    globalThis.fetch = savedFetch;
    if (savedMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = savedMode;
    if (savedHub === undefined) delete process.env.FIKA_HUB_BASE_URL; else process.env.FIKA_HUB_BASE_URL = savedHub;
  }
});
