import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import type { GrabAndGoOrder, GrabAndGoProduct } from "../lib/grab-and-go";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");

const OPLOC = "oploc:standing";
// Oct 2026 (BST until the 25th): Mon 19, Tue 20, Wed 21, Thu 22, Fri 23, Mon 26, Wed 28.
const at = (day: string, hour = 6) => new Date(`${day}T${String(hour - 1).padStart(2, "0")}:00:00Z`);
const products: GrabAndGoProduct[] = [
  { productId: "p:a", name: "Pot A", category: "grab_250ml", rotationWeeks: [1, 2, 3, 4], allowedDeliveryWeekdays: ["Monday", "Wednesday"], active: true, sortOrder: 1, price: 1 },
  { productId: "p:b", name: "Pot B", category: "grab_250ml", rotationWeeks: [1, 2, 3, 4], allowedDeliveryWeekdays: ["Monday", "Wednesday"], active: true, sortOrder: 2, price: 1 },
  { productId: "p:mon-only", name: "Monday only", category: "grab_250ml", rotationWeeks: [1, 2, 3, 4], allowedDeliveryWeekdays: ["Monday"], active: true, sortOrder: 3, price: 1 },
];

function fakeDb() {
  const records = new Map<string, any>(); let queue: Promise<unknown> = Promise.resolve();
  const snapshot = (ref: any) => ({ exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const collection = (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, get: async function (this: any) { return snapshot(this); } }),
    where(field: string, _operator: string, value: unknown) {
      const filters = [[field, _operator, value]] as Array<[string, string, unknown]>;
      const query: any = { where(nextField: string, op: string, nextValue: unknown) { filters.push([nextField, op, nextValue]); return query; }, limit() { return query; }, orderBy() { return query; },
        async get() { const docs = [...records.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, row]) => row).filter(row => filters.every(([key, op, expected]) => op === "==" ? row[key] === expected : op === ">=" ? row[key] >= (expected as string) : row[key] < (expected as string))); return { size: docs.length, docs: docs.map(row => ({ data: () => structuredClone(row) })) }; } };
      return query;
    },
  });
  const runTransaction = (callback: any) => { const operation = queue.then(async () => {
    const writes: Array<[any, any, boolean]> = [];
    const result = await callback({ get: async (ref: any) => snapshot(ref), set: (ref: any, data: any) => writes.push([ref, data, false]), create: (ref: any, data: any) => writes.push([ref, data, true]) });
    for (const [ref, , create] of writes) if (create && records.has(ref.path)) throw new Error("already exists");
    for (const [ref, data] of writes) records.set(ref.path, structuredClone(data));
    return result; }); queue = operation.then(() => undefined, () => undefined); return operation; };
  return { records, db: { collection, runTransaction } };
}

function environment(t: TestContext, mode: "local" | "staging") {
  const directory = mkdtempSync(join(tmpdir(), "fika-standing-")); const fake = fakeDb(); const forwarded: any[] = [];
  const previous = process.env.FIKA_RUNTIME_MODE; process.env.FIKA_RUNTIME_MODE = mode;
  t.after(() => { if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous; rmSync(directory, { recursive: true, force: true }); });
  const instance = () => {
    const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
      [resolve(appRoot, "lib/firebase-admin.ts")]: { db: fake.db },
      [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { forwarded.push(structuredClone(input)); return "delivered"; } },
      [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
      [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: (_app: string, ...parts: string[]) => join(directory, parts.at(-1)!) },
      "@fika/server-shared/data-source-meter-server": { recordDataAccess() {} },
    } });
    return {
      lib: load(resolve(appRoot, "lib/grab-and-go.ts")) as typeof import("../lib/grab-and-go"),
      standing: load(resolve(appRoot, "lib/grab-and-go-standing.ts")) as typeof import("../lib/grab-and-go-standing"),
      service: load(resolve(appRoot, "lib/grab-and-go-standing-service.ts")) as typeof import("../lib/grab-and-go-standing-service"),
      store: load(resolve(appRoot, "lib/grab-and-go-store.ts")) as typeof import("../lib/grab-and-go-store"),
      handoff: load(resolve(appRoot, "lib/grab-and-go-handoff.ts")) as typeof import("../lib/grab-and-go-handoff"),
    };
  };
  const main = instance();
  const manualOrder = async (date: string, quantities: Record<string, number> = { "p:a": 3, "p:b": 2 }, siteId = OPLOC) => {
    const order = main.lib.applyOrderAction(undefined, { action: "submit", oplocId: siteId, deliveryDate: date, rotationWeek: main.lib.rotationWeekForDate(date), lines: Object.entries(quantities).map(([productId, quantity]) => ({ productId, quantity })), actor: "staff@example.test", at: "2026-10-12T09:00:00Z" }, products);
    await main.store.saveGrabAndGoOrderHosted(order); return order;
  };
  const orders = async () => (await main.store.listGrabAndGoOrdersHosted(OPLOC, "2026-01-01", "2027-01-01")).sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate));
  const convert = (date = "2026-10-19", weekdays: unknown = ["Monday", "Wednesday"], endDate?: string) => main.service.createStandingOrder({ oplocId: OPLOC, sourceDeliveryDate: date, weekdays, endDate, actor: "staff@example.test", now: at("2026-10-15") });
  const run = (when: Date, instanceToUse = main) => instanceToUse.service.generateDueStandingOrders({ products, now: when });
  return { ...main, main, instance, manualOrder, orders, convert, run, forwarded, fake };
}

