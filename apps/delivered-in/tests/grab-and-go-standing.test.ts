import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { type TestContext } from "node:test";
import { applyOrderAction, deliveryCutoff, londonInstant, rotationWeekForDate, type GrabAndGoOrder } from "../lib/grab-and-go";
import { applyStandingAction, generationInstant, isGenerationDue, manualGenerationDates, planStandingOccurrences, slotKey, slotKeyForDate, standingDeliveryDates, upcomingGenerations } from "../lib/grab-and-go-standing";
import { parseExternalProductionMaterialisation } from "@fika/server-shared/external-production";
import { OPLOC, OTHER, MON, THU, SLOTS, activate, appRoot, catalogue, fakeFirestore, lines, standingModules, withHostedRuntime as hosted, type Modules } from "./support/standing-fixture";

const require = createRequire(import.meta.url);
const MON2 = new Date("2026-11-09T12:01:00Z"); // Wed 11-11 becomes due
const fixture = () => { const fs = fakeFirestore(); const m = standingModules(fs.db); const rows = (name: string) => [...fs.records.entries()].filter(([key]) => key.startsWith(`${name}/`)).map(([, row]) => row);
  return { ...m, fs, records: fs.records, queries: fs.queries, rows,
    orders: () => rows("fikaDeliveredInGrabAndGoOrdersV1").sort((a, b) => a.deliveryDate.localeCompare(b.deliveryDate)) as GrabAndGoOrder[],
    events: () => rows("fikaDeliveredInGrabAndGoHandoffV1"),
    heads: () => rows(m.store.STANDING_COLLECTION).filter(row => row.recordType === "head"),
    versions: () => rows(m.store.STANDING_COLLECTION).filter(row => row.recordType === "version"),
    operations: () => rows(m.store.STANDING_COLLECTION).filter(row => row.recordType === "operation") }; };
type F = ReturnType<typeof fixture>;
const orderOn = (f: F, date: string) => f.orders().find(order => order.deliveryDate === date)!;
const manualOrder = (f: F, date: string, week: number, quantity: number, product = "p:b") => applyOrderAction(undefined, { action: "submit", oplocId: OPLOC, deliveryDate: date, rotationWeek: week, lines: [{ productId: product, quantity }], actor: "site@example.test", at: MON.toISOString() }, f.catalogue());

test("the four-week rotation maps each Monday/Wednesday to its own independently editable slot", () => {
  const all: Record<string, Array<{ productId: string; quantity: number }>> = {}; let quantity = 0;
  for (const week of [1, 2, 3, 4]) for (const weekday of ["Monday", "Wednesday"] as const) all[slotKey(week, weekday)] = [{ productId: "p:a", quantity: ++quantity }];
  const head = applyStandingAction(undefined, { action: "save", oplocId: OPLOC, actor: "m", slots: all, at: MON.toISOString() }, catalogue()).head;
  const plan = planStandingOccurrences({ ...head, status: "active" }, new Map(), catalogue(), MON, 27);
  assert.equal(plan.length, 8, "28 days contain exactly the eight rotation slots"); assert.equal(new Set(plan.map(item => item.slotKey)).size, 8);
  for (const item of plan) { assert.equal(item.slotKey, slotKeyForDate(item.deliveryDate)); assert.equal(item.templateLines[0].quantity, Object.keys(all).indexOf(item.slotKey) + 1); assert.equal(item.rotationWeek, rotationWeekForDate(item.deliveryDate)); }
  const edited = applyStandingAction(head, { action: "save", oplocId: OPLOC, actor: "m", expectedVersion: 1, slots: { ...all, "2:Wednesday": [{ productId: "p:b", quantity: 40 }] } }, catalogue());
  assert.deepEqual(edited.version?.changedSlots, ["2:Wednesday"]);
});

test("generation instants are Monday 12:01 for Wednesday and Thursday 12:01 for Monday, in London time across BST/GMT", () => {
  assert.equal(generationInstant("2026-11-04").toISOString(), "2026-11-02T12:01:00.000Z", "Wednesday <- Monday, GMT");
  assert.equal(generationInstant("2026-11-09").toISOString(), "2026-11-05T12:01:00.000Z", "Monday <- previous Thursday, GMT");
  assert.equal(generationInstant("2026-10-21").toISOString(), "2026-10-19T11:01:00.000Z", "Wednesday in BST: 12:01 BST = 11:01Z");
  assert.equal(generationInstant("2026-10-26").toISOString(), "2026-10-22T11:01:00.000Z", "Thursday in BST for the Monday after clocks go back");
  assert.equal(generationInstant("2026-03-30").toISOString(), "2026-03-26T12:01:00.000Z", "Thursday in GMT for the Monday after clocks go forward");
  assert.equal(generationInstant("2026-04-01").toISOString(), "2026-03-30T11:01:00.000Z", "Monday in BST");
  assert.equal(londonInstant("2026-10-25", 12, 0).toISOString(), deliveryCutoff("2026-10-26").toISOString(), "same helper as the existing noon cutoff");
  // Cutoffs are unchanged: Tuesday 12:00 for Wednesday, Sunday 12:00 for Monday.
  assert.equal(deliveryCutoff("2026-11-04").toISOString(), "2026-11-03T12:00:00.000Z"); assert.equal(deliveryCutoff("2026-11-09").toISOString(), "2026-11-08T12:00:00.000Z");
  assert.equal(deliveryCutoff("2026-10-26").toISOString(), "2026-10-25T12:00:00.000Z", "Sunday after clocks go back: 12:00 GMT");
  assert.equal(deliveryCutoff("2026-10-21").toISOString(), "2026-10-20T11:00:00.000Z", "Tuesday in BST");
  assert.equal(deliveryCutoff("2026-03-30").toISOString(), "2026-03-29T11:00:00.000Z", "Sunday after clocks go forward: 12:00 BST");
  // Due window: generation time reached AND cutoff still open.
  assert.equal(isGenerationDue("2026-10-26", new Date("2026-10-22T11:00:59Z")), false); assert.equal(isGenerationDue("2026-10-26", new Date("2026-10-22T11:01:00Z")), true);
  assert.equal(isGenerationDue("2026-10-26", new Date("2026-10-25T11:59:59Z")), true, "recoverable right up to the cutoff"); assert.equal(isGenerationDue("2026-10-26", new Date("2026-10-25T12:00:00Z")), false);
  assert.equal(isGenerationDue("2026-03-30", new Date("2026-03-29T10:59:59Z")), true); assert.equal(isGenerationDue("2026-03-30", new Date("2026-03-29T11:00:00Z")), false, "BST cutoff is 11:00Z");
  // 23:30 UTC on 24 Oct is 00:30 BST on 25 Oct: the London day anchors the window.
  assert.equal(standingDeliveryDates(new Date("2026-10-24T23:30:00Z"), 1)[0], "2026-10-26");
  assert.deepEqual(upcomingGenerations(new Date("2026-11-03T09:00:00Z")).map(item => `${item.deliveryDate}@${item.generationAt}`), ["2026-11-09@2026-11-05T12:01:00.000Z", "2026-11-11@2026-11-09T12:01:00.000Z"]);
});

