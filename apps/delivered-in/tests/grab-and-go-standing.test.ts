import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { fileURLToPath } from "node:url";
import { applyOrderAction, deliveryCutoff, rotationWeekForDate, type GrabAndGoOrder, type GrabAndGoProduct } from "../lib/grab-and-go";
import { applyStandingAction, planStandingOccurrences, slotKey, slotKeyForDate, standingDeliveryDates } from "../lib/grab-and-go-standing";

const require = createRequire(import.meta.url);
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const { typescriptLoader } = require("../../../scripts/testing/load-typescript.cjs");

const OPLOC = "oploc:owned";
const OTHER = "oploc:other";
const NOW = new Date("2026-11-02T09:00:00Z"); // Monday, GMT. Open deliveries: Wed 11-04 (w3), Mon 11-09 (w4), Wed 11-11 (w4), Mon 11-16 (w1).
const product = (id: string, extra: Partial<GrabAndGoProduct> = {}): GrabAndGoProduct => ({ productId: id, name: id, category: "grab_250ml", rotationWeeks: [1, 2, 3, 4], allowedDeliveryWeekdays: ["Monday", "Wednesday"], active: true, sortOrder: 1, price: 1, ...extra });
const catalogue = (): GrabAndGoProduct[] => [product("p:a", { sortOrder: 1 }), product("p:b", { sortOrder: 2 }), product("p:wk4mon", { sortOrder: 3, rotationWeeks: [4], allowedDeliveryWeekdays: ["Monday"] })];
const SLOTS = { "3:Wednesday": [{ productId: "p:a", quantity: 5 }], "4:Monday": [{ productId: "p:a", quantity: 6 }, { productId: "p:b", quantity: 2 }], "4:Wednesday": [{ productId: "p:b", quantity: 7 }] };