for (const mode of ["local", "staging"] as const) {
  const name = (title: string) => `standing orders (${mode === "local" ? "SQLite" : "Firestore"}): ${title}`;

  test(name("converts an existing order into a standing order and links it"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19");
    const template = await env.convert();
    assert.equal(template.status, "active"); assert.equal(template.sourceOrderId, "grab-and-go:oploc:standing:2026-10-19"); assert.equal(template.lastOccurrenceDate, "2026-10-19");
    assert.deepEqual(template.weekdays, ["Monday", "Wednesday"]); assert.equal(template.endDate, undefined); assert.equal(template.version, 1);
    assert.deepEqual(template.lines, [{ productId: "p:a", quantity: 3 }, { productId: "p:b", quantity: 2 }]);
    const [source] = await env.orders(); assert.equal(source.standingOrderId, template.standingOrderId); assert.equal(source.standingOrderOccurrenceDate, "2026-10-19"); assert.equal(source.version, 1);
    await assert.rejects(() => env.convert(), (error: any) => error.status === 409);
  });

  test(name("accepts only Monday, Wednesday or both and rejects every other weekday"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19");
    for (const bad of [["Tuesday"], ["Monday", "Friday"], [], "Monday", ["Sunday"]]) await assert.rejects(() => env.convert("2026-10-19", bad), (error: any) => error.status === 422);
    assert.throws(() => env.standing.assertServiceDay("2026-10-20"), /Monday or Wednesday/);
    const template = await env.convert("2026-10-19", ["Wednesday"]); assert.deepEqual(template.weekdays, ["Wednesday"]);
    await assert.rejects(() => env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "edit", weekdays: ["Thursday"] }, actor: "x" }), (error: any) => error.status === 422);
  });

  test(name("single weekday recurrence skips the other service day"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert("2026-10-19", ["Monday"]);
    const result = await env.run(at("2026-10-20")); assert.equal(result.outcomes[0].occurrenceDate, "2026-10-26");
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-26"]);
  });

  test(name("Monday then Tuesday run creates Wednesday; Wednesday then Thursday run creates next Monday (Mon & Wed)"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert();
    assert.equal((await env.run(at("2026-10-20"))).created, 1);
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-21"]);
    assert.equal((await env.run(at("2026-10-22"))).created, 1);
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-21", "2026-10-26"]);
    const generated = (await env.orders())[1];
    assert.equal(generated.standingOrderId, "standing:grab-and-go:oploc:standing:2026-10-19"); assert.equal(generated.standingOrderOccurrenceDate, "2026-10-21"); assert.equal(generated.updatedBy, `standing-order:${generated.standingOrderId}`);
    for (const order of await env.orders()) assert.ok(["Monday", "Wednesday"].includes(new Date(`${order.deliveryDate}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" })));
  });

  test(name("an existing future occurrence prevents another creation"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert(); await env.run(at("2026-10-20"));
    for (const day of ["2026-10-20", "2026-10-21"]) { const again = await env.run(at(day, day === "2026-10-21" ? 6 : 8)); assert.equal(again.created, 0); assert.equal(again.outcomes[0].reason, "future-occurrence-exists"); }
    assert.equal((await env.orders()).length, 2);
  });

  test(name("repeated scheduler invocation creates no duplicate"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert();
    for (let attempt = 0; attempt < 4; attempt += 1) await env.run(at("2026-10-20", 6 + attempt));
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-21"]);
    if (mode === "local") assert.equal(env.store.listGrabAndGoEvents().filter(event => event.eventType === "grab-and-go.order.submitted").length, 2);
  });

  test(name("concurrent generation creates no duplicate"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert();
    const runners = [env.main, env.instance(), env.instance(), env.instance()];
    const results = await Promise.all(runners.map(runner => env.run(at("2026-10-20"), runner)));
    assert.equal(results.reduce((sum, result) => sum + result.created, 0), 1);
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-21"]);
  });

  test(name("paused creates nothing; resume produces the next valid occurrence; no past backfill"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); const template = await env.convert();
    const paused = await env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "pause" }, actor: "x" });
    assert.equal(paused.status, "paused"); assert.equal((await env.run(at("2026-10-20"))).evaluated, 0); assert.equal((await env.orders()).length, 1);
    await assert.rejects(() => env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "resume" }, actor: "x" }), (error: any) => error.status === 409);
    await env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 2, change: { action: "resume" }, actor: "x" });
    // Paused through Mon 26 Oct; resumed on Tue 27 Oct -> Wed 28 Oct only, never 21 Oct / 26 Oct.
    const result = await env.run(at("2026-10-27")); assert.equal(result.outcomes[0].occurrenceDate, "2026-10-28");
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-28"]);
  });

  test(name("stopped creates nothing, is permanent, and keeps existing orders"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); const template = await env.convert(); await env.run(at("2026-10-20"));
    const stopped = await env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "stop" }, actor: "x" });
    assert.equal(stopped.status, "stopped"); assert.equal((await env.run(at("2026-10-22"))).evaluated, 0);
    assert.deepEqual((await env.orders()).map(order => order.status), ["submitted", "submitted"]);
    await assert.rejects(() => env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 2, change: { action: "resume" }, actor: "x" }), (error: any) => error.status === 409);
  });

  test(name("missed scheduler run never backfills: Friday run still creates Monday"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert(); await env.run(at("2026-10-20"));
    const result = await env.run(at("2026-10-23")); assert.equal(result.outcomes[0].occurrenceDate, "2026-10-26");
    assert.deepEqual((await env.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-10-21", "2026-10-26"]);
    // A run weeks late: only the next future date is created.
    const env2 = environment(t, mode); await env2.manualOrder("2026-10-19"); await env2.convert();
    assert.equal((await env2.run(at("2026-11-04"))).outcomes[0].occurrenceDate, "2026-11-09");
    assert.deepEqual((await env2.orders()).map(order => order.deliveryDate), ["2026-10-19", "2026-11-09"]);
  });

  test(name("cancelling a generated order neither stops the template nor regenerates it"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); const template = await env.convert(); await env.run(at("2026-10-20"));
    const generated = (await env.orders())[1];
    const cancelled = env.lib.applyOrderAction(generated, { action: "cancel", oplocId: OPLOC, deliveryDate: generated.deliveryDate, rotationWeek: generated.rotationWeek, actor: "staff", expectedVersion: 1, at: "2026-10-20T08:00:00Z" }, products);
    await env.store.saveGrabAndGoOrderHosted(cancelled, 1);
    assert.equal((await env.store.getStandingOrderHosted(template.standingOrderId))?.status, "active");
    assert.equal((await env.run(at("2026-10-20", 9))).created, 0);
    assert.equal((await env.run(at("2026-10-22"))).outcomes[0].occurrenceDate, "2026-10-26");
  });

  test(name("one-off amendment does not mutate the template; edit and update-from-order affect future occurrences only"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); const template = await env.convert(); await env.run(at("2026-10-20"));
    const generated = (await env.orders())[1];
    const amended = env.lib.applyOrderAction(generated, { action: "amend", oplocId: OPLOC, deliveryDate: generated.deliveryDate, rotationWeek: generated.rotationWeek, lines: [{ productId: "p:a", quantity: 9 }], actor: "staff", expectedVersion: 1, at: "2026-10-20T08:00:00Z" }, products);
    await env.store.saveGrabAndGoOrderHosted(amended, 1);
    const unchanged = await env.store.getStandingOrderHosted(template.standingOrderId);
    assert.deepEqual(unchanged?.lines, template.lines); assert.equal(unchanged?.version, 1);
    assert.equal((await env.orders())[1].standingOrderId, template.standingOrderId, "amendment keeps the standing link");
    // Next occurrence uses the untouched template quantities.
    await env.run(at("2026-10-22")); assert.deepEqual((await env.orders())[2].lines.map(line => line.quantity), [3, 2]);
    // Explicit action: update from the amended order; generation after that uses 9, already-created orders are untouched.
    const updated = await env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "update-from-order", deliveryDate: "2026-10-21" }, actor: "staff" });
    assert.deepEqual(updated.lines, [{ productId: "p:a", quantity: 9 }]); assert.equal(updated.version, 2);
    assert.deepEqual((await env.orders())[2].lines.map(line => line.quantity), [3, 2]);
    await env.run(at("2026-10-27")); assert.deepEqual((await env.orders())[3].lines.map(line => line.quantity), [9]);
    // Template edit: weekdays Monday only -> next after Wed 28 Oct is Mon 2 Nov; stale version is rejected.
    await assert.rejects(() => env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 1, change: { action: "edit", weekdays: ["Monday"] }, actor: "x" }), (error: any) => error.status === 409);
    await env.service.changeStandingOrder({ oplocId: OPLOC, standingOrderId: template.standingOrderId, expectedVersion: 2, change: { action: "edit", weekdays: ["Monday"] }, actor: "x" });
    assert.equal((await env.run(at("2026-10-29"))).outcomes[0].occurrenceDate, "2026-11-02");
  });

  test(name("end date stops generation; unavailable products are dropped; nothing valid is not created"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19", { "p:mon-only": 1, "p:a": 2 }); const template = await env.convert("2026-10-19", ["Monday", "Wednesday"], "2026-10-21");
    const wednesday = await env.run(at("2026-10-20")); assert.deepEqual(wednesday.outcomes[0].droppedProductIds, ["p:mon-only"]);
    assert.deepEqual((await env.orders())[1].lines.map(line => line.productId), ["p:a"]);
    assert.equal((await env.run(at("2026-10-22"))).outcomes[0].reason, "ended");
    assert.equal((await env.orders()).length, 2); assert.ok(template.endDate);
    const env2 = environment(t, mode); await env2.manualOrder("2026-10-19", { "p:mon-only": 1 }); await env2.convert();
    assert.equal((await env2.run(at("2026-10-20"))).outcomes[0].result, "no-valid-lines"); assert.equal((await env2.orders()).length, 1);
  });

  test(name("an order that already exists for the date is never overwritten"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert(); const manual = await env.manualOrder("2026-10-21", { "p:b": 7 });
    const result = await env.run(at("2026-10-20")); assert.equal(result.outcomes[0].result, "skipped-existing-order");
    const stored = await env.store.getGrabAndGoOrderHosted(OPLOC, "2026-10-21"); assert.deepEqual(stored, manual);
    assert.equal((await env.run(at("2026-10-22"))).outcomes[0].occurrenceDate, "2026-10-26");
  });

  test(name("a generated order reaches CPU exactly like a manually created one"), async t => {
    const env = environment(t, mode); await env.manualOrder("2026-10-19"); await env.convert();
    const result = await env.service.generateDueStandingOrders({ products, now: at("2026-10-20"), deliver: async order => mode === "staging" ? env.handoff.deliverGrabHandoff(env.handoff.grabHandoffId(order), at("2026-10-20", 7)) : env.main.handoff.grabHandoffEvent(order) });
    const generated = result.outcomes[0].order!;
    const manual = env.lib.applyOrderAction(undefined, { action: "submit", oplocId: OPLOC, deliveryDate: "2026-10-21", rotationWeek: generated.rotationWeek, lines: generated.lines.map(line => ({ productId: line.productId, quantity: line.quantity })), actor: "someone", at: "2026-10-20T05:00:00Z" }, products);
    const payload = env.handoff.grabHandoffEvent(generated).payload;
    assert.deepEqual(payload, env.handoff.grabHandoffEvent(manual).payload);
    assert.equal(payload.sourceDomain, "grab-and-go"); assert.ok(!JSON.stringify(payload).includes("standingOrder"));
    assert.equal(generated.version, 1); assert.equal(generated.status, "submitted"); assert.equal(generated.history.length, 1);
    if (mode === "staging") { assert.equal(env.forwarded.length, 1); assert.deepEqual(env.forwarded[0], payload); assert.ok([...env.fake.records.keys()].some(key => key.startsWith("fikaDeliveredInGrabAndGoHandoffV1/"))); }
    else assert.equal(env.store.listGrabAndGoEvents().filter(event => event.sourceAggregateId === generated.orderId).length, 1);
  });
}

test("planNextOccurrence skips a Wednesday whose Tuesday-noon cut-off has gone", async t => {
  const env = environment(t, "local"); await env.manualOrder("2026-10-19"); const template = await env.convert();
  assert.deepEqual(env.standing.planNextOccurrence(template, at("2026-10-20", 13)), { action: "create", occurrenceDate: "2026-10-26" });
});