test("activation, amendment and resume never create orders; the schedule creates exactly one due order per run", () => hosted(async () => {
  const f = fixture(); const created = await activate(f);
  assert.equal(created.standingOrder.status, "active"); assert.equal(f.orders().length, 0, "activating generates nothing"); assert.equal(created.reconcile, undefined);
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Wednesday": [{ productId: "p:b", quantity: 9 }] } });
  assert.equal(f.orders().length, 0, "amending generates nothing"); assert.deepEqual(edit.reconcile!.items.filter(item => item.outcome !== "unchanged"), []);
  const slots = { ...SLOTS, "4:Wednesday": [{ productId: "p:b", quantity: 9 }] };
  const monday = await f.run(MON); assert.deepEqual(monday.results[0].items.filter(item => item.outcome === "created").map(item => item.deliveryDate), ["2026-11-04"], "Monday 12:01 creates Wednesday only");
  const wed = orderOn(f, "2026-11-04");
  assert.equal(lines(wed), "p:a:5"); assert.equal(wed.control, "automatic"); assert.equal(wed.source?.type, "standing-order"); assert.equal(wed.source?.templateVersion, 3); assert.equal(wed.source?.trigger, "scheduler");
  assert.equal(wed.updatedBy, "manager@example.test", "the authorising person, not a synthetic actor"); assert.equal(wed.history[0].automation?.standingOrderId, `grab-and-go-standing:v2:${OPLOC}`); assert.equal(wed.orderId, `grab-and-go:${OPLOC}:2026-11-04`);
  const thursday = await f.run(THU); assert.deepEqual(thursday.results[0].items.filter(item => item.outcome === "created").map(item => item.deliveryDate), ["2026-11-09"], "Thursday 12:01 creates the following Monday only");
  assert.equal(lines(orderOn(f, "2026-11-09")), "p:a:6,p:b:2"); assert.equal(f.orders().length, 2, "Wednesday 11-11 is not generated until Monday 11-09 12:01");
  await f.run(MON2); assert.equal(lines(orderOn(f, "2026-11-11")), `p:b:${slots["4:Wednesday"][0].quantity}`);
  assert.equal(f.events().length, 3, "one immutable handoff event per generated order, committed with it"); assert.equal(f.calls.length, 3);
  const manualEquivalent = f.handoff.grabHandoffEvent(wed); assert.deepEqual(f.events().find(event => event.eventId === manualEquivalent.eventId).payload, manualEquivalent.payload);
  assert.ok(f.calls.every(call => call.sourceDomain === "grab-and-go" && call.destinationOplocId === OPLOC && call.status === "submitted"));
  for (const call of f.calls) assert.deepEqual(parseExternalProductionMaterialisation(call), call, "every generated handoff passes the shared CPU intake contract unchanged");
  const paused = await f.mutate({ action: "pause", expectedVersion: edit.standingOrder.version }, MON2); const resumed = await f.mutate({ action: "resume", expectedVersion: paused.standingOrder.version }, MON2);
  assert.equal(resumed.standingOrder.status, "active"); assert.equal(f.orders().length, 3, "resume creates nothing");
}));

test("replay and retry change nothing: no duplicate orders, versions, events or forwards", () => hosted(async () => {
  const f = fixture(); await activate(f); await f.run(MON); const before = JSON.stringify(f.orders()); const events = f.events().length, forwarded = f.calls.length;
  for (let i = 0; i < 3; i += 1) { const run = await f.run(new Date(MON.getTime() + i * 60_000)); assert.equal(run.created + run.amended + run.cancelled, 0); }
  assert.equal(JSON.stringify(f.orders()), before); assert.equal(f.events().length, events); assert.equal(f.calls.length, forwarded);
}));

