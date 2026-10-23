/**
 * Real Cloud Firestore emulator validation of the standing-order transactions (not a mock).
 * Run with:  npm run test:emulator   (firebase emulators:exec --only firestore ...)
 * Skipped automatically when no emulator is running.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test, { beforeEach } from "node:test";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { OPLOC, MON, SLOTS, THU, activate, fakeFirestore, lines, standingModules, withHostedRuntime as hosted } from "../support/standing-fixture";

const require = createRequire(import.meta.url);
const host = process.env.FIRESTORE_EMULATOR_HOST; const skip = host ? false : "Firestore emulator is not running (use npm run test:emulator).";
const PROJECT = process.env.GCLOUD_PROJECT || "demo-fika-standing";
// Same settings as lib/firebase-admin.ts (existing outbox records carry undefined fields that production ignores).
const app = getApps()[0] || initializeApp({ projectId: PROJECT }); const db = getFirestore(app); try { db.settings({ ignoreUndefinedProperties: true }); } catch { /* already configured */ }
const orders = "fikaDeliveredInGrabAndGoOrdersV1", handoffs = "fikaDeliveredInGrabAndGoHandoffV1", standing = "fikaDeliveredInGrabAndGoStandingOrdersV1";
const all = async (name: string) => (await db.collection(name).get()).docs.map(doc => doc.data());
const clear = async () => { await fetch(`http://${host}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" }); };
beforeEach(async () => { if (host) await clear(); });
void fakeFirestore;

test("emulator: activation creates nothing; the Monday run creates one order with its handoff in one transaction", { skip }, () => hosted(async () => {
  const m = standingModules(db); await activate(m);
  assert.equal((await all(orders)).length, 0);
  const run = await m.run(MON); assert.equal(run.created, 1);
  const stored = await all(orders); assert.equal(stored.length, 1); assert.equal(stored[0].deliveryDate, "2026-11-04"); assert.equal(lines(stored[0] as any), "p:a:5"); assert.equal(stored[0].source.type, "standing-order"); assert.equal(stored[0].control, "automatic");
  const events = await all(handoffs); assert.equal(events.length, 1); assert.equal(events[0].sourceVersion, 1); assert.equal(events[0].payload.destinationOplocId, OPLOC); assert.equal(events[0].delivery.status, "delivered"); assert.equal(m.calls.length, 1);
  assert.equal((await m.run(MON)).created, 0, "replay"); assert.equal((await all(orders)).length, 1); assert.equal((await all(handoffs)).length, 1);
}));

test("emulator: concurrent generator runs under real transaction contention create exactly one order", { skip }, () => hosted(async () => {
  const m = standingModules(db); await activate(m);
  const runs = await Promise.all(Array.from({ length: 6 }, () => m.run(MON)));
  assert.equal(runs.reduce((sum, run) => sum + run.created, 0), 1); assert.equal((await all(orders)).length, 1); assert.equal((await all(handoffs)).length, 1);
  const order = (await all(orders))[0]; assert.equal(order.version, 1); assert.equal(m.calls.filter(call => call.sourceVersion === 1).length, 1, "forwarded once");
}));

test("emulator: a pause racing the generator never leaves an order the paused template did not authorise", { skip }, () => hosted(async () => {
  for (let round = 0; round < 5; round += 1) {
    await clear(); const m = standingModules(db); const active = await activate(m);
    await Promise.allSettled([m.run(MON), m.mutate({ action: "pause", expectedVersion: active.standingOrder.version }, MON)]);
    const head = (await all(standing)).find(doc => doc.recordType === "head")!; const stored = await all(orders);
    assert.equal(head.status, "paused"); assert.ok(stored.length <= 1);
    for (const order of stored) { assert.equal(order.source.templateVersion, 2, "created under the still-active template version"); assert.equal((await all(handoffs)).filter(event => event.sourceAggregateId === order.orderId).length, 1); }
    const after = await m.run(MON); assert.equal(after.templates, 0, "paused templates are never scanned");
  }
}));

test("emulator: template compare-and-set, immutable versions and operation audit with ordered queries", { skip }, () => hosted(async () => {
  const m = standingModules(db); await m.mutate({ action: "save", slots: SLOTS });
  const results = await Promise.allSettled([m.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 1 }] } }), m.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 2 }] } })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]);
  const versions = await m.store.listStandingVersionsHosted(OPLOC); assert.deepEqual(versions.map(version => version.version), [2, 1], "newest first");
  const heads = (await all(standing)).filter(doc => doc.recordType === "head"); assert.equal(heads.length, 1); assert.equal(heads[0].version, 2);
  const active = await m.mutate({ action: "activate", expectedVersion: 2 }); await m.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-04", actor: "derek@example.test" });
  const operations = await m.store.listStandingOperationsHosted(OPLOC); assert.equal(operations.length, 1); assert.equal(operations[0].actor, "derek@example.test"); assert.equal(operations[0].complete, true);
  assert.equal((await m.store.listActiveStandingOrdersHosted(10)).length, 1);
}));

test("emulator: amendment propagation, explicit cancellation, CPU outage visibility and recovery", { skip }, () => hosted(async () => {
  const m = standingModules(db); const created = await activate(m); await m.run(MON); await m.run(THU); m.calls.length = 0;
  const edit = await m.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 10 }] } }, THU);
  const monday = (await all(orders)).find(order => order.deliveryDate === "2026-11-09")!; assert.equal(monday.version, 2); assert.equal(lines(monday as any), "p:a:10"); assert.equal(edit.complete, true); assert.equal(m.calls.at(-1).sourceVersion, 2);
  const paused = await m.mutate({ action: "pause", expectedVersion: edit.standingOrder.version }, THU); m.failForward(true);
  const partial = await m.mutate({ action: "cancel-upcoming", expectedVersion: paused.standingOrder.version, actor: "ops@example.test" }, THU);
  assert.equal(partial.complete, false); assert.equal((await m.store.listStandingOperationsHosted(OPLOC))[0].complete, false);
  const overview = await m.service.standingOverview(OPLOC, m.catalogue(), THU); assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.order!.handoff, "pending");
  m.failForward(false); const recovery = await m.handoff.recoverGrabHandoffs(25, new Date(THU.getTime() + 120_000)); assert.equal(recovery.delivered, 1); assert.equal(m.calls.at(-1).status, "cancelled");
  const healed = await m.service.standingOverview(OPLOC, m.catalogue(), THU); assert.equal(healed.upcoming.find(item => item.deliveryDate === "2026-11-09")!.order!.handoff, "delivered");
  const resumed = await m.mutate({ action: "resume", expectedVersion: paused.standingOrder.version }, THU); assert.equal(resumed.standingOrder.status, "active");
  assert.equal(((await all(orders)).find(order => order.deliveryDate === "2026-11-09")!).status, "cancelled", "cancellation is never resurrected");
}));

test("emulator: legacy documents are invisible and never modified; unsupported head documents are not overwritten", { skip }, () => hosted(async () => {
  const m = standingModules(db); const { stableDocumentId } = m.load(require.resolve("@fika/server-shared/stable-document-id"));
  const legacy = { standingOrderId: `standing:grab-and-go:${OPLOC}:2026-11-04`, oplocId: OPLOC, status: "active", weekdays: ["Monday"], lines: [{ productId: "p:a", quantity: 9 }], version: 4 };
  await db.collection(standing).doc(stableDocumentId(legacy.standingOrderId)).set(legacy);
  assert.deepEqual(await m.store.listActiveStandingOrdersHosted(10), []); await activate(m); await m.run(THU);
  assert.deepEqual((await db.collection(standing).doc(stableDocumentId(legacy.standingOrderId)).get()).data(), legacy); assert.ok(!(await all(orders)).some(order => order.lines.some((line: any) => line.quantity === 9)));
  await clear(); await db.collection(standing).doc(stableDocumentId(m.standing.standingOrderIdFor(OPLOC))).set({ standingOrderId: "x", oplocId: OPLOC, status: "active" });
  await assert.rejects(m.mutate({ action: "save", slots: SLOTS }), (error: any) => error.status === 409);
}));

test("emulator: the read-only UAT report and census describe the generated order and perform no writes", { skip }, () => hosted(async () => {
  const { execFileSync } = await import("node:child_process"); const { appRoot } = await import("../support/standing-fixture");
  const m = standingModules(db); await activate(m); await m.run(MON);
  const stored = await all(orders); const before = JSON.stringify([stored, await all(handoffs), await all(standing)]);
  const run = (...args: string[]) => JSON.parse(execFileSync(process.execPath, ["--import", "tsx", "scripts/standing-uat-report.ts", ...args, "--project", PROJECT], { cwd: appRoot, env: { ...process.env }, encoding: "utf8" }));
  const report = run("report", "--oploc", OPLOC, "--date", "2026-11-04");
  assert.equal(report.deliveredInOrder.version, 1); assert.deepEqual(report.deliveredInOrder.lines, ["p:a×5"]); assert.equal(report.deliveredInOrder.rotationWeek, 3); assert.equal(report.deliveredInOrder.control, "automatic"); assert.equal(report.deliveredInOrder.source.templateVersion, 2); assert.equal(report.handoffEvents[0].delivery, "delivered"); assert.equal(report.standingOrder.status, "active");
  const census = run("census"); assert.deepEqual(census.counts, { "v2-head": 1, "v2-version": 2 }); assert.deepEqual(census.collisions, []);
  assert.equal(JSON.stringify([await all(orders), await all(handoffs), await all(standing)]), before, "the script wrote nothing");
}));
