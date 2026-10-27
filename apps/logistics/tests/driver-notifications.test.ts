import assert from "node:assert/strict";
import test from "node:test";
import { diffBatch, diffRun, isEligibleNow, londonServiceDate, type DriverRunSnapshot, type DriverVisit } from "../lib/driver-notifications";

const TODAY = "2026-10-28";
const visit = (visitId: string, jobIds: string[], extra: Partial<DriverVisit> = {}): DriverVisit => ({ visitId, lane: "delivery", destination: "One Angel Court", time: "10:00", jobIds, quantities: "7 items · 85 pieces", instructions: "", ...extra });
const run = (extra: Partial<DriverRunSnapshot> = {}): DriverRunSnapshot => ({ runId: "run-1", version: 1, vehicleId: "van1", vehicleLabel: "Van 1", serviceDate: TODAY, status: "planned", departure: "11:30", return: "16:00", visits: [visit("stop-a", ["job-1"])], ...extra });
const kinds = (notices: { kind: string }[]) => notices.map(n => n.kind);

test("a populated run appearing for today is one 'New run assigned' notice", () => {
  const notices = diffRun(undefined, run());
  assert.deepEqual(kinds(notices), ["run-assigned"]);
  assert.equal(notices[0].vehicleId, "van1");
});

test("an empty draft run never notifies, including when it is later discarded", () => {
  assert.deepEqual(diffRun(undefined, run({ status: "draft", visits: [] })), []);
  assert.deepEqual(diffRun(run({ status: "draft", visits: [] }), undefined), []);
});

test("a delivery or collection added to an existing run notifies with its destination and time", () => {
  const notices = diffRun(run(), run({ version: 2, visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { lane: "collection", destination: "Commerzbank", time: "14:00" })] }));
  assert.deepEqual(kinds(notices), ["collection-assigned"]);
  assert.match(notices[0].inboxText, /Commerzbank at 14:00/);
  assert.equal(notices[0].pushBody.includes("Commerzbank"), false, "push text stays free of destinations");
});

test("a removed stop notifies once and names the former destination in the inbox", () => {
  const notices = diffRun(run({ visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { destination: "Haleon" })] }), run({ version: 2 }));
  assert.deepEqual(kinds(notices), ["stop-removed"]);
  assert.match(notices[0].inboxText, /Haleon/);
});

test("removing one item from a multi-item stop is a load change, not the removal of the physical stop", () => {
  const notices = diffRun(run({ visits: [visit("stop-a", ["job-1", "job-2"], { quantities: "14 items" })] }), run({ version: 2, visits: [visit("stop-a", ["job-1"], { quantities: "7 items" })] }));
  assert.deepEqual(kinds(notices), ["load-details-changed"]);
  assert.equal(notices.some(n => n.kind === "stop-removed"), false);
});

test("a moved collection time notifies the affected visit with the old and new times", () => {
  const before = run({ visits: [visit("stop-a", ["job-1"], { lane: "collection", destination: "Commerzbank", time: "14:00" })] });
  const after = run({ version: 2, visits: [visit("stop-a", ["job-1"], { lane: "collection", destination: "Commerzbank", time: "14:30" })] });
  const notices = diffRun(before, after);
  assert.deepEqual(kinds(notices), ["collection-time-changed"]);
  assert.match(notices[0].inboxText, /moved from 14:00 to 14:30/);
  assert.match(notices[0].pushBody, /14:00 → 14:30/);
});

test("an identical save produces no notices, so replays and unchanged values stay silent", () => {
  assert.deepEqual(diffRun(run(), run({ version: 2 })), [], "a higher version with identical driver-visible content is a technical change");
});

test("identity: 11:30 → 12:00 → 11:30 → 12:00 produces two independent 12:00 notices, not one", () => {
  const v1 = run({ version: 1, departure: "11:30" });
  const v2 = run({ version: 2, departure: "12:00" });
  const v3 = run({ version: 3, departure: "11:30" });
  const v4 = run({ version: 4, departure: "12:00" });
  const first = diffRun(v1, v2);
  const second = diffRun(v3, v4);
  assert.equal(first[0].kind, "departure-time-changed");
  assert.equal(second[0].kind, "departure-time-changed");
  assert.notEqual(first[0].dedupeKey, second[0].dedupeKey, "later committed changes stay visible");
});