function fixture() {
  const records = new Map<string, any>(), calls: any[] = [], queries: any[] = [];
  let queue = Promise.resolve(), products = catalogue(), failForward = false;
  const snapshot = (ref: any) => ({ exists: records.has(ref.path), data: () => structuredClone(records.get(ref.path)) });
  const collection = (name: string) => ({
    doc: (id: string) => ({ path: `${name}/${id}`, get: async function () { return snapshot(this); } }),
    where: (field: string, operator: string, value: unknown) => {
      const filters = [{ field, operator, value }]; let sort = "", direction = "asc", limit = 0;
      const query: any = {
        where(f: string, o: string, v: unknown) { filters.push({ field: f, operator: o, value: v }); return query; },
        orderBy(f: string, d = "asc") { sort = f; direction = d; return query; },
        limit(n: number) { limit = n; return query; },
        async get() {
          queries.push({ name, filters: structuredClone(filters), sort, limit });
          let rows = [...records.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, row]) => row).filter(row => filters.every(filter => filter.operator === "in" ? (filter.value as unknown[]).includes(row[filter.field]) : filter.operator === "<=" ? row[filter.field] !== undefined && row[filter.field] <= (filter.value as string) : row[filter.field] === filter.value));
          if (sort) rows = rows.sort((a, b) => (direction === "desc" ? -1 : 1) * (a[sort] < b[sort] ? -1 : a[sort] > b[sort] ? 1 : 0));
          rows = rows.slice(0, limit || rows.length);
          return { size: rows.length, docs: rows.map(row => ({ data: () => structuredClone(row) })) };
        },
      };
      return query;
    },
  });
  const db = { collection, runTransaction: (callback: any) => {
    const operation = queue.then(async () => {
      const writes: Array<[any, any, boolean]> = [];
      const result = await callback({ get: async (ref: any) => { if (writes.length) throw new Error("reads must precede writes"); return snapshot(ref); }, set: (ref: any, data: any) => writes.push([ref, data, false]), create: (ref: any, data: any) => writes.push([ref, data, true]) });
      for (const [ref, , create] of writes) if (create && records.has(ref.path)) throw Object.assign(new Error("already exists"), { status: 409 });
      for (const [ref, data] of writes) { if (JSON.stringify(data) === undefined || /"undefined"/.test(JSON.stringify(data)) || Object.values(data).some(value => value === undefined)) throw new Error("Firestore rejects undefined fields"); records.set(ref.path, structuredClone(data)); }
      return result;
    });
    queue = operation.then(() => undefined, () => undefined); return operation;
  } };
  let access = { email: "manager@example.test", oplocIds: [OPLOC], permissions: ["delivered_in.view"] };
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db },
    [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { calls.push(structuredClone(input)); if (failForward) throw new Error("isolated CPU outage"); return "delivered"; } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
    [resolve(appRoot, "lib/server.ts")]: { resolveAccess: async () => ({ access, sites: [] }), deliveredInErrorBody: (error: Error) => ({ error: { message: error.message } }) },
    [resolve(appRoot, "lib/grab-and-go-catalogue-client.ts")]: { getGrabAndGoCataloguePackage: async () => ({ catalogue: { schemaVersion: 1, products: structuredClone(products) }, manifest: {} }) },
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: () => "unused-isolated-hosted-store" },
    "@fika/server-shared/data-source-meter-server": { recordDataAccess() {}, withDataTrace: (_trace: any, fn: any) => fn() },
  } });
  const service: typeof import("../lib/grab-and-go-standing-service") = load(resolve(appRoot, "lib/grab-and-go-standing-service.ts"));
  const store: typeof import("../lib/grab-and-go-store") = load(resolve(appRoot, "lib/grab-and-go-store.ts"));
  const handoff: typeof import("../lib/grab-and-go-handoff") = load(resolve(appRoot, "lib/grab-and-go-handoff.ts"));
  const rows = (name: string) => [...records.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, row]) => row);
  return {
    records, calls, queries, load, service, store, handoff, rows,
    orders: () => rows("fikaDeliveredInGrabAndGoOrdersV1").sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)) as GrabAndGoOrder[],
    events: () => rows("fikaDeliveredInGrabAndGoHandoffV1"),
    heads: () => rows(store.STANDING_COLLECTION).filter(row => row.recordType === "head"),
    versions: () => rows(store.STANDING_COLLECTION).filter(row => row.recordType === "version"),
    setCatalogue: (next: GrabAndGoProduct[]) => { products = next; }, catalogue: () => structuredClone(products), setAccess: (next: typeof access) => { access = next; }, failForward: (value: boolean) => { failForward = value; },
    mutate: (input: Partial<Parameters<typeof service.mutateStandingOrder>[0]> & { action: any }, at = NOW) => service.mutateStandingOrder({ oplocId: OPLOC, actor: "manager@example.test", ...input } as any, products, at),
  };
}
const withHosted = async (run: () => Promise<void>) => {
  const previous = process.env.FIKA_RUNTIME_MODE; process.env.FIKA_RUNTIME_MODE = "staging";
  try { await run(); } finally { if (previous === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = previous; }
};
type Fixture = ReturnType<typeof fixture>;
async function activated(f: Fixture, slots: unknown = SLOTS) {
  const draft = await f.mutate({ action: "save", slots }); assert.equal(draft.standingOrder.status, "draft"); assert.equal(f.orders().filter(order => order.source).length, 0, "a draft generates nothing");
  return f.mutate({ action: "activate", expectedVersion: draft.standingOrder.version });
}
const lines = (order: GrabAndGoOrder) => order.lines.map(line => `${line.productId}:${line.quantity}`).join(",");

test("the four-week rotation maps each Monday/Wednesday to its own independently editable slot", () => {
  const all: Record<string, Array<{ productId: string; quantity: number }>> = {};
  let quantity = 0; for (const week of [1, 2, 3, 4]) for (const weekday of ["Monday", "Wednesday"] as const) all[slotKey(week, weekday)] = [{ productId: "p:a", quantity: ++quantity }];
  const head = applyStandingAction(undefined, { action: "save", oplocId: OPLOC, actor: "m", slots: all, at: NOW.toISOString() }, catalogue()).head;
  const plan = planStandingOccurrences({ ...head, status: "active" }, new Map(), catalogue(), NOW, 27);
  assert.equal(plan.length, 8, "28 days contain exactly the eight rotation slots");
  assert.deepEqual(new Set(plan.map(item => item.slotKey)).size, 8);
  for (const item of plan) { assert.equal(item.slotKey, slotKeyForDate(item.deliveryDate)); assert.equal(item.templateLines[0].quantity, Number(Object.keys(all).indexOf(item.slotKey)) + 1); assert.equal(item.rotationWeek, rotationWeekForDate(item.deliveryDate)); }
  // Editing Week 2 Wednesday alone leaves every other slot untouched.
  const edited = applyStandingAction(head, { action: "save", oplocId: OPLOC, actor: "m", expectedVersion: 1, slots: { ...all, "2:Wednesday": [{ productId: "p:b", quantity: 40 }] } }, catalogue());
  assert.deepEqual(edited.version?.changedSlots, ["2:Wednesday"]);
});

test("BST/GMT boundaries move the 12:00 London cutoff and the London day, not the UTC clock", () => {
  assert.equal(deliveryCutoff("2026-10-26").toISOString(), "2026-10-25T12:00:00.000Z", "Monday after clocks go back: 12:00 GMT");
  assert.equal(deliveryCutoff("2026-10-21").toISOString(), "2026-10-20T11:00:00.000Z", "Wednesday in BST: 12:00 BST = 11:00Z");
  assert.equal(deliveryCutoff("2026-03-30").toISOString(), "2026-03-29T11:00:00.000Z", "Monday after clocks go forward: 12:00 BST");
  const head = { ...applyStandingAction(undefined, { action: "save", oplocId: OPLOC, actor: "m", slots: { "2:Monday": [{ productId: "p:a", quantity: 3 }] } }, catalogue()).head, status: "active" as const };
  const state = (now: string, date: string) => planStandingOccurrences(head, new Map(), catalogue(), new Date(now), 14).find(item => item.deliveryDate === date)!;
  assert.equal(state("2026-10-25T11:59:00Z", "2026-10-26").state, "generate");
  assert.equal(state("2026-10-25T12:00:00Z", "2026-10-26").state, "cutoff-passed", "exactly at the cutoff is closed");
  // 23:30 UTC on 24 Oct is already 00:30 BST on 25 Oct: the London day, not the UTC day, anchors the window.
  assert.equal(standingDeliveryDates(new Date("2026-10-24T23:30:00Z"), 1)[0], "2026-10-26");
  const spring = planStandingOccurrences({ ...head, slots: { [slotKeyForDate("2026-03-30")]: [{ productId: "p:a", quantity: 1 }] } }, new Map(), catalogue(), new Date("2026-03-29T10:59:00Z"), 3).find(item => item.deliveryDate === "2026-03-30")!;
  assert.equal(spring.state, "generate");
  assert.equal(planStandingOccurrences({ ...head, slots: { [slotKeyForDate("2026-03-30")]: [{ productId: "p:a", quantity: 1 }] } }, new Map(), catalogue(), new Date("2026-03-29T11:00:00Z"), 3).find(item => item.deliveryDate === "2026-03-30")!.state, "cutoff-passed");
});

test("activation creates real, identifiable orders only for configured open slots and stages the canonical CPU handoff", () => withHosted(async () => {
  const f = fixture(); const result = await activated(f);
  assert.equal(result.standingOrder.status, "active");
  const orders = f.orders();
  assert.deepEqual(orders.map(order => `${order.deliveryDate}:${lines(order)}`), ["2026-11-04:p:a:5", "2026-11-09:p:a:6,p:b:2", "2026-11-11:p:b:7"], "Mon 11-16 (week 1) is unconfigured, 11-02 is past its cutoff");
  for (const order of orders) {
    assert.equal(order.control, "automatic"); assert.equal(order.source?.type, "standing-order"); assert.equal(order.source?.templateVersion, 2); assert.equal(order.source?.trigger, "activation");
    assert.equal(order.updatedBy, "manager@example.test", "the authorising person, not a synthetic actor"); assert.equal(order.history[0].automation?.standingOrderId, `grab-and-go-standing:v2:${OPLOC}`);
    assert.equal(order.orderId, `grab-and-go:${OPLOC}:${order.deliveryDate}`, "same canonical deterministic order id as a manual order");
  }
  assert.equal(f.events().length, 3, "one immutable handoff event per generated order, committed with it");
  const manualEquivalent = f.handoff.grabHandoffEvent(orders[0]); assert.deepEqual(f.events().find(event => event.eventId === manualEquivalent.eventId).payload, manualEquivalent.payload);
  assert.equal(f.calls.length, 3, "delivered through the existing outbox/forward path"); assert.ok(f.calls.every(call => call.sourceDomain === "grab-and-go" && call.destinationOplocId === OPLOC && call.status === "submitted"));
  assert.equal(f.calls.find(call => call.serviceDate === "2026-11-09").lines.reduce((sum: number, line: any) => sum + line.quantity, 0), 8);
}));

test("replay and retry change nothing: no duplicate orders, versions, events or forwards", () => withHosted(async () => {
  const f = fixture(); await activated(f); const before = JSON.stringify(f.orders()); const eventCount = f.events().length, forwarded = f.calls.length;
  for (let i = 0; i < 3; i += 1) { const run = await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW }); assert.equal(run.created + run.amended + run.cancelled, 0); }
  assert.equal(JSON.stringify(f.orders()), before); assert.equal(f.events().length, eventCount); assert.equal(f.calls.length, forwarded);
}));

