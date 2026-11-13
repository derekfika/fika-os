import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "../app/api/signed-allergen-pdf/route";

let saved: NodeJS.ProcessEnv;
test.beforeEach(() => {
  saved = { ...process.env };
  Object.assign(process.env, { FIKA_RUNTIME_MODE: "local", NODE_ENV: "test", FIKA_HUB_BASE_URL: "http://hub.test" });
  for (const key of ["K_SERVICE", "K_REVISION", "K_CONFIGURATION"]) delete process.env[key];
});
test.afterEach(() => {
  for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
  Object.assign(process.env, saved);
});

test("signed PDF route requires a Hub-authenticated CPU actor before reading an order", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ error: { message: "Not admitted", code: "FIKA_ACCESS_DENIED" } }, { status: 401 }); });
  const response = await GET(new NextRequest("https://cpu.fikacatering.com/api/signed-allergen-pdf?orderId=order%3A1", { headers: { cookie: "fika_session=invalid" } }));
  assert.equal(response.status, 401);
  assert.equal(calls, 1, "an unauthenticated request must stop before the Production Order read");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});

test("signed PDF route rejects a Production Order outside the caller's OPLOC scope", async t => {
  const paths: string[] = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL, init?: RequestInit) => {
    const path = new URL(String(url)).pathname;
    paths.push(path);
    if (path === "/api/cpu-production/access") return Response.json({ principal: { id: "cpu-chef" }, allOplocs: false, oplocs: [{ id: "oploc:allowed" }] });
    if (path === "/api/production") return Response.json({ order: { canonicalId: "order:other-site", version: 4, destinationOplocId: "oploc:other", destination: { kind: "oploc", oplocId: "oploc:other" }, origin: "menu_planning", status: "planned" } });
    if (path === "/api/oploc-labels") {
      assert.equal(init?.method, "POST");
      return Response.json({ oplocs: [{ canonicalId: "oploc:other", requestedId: "oploc:other", label: "Other site" }] });
    }
    throw new Error(`Unexpected upstream request ${path}`);
  });
  const response = await GET(new NextRequest("https://cpu.fikacatering.com/api/signed-allergen-pdf?orderId=order%3Aother-site", { headers: { cookie: "fika_session=valid" } }));
  assert.equal(response.status, 403);
  assert.ok(paths.includes("/api/cpu-production/access"));
  assert.ok(paths.includes("/api/production"));
  assert.ok(paths.includes("/api/oploc-labels"));
  assert.equal(paths.some(path => path.includes("signed-allergen") || path.includes("drive")), false, "scope denial occurs before plan or Drive access");
  assert.match(response.headers.get("cache-control") || "", /no-store/);
});


test("master date PDF requires all-site CPU authority before order or Drive reads", async t => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => { calls++; return Response.json({ principal: { id: "scoped-chef" }, allOplocs: false, oplocs: [{ id: "oploc:one" }] }); });
  const response = await GET(new NextRequest("https://cpu.fikacatering.com/api/signed-allergen-pdf?document=master&serviceDate=2026-11-13&download=pdf", { headers: { cookie: "fika_session=valid" } }));
  assert.equal(response.status, 403); assert.ok(calls <= 2); assert.match(response.headers.get("cache-control") || "", /no-store/);
});