test("identity: replaying the same committed change gives the same key, so it cannot create a second row", () => {
  const first = diffRun(run(), run({ version: 2, departure: "12:00" }));
  const replay = diffRun(run(), run({ version: 2, departure: "12:00" }));
  assert.equal(first[0].dedupeKey, replay[0].dedupeKey);
});

test("a stop order change notifies once; the same order does not", () => {
  const before = run({ visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { destination: "Haleon" })] });
  const swapped = run({ version: 2, visits: [visit("stop-b", ["job-2"], { destination: "Haleon" }), visit("stop-a", ["job-1"])] });
  assert.deepEqual(kinds(diffRun(before, swapped)), ["route-order-updated"]);
});

test("quantity changes on an assigned load are detected even when the job list is unchanged", () => {
  const notices = diffRun(run(), run({ version: 2, visits: [visit("stop-a", ["job-1"], { quantities: "9 items · 110 pieces" })] }));
  assert.deepEqual(kinds(notices), ["load-details-changed"]);
  assert.match(notices[0].inboxText, /changed from 7 items · 85 pieces to 9 items · 110 pieces/);
});

test("operational instructions changes are detected; whitespace-only edits are not", () => {
  const notices = diffRun(run(), run({ version: 2, visits: [visit("stop-a", ["job-1"], { instructions: "Use the loading bay" })] }));
  assert.deepEqual(kinds(notices), ["delivery-instructions-updated"]);
  assert.deepEqual(diffRun(run({ visits: [visit("stop-a", ["job-1"], { instructions: "Use the loading bay" })] }), run({ version: 2, visits: [visit("stop-a", ["job-1"], { instructions: "Use   the loading bay " })] })), []);
});

test("departure and return time changes notify separately", () => {
  assert.deepEqual(kinds(diffRun(run(), run({ version: 2, departure: "12:00" }))), ["departure-time-changed"]);
  assert.deepEqual(kinds(diffRun(run(), run({ version: 2, return: "17:00" }))), ["return-time-changed"]);
});

test("a dispatched run's time change is high priority", () => {
  const notices = diffRun(run({ status: "dispatched" }), run({ version: 2, status: "dispatched", departure: "12:00" }));
  assert.equal(notices[0].priority, "high");
});

test("cancelling an active run is high priority and distinct from a removed stop", () => {
  const notices = diffRun(run({ status: "dispatched" }), undefined);
  assert.deepEqual(kinds(notices), ["run-cancelled"]);
  assert.equal(notices[0].priority, "high");
});

test("a run that changes vehicle: the old vehicle hears it was reassigned, the new vehicle receives it as a new run", () => {
  const before = run({ vehicleId: "van1", vehicleLabel: "Van 1" });
  const after = run({ version: 2, vehicleId: "van2", vehicleLabel: "Van 2" });
  const notices = diffRun(before, after);
  const oldVan = notices.filter(n => n.vehicleId === "van1");
  const newVan = notices.filter(n => n.vehicleId === "van2");
  assert.deepEqual(kinds(oldVan), ["work-reassigned"]);
  assert.match(oldVan[0].inboxText, /now assigned to Van 2/);
  assert.equal(oldVan[0].title, "Run reassigned", "a reassigned run is not described as cancelled");
  assert.deepEqual(kinds(newVan), ["run-assigned"]);
});