test("concurrent scheduler runs create each order exactly once", () => withHosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  // Activate without the post-activation reconcile so two scheduler runs race for the same empty window.
  const transition = f.load(resolve(appRoot, "lib/grab-and-go-standing.ts")).applyStandingAction(draft.standingOrder, { action: "activate", oplocId: OPLOC, actor: "manager@example.test", expectedVersion: 1 }, f.catalogue());
  await f.store.saveStandingOrderHosted(transition, 1);
  const [one, two] = await Promise.all([f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW }), f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW })]);
  assert.equal(one.created + two.created, 3); assert.equal(one.skipped + two.skipped, 3); assert.equal(f.orders().length, 3); assert.ok(f.orders().every(order => order.version === 1)); assert.equal(f.events().length, 3);
}));

test("manual orders are never overwritten, and a manual edit takes an automatic order out of template control", () => withHosted(async () => {
  const f = fixture(); const manual = applyOrderAction(undefined, { action: "submit", oplocId: OPLOC, deliveryDate: "2026-11-04", rotationWeek: 3, lines: [{ productId: "p:b", quantity: 1 }], actor: "site@example.test", at: NOW.toISOString() }, f.catalogue());
  await f.store.saveGrabAndGoOrderHosted(manual);
  const created = await activated(f);
  assert.equal(created.reconcile!.items.find(item => item.deliveryDate === "2026-11-04")!.outcome, "skipped-manual-order");
  assert.equal(lines(f.orders()[0]), "p:b:1"); assert.equal(f.orders()[0].version, 1); assert.equal(f.orders()[0].source, undefined); assert.equal(f.orders().length, 3);
  // A human amends an automatic order: it becomes manually controlled and later template edits leave it alone.
  const auto = f.orders()[1]; const amended = applyOrderAction(auto, { action: "amend", oplocId: OPLOC, deliveryDate: auto.deliveryDate, rotationWeek: auto.rotationWeek, lines: [{ productId: "p:a", quantity: 99 }], expectedVersion: auto.version, actor: "site@example.test", at: NOW.toISOString() }, f.catalogue());
  assert.equal(amended.control, "manual"); assert.ok(amended.source, "provenance is retained for audit"); await f.store.saveGrabAndGoOrderHosted(amended, auto.version);
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 1 }] } });
  assert.equal(edit.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.outcome, "skipped-manual-order"); assert.equal(lines(f.orders()[1]), "p:a:99");
}));

