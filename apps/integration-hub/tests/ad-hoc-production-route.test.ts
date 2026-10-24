import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { authoriseAdHocDestination, localAdHocServiceAllowed } from "../lib/ad-hoc-production-auth";
import { GET as ordersGet, POST as ordersPost } from "../app/api/ad-hoc-production/orders/route";
import { GET as accessGet } from "../app/api/ad-hoc-production/access/route";
import { adHocOneOffDestinationId, adHocProductionOrderId, adHocSendKey, AD_HOC_HUB_API, AD_HOC_SERVICE_TOKEN_HEADER, type AdHocOrderInput, type AdHocSendCommand } from "../../shared/ad-hoc-production-contract";
import { db } from "../lib/firebase-admin";

const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";

const order = (requestId: string, version = 1, overrides: Partial<AdHocOrderInput> = {}): AdHocOrderInput => ({
  clientName: "Board lunch", productionCategory: "hospitality", serviceDate: "2099-03-02", deliveryDateTime: "2099-03-02T12:00", requiredBy: "2099-03-02T12:00", serviceWindow: { startTime: "12:00" },
  destinationOplocId: adHocOneOffDestinationId(requestId), requiresDelivery: true, deliveryLocation: "Client residence",
  destinationAddress: { identity: adHocOneOffDestinationId(requestId), label: "Client residence", address: "1 Test Street" },
  serviceType: "Ad-hoc · Board meeting", pax: 10, priority: "normal", sourceReference: "REQ-2099-001", sourceEntityId: requestId, sourceVersion: version, stableSourceIdentity: true,
  lines: [{ sourceLineId: "line:a", itemName: "Buffet", customerQuantity: 10, customerUnit: "portions", productionQuantity: 10, productionUnit: "portions" }],
  ...overrides,
});
const send = (requestId: string, version = 1, overrides: Partial<AdHocOrderInput> = {}): AdHocSendCommand => ({ action: "send", requestId, requestVersion: version, idempotencyKey: adHocSendKey(requestId, version), order: order(requestId, version, overrides) });
const call = (method: "GET" | "POST", path: string, body?: unknown, headers: Record<string, string> = {}) => new NextRequest(`http://localhost${path}`, { method, headers: { "content-type": "application/json", ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const withEnv = async <T>(env: Record<string, string | undefined>, work: () => Promise<T>) => {
  const saved = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]]));
  for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else (process.env as Record<string, string>)[key] = value; }
  try { return await work(); } finally { for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else (process.env as Record<string, string>)[key] = value; } }
};
const requirementsFor = async (orderId: string) => (await db.collection("fikaFulfilmentRequirementsV1").where("sourceEntityId", "==", orderId).get()).docs.map(doc => doc.data());

test("the synthetic local identity is impossible outside a local, non-production, non-hosted Hub", () => {
  assert.equal(localAdHocServiceAllowed({ NODE_ENV: "development" }), true);
  assert.equal(localAdHocServiceAllowed({ NODE_ENV: "test", FIKA_RUNTIME_MODE: "local" }), true);
  for (const env of [{ NODE_ENV: "production" }, { NODE_ENV: "production", FIKA_RUNTIME_MODE: "local" }, { NODE_ENV: "development", FIKA_RUNTIME_MODE: "staging" }, { NODE_ENV: "development", FIKA_RUNTIME_MODE: "production" }, { NODE_ENV: "development", K_SERVICE: "hub" }, { NODE_ENV: "development", GAE_ENV: "standard" }]) {
    assert.equal(localAdHocServiceAllowed(env), false, JSON.stringify(env));
  }
});

test("destination authority: OPLOCs resolve through authorised scope and Hub redirects; one-off identity cannot be forged", () => {
  const scope = { oplocs: [{ canonicalId: "oploc:new", label: "Hub Label", address: "1 Hub Street" }], redirects: { "oploc:old": "oploc:new" } };
  const oploc = (id: string) => send("adhoc-request:1", 1, { destinationOplocId: id, destinationAddress: undefined, deliveryLocation: "client label" });
  const resolved = authoriseAdHocDestination(oploc("oploc:old"), scope);
  assert.deepEqual([resolved.order.destinationOplocId, resolved.order.deliveryLocation, resolved.destination], ["oploc:new", "Hub Label", { oplocId: "oploc:new", label: "Hub Label", address: "1 Hub Street" }]);
  assert.throws(() => authoriseAdHocDestination(oploc("oploc:other"), scope), (error: any) => error.status === 422 && error.code === "AD_HOC_DESTINATION_NOT_AUTHORISED");
  assert.throws(() => authoriseAdHocDestination(oploc("oploc:new"), undefined), (error: any) => error.status === 422);
  const oneOff = send("adhoc-request:1");
  assert.equal(authoriseAdHocDestination(oneOff, undefined).destination.label, "Client residence");
  assert.throws(() => authoriseAdHocDestination(send("adhoc-request:1", 1, { destinationOplocId: "oploc:new" }), scope), (error: any) => /request-scoped identity/.test(error.message), "an OPLOC id cannot be smuggled in as a one-off");
  assert.throws(() => authoriseAdHocDestination(send("adhoc-request:1", 1, { destinationAddress: undefined, destinationOplocId: adHocOneOffDestinationId("adhoc-request:1") }), scope), (error: any) => /requires an address/.test(error.message));
  assert.throws(() => authoriseAdHocDestination({ ...oneOff, idempotencyKey: "adhoc-send:other:v1" }, scope), (error: any) => /idempotency key/.test(error.message));
  assert.throws(() => authoriseAdHocDestination({ ...oneOff, requestVersion: 2 }, scope), (error: any) => /version/.test(error.message));
  assert.throws(() => authoriseAdHocDestination({ ...oneOff, order: { ...oneOff.order, sourceEntityId: "adhoc-request:2" } }, scope), (error: any) => /belong/.test(error.message));
});

