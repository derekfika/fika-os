import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  CATALOGUE_PACKAGE_CONTRACT,
  type CataloguePackage,
} from "@fika/server-shared/hospitality-effective-offering";
import { effectiveServiceLayout } from "@fika/server-shared/hospitality-service-layout";
import { catalogueEligibility, catalogueGateway, publicCatalogueResponse } from "../lib/catalogue-gateway";
import { publicCataloguePath, readStudioCatalogue } from "../lib/catalogue";
import { studioReadScope } from "../lib/auth";
import { studioRuntime } from "../lib/runtime";

const runtime = studioRuntime({
  NODE_ENV: "test",
  FIKA_RUNTIME_MODE: "staging",
  FIREBASE_PROJECT_ID: "fika-os-dev",
  FIKA_HUB_BASE_URL: "https://staging-os.fikacatering.com",
  FIKA_STUDIO_ORIGIN: "https://menu-studio-staging.fikacatering.com",
  FIKA_STUDIO_FIRESTORE_DATABASE: "hospitality-menu-studio",
  FIKA_SESSION_COOKIE_DOMAIN: ".fikacatering.com",
});
const origin = "https://menu-studio-staging.fikacatering.com";
const payload = {
  rows: [], oplocs: [], reviewGroups: [], counts: {}, canonicalisation: {},
  generatedAt: "2026-11-23T10:00:00Z", canManage: true,
};
const cookie = "fixture token+with special characters";
const session = runtime.name + "=" + encodeURIComponent(cookie);
const command = JSON.stringify({ action: "bulk-update", operationId: "fixed-key-777", itemIds: ["item:one"], expectedVersions: { "item:one": 7 } });

function request(method = "GET", body?: string, options: Record<string, string> = {}) {
  return new Request(origin + "/api/catalogue", {
    method, body,
    headers: {
      host: new URL(origin).host,
      origin,
      "content-type": "application/json",
      authorization: "never forwarded",
      cookie: "another_cookie=never-forwarded",
      ...options,
    },
  });
}

function hub({ studioManage = true, catalogueManage = true, status = 200, mutateBody = { message: "Saved", rows: [], package: "unchanged" } as unknown } = {}) {
  const calls: Array<{ url: string; headers: Headers; init?: RequestInit }> = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), init });
    if (url === runtime.hub + "/api/hospitality-studio-access") {
      return Response.json({ permissions: { View: true, Manage: studioManage }, principal: { id: "fixture-operator" } });
    }
    assert.equal(url, runtime.hub + "/api/hospitality-catalogue");
    return Response.json(init?.method === "POST" ? mutateBody : { ...payload, canManage: catalogueManage }, { status });
  };
  return { gateway: catalogueGateway(runtime, fetch), calls };
}

test("reads require a real Studio session and expose only the intersection of available management permissions", async () => {
  const unauthed = hub();
  assert.equal((await unauthed.gateway.GET(request())).status, 401);
  assert.equal(unauthed.calls.length, 0);
  for (const [studioManage, catalogueManage, allowed] of [
    [true, true, true], [false, true, false], [true, false, false],
  ]) {
    const upstream = hub({ studioManage, catalogueManage });
    const read = await upstream.gateway.GET(request(), cookie);
    assert.equal(read.status, 200);
    assert.deepEqual(await read.json(), { ...payload, canManage: allowed });
    assert.equal(read.headers.get("cache-control"), "private, no-store");
    assert.equal(upstream.calls.length, 2);
    for (const { headers, init } of upstream.calls) {
      assert.equal(headers.get("cookie"), session);
      assert.equal(headers.has("authorization"), false);
      assert.equal(init?.redirect, "error");
      assert.equal(init?.cache, "no-store");
    }
  }
});