test("a cancelled order is never resurrected by later runs, resume or amendment", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f); const auto = f.orders()[0];
  const cancelled = applyOrderAction(auto, { action: "cancel", oplocId: OPLOC, deliveryDate: auto.deliveryDate, rotationWeek: auto.rotationWeek, expectedVersion: 1, actor: "site@example.test", at: NOW.toISOString() }, f.catalogue());
  await f.store.saveGrabAndGoOrderHosted(cancelled, 1);
  const run = await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW });
  assert.equal(run.results[0].items.find(item => item.deliveryDate === auto.deliveryDate)!.outcome, "skipped-cancelled"); assert.equal(f.orders()[0].status, "cancelled"); assert.equal(f.orders()[0].version, 2);
  const paused = await f.mutate({ action: "pause", expectedVersion: created.standingOrder.version }); const resumed = await f.mutate({ action: "resume", expectedVersion: paused.standingOrder.version });
  assert.equal(f.orders()[0].status, "cancelled"); assert.equal(resumed.reconcile!.items.find(item => item.deliveryDate === auto.deliveryDate)!.outcome, "skipped-cancelled");
}));

test("no backfill: closed cutoffs, past dates and unconfigured slots never produce orders", () => withHosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: { "3:Monday": [{ productId: "p:a", quantity: 4 }], ...SLOTS } });
  // Sunday 12:00 London: Monday 11-02's cutoff has just passed; Wednesday 11-04 remains open.
  const lateNow = new Date("2026-11-01T12:00:00Z"); const activatedLate = await f.mutate({ action: "activate", expectedVersion: draft.standingOrder.version }, lateNow);
  assert.ok(!f.orders().some(order => order.deliveryDate === "2026-11-02"), "Monday 11-02 closed at 12:00 on Sunday");
  assert.ok(!f.orders().some(order => order.deliveryDate < "2026-11-04")); assert.equal(activatedLate.reconcile!.items.find(item => item.deliveryDate === "2026-11-02")!.outcome, "unchanged");
  assert.ok(!f.orders().some(order => order.deliveryDate === "2026-11-16" || order.deliveryDate === "2026-11-18"), "unconfigured slots stay empty");
}));

test("future automatic orders follow template amendments with explicit versions and downstream propagation; cutoff freezes them", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f); f.calls.length = 0;
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 10 }] }, note: "Event week" });
  assert.equal(edit.version!.action, "amended"); assert.deepEqual(edit.version!.changedSlots, ["4:Monday"]);
  const monday = f.orders().find(order => order.deliveryDate === "2026-11-09")!;
  assert.equal(monday.version, 2); assert.equal(lines(monday), "p:a:10"); assert.equal(monday.source?.templateVersion, 3); assert.equal(monday.history.at(-1)!.automation?.templateVersion, 3);
  assert.equal(f.orders().find(order => order.deliveryDate === "2026-11-04")!.version, 1, "unchanged slots are not versioned");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].sourceVersion, 2); assert.equal(f.calls[0].lines.length, 1, "CPU receives the v2 quantities");
  assert.equal(f.events().filter(event => event.sourceAggregateId === monday.orderId).length, 2, "v1 evidence retained beside v2");
  // After Sunday 12:00 London the 11-09 order is read-only: a further amendment cannot touch it.
  const after = new Date("2026-11-08T12:00:00Z");
  const late = await f.mutate({ action: "save", expectedVersion: edit.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 77 }] } }, after);
  assert.equal(f.orders().find(order => order.deliveryDate === "2026-11-09")!.version, 2); assert.equal(late.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.outcome, "unchanged");
  assert.throws(() => applyOrderAction(monday, { action: "amend", oplocId: OPLOC, deliveryDate: monday.deliveryDate, rotationWeek: 4, lines: [{ productId: "p:a", quantity: 1 }], expectedVersion: 2, actor: "x", at: after.toISOString() }, f.catalogue()), (error: any) => error.status === 409);
}));