test("a collection moved from Van 1 to Van 2 notifies Van 1 of the reassignment and Van 2 of the new assignment", () => {
  const van1Before = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  const van1After = run({ runId: "r1", version: 2, vehicleId: "van1", vehicleLabel: "Van 1", visits: [] });
  const van2Before = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"])] });
  const van2After = run({ runId: "r2", version: 2, vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"]), visit("s9", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  const notices = diffBatch(TODAY, [van1Before, van2Before], [van1After, van2After]);
  assert.deepEqual(kinds(notices.filter(n => n.vehicleId === "van1")), ["work-reassigned"]);
  assert.equal(notices.filter(n => n.vehicleId === "van1").length, 1, "Van 1 is not also told its whole stop was removed");
  assert.ok(notices.some(n => n.vehicleId === "van2" && n.title === "New collection assigned"));
});

test("the source run retired after a reassignment still notifies the losing vehicle", () => {
  const van1Before = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-9"], { destination: "Bridgepoint" })] });
  const van2Before = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"])] });
  const van2After = run({ runId: "r2", version: 2, vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"]), visit("s9", ["job-9"], { destination: "Bridgepoint" })] });
  const notices = diffBatch(TODAY, [van1Before, van2Before], [van2After]);
  assert.ok(notices.some(n => n.vehicleId === "van1" && n.kind === "work-reassigned"), "the losing vehicle is told even though its run vanished");
  assert.equal(notices.some(n => n.vehicleId === "van1" && n.kind === "run-cancelled"), false, "a moved stop is not a cancelled run");
});

test("moving one load from a multi-load stop reports the load, never the removal of the whole stop", () => {
  const van1Before = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-1", "job-2"], { destination: "Haleon" })] });
  const van1After = run({ runId: "r1", version: 2, vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-1"], { destination: "Haleon" })] });
  const van2Before = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [] });
  const van2After = run({ runId: "r2", version: 2, vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-2"], { destination: "Haleon" })] });
  const notices = diffBatch(TODAY, [van1Before, van2Before], [van1After, van2After]);
  assert.equal(notices.some(n => n.kind === "stop-removed"), false, "the physical stop still exists on Van 1");
  assert.ok(notices.some(n => n.vehicleId === "van1" && n.kind === "work-reassigned"));
  assert.ok(notices.some(n => n.vehicleId === "van2" && n.kind === "delivery-assigned"));
});

test("a vehicle not involved in a change is never notified", () => {
  const van1Before = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-1"])] });
  const van2Before = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-2"])] });
  const van1After = run({ runId: "r1", version: 2, vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-1"], { time: "11:00" })] });
  const notices = diffBatch(TODAY, [van1Before, van2Before], [van1After, { ...van2Before, version: 2 }]);
  assert.ok(notices.length > 0);
  assert.equal(notices.some(n => n.vehicleId === "van2"), false);
});

test("only today's runs notify: tomorrow's and past runs never create notices", () => {
  const tomorrow = run({ serviceDate: "2026-10-29" });
  assert.deepEqual(diffBatch(TODAY, [], [tomorrow]), []);
  assert.deepEqual(diffBatch(TODAY, [tomorrow], [run({ serviceDate: "2026-10-29", version: 2, visits: [] })]), []);
  const yesterday = run({ serviceDate: "2026-10-27" });
  assert.deepEqual(diffBatch(TODAY, [yesterday], [run({ serviceDate: "2026-10-27", version: 2, departure: "12:00" })]), []);
});

test("baseline: the first tracking run records existing runs without notifying a flood of 'New run assigned'", () => {
  const existing = [run({ runId: "r1" }), run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2" })];
  assert.deepEqual(diffBatch(TODAY, [], existing, { baseline: true }), []);
  assert.ok(diffBatch(TODAY, [], existing).length > 0, "without the baseline these would all look new");
});

test("a delayed push is only eligible while its service date is still today in Europe/London", () => {
  const notice = { serviceDate: TODAY };
  assert.equal(isEligibleNow(notice, new Date("2026-10-28T10:00:00Z")), true);
  assert.equal(isEligibleNow(notice, new Date("2026-10-29T00:30:00Z")), false, "a queued alert must not arrive the next morning");
});

test("the service date comes from Europe/London, not the device clock", () => {
  assert.equal(londonServiceDate(new Date("2026-10-27T23:30:00Z")), "2026-10-27");
  assert.equal(londonServiceDate(new Date("2026-10-28T00:30:00Z")), "2026-10-28", "after UK midnight the London date has advanced");
});

test("adding or removing a stop is not also a route reorder (found in staging UAT)", () => {
  const stopA = visit("a", ["job-a"]), stopB = visit("b", ["job-b"]);
  const withBoth = run({ visits: [stopA, stopB], stopOrder: ["stop-a", "stop-b"] });
  const withoutB = run({ version: 2, visits: [stopA], stopOrder: ["stop-a"] });
  assert.ok(!kinds(diffRun(withBoth, withoutB)).includes("route-order-updated"), "removing a stop");
  assert.ok(!kinds(diffRun(withoutB, withBoth)).includes("route-order-updated"), "adding a stop");
  const empty = run({ version: 2, visits: [], stopOrder: [] });
  assert.ok(!kinds(diffRun(withoutB, empty)).includes("route-order-updated"), "the last stop leaving the run");
  assert.ok(!kinds(diffRun(empty, withoutB)).includes("route-order-updated"), "a first stop arriving");
  const swapped = run({ version: 2, visits: [stopA, stopB], stopOrder: ["stop-b", "stop-a"] });
  assert.deepEqual(kinds(diffRun(withBoth, swapped)), ["route-order-updated"], "a genuine reorder still notifies");
});