test("missed scheduler runs recover until the cutoff and never backfill after it", () => hosted(async () => {
  const f = fixture(); await activate(f);
  // The Monday 12:01 run never happened. Tuesday 09:00 (before the Tuesday 12:00 cutoff) recovers it exactly once.
  const recovered = await f.run(new Date("2026-11-03T09:00:00Z")); assert.equal(recovered.created, 1); assert.equal(orderOn(f, "2026-11-04").source?.trigger, "scheduler");
  assert.equal((await f.run(new Date("2026-11-03T11:59:00Z"))).created, 0);
  // The Thursday run is also missed and nobody recovers it before the Sunday 12:00 cutoff: it is reported, not backfilled.
  const late = new Date("2026-11-08T12:00:00Z"); assert.equal((await f.run(late)).created, 0); assert.ok(!f.orders().some(order => order.deliveryDate === "2026-11-09"));
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), late); const missed = overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!;
  assert.equal(missed.state, "missed"); assert.match(missed.exception!, /did not create this order before the cut-off/);
  // Friday recovery of the Thursday run.
  const g = fixture(); await activate(g); assert.equal((await g.run(new Date("2026-11-06T10:00:00Z"))).created, 1); assert.equal(orderOn(g, "2026-11-09").deliveryDate, "2026-11-09");
  // A site activated after the generation time is not reported as a missed run.
  const h = fixture(); const draft = await h.mutate({ action: "save", slots: SLOTS }, new Date("2026-11-03T08:00:00Z")); await h.mutate({ action: "activate", expectedVersion: 1 }, new Date("2026-11-03T08:00:00Z"));
  assert.equal(draft.standingOrder.version, 1); assert.notEqual((await h.service.standingOverview(OPLOC, h.catalogue(), new Date("2026-11-03T12:00:00Z"))).upcoming.find(item => item.deliveryDate === "2026-11-04")!.state, "missed");
}));

test("scheduler cost is bounded: scan limit, per-template reads and dates", () => hosted(async () => {
  const f = fixture(); await activate(f); f.queries.length = 0; await f.run(MON, { limit: 5 });
  assert.equal(f.queries[0].limit, 6); assert.deepEqual(f.queries[0].filters.map((filter: any) => filter.field), ["recordType", "status"]);
  assert.equal(f.queries.length, 1, "one bounded scan; everything else is direct reads of known ids");
}));

test("concurrent scheduler runs create each order exactly once", () => hosted(async () => {
  const f = fixture(); await activate(f);
  const runs = await Promise.all([f.run(MON), f.run(MON), f.run(MON)]);
  assert.equal(runs.reduce((sum, run) => sum + run.created, 0), 1); assert.equal(runs.reduce((sum, run) => sum + run.skipped, 0), 2); assert.equal(f.orders().length, 1); assert.equal(orderOn(f, "2026-11-04").version, 1); assert.equal(f.events().length, 1); assert.equal(f.calls.length, 1);
}));

test("manual orders are never overwritten, and a manual edit takes an automatic order out of template control", () => hosted(async () => {
  const f = fixture(); await f.store.saveGrabAndGoOrderHosted(manualOrder(f, "2026-11-04", 3, 1));
  const created = await activate(f); const monday = await f.run(MON);
  assert.equal(monday.results[0].items.find(item => item.deliveryDate === "2026-11-04")!.outcome, "skipped-manual-order"); assert.equal(lines(orderOn(f, "2026-11-04")), "p:b:1"); assert.equal(orderOn(f, "2026-11-04").version, 1); assert.equal(orderOn(f, "2026-11-04").source, undefined);
  await f.run(THU); const auto = orderOn(f, "2026-11-09");
  const amended = applyOrderAction(auto, { action: "amend", oplocId: OPLOC, deliveryDate: auto.deliveryDate, rotationWeek: auto.rotationWeek, lines: [{ productId: "p:a", quantity: 99 }], expectedVersion: auto.version, actor: "site@example.test", at: THU.toISOString() }, f.catalogue());
  assert.equal(amended.control, "manual"); assert.ok(amended.source, "provenance is retained for audit"); await f.store.saveGrabAndGoOrderHosted(amended, auto.version);
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 1 }] } }, THU);
  assert.equal(edit.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.outcome, "skipped-manual-order"); assert.equal(lines(orderOn(f, "2026-11-09")), "p:a:99");
  assert.equal((await f.run(THU)).amended, 0);
}));

test("a cancelled order is never resurrected by later runs, resume or amendment", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(MON); const auto = orderOn(f, "2026-11-04");
  const cancelled = applyOrderAction(auto, { action: "cancel", oplocId: OPLOC, deliveryDate: auto.deliveryDate, rotationWeek: auto.rotationWeek, expectedVersion: 1, actor: "site@example.test", at: MON.toISOString() }, f.catalogue()); await f.store.saveGrabAndGoOrderHosted(cancelled, 1);
  const again = await f.run(new Date(MON.getTime() + 60_000)); assert.equal(again.results[0].items.find(item => item.deliveryDate === "2026-11-04")!.outcome, "skipped-cancelled"); assert.equal(orderOn(f, "2026-11-04").status, "cancelled"); assert.equal(orderOn(f, "2026-11-04").version, 2);
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "3:Wednesday": [{ productId: "p:b", quantity: 1 }] } });
  const paused = await f.mutate({ action: "pause", expectedVersion: edit.standingOrder.version }); await f.mutate({ action: "resume", expectedVersion: paused.standingOrder.version });
  assert.equal(orderOn(f, "2026-11-04").status, "cancelled"); assert.equal(orderOn(f, "2026-11-04").version, 2);
}));