test("removing a slot withdraws its future automatic order downstream", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f); f.calls.length = 0;
  const { "4:Wednesday": _removed, ...rest } = SLOTS;
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: rest });
  const wednesday = f.orders().find(order => order.deliveryDate === "2026-11-11")!; assert.equal(wednesday.status, "cancelled"); assert.equal(wednesday.version, 2);
  assert.equal(edit.reconcile!.items.find(item => item.deliveryDate === "2026-11-11")!.outcome, "cancelled"); assert.equal(f.calls[0].status, "cancelled"); assert.equal(f.calls[0].sourceVersion, 2);
}));

test("catalogue changes fail closed: unavailable products block creation and amendment, never drop lines", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f);
  const rejected = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { "4:Monday": [{ productId: "p:wk4mon", quantity: 1 }], "3:Wednesday": [{ productId: "p:wk4mon", quantity: 1 }] } }).catch((error: any) => error);
  assert.equal(rejected.status, 422, "p:wk4mon is only offered on week-4 Mondays, so week-3 Wednesday cannot hold it");
  // Product b is withdrawn from the catalogue after the template and its orders exist.
  f.setCatalogue(f.catalogue().map(item => item.productId === "p:b" ? { ...item, active: false } : item));
  const before = JSON.stringify(f.orders());
  const run = await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW });
  assert.equal(JSON.stringify(f.orders()), before, "existing orders are left exactly as ordered");
  assert.deepEqual(run.results[0].items.filter(item => item.outcome === "unavailable-lines").map(item => item.deliveryDate).sort(), ["2026-11-09", "2026-11-11"]);
  assert.equal(run.exceptions, 2);
  // A date that has no order yet and whose slot is unavailable is not created at all (and no line is dropped).
  const later = new Date("2026-11-09T09:00:00Z");
  const laterRun = await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: later });
  assert.ok(!f.orders().some(order => order.deliveryDate > "2026-11-11" && order.lines.some(line => line.productId === "p:b")));
  assert.ok(laterRun.results[0].items.every(item => item.outcome !== "created" || item.deliveryDate === "2026-11-16" || item.deliveryDate === "2026-11-18"));
  const paused = await f.mutate({ action: "pause", expectedVersion: created.standingOrder.version });
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), NOW);
  assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.state, "in-sync", "a paused template keeps its orders visible"); assert.equal(paused.standingOrder.status, "paused");
}));

test("an unavailable line blocks only its own slot and is reported as an exception", () => withHosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  f.setCatalogue(f.catalogue().map(item => item.productId === "p:b" ? { ...item, active: false } : item));
  const result = await f.mutate({ action: "activate", expectedVersion: draft.standingOrder.version }).catch((error: any) => ({ error }));
  assert.equal((result as any).error.status, 422, "activation re-validates every slot against the live catalogue");
  f.setCatalogue(catalogue()); const activeResult = await f.mutate({ action: "activate", expectedVersion: draft.standingOrder.version });
  f.setCatalogue(f.catalogue().map(item => item.productId === "p:a" ? { ...item, active: false } : item));
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), NOW);
  assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-04")!.state, "unavailable-lines"); assert.match(overview.upcoming.find(item => item.deliveryDate === "2026-11-04")!.exception!, /catalogue no longer offers/);
  assert.equal(activeResult.standingOrder.status, "active");
}));

test("pause stops generation, resume restarts it, and cancelling upcoming orders is explicit and propagated", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f); f.calls.length = 0;
  const paused = await f.mutate({ action: "pause", expectedVersion: created.standingOrder.version }); assert.equal(paused.standingOrder.status, "paused"); assert.equal(f.orders().length, 3, "keep is the default");
  assert.equal((await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW })).templates, 0, "paused templates are not scheduled");
  const nextWindow = new Date("2026-11-04T09:00:00Z"); assert.equal((await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: nextWindow, oplocId: OPLOC })).results.length, 0);
  assert.equal(f.orders().length, 3, "no orders appear while paused");
  const resumed = await f.mutate({ action: "resume", expectedVersion: paused.standingOrder.version }, nextWindow);
  assert.ok(f.orders().length >= 3); assert.equal(resumed.standingOrder.status, "active");
  const pausedAgain = await f.mutate({ action: "pause", expectedVersion: resumed.standingOrder.version, upcomingOrders: "cancel" }, nextWindow);
  const open = f.orders().filter(order => order.deliveryDate > "2026-11-05" && order.control === "automatic");
  assert.ok(open.length > 0 && open.every(order => order.status === "cancelled"), "open automatic orders are withdrawn"); assert.ok(f.calls.some(call => call.status === "cancelled"));
  assert.equal(pausedAgain.standingOrder.status, "paused");
  await assert.rejects(f.mutate({ action: "pause", expectedVersion: pausedAgain.standingOrder.version }), (error: any) => error.status === 409);
}));

