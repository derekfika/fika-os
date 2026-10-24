import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import { createHubClient, getHubBaseUrl, getServiceToken, isHubError } from "../lib/hub-client";
import { resolveOplocDestination } from "../lib/destinations";
import { AD_HOC_HUB_API, adHocProductionOrderId, adHocSendKey, type AdHocSendCommand } from "../../shared/ad-hoc-production-contract";

type Seen = { method?: string; url?: string; headers: http.IncomingHttpHeaders; body: string };
async function hub(handler: (seen: Seen, res: http.ServerResponse) => void) {
  const seen: Seen[] = [];
  const server = http.createServer((req, res) => { let body = ""; req.on("data", chunk => { body += chunk; }); req.on("end", () => { const entry = { method: req.method, url: req.url, headers: req.headers, body }; seen.push(entry); handler(entry, res); }); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, seen, close: () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }) };
}
const json = (res: http.ServerResponse, status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
const local = (url: string, extra: Record<string, string> = {}) => ({ FIKA_RUNTIME_MODE: "local", FIKA_HUB_BASE_URL: url, ...extra });
const command: AdHocSendCommand = { action: "send", requestId: "adhoc-request:1", requestVersion: 2, idempotencyKey: adHocSendKey("adhoc-request:1", 2), order: { clientName: "Board lunch", productionCategory: "hospitality", serviceDate: "2026-11-02", deliveryDateTime: "2026-11-02T12:00", requiredBy: "2026-11-02T12:00", serviceWindow: { startTime: "12:00" }, destinationOplocId: "oploc:a", requiresDelivery: true, deliveryLocation: "A", serviceType: "Ad-hoc", pax: 5, priority: "normal", sourceReference: "REQ-1", sourceEntityId: "adhoc-request:1", sourceVersion: 2, stableSourceIdentity: true, lines: [{ sourceLineId: "line:1", itemName: "Buffet", customerQuantity: 1, customerUnit: "portions", productionQuantity: 1, productionUnit: "portions" }] } };
const sendOk = { canonicalId: adHocProductionOrderId("adhoc-request:1"), orderVersion: 1, orderStatus: "draft", outcome: "created", destination: { oplocId: "oploc:a", label: "A" } };

test("requests forward the caller's session and the service token, with the contract paths", async () => {
  const server = await hub((seen, res) => json(res, 200, seen.url!.startsWith(AD_HOC_HUB_API.access) ? { principal: { id: "u1", displayName: "Una" }, oplocs: [] } : sendOk));
  try {
    const client = createHubClient({ cookie: "fika_session=abc", requestId: "req-1", env: local(server.url, { FIKA_INTERNAL_API_TOKEN: "shared-secret" }) });
    assert.equal((await client.access({ oplocs: true })).principal.id, "u1");
    assert.equal((await client.send(command)).outcome, "created");
    assert.equal(server.seen[0].url, `${AD_HOC_HUB_API.access}?oplocs=true`);
    assert.equal(server.seen[1].url, AD_HOC_HUB_API.orders);
    for (const entry of server.seen) {
      assert.equal(entry.headers.cookie, "fika_session=abc");
      assert.equal(entry.headers["x-fika-internal-token"], "shared-secret");
      assert.equal(entry.headers["x-request-id"], "req-1");
    }
    assert.deepEqual(JSON.parse(server.seen[1].body).idempotencyKey, adHocSendKey("adhoc-request:1", 2), "the per-version idempotency key is sent unchanged");
  } finally { await server.close(); }
});

test("an unreachable Hub is reported as unconfirmed for changes and unavailable for reads", async () => {
  const env = local("http://127.0.0.1:1");
  const client = createHubClient({ env });
  await assert.rejects(client.send(command), (error: any) => isHubError(error) && error.kind === "unconfirmed" && /safe to try again/.test(error.message) && error.status === 503);
  await assert.rejects(client.status("adhoc-request:1"), (error: any) => isHubError(error) && error.kind === "unavailable");
});

test("a Hub that stalls past the timeout is reported as unconfirmed (the change may have committed)", async () => {
  const server = await hub(() => { /* never respond */ });
  try {
    const original = AbortSignal.timeout;
    AbortSignal.timeout = () => original.call(AbortSignal, 150);
    try { await assert.rejects(createHubClient({ env: local(server.url) }).send(command), (error: any) => error.kind === "unconfirmed" && error.code === "AD_HOC_HUB_TIMEOUT"); }
    finally { AbortSignal.timeout = original; }
  } finally { await server.close(); }
});

test("Hub failures map to honest, typed errors", async () => {
  const cases: Array<[number, unknown, string]> = [[401, { error: { message: "Authentication is required." } }, "unauthorised"], [403, { error: { message: "No access." } }, "forbidden"], [422, { error: { code: "X", message: "CPU has already moved this order. Contact CPU." } }, "rejected"], [500, { error: { message: "boom" } }, "unconfirmed"], [502, "<html>bad gateway</html>", "unconfirmed"]];
  for (const [status, body, kind] of cases) {
    const server = await hub((_seen, res) => typeof body === "string" ? (res.writeHead(status), res.end(body)) : json(res, status, body));
    try { await assert.rejects(createHubClient({ env: local(server.url) }).send(command), (error: any) => error.kind === kind && (status !== 422 || /Contact CPU/.test(error.message)), `HTTP ${status}`); }
    finally { await server.close(); }
  }
});

test("order status: 404 means no order; a malformed body is rejected rather than trusted", async () => {
  const missing = await hub((_seen, res) => json(res, 404, { error: { code: "AD_HOC_ORDER_NOT_FOUND", message: "none" } }));
  const garbage = await hub((_seen, res) => json(res, 200, { unexpected: true }));
  try {
    assert.equal(await createHubClient({ env: local(missing.url) }).status("adhoc-request:1"), null);
    await assert.rejects(createHubClient({ env: local(garbage.url) }).status("adhoc-request:1"), (error: any) => error.kind === "invalid_response");
    await assert.rejects(createHubClient({ env: local(garbage.url) }).send(command), (error: any) => error.kind === "invalid_response");
  } finally { await missing.close(); await garbage.close(); }
});

test("redirects are refused so credentials are never replayed to another origin", async () => {
  const server = await hub((_seen, res) => { res.writeHead(302, { location: "http://127.0.0.1:1/steal" }); res.end(); });
  try { await assert.rejects(createHubClient({ cookie: "s=1", env: local(server.url, { FIKA_INTERNAL_API_TOKEN: "t" }) }).access(), (error: any) => isHubError(error)); }
  finally { await server.close(); }
});

test("hosted runtimes require an HTTPS Hub URL and the service token (fail closed)", () => {
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging" }), (error: any) => error.code === "AD_HOC_HUB_URL_NOT_CONFIGURED");
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "staging", FIKA_HUB_BASE_URL: "http://hub.example.com" }), (error: any) => error.code === "AD_HOC_HUB_URL_INVALID");
  assert.throws(() => getHubBaseUrl({ FIKA_RUNTIME_MODE: "weird" }), (error: any) => error.code === "AD_HOC_RUNTIME_MODE");
  assert.throws(() => getServiceToken({ FIKA_RUNTIME_MODE: "staging" }), (error: any) => error.code === "AD_HOC_SERVICE_TOKEN_MISSING");
  assert.throws(() => getServiceToken({ NODE_ENV: "production" }), (error: any) => error.code === "AD_HOC_SERVICE_TOKEN_MISSING", "unset runtime mode in a production build is treated as production");
  assert.equal(getServiceToken({ FIKA_RUNTIME_MODE: "local" }), undefined);
  assert.equal(getServiceToken({ FIKA_RUNTIME_MODE: "staging", FIKA_INTERNAL_API_TOKEN: " t " }), "t");
});

test("OPLOC destinations are resolved against the Hub-authorised list, aliases included, with Hub-owned snapshots", () => {
  // The Hub list is already limited to active ("published") OPLOCs the caller may use; Ad-Hoc trusts that authority.
  const access = { oplocs: [{ canonicalId: "oploc:new", label: "New Name", address: "1 Hub Street", lifecycleStatus: "published" }], redirects: { "oploc:old": "oploc:new" } };
  const base = { mode: "oploc" as const, label: "client label", address: "client address", identity: "" };
  const resolved = resolveOplocDestination({ ...base, oplocId: "oploc:old" }, access);
  assert.deepEqual([resolved.oplocId, resolved.label, resolved.address, resolved.identity], ["oploc:new", "New Name", "1 Hub Street", "oploc:new"]);
  assert.throws(() => resolveOplocDestination({ ...base, oplocId: "oploc:other" }, access), (error: any) => error.status === 422);
  const oneOff = { mode: "one_off" as const, label: "x", address: "y", identity: "adhoc-destination:1" };
  assert.equal(resolveOplocDestination(oneOff, access), oneOff);
});