test("future automatic orders follow template amendments with explicit versions and downstream propagation; cutoff freezes them", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(THU); f.calls.length = 0;
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 10 }] }, note: "Event week" }, THU);
  assert.equal(edit.version!.action, "amended"); assert.deepEqual(edit.version!.changedSlots, ["4:Monday"]); assert.equal(edit.complete, true);
  const monday = orderOn(f, "2026-11-09"); assert.equal(monday.version, 2); assert.equal(lines(monday), "p:a:10"); assert.equal(monday.source?.templateVersion, 3); assert.equal(monday.history.at(-1)!.automation?.templateVersion, 3); assert.equal(monday.history[0].lines.length, 2, "v1 lines are retained in history");
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].sourceVersion, 2); assert.equal(f.calls[0].lines.length, 1);
  assert.equal(f.events().filter(event => event.sourceAggregateId === monday.orderId).length, 2, "v1 evidence retained beside v2");
  const after = new Date("2026-11-08T12:00:00Z");
  const late = await f.mutate({ action: "save", expectedVersion: edit.standingOrder.version, slots: { ...SLOTS, "4:Monday": [{ productId: "p:a", quantity: 77 }] } }, after);
  assert.equal(orderOn(f, "2026-11-09").version, 2); assert.deepEqual(late.reconcile!.items.filter(item => item.outcome !== "unchanged"), [], "the closed date is left alone");
  assert.throws(() => applyOrderAction(monday, { action: "amend", oplocId: OPLOC, deliveryDate: monday.deliveryDate, rotationWeek: 4, lines: [{ productId: "p:a", quantity: 1 }], expectedVersion: 2, actor: "x", at: after.toISOString() }, f.catalogue()), (error: any) => error.status === 409);
}));

test("removing a slot withdraws its future automatic order downstream", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(THU); f.calls.length = 0;
  const { "4:Monday": _removed, ...rest } = SLOTS;
  const edit = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: rest }, THU);
  const monday = orderOn(f, "2026-11-09"); assert.equal(monday.status, "cancelled"); assert.equal(monday.version, 2);
  assert.equal(edit.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.outcome, "cancelled"); assert.equal(f.calls[0].status, "cancelled"); assert.equal(f.calls[0].sourceVersion, 2);
}));

test("catalogue changes fail closed: unavailable products block creation and amendment, never drop lines", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(THU);
  const rejected = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { "4:Monday": [{ productId: "p:wk4mon", quantity: 1 }], "3:Wednesday": [{ productId: "p:wk4mon", quantity: 1 }] } }).catch((error: any) => error);
  assert.equal(rejected.status, 422, "p:wk4mon is only offered on week-4 Mondays, so week-3 Wednesday cannot hold it");
  f.setCatalogue(f.catalogue().map(item => item.productId === "p:b" ? { ...item, active: false } : item));
  const before = JSON.stringify(f.orders()); const run = await f.run(THU);
  assert.equal(JSON.stringify(f.orders()), before, "existing orders are left exactly as ordered"); assert.deepEqual(run.results[0].items.filter(item => item.outcome === "unavailable-lines").map(item => item.deliveryDate), ["2026-11-09", "2026-11-11"], "unavailable lines are reported as soon as they are known"); assert.equal(run.exceptions, 2);
  const wednesday = await f.run(MON2); assert.equal(wednesday.created, 0, "week-4 Wednesday uses the withdrawn product, so nothing is created and no line is dropped"); assert.ok(!f.orders().some(order => order.deliveryDate === "2026-11-11"));
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), MON2); const blocked = overview.upcoming.find(item => item.deliveryDate === "2026-11-11")!;
  assert.equal(blocked.state, "unavailable-lines"); assert.match(blocked.exception!, /catalogue no longer offers/); assert.equal(blocked.canGenerateNow, false);
  const draft = fixture(); const saved = await draft.mutate({ action: "save", slots: SLOTS }); draft.setCatalogue(draft.catalogue().map(item => item.productId === "p:b" ? { ...item, active: false } : item));
  assert.equal(((await draft.mutate({ action: "activate", expectedVersion: saved.standingOrder.version }).catch((error: any) => error)) as any).status, 422, "activation re-validates every slot against the live catalogue");
}));

test("pause only stops future generation; cancelling outstanding automatic orders is a separate, audited, recoverable action", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(MON); await f.run(THU); f.calls.length = 0;
  const paused = await f.mutate({ action: "pause", expectedVersion: created.standingOrder.version }, THU); assert.equal(paused.standingOrder.status, "paused");
  assert.ok(f.orders().every(order => order.status === "submitted"), "pausing cancels nothing"); assert.equal(f.calls.length, 0);
  assert.equal((await f.run(THU)).templates, 0, "paused templates are not scheduled");
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), THU); assert.match(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.exception!, /paused, but this automatic order is still active/);
  await assert.rejects(f.mutate({ action: "cancel-upcoming", expectedVersion: 99 }, THU), (error: any) => error.status === 409, "stale view");
  // CPU outage during the explicit cancellation: the cancellation is recorded, but it is NOT reported as complete.
  f.failForward(true);
  const partial = await f.mutate({ action: "cancel-upcoming", expectedVersion: paused.standingOrder.version, actor: "ops@example.test" }, THU);
  assert.equal(partial.complete, false); assert.equal(partial.reconcile!.items.find(item => item.deliveryDate === "2026-11-09")!.handoff, "pending"); assert.equal(orderOn(f, "2026-11-09").status, "cancelled");
  assert.equal(f.operations().length, 1); assert.equal(f.operations()[0].complete, false); assert.equal(f.operations()[0].actor, "ops@example.test"); assert.equal(f.operations()[0].operation, "cancel-upcoming");
  const pending = await f.service.standingOverview(OPLOC, f.catalogue(), THU); const row = pending.upcoming.find(item => item.deliveryDate === "2026-11-09")!;
  assert.equal(row.order!.handoff, "pending"); assert.match(row.exception!, /cancellation is recorded but CPU has not been updated/); assert.equal(pending.operations[0].complete, false);
  // Recovery: the existing bounded outbox worker (or the retry button) delivers the identical cancellation.
  f.failForward(false); const recovery = await f.handoff.recoverGrabHandoffs(25, new Date(THU.getTime() + 120_000)); assert.equal(recovery.delivered, 1);
  assert.equal(f.calls.at(-1).status, "cancelled"); assert.equal(f.calls.at(-1).sourceVersion, 2);
  const healed = await f.service.standingOverview(OPLOC, f.catalogue(), THU); assert.equal(healed.upcoming.find(item => item.deliveryDate === "2026-11-09")!.order!.handoff, "delivered"); assert.equal(healed.upcoming.find(item => item.deliveryDate === "2026-11-09")!.exception, undefined);
  // Retrying the explicit action is idempotent and never touches manual orders or already-cancelled ones.
  const again = await f.mutate({ action: "cancel-upcoming", expectedVersion: paused.standingOrder.version }, THU); assert.equal(again.complete, true); assert.equal(orderOn(f, "2026-11-09").version, 2);
  const resumed = await f.mutate({ action: "resume", expectedVersion: paused.standingOrder.version }, THU); assert.equal(orderOn(f, "2026-11-09").status, "cancelled", "resume never resurrects");
  assert.equal(resumed.standingOrder.status, "active");
  await assert.rejects(f.mutate({ action: "cancel-upcoming", expectedVersion: resumed.standingOrder.version }, THU), (error: any) => error.status === 409, "an active template must be paused first");
}));