test("termination is audited and final; a fresh draft starts a new cycle without losing history", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f);
  const ended = await f.mutate({ action: "terminate", expectedVersion: created.standingOrder.version, note: "Site closed" }); assert.equal(ended.standingOrder.status, "terminated");
  await assert.rejects(f.mutate({ action: "resume", expectedVersion: ended.standingOrder.version }), (error: any) => error.status === 409);
  await assert.rejects(f.mutate({ action: "activate", expectedVersion: ended.standingOrder.version }), (error: any) => error.status === 409);
  assert.equal((await f.service.runStandingGeneration({ catalogue: f.catalogue(), now: NOW })).templates, 0);
  const redraft = await f.mutate({ action: "save", expectedVersion: ended.standingOrder.version, slots: SLOTS }); assert.equal(redraft.standingOrder.status, "draft"); assert.equal(redraft.standingOrder.cycle, 2); assert.equal(redraft.version!.action, "redrafted");
  assert.deepEqual(f.versions().map(version => version.action).sort(), ["activated", "created", "redrafted", "terminated"].sort());
  assert.equal(f.versions().length, redraft.standingOrder.version, "every head version has an immutable record");
}));

test("a pause or amendment that lands during a run prevents the stale write", () => withHosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  const standingModule = f.load(resolve(appRoot, "lib/grab-and-go-standing.ts"));
  const activeHead = standingModule.applyStandingAction(draft.standingOrder, { action: "activate", oplocId: OPLOC, actor: "manager@example.test", expectedVersion: 1 }, f.catalogue());
  await f.store.saveStandingOrderHosted(activeHead, 1);
  const stale = activeHead.head; // the run planned against version 2
  const pause = standingModule.applyStandingAction(stale, { action: "pause", oplocId: OPLOC, actor: "manager@example.test", expectedVersion: 2 }, f.catalogue());
  await f.store.saveStandingOrderHosted(pause, 2);
  const run = await f.service.reconcileStandingOrder(stale, f.catalogue(), { now: NOW, trigger: "scheduler" });
  assert.equal(f.orders().length, 0); assert.equal(f.events().length, 0); assert.ok(run.items.some(item => item.outcome === "template-changed"));
}));

test("template versions are compare-and-set; double submits and stale editors lose", () => withHosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  const results = await Promise.allSettled([f.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 1 }] } }), f.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 2 }] } })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]); assert.equal((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.status, 409);
  await assert.rejects(f.mutate({ action: "save", slots: SLOTS }), (error: any) => error.status === 409, "creating over an existing template");
  assert.equal(f.heads().length, 1); assert.equal(f.versions().length, 2); assert.equal(draft.standingOrder.version, 1);
  const unchanged = await f.mutate({ action: "save", expectedVersion: 2, slots: f.heads()[0].slots }); assert.equal(unchanged.unchanged, true); assert.equal(f.versions().length, 2, "a no-op save adds no version");
}));

test("a submitted one-off order populates its slot; cancelled and foreign orders cannot", () => withHosted(async () => {
  const f = fixture(); const order = applyOrderAction(undefined, { action: "submit", oplocId: OPLOC, deliveryDate: "2026-11-11", rotationWeek: 4, lines: [{ productId: "p:a", quantity: 12 }], actor: "site@example.test", at: NOW.toISOString() }, f.catalogue());
  await f.store.saveGrabAndGoOrderHosted(order);
  const populated = await f.mutate({ action: "populate-slot", deliveryDate: "2026-11-11" });
  assert.deepEqual(populated.standingOrder.slots, { "4:Wednesday": [{ productId: "p:a", quantity: 12 }] }); assert.equal(populated.version!.action, "slot-populated"); assert.equal(populated.version!.sourceOrderId, order.orderId); assert.equal(populated.standingOrder.status, "draft");
  const cancelled = applyOrderAction(order, { action: "cancel", oplocId: OPLOC, deliveryDate: order.deliveryDate, rotationWeek: 4, expectedVersion: 1, actor: "x", at: NOW.toISOString() }, f.catalogue()); await f.store.saveGrabAndGoOrderHosted(cancelled, 1);
  await assert.rejects(f.mutate({ action: "populate-slot", deliveryDate: "2026-11-11", expectedVersion: 1 }), (error: any) => error.status === 409);
  await assert.rejects(f.mutate({ action: "populate-slot", deliveryDate: "2026-11-30", expectedVersion: 1 }), (error: any) => error.status === 404);
}));