test("the public package route preserves exact bytes and fences a session or permission change before fetching Hub data", async () => {
  const hash = "a".repeat(64);
  const bytes = Uint8Array.of(31, 139, 8, 0, 93);
  const actor = { id: "fixture-operator", name: "Studio reviewer", canManage: runtime.writes, canPublish: false };
  const scope = studioReadScope(actor, cookie, runtime);
  const calls: string[] = [];
  const fetchHub: typeof fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    assert.equal(new Headers(init?.headers).get("authorization"), null);
    if (path === "/api/hospitality-studio-access") return Response.json({
      permissions: { View: true, Manage: true }, principal: { id: actor.id },
    });
    assert.equal(path, "/api/hospitality-catalogue/public-package/" + hash);
    return new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } });
  };
  const incoming = request("GET", undefined, { "x-fika-studio-scope": scope });
  const allowed = await publicCatalogueResponse(incoming, cookie, runtime, hash, fetchHub);
  assert.equal(allowed.status, 200);
  assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()), bytes);
  const switched = await publicCatalogueResponse(incoming, "different session cookie", runtime, hash, fetchHub);
  assert.equal(switched.status, 403);
  assert.equal((await switched.json()).error.code, "STUDIO_SCOPE_CHANGED");
  assert.equal(calls.filter(call => call.endsWith(hash)).length, 1);
});

test("the admin version proxy validates Hub's head and intersects current capability", async () => {
  const fetchHub: typeof fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/hospitality-studio-access") return Response.json({
      permissions: { View: true, Manage: false }, principal: { id: "fixture-operator" },
    });
    assert.equal(path, "/api/hospitality-catalogue/version");
    return Response.json({ schemaVersion: 1, version: "head-1", canManage: true });
  };
  const response = await catalogueGateway(runtime, fetchHub).version(request(), cookie);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { schemaVersion: 1, version: "head-1", canManage: false });
});

test("concurrent verified reads and the authenticated browser share the same upstream gzip download", async () => {
  const text = JSON.stringify(catalogue);
  const bytes = Uint8Array.from(gzipSync(text));
  const hash = createHash("sha256").update(bytes).digest("hex");
  const manifest = {
    dataset: "hospitality-booking/catalogue", packageVersion: 1, schemaVersion: 2, contractVersion: CATALOGUE_PACKAGE_CONTRACT,
    contentHash: hash, compressedSize: bytes.length, uncompressedSize: Buffer.byteLength(text),
    compression: "gzip", objectName: "fixtures/" + hash, recordCount: 2, generatedAt: "2026-11-26T07:00:00Z",
  };
  let downloads = 0;
  let cataloguePermission = true;
  const upstream: typeof fetch = async input => {
    const path = new URL(String(input)).pathname;
    if (path === "/api/hospitality-studio-access") return Response.json({
      permissions: { View: true, Manage: true }, principal: { id: "fixture-operator" },
    });
    if (!cataloguePermission) return new Response(null, { status: 403 });
    if (path === publicCataloguePath) return Response.json(manifest);
    assert.equal(path, publicCataloguePath + "/" + hash);
    downloads++;
    return new Response(bytes);
  };
  await Promise.all([
    readStudioCatalogue(runtime.hub, session, upstream),
    readStudioCatalogue(runtime.hub, session, upstream),
  ]);
  const allowed = await publicCatalogueResponse(request(), cookie, runtime, hash, upstream);
  assert.equal(allowed.status, 200);
  assert.deepEqual(new Uint8Array(await allowed.arrayBuffer()), bytes);
  cataloguePermission = false;
  const denied = await publicCatalogueResponse(request(), cookie, runtime, hash, upstream);
  assert.equal(denied.status, 403);
  assert.equal(downloads, 1);
});

test("writes fail closed on browser origin, host, media type, command scope and Studio read-only access", async () => {
  const disallowed: Record<string, string>[] = [
    { origin: runtime.hub }, { origin: "" }, { host: "unexpected.example" }, { "sec-fetch-site": "cross-site" },
  ];
  for (const options of disallowed) {
    const upstream = hub();
    assert.equal((await upstream.gateway.POST(request("POST", command, options), cookie)).status, 403);
    assert.equal(upstream.calls.length, 0);
  }
  const readOnly = hub({ studioManage: false });
  assert.equal((await readOnly.gateway.POST(request("POST", command), cookie)).status, 403);
  assert.equal(readOnly.calls.length, 1);

  const write = hub();
  assert.equal((await write.gateway.POST(request("POST", command, { "content-type": "text/plain" }), cookie)).status, 415);
  assert.equal((await write.gateway.POST(request("POST", JSON.stringify({ action: "publish-menu" })), cookie)).status, 422);
  assert.equal((await write.gateway.POST(request("POST", command, { "content-length": "5000000" }), cookie)).status, 413);
  assert.equal((await write.gateway.POST(request("POST", JSON.stringify({ action: "bulk-update", text: "x".repeat(4 * 1024 * 1024) })), cookie)).status, 413);
  assert.ok(write.calls.every(call => call.url.endsWith("/api/hospitality-studio-access")));
});