test("termination is audited and final; a fresh draft starts a new cycle without losing history", () => hosted(async () => {
  const f = fixture(); const created = await activate(f);
  const ended = await f.mutate({ action: "terminate", expectedVersion: created.standingOrder.version, note: "Site closed" }); assert.equal(ended.standingOrder.status, "terminated");
  await assert.rejects(f.mutate({ action: "resume", expectedVersion: ended.standingOrder.version }), (error: any) => error.status === 409);
  await assert.rejects(f.mutate({ action: "activate", expectedVersion: ended.standingOrder.version }), (error: any) => error.status === 409);
  assert.equal((await f.run(MON)).templates, 0);
  const redraft = await f.mutate({ action: "save", expectedVersion: ended.standingOrder.version, slots: SLOTS }); assert.equal(redraft.standingOrder.status, "draft"); assert.equal(redraft.standingOrder.cycle, 2); assert.equal(redraft.version!.action, "redrafted");
  assert.deepEqual(f.versions().map(version => version.action).sort(), ["activated", "created", "redrafted", "terminated"]); assert.equal(f.versions().length, redraft.standingOrder.version, "every head version has an immutable record");
}));

test("a pause or amendment that lands during a run prevents the stale write", () => hosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  const activeHead = f.standing.applyStandingAction(draft.standingOrder, { action: "activate", oplocId: OPLOC, actor: "manager@example.test", expectedVersion: 1 }, f.catalogue()); await f.store.saveStandingOrderHosted(activeHead as any, 1);
  const stale = activeHead.head; const pause = f.standing.applyStandingAction(stale, { action: "pause", oplocId: OPLOC, actor: "manager@example.test", expectedVersion: 2 }, f.catalogue()); await f.store.saveStandingOrderHosted(pause as any, 2);
  const run = await f.service.reconcileStandingOrder(stale, f.catalogue(), { now: MON, trigger: "scheduler", mode: "scheduled" });
  assert.equal(f.orders().length, 0); assert.equal(f.events().length, 0); assert.ok(run.items.some(item => item.outcome === "template-changed"));
}));

test("template versions are compare-and-set; double submits and stale editors lose", () => hosted(async () => {
  const f = fixture(); await f.mutate({ action: "save", slots: SLOTS });
  const results = await Promise.allSettled([f.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 1 }] } }), f.mutate({ action: "save", expectedVersion: 1, slots: { "3:Wednesday": [{ productId: "p:a", quantity: 2 }] } })]);
  assert.deepEqual(results.map(result => result.status).sort(), ["fulfilled", "rejected"]); assert.equal((results.find(result => result.status === "rejected") as PromiseRejectedResult).reason.status, 409);
  await assert.rejects(f.mutate({ action: "save", slots: SLOTS }), (error: any) => error.status === 409, "creating over an existing template"); assert.equal(f.heads().length, 1); assert.equal(f.versions().length, 2);
  const unchanged = await f.mutate({ action: "save", expectedVersion: 2, slots: f.heads()[0].slots }); assert.equal(unchanged.unchanged, true); assert.equal(f.versions().length, 2, "a no-op save adds no version");
}));

test("a submitted one-off order populates its slot; cancelled and foreign orders cannot", () => hosted(async () => {
  const f = fixture(); const order = manualOrder(f, "2026-11-11", 4, 12, "p:a"); await f.store.saveGrabAndGoOrderHosted(order);
  const populated = await f.mutate({ action: "populate-slot", deliveryDate: "2026-11-11" });
  assert.deepEqual(populated.standingOrder.slots, { "4:Wednesday": [{ productId: "p:a", quantity: 12 }] }); assert.equal(populated.version!.action, "slot-populated"); assert.equal(populated.version!.sourceOrderId, order.orderId); assert.equal(populated.standingOrder.status, "draft");
  const cancelled = applyOrderAction(order, { action: "cancel", oplocId: OPLOC, deliveryDate: order.deliveryDate, rotationWeek: 4, expectedVersion: 1, actor: "x", at: MON.toISOString() }, f.catalogue()); await f.store.saveGrabAndGoOrderHosted(cancelled, 1);
  await assert.rejects(f.mutate({ action: "populate-slot", deliveryDate: "2026-11-11", expectedVersion: 1 }), (error: any) => error.status === 409);
  await assert.rejects(f.mutate({ action: "populate-slot", deliveryDate: "2026-11-30", expectedVersion: 1 }), (error: any) => error.status === 404);
}));