test("CPU and Logistics see ordinary Grab & Go source versions: v1 create, v2 amend, v3 cancel; nothing else is written", () => withHosted(async () => {
  const f = fixture(); const created = await activated(f); const wednesday = "2026-11-04";
  const amended = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "3:Wednesday": [{ productId: "p:a", quantity: 8 }] } });
  await f.mutate({ action: "save", expectedVersion: amended.standingOrder.version, slots: { "4:Monday": SLOTS["4:Monday"], "4:Wednesday": SLOTS["4:Wednesday"] } });
  const forwarded = f.calls.filter(call => call.serviceDate === wednesday).map(call => `${call.sourceVersion}:${call.status}:${call.lines.map((line: any) => line.quantity).join("+")}`);
  assert.deepEqual(forwarded, ["1:submitted:5", "2:submitted:8", "3:cancelled:8"]);
  for (const call of f.calls) { assert.equal(call.sourceDomain, "grab-and-go"); assert.equal(call.destinationOplocId, OPLOC); assert.ok(call.lines.every((line: any) => line.workstream === "grab_and_go" && line.unit === "item")); }
  const prefixes = new Set([...f.records.keys()].map(key => key.split("/")[0]));
  assert.deepEqual([...prefixes].sort(), ["fikaDeliveredInGrabAndGoHandoffV1", "fikaDeliveredInGrabAndGoOrdersV1", "fikaDeliveredInGrabAndGoStandingOrdersV1"], "no parallel production or fulfilment authority");
  f.failForward(true); const down = await f.mutate({ action: "save", expectedVersion: 4, slots: { "4:Monday": [{ productId: "p:a", quantity: 1 }], "4:Wednesday": SLOTS["4:Wednesday"] } });
  assert.equal(down.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.handoff, "pending", "a CPU outage leaves the committed version pending for the existing recovery worker");
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), NOW);
  assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.order!.handoff, "pending"); assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-11")!.order!.handoff, "delivered");
}));

test("overview reports source template, CPU handoff state and exceptions for upcoming deliveries", () => withHosted(async () => {
  const f = fixture(); await activated(f);
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), NOW);
  assert.equal(overview.standingOrder!.status, "active"); assert.equal(overview.versions[0].version, 2);
  const byDate = Object.fromEntries(overview.upcoming.map(item => [item.deliveryDate, item]));
  assert.equal(byDate["2026-11-04"].order!.source!.templateVersion, 2); assert.equal(byDate["2026-11-04"].order!.handoff, "delivered"); assert.equal(byDate["2026-11-16"].state, "no-slot");
  assert.equal(byDate["2026-11-02"].cutoffPassed, true);
  assert.ok(overview.versions.length <= 50 && f.queries.every(query => query.limit > 0), "every collection read is bounded");
}));

test("legacy standing-order documents are ignored and never rewritten", () => withHosted(async () => {
  const f = fixture(); f.records.set(`${f.store.STANDING_COLLECTION}/legacy`, { standingOrderId: "standing:old", oplocId: OPLOC, status: "active", weekdays: ["Monday"], lines: [{ productId: "p:a", quantity: 9 }], version: 4 });
  assert.deepEqual(await f.store.listActiveStandingOrdersHosted(10), []); assert.equal(await f.store.getStandingOrderHosted(OPLOC), undefined);
  await activated(f); assert.deepEqual(f.records.get(`${f.store.STANDING_COLLECTION}/legacy`).version, 4); assert.equal(f.orders().some(order => order.lines.some(line => line.quantity === 9)), false);
}));

test("templates are owned per OPLOC: a site only ever generates its own orders", () => withHosted(async () => {
  const f = fixture(); await activated(f); await f.mutate({ action: "save", oplocId: OTHER, slots: { "3:Wednesday": [{ productId: "p:b", quantity: 3 }] } } as any);
  assert.equal(f.heads().length, 2); assert.deepEqual([...new Set(f.orders().map(order => order.oplocId))], [OPLOC]);
  const other = await f.mutate({ action: "activate", oplocId: OTHER, expectedVersion: 1 } as any); assert.equal(other.standingOrder.oplocId, OTHER);
  assert.deepEqual(f.orders().filter(order => order.oplocId === OTHER).map(order => `${order.deliveryDate}:${lines(order)}`), ["2026-11-04:p:b:3"]);
  assert.equal(f.orders().filter(order => order.oplocId === OPLOC).length, 3);
}));

test("site API enforces AUTHMOD scope and rejects unsupported requests before touching persistence", () => withHosted(async () => {
  const f = fixture(); const route = f.load(resolve(appRoot, "app/api/delivered-in/grab-and-go/standing-orders/route.ts")); const { NextRequest } = require("next/server");
  const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/delivered-in/grab-and-go/standing-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = (query: string) => route.GET(new NextRequest(`http://localhost/api/delivered-in/grab-and-go/standing-orders${query}`));
  assert.equal((await post({ oplocId: OTHER, action: "save", slots: SLOTS })).status, 403); assert.equal((await get(`?oplocId=${OTHER}`)).status, 403); assert.equal(f.records.size, 0);
  assert.equal((await post({ oplocId: OPLOC, action: "save", slots: SLOTS, actor: "forged@example.test" })).status, 422, "actor is never client-supplied");
  assert.equal((await post({ oplocId: OPLOC, action: "delete" })).status, 422); assert.equal(f.records.size, 0);
  const saved = await post({ oplocId: OPLOC, action: "save", slots: SLOTS }); assert.equal(saved.status, 201); const body = await saved.json(); assert.equal(body.standingOrder.updatedBy, "manager@example.test");
  const overview = await (await get(`?oplocId=${OPLOC}`)).json(); assert.equal(overview.standingOrder.version, 1); assert.equal(overview.upcoming.length > 0, true);
  // Historical alias of an authorised OPLOC resolves to the canonical owner.
  const canonical = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b", alias = "oploc:46701265-15af-48f4-a230-1d27ca21bc59"; f.setAccess({ email: "manager@example.test", oplocIds: [canonical], permissions: ["delivered_in.view"] });
  assert.equal((await post({ oplocId: alias, action: "save", slots: SLOTS })).status, 201); assert.ok(f.heads().some(head => head.oplocId === canonical)); assert.ok(!f.heads().some(head => head.oplocId === alias));
}));