test("an allowed Studio writer must still pass Hub commercial permission, and commands and replay IDs are preserved", async () => {
  const received = { message: "Applied to one item", package: "stale", rows: [], bulk: { results: [{ itemId: "item:one", status: "applied" }] } };
  for (const status of [200, 403, 409]) {
    const upstream = hub({ status, mutateBody: received });
    const response = await upstream.gateway.POST(request("POST", command), cookie);
    assert.equal(response.status, status);
    if (status === 200) assert.deepEqual(await response.json(), received);
    else assert.match((await response.json()).error.code, status === 403 ? /ACCESS_DENIED/ : /CONFLICT/);
    assert.equal(upstream.calls.length, 2);
    assert.equal(upstream.calls[1].init?.body, command);
    assert.equal(upstream.calls[1].headers.get("origin"), runtime.hub);
    assert.equal(upstream.calls[1].headers.get("cookie"), session);
    assert.equal(upstream.calls[1].headers.has("authorization"), false);
  }
});

test("write response loss, oversized command and malformed receipts cannot look like acknowledged saves", async () => {
  const malformed = hub({ mutateBody: { message: "OK" } });
  const result = await malformed.gateway.POST(request("POST", command), cookie);
  assert.equal(result.status, 503);
  assert.equal((await result.json()).error.code, "CATALOGUE_OUTCOME_UNKNOWN");
  const timeout = catalogueGateway(runtime, async url => {
    if (String(url).endsWith("/api/hospitality-studio-access")) {
      return Response.json({ permissions: { View: true, Manage: true }, principal: { id: "operator" } });
    }
    throw new TypeError("network loss");
  });
  const failed = await timeout.POST(request("POST", command), cookie);
  assert.equal(failed.status, 503);
  assert.equal((await failed.json()).error.code, "CATALOGUE_OUTCOME_UNKNOWN");
});

const itemId = "item:lunchbox";
const siteId = "oploc:fictional";
const catalogue: CataloguePackage = {
  contract: CATALOGUE_PACKAGE_CONTRACT, schemaVersion: 2,
  items: [{
    id: itemId, name: "Lunch box", category: "Lunch Boxes",
    defaultPrices: [{ from: "2026-11-01", to: "2026-12-01", amount: 6, vatRate: 0.2 }, { from: "2026-12-02", amount: 7, vatRate: 0.05 }],
    defaultMinimumQuantity: 3, defaultNoticeRequiredDays: 2,
    dietaryInformation: [], allergenInformation: [],
  }],
  oplocs: [{ id: siteId, label: "Fictional site" }],
  exceptions: [],
};
const query = { itemId, siteId, serviceId: "lunch", eventDate: "2026-12-02" } as const;

test("published eligibility distinguishes category configuration, price inheritance, exceptions and quote-only", () => {
  const standard = catalogueEligibility(catalogue, query);
  assert.deepEqual(standard, { status: "standard", amount: 7, vatRate: 0.05, minimumQuantity: 3, minimumGuests: undefined, noticeRequiredDays: 2 });
  const exception: CataloguePackage["exceptions"][number] = {
    id: "test:exception", itemId, oplocId: siteId, mode: "standard", available: true,
    prices: [{ amount: 9, vatRate: 0.2, from: "2026-11-01" }], minimumQuantity: 8,
  };
  const override = catalogueEligibility({ ...catalogue, exceptions: [exception] }, query);
  assert.equal(override.status, "standard");
  assert.equal(override.minimumQuantity, 8);
  assert.equal(catalogueEligibility({ ...catalogue, exceptions: [{ ...exception, available: false }] }, query).status, "unavailable");
  assert.equal(catalogueEligibility({ ...catalogue, exceptions: [{ ...exception, mode: "quote_only", prices: [] }] }, query).status, "quote_only");
  assert.equal(catalogueEligibility({ ...catalogue, serviceLayout: effectiveServiceLayout({ sites: { [siteId]: { lunch: { categories: ["Drinks"] } } } }) }, query).status, "unavailable");
});