test("controlled manual generation obeys eligibility, cutoff and precedence, is audited and attributed to the person", () => hosted(async () => {
  const f = fixture(); const draft = await f.mutate({ action: "save", slots: SLOTS });
  await assert.rejects(f.mutate({ action: "generate", expectedVersion: 1, deliveryDate: "2026-11-04" }), (error: any) => error.status === 409, "a draft cannot generate");
  const active = await f.mutate({ action: "activate", expectedVersion: draft.standingOrder.version });
  await assert.rejects(f.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-11" }), (error: any) => error.status === 422, "only the next two open deliveries");
  await assert.rejects(f.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-02" }), (error: any) => error.status === 422, "closed dates");
  await assert.rejects(f.mutate({ action: "generate", expectedVersion: 1, deliveryDate: "2026-11-04" }), (error: any) => error.status === 409, "stale template version");
  assert.deepEqual(manualGenerationDates(MON), ["2026-11-04", "2026-11-09"]); assert.equal(f.orders().length, 0, "nothing was created by the rejected attempts");
  const result = await f.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-09", actor: "derek@example.test" });
  assert.equal(result.complete, true); assert.equal(result.reconcile!.items.length, 1, "exactly one date"); const created = orderOn(f, "2026-11-09");
  assert.equal(lines(created), "p:a:6,p:b:2"); assert.equal(created.source?.trigger, "manual-run"); assert.equal(created.updatedBy, "derek@example.test"); assert.equal(created.rotationWeek, 4); assert.equal(f.calls.length, 1); assert.equal(f.operations()[0].operation, "manual-generate");
  const second = await f.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-09" }); assert.equal(second.reconcile!.items[0].outcome, "unchanged"); assert.equal(f.orders().length, 1, "idempotent");
  await f.store.saveGrabAndGoOrderHosted(manualOrder(f, "2026-11-04", 3, 3)); const blocked = await f.mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-04" });
  assert.equal(blocked.reconcile!.items[0].outcome, "skipped-manual-order"); assert.equal(lines(orderOn(f, "2026-11-04")), "p:b:3");
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), MON); assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.canGenerateNow, false, "already created"); assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-11")!.canGenerateNow, false);
}));

test("CPU and Logistics see ordinary Grab & Go source versions: v1 create, v2 amend, v3 cancel; nothing else is written", () => hosted(async () => {
  const f = fixture(); const created = await activate(f); await f.run(MON); const wednesday = "2026-11-04";
  const amended = await f.mutate({ action: "save", expectedVersion: created.standingOrder.version, slots: { ...SLOTS, "3:Wednesday": [{ productId: "p:a", quantity: 8 }] } });
  await f.mutate({ action: "save", expectedVersion: amended.standingOrder.version, slots: { "4:Monday": SLOTS["4:Monday"], "4:Wednesday": SLOTS["4:Wednesday"] } });
  assert.deepEqual(f.calls.filter(call => call.serviceDate === wednesday).map(call => `${call.sourceVersion}:${call.status}:${call.lines.map((line: any) => line.quantity).join("+")}`), ["1:submitted:5", "2:submitted:8", "3:cancelled:8"]);
  for (const call of f.calls) { assert.equal(call.sourceDomain, "grab-and-go"); assert.equal(call.destinationOplocId, OPLOC); assert.ok(call.lines.every((line: any) => line.workstream === "grab_and_go" && line.unit === "item" && line.canonicalItemId.startsWith("p:"))); }
  assert.deepEqual([...new Set([...f.records.keys()].map(key => key.split("/")[0]))].sort(), ["fikaDeliveredInGrabAndGoHandoffV1", "fikaDeliveredInGrabAndGoOrdersV1", "fikaDeliveredInGrabAndGoStandingOrdersV1"], "no parallel production or fulfilment authority");
  f.failForward(true); await f.run(THU); assert.equal(orderOn(f, "2026-11-09").version, 1);
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), THU); assert.equal(overview.upcoming.find(item => item.deliveryDate === "2026-11-09")!.order!.handoff, "pending");
}));

test("overview reports source template, CPU handoff state, schedule and exceptions", () => hosted(async () => {
  const f = fixture(); await activate(f); await f.run(MON);
  const overview = await f.service.standingOverview(OPLOC, f.catalogue(), new Date("2026-11-03T09:00:00Z"));
  assert.equal(overview.standingOrder!.status, "active"); assert.equal(overview.versions[0].version, 2); assert.equal(overview.schedule.timeZone, "Europe/London"); assert.equal(overview.schedule.nextGenerations[0].generationAt, "2026-11-05T12:01:00.000Z");
  const byDate = Object.fromEntries(overview.upcoming.map(item => [item.deliveryDate, item]));
  assert.equal(byDate["2026-11-04"].order!.source!.templateVersion, 2); assert.equal(byDate["2026-11-04"].order!.handoff, "delivered"); assert.equal(byDate["2026-11-09"].state, "scheduled"); assert.equal(byDate["2026-11-09"].canGenerateNow, true); assert.equal(byDate["2026-11-16"].state, "no-slot");
  assert.ok(f.queries.every(query => query.limit > 0), "every collection read is bounded");
}));

test("a failing history query (e.g. an index still building) degrades only the history, never the overview", () => hosted(async () => {
  const f = fixture(); await activate(f); const original = f.store.listStandingOperationsHosted;
  (f.store as any).listStandingOperationsHosted = async () => { throw Object.assign(new Error("FAILED_PRECONDITION: the query requires an index"), { code: 9 }); };
  try { const overview = await f.service.standingOverview(OPLOC, f.catalogue(), MON); assert.equal(overview.historyAvailable, false); assert.equal(overview.standingOrder!.status, "active"); assert.ok(overview.upcoming.length > 0); }
  finally { (f.store as any).listStandingOperationsHosted = original; }
  assert.equal((await f.service.standingOverview(OPLOC, f.catalogue(), MON)).historyAvailable, true);
}));