test("production-shaped runtime: no session means 401 and the service token alone never authenticates a user", async () => {
  await withEnv({ NODE_ENV: "production", FIKA_RUNTIME_MODE: "staging", FIKA_INTERNAL_API_TOKEN: "secret" }, async () => {
    const withToken = { [AD_HOC_SERVICE_TOKEN_HEADER]: "secret" };
    assert.equal((await ordersPost(call("POST", AD_HOC_HUB_API.orders, send("adhoc-request:1"), withToken))).status, 401);
    assert.equal((await ordersGet(call("GET", `${AD_HOC_HUB_API.orders}?requestId=adhoc-request:1`, undefined, withToken))).status, 401);
    assert.equal((await accessGet(call("GET", AD_HOC_HUB_API.access))).status, 401);
    assert.equal((await ordersPost(call("POST", AD_HOC_HUB_API.orders, send("adhoc-request:1")))).status, 403, "no service token is refused before anything else");
  });
});

test("privileged order operations require the service token whenever one is configured", async () => {
  await withEnv({ NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIKA_INTERNAL_API_TOKEN: "secret" }, async () => {
    assert.equal((await ordersPost(call("POST", AD_HOC_HUB_API.orders, send("adhoc-request:1")))).status, 403);
    assert.equal((await ordersPost(call("POST", AD_HOC_HUB_API.orders, send("adhoc-request:1"), { [AD_HOC_SERVICE_TOKEN_HEADER]: "wrong" }))).status, 403);
    assert.equal((await ordersGet(call("GET", `${AD_HOC_HUB_API.orders}?requestId=x`))).status, 403);
  });
});

test("emulator: send, amend, status and cancel over the route contract create exactly one order and requirement", { skip: !emulatorEnabled }, async () => {
  await withEnv({ NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIKA_INTERNAL_API_TOKEN: undefined }, async () => {
    const requestId = `adhoc-request:${crypto.randomUUID()}`;
    const post = async (body: unknown) => { const response = await ordersPost(call("POST", AD_HOC_HUB_API.orders, body)); return { status: response.status, body: await response.json() }; };

    const created = await post(send(requestId));
    assert.equal(created.status, 200);
    assert.equal(created.body.outcome, "created");
    assert.equal(created.body.canonicalId, adHocProductionOrderId(requestId));
    assert.deepEqual(created.body.destination, { label: "Client residence", address: "1 Test Street" });
    assert.equal((await post(send(requestId))).body.outcome, "already_applied", "a replay is idempotent");
    const amended = await post(send(requestId, 2, { lines: [{ sourceLineId: "line:a", itemName: "Buffet", customerQuantity: 20, customerUnit: "portions", productionQuantity: 20, productionUnit: "portions" }] }));
    assert.equal(amended.body.outcome, "amended");
    assert.equal(amended.body.canonicalId, created.body.canonicalId);
    const requirements = await requirementsFor(created.body.canonicalId);
    assert.equal(requirements.length, 1);
    assert.equal(requirements[0].lines[0].quantity, 20);

    const status = await ordersGet(call("GET", `${AD_HOC_HUB_API.orders}?requestId=${encodeURIComponent(requestId)}`));
    assert.deepEqual(await status.json(), { canonicalId: created.body.canonicalId, orderStatus: "draft", orderVersion: amended.body.orderVersion, cancelled: false });

    const cancelled = await post({ action: "cancel", requestId, reason: "Client cancelled" });
    assert.equal(cancelled.body.outcome, "cancelled");
    assert.equal((await post({ action: "cancel", requestId, reason: "again" })).body.outcome, "already_cancelled");
    assert.equal((await requirementsFor(created.body.canonicalId))[0].status, "withdrawn");
    assert.equal((await ordersGet(call("GET", `${AD_HOC_HUB_API.orders}?requestId=${encodeURIComponent(requestId)}`))).status, 200);
    assert.equal((await ordersGet(call("GET", `${AD_HOC_HUB_API.orders}?requestId=adhoc-request:none`))).status, 404);
    assert.equal((await post({ action: "cancel", requestId: "adhoc-request:none", reason: "x" })).status, 404);
  });
});

test("emulator: malformed or forged commands are rejected before any Hub write", { skip: !emulatorEnabled }, async () => {
  await withEnv({ NODE_ENV: "test", FIKA_RUNTIME_MODE: "local", FIKA_INTERNAL_API_TOKEN: undefined }, async () => {
    const requestId = `adhoc-request:${crypto.randomUUID()}`;
    const post = async (body: unknown) => (await ordersPost(call("POST", AD_HOC_HUB_API.orders, body))).status;
    assert.equal(await post({ ...send(requestId), extra: true }), 422, "unknown fields are refused (strict contract)");
    assert.equal(await post({ ...send(requestId), order: { ...order(requestId), lines: [] } }), 422);
    assert.equal(await post({ ...send(requestId), order: { ...order(requestId), pax: 0 } }), 422);
    assert.equal(await post({ ...send(requestId), idempotencyKey: "adhoc-send:forged:v1" }), 422);
    assert.equal(await post({ ...send(requestId), order: order(requestId, 1, { destinationOplocId: "oploc:forged" }) }), 422);
    assert.equal(await post({ action: "unknown" }), 422);
    assert.equal(await ordersPost(new NextRequest("http://localhost/api/ad-hoc-production/orders", { method: "POST", body: "not json" })).then(response => response.status), 422);
    const written = await db.collection("fikaProductionOrdersV1").doc((await import("../lib/canonical-editor")).stableDocumentId(adHocProductionOrderId(requestId))).get();
    assert.equal(written.exists, false, "nothing was written");
  });
});