test("scheduler endpoint is internal-only, bounded and never schedules itself", async () => {
  const f = fixture(); const route = f.load(resolve(appRoot, "app/api/internal/grab-and-go-standing-orders/route.ts")); const { NextRequest } = require("next/server"); const previous = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "isolated-token";
  try {
    const request = (body: unknown, authorised = true) => new NextRequest("http://localhost/api/internal/grab-and-go-standing-orders", { method: "POST", headers: { "content-type": "application/json", ...(authorised ? { "x-fika-internal-token": "isolated-token" } : {}) }, body: JSON.stringify(body) });
    assert.equal((await route.POST(request({}, false))).status, 403); assert.equal((await route.POST(request({ limit: 51 }))).status, 422); assert.equal((await route.POST(request({ eventId: "x" }))).status, 422); assert.equal((await route.POST(request({ oplocId: "not-an-oploc" }))).status, 422);
    assert.equal(f.queries.length, 0); await withHosted(async () => { const ok = await route.POST(request({ limit: 5 })); assert.equal(ok.status, 200); assert.equal(f.queries[0].limit, 6, "scan is bounded by limit + 1"); assert.deepEqual(f.queries[0].filters.map((filter: any) => filter.field), ["recordType", "status"]); });
  } finally { if (previous === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previous; }
});

test("Firestore index for standing-order version history is declared", () => {
  const indexes = JSON.parse(readFileSync(new URL("../../integration-hub/firestore.indexes.json", import.meta.url), "utf8"));
  assert.ok(indexes.indexes.some((index: any) => index.collectionGroup === "fikaDeliveredInGrabAndGoStandingOrdersV1" && index.fields.map((field: any) => `${field.fieldPath}:${field.order}`).join(",") === "recordType:ASCENDING,oplocId:ASCENDING,version:DESCENDING"));
});

function localFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "fika-grab-standing-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const calls: any[] = [];
  const load = typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: (_app: string, ...parts: string[]) => join(directory, parts.at(-1)!) },
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db: { collection: () => { throw new Error("Local standing-order regression must not access Firestore."); } } },
    [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { calls.push(input); return "delivered"; } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} },
    "@fika/server-shared/data-source-meter-server": { recordDataAccess() {} },
  } });
  return { calls, service: load(resolve(appRoot, "lib/grab-and-go-standing-service.ts")) as typeof import("../lib/grab-and-go-standing-service"), store: load(resolve(appRoot, "lib/grab-and-go-store.ts")) as typeof import("../lib/grab-and-go-store") };
}
test("local runtime persists templates, versions and generated orders atomically in the existing SQLite state", async t => {
  const { service, store, calls } = localFixture(t); const mutate = (input: any, at = NOW) => service.mutateStandingOrder({ oplocId: OPLOC, actor: "local@example.test", ...input }, catalogue(), at);
  const draft = await mutate({ action: "save", slots: SLOTS }); const active = await mutate({ action: "activate", expectedVersion: draft.standingOrder.version });
  assert.equal(active.reconcile!.items.filter(item => item.outcome === "created").length, 3); assert.equal(calls.length, 3);
  assert.deepEqual(store.listGrabAndGoOrders(OPLOC).map(order => order.deliveryDate), ["2026-11-04", "2026-11-09", "2026-11-11"]);
  assert.equal((await service.runStandingGeneration({ catalogue: catalogue(), now: NOW })).created, 0, "replay is idempotent locally too");
  assert.equal((await store.listStandingVersionsHosted(OPLOC)).length, 2);
  await mutate({ action: "pause", expectedVersion: active.standingOrder.version });
  const guarded = await service.reconcileStandingOrder(active.standingOrder, catalogue(), { now: new Date("2026-11-03T09:00:00Z"), trigger: "scheduler" });
  assert.ok(guarded.items.every(item => item.outcome !== "created"), "a paused template cannot create orders"); assert.equal(store.listGrabAndGoOrders(OPLOC).length, 3);
  await assert.rejects(mutate({ action: "save", expectedVersion: 1, slots: SLOTS }), (error: any) => error.status === 409);
});