test("legacy standing-order documents and ids can never collide with or be read as the new schema", () => hosted(async () => {
  const f = fixture(); const { stableDocumentId } = f.load(require.resolve("@fika/server-shared/stable-document-id"));
  const legacyIds = [`standing:grab-and-go:${OPLOC}:2026-11-04`, `standing:grab-and-go:${OPLOC}:2026-11-09`];
  const newIds = [f.standing.standingOrderIdFor(OPLOC), f.standing.standingVersionIdFor(f.standing.standingOrderIdFor(OPLOC), 1), `${f.standing.standingOrderIdFor(OPLOC)}:op:x`];
  for (const legacy of legacyIds) for (const id of newIds) assert.notEqual(stableDocumentId(legacy), stableDocumentId(id));
  assert.ok(newIds.every(id => id.startsWith("grab-and-go-standing:v2:")) && legacyIds.every(id => id.startsWith("standing:")), "distinct, versioned id namespaces");
  f.records.set(`${f.store.STANDING_COLLECTION}/${stableDocumentId(legacyIds[0])}`, { standingOrderId: legacyIds[0], oplocId: OPLOC, status: "active", weekdays: ["Monday"], lines: [{ productId: "p:a", quantity: 9 }], version: 4 });
  f.records.set(`${f.store.STANDING_COLLECTION}/odd`, { schemaVersion: 1, recordType: "head", oplocId: OPLOC, status: "active", slots: { "4:Monday": [{ productId: "p:a", quantity: 9 }] } });
  assert.deepEqual(await f.store.listActiveStandingOrdersHosted(10), [], "legacy and unknown-schema documents are invisible to the scheduler"); assert.equal(await f.store.getStandingOrderHosted(OPLOC), undefined);
  const before = JSON.stringify([...f.records.entries()]); await activate(f); await f.run(THU);
  assert.equal(f.records.get(`${f.store.STANDING_COLLECTION}/${stableDocumentId(legacyIds[0])}`).version, 4); assert.equal(f.orders().some(order => order.lines.some(line => line.quantity === 9)), false); assert.ok(before.length > 0);
  const poisoned = fixture(); poisoned.records.set(`${poisoned.store.STANDING_COLLECTION}/${stableDocumentId(poisoned.standing.standingOrderIdFor(OPLOC))}`, { standingOrderId: "x", oplocId: OPLOC, status: "active" });
  await assert.rejects(poisoned.mutate({ action: "save", slots: SLOTS }), (error: any) => error.status === 409, "an unsupported document at the head id is never overwritten");
}));

test("templates are owned per OPLOC: a site only ever generates its own orders", () => hosted(async () => {
  const f = fixture(); await activate(f); await f.mutate({ action: "save", oplocId: OTHER, slots: { "3:Wednesday": [{ productId: "p:b", quantity: 3 }] } } as any);
  await f.mutate({ action: "activate", oplocId: OTHER, expectedVersion: 1 } as any); await f.run(MON);
  assert.equal(f.heads().length, 2); assert.deepEqual(f.orders().map(order => `${order.oplocId}:${order.deliveryDate}:${lines(order)}`).sort(), [`${OPLOC}:2026-11-04:p:a:5`, `${OTHER}:2026-11-04:p:b:3`].sort());
  assert.equal((await f.run(MON, { oplocId: OTHER })).created, 0, "an OPLOC-scoped run touches only that site");
}));

test("site API enforces AUTHMOD scope, never trusts the client actor and rejects unsupported requests before touching persistence", () => hosted(async () => {
  const f = fixture(); const route = f.load(resolve(appRoot, "app/api/delivered-in/grab-and-go/standing-orders/route.ts")); const { NextRequest } = require("next/server");
  const post = (body: unknown) => route.POST(new NextRequest("http://localhost/api/delivered-in/grab-and-go/standing-orders", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  const get = (query: string) => route.GET(new NextRequest(`http://localhost/api/delivered-in/grab-and-go/standing-orders${query}`));
  assert.equal((await post({ oplocId: OTHER, action: "save", slots: SLOTS })).status, 403); assert.equal((await post({ oplocId: OTHER, action: "generate", expectedVersion: 1, deliveryDate: "2026-11-04" })).status, 403); assert.equal((await get(`?oplocId=${OTHER}`)).status, 403); assert.equal(f.records.size, 0);
  assert.equal((await post({ oplocId: OPLOC, action: "save", slots: SLOTS, actor: "forged@example.test" })).status, 422); assert.equal((await post({ oplocId: OPLOC, action: "pause", upcomingOrders: "cancel", expectedVersion: 1 })).status, 422, "pause can no longer cancel orders");
  assert.equal((await post({ oplocId: OPLOC, action: "delete" })).status, 422); assert.equal((await post({ oplocId: OPLOC, action: "generate", deliveryDate: "2026-11-04" })).status, 422, "generate needs the current version"); assert.equal((await post({ oplocId: OPLOC, action: "generate", expectedVersion: 1, deliveryDate: "tomorrow" })).status, 422); assert.equal(f.records.size, 0);
  const saved = await post({ oplocId: OPLOC, action: "save", slots: SLOTS }); assert.equal(saved.status, 201); assert.equal((await saved.json()).standingOrder.updatedBy, "manager@example.test");
  const overview = await (await get(`?oplocId=${OPLOC}`)).json(); assert.equal(overview.standingOrder.version, 1); assert.ok(overview.schedule.nextGenerations.length > 0);
  const canonical = "oploc:bb4c7eea-87f5-4e79-8ed6-b973b24ded7b", alias = "oploc:46701265-15af-48f4-a230-1d27ca21bc59"; f.access.current = { email: "manager@example.test", oplocIds: [canonical], permissions: ["delivered_in.view"] };
  assert.equal((await post({ oplocId: alias, action: "save", slots: SLOTS })).status, 201); assert.ok(f.heads().some(head => head.oplocId === canonical)); assert.ok(!f.heads().some(head => head.oplocId === alias));
}));

test("scheduler endpoint is internal-only, bounded and never schedules itself", async () => {
  const f = fixture(); const route = f.load(resolve(appRoot, "app/api/internal/grab-and-go-standing-orders/route.ts")); const { NextRequest } = require("next/server"); const previous = process.env.FIKA_INTERNAL_API_TOKEN;
  process.env.FIKA_INTERNAL_API_TOKEN = "isolated-token";
  try {
    const request = (body: unknown, authorised = true) => new NextRequest("http://localhost/api/internal/grab-and-go-standing-orders", { method: "POST", headers: { "content-type": "application/json", ...(authorised ? { "x-fika-internal-token": "isolated-token" } : {}) }, body: JSON.stringify(body) });
    assert.equal((await route.POST(request({}, false))).status, 403); assert.equal((await route.POST(request({ limit: 51 }))).status, 422); assert.equal((await route.POST(request({ eventId: "x" }))).status, 422); assert.equal((await route.POST(request({ oplocId: "not-an-oploc" }))).status, 422); assert.equal((await route.POST(request({ deliveryDate: "2026-11-04" }))).status, 422, "no date override through the scheduler");
    assert.equal(f.queries.length, 0); await hosted(async () => { const ok = await route.POST(request({ limit: 5 })); assert.equal(ok.status, 200); assert.equal(f.queries[0].limit, 6); });
  } finally { if (previous === undefined) delete process.env.FIKA_INTERNAL_API_TOKEN; else process.env.FIKA_INTERNAL_API_TOKEN = previous; }
});

test("Firestore indexes for standing-order history queries are declared", () => {
  const indexes = JSON.parse(readFileSync(new URL("../../integration-hub/firestore.indexes.json", import.meta.url), "utf8")).indexes;
  const has = (fields: string) => indexes.some((index: any) => index.collectionGroup === "fikaDeliveredInGrabAndGoStandingOrdersV1" && index.fields.map((field: any) => `${field.fieldPath}:${field.order}`).join(",") === fields);
  assert.ok(has("recordType:ASCENDING,oplocId:ASCENDING,version:DESCENDING")); assert.ok(has("recordType:ASCENDING,oplocId:ASCENDING,at:DESCENDING"));
});

function localFixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "fika-grab-standing-")); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { createRequire: _unused } = { createRequire }; void _unused;
  const m = standingModules({ collection: () => { throw new Error("Local standing-order regression must not access Firestore."); } });
  const load = require("../../../scripts/testing/load-typescript.cjs").typescriptLoader({ typescript: require("typescript"), appRoot, mocks: {
    [resolve(appRoot, "../shared/app-data-path.ts")]: { appDataPath: (_app: string, ...parts: string[]) => join(directory, parts.at(-1)!) },
    [resolve(appRoot, "lib/firebase-admin.ts")]: { db: { collection: () => { throw new Error("Local standing-order regression must not access Firestore."); } } },
    [resolve(appRoot, "lib/production-client.ts")]: { forwardProductionMaterialisation: async (input: any) => { m.calls.push(input); return "delivered"; } },
    [resolve(appRoot, "lib/delivered-in-read-budget.ts")]: { recordDeliveredInAppReadBudget() {} }, "@fika/server-shared/data-source-meter-server": { recordDataAccess() {} },
  } });
  return { calls: m.calls, service: load(resolve(appRoot, "lib/grab-and-go-standing-service.ts")) as Modules["service"], store: load(resolve(appRoot, "lib/grab-and-go-store.ts")) as Modules["store"] };
}
test("local runtime persists templates, versions, operations and generated orders atomically in the existing SQLite state", async t => {
  const { service, store, calls } = localFixture(t); const mutate = (input: any, at = MON) => service.mutateStandingOrder({ oplocId: OPLOC, actor: "local@example.test", ...input }, catalogue(), at);
  const draft = await mutate({ action: "save", slots: SLOTS }); const active = await mutate({ action: "activate", expectedVersion: draft.standingOrder.version });
  assert.equal(store.listGrabAndGoOrders(OPLOC).length, 0, "activation creates nothing");
  const run = await service.runStandingGeneration({ catalogue: catalogue(), now: MON }); assert.equal(run.created, 1); assert.equal(calls.length, 1); assert.deepEqual(store.listGrabAndGoOrders(OPLOC).map(order => order.deliveryDate), ["2026-11-04"]);
  assert.equal((await service.runStandingGeneration({ catalogue: catalogue(), now: MON })).created, 0, "replay is idempotent locally too"); assert.equal((await store.listStandingVersionsHosted(OPLOC)).length, 2);
  const manual = await mutate({ action: "generate", expectedVersion: active.standingOrder.version, deliveryDate: "2026-11-09", actor: "derek@example.test" }); assert.equal(manual.complete, true); assert.equal((await store.listStandingOperationsHosted(OPLOC)).length, 1);
  const paused = await mutate({ action: "pause", expectedVersion: active.standingOrder.version });
  const guarded = await service.reconcileStandingOrder(active.standingOrder, catalogue(), { now: new Date("2026-11-05T12:01:00Z"), trigger: "scheduler", mode: "scheduled" });
  assert.ok(guarded.items.every(item => item.outcome !== "created"), "a paused template cannot create orders"); assert.equal(store.listGrabAndGoOrders(OPLOC).length, 2); assert.equal(paused.standingOrder.status, "paused");
  await assert.rejects(mutate({ action: "save", expectedVersion: 1, slots: SLOTS }), (error: any) => error.status === 409);
});
