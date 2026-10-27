import assert from "node:assert/strict";
import test from "node:test";
import { diffBatch, diffRun, londonServiceDate, type DriverRunSnapshot, type DriverVisit } from "../lib/driver-notifications";

const TODAY = "2026-10-28";
const visit = (visitId: string, jobIds: string[], extra: Partial<DriverVisit> = {}): DriverVisit => ({ visitId, lane: "delivery", destination: "One Angel Court", time: "10:00", jobIds, ...extra });
const run = (extra: Partial<DriverRunSnapshot> = {}): DriverRunSnapshot => ({ runId: "run-1", vehicleId: "van1", vehicleLabel: "Van 1", serviceDate: TODAY, status: "planned", departure: "11:30", return: "16:00", visits: [visit("stop-a", ["job-1"])], ...extra });
const kinds = (notices: { kind: string }[]) => notices.map(n => n.kind);

test("a populated run appearing for today is one 'New run assigned' notice", () => {
  const notices = diffRun(undefined, run());
  assert.deepEqual(kinds(notices), ["run-assigned"]);
  assert.equal(notices[0].title, "New run assigned");
  assert.equal(notices[0].vehicleId, "van1");
});

test("an empty draft run never notifies, including when it is later discarded", () => {
  assert.deepEqual(diffRun(undefined, run({ status: "draft", visits: [] })), []);
  assert.deepEqual(diffRun(run({ status: "draft", visits: [] }), undefined), []);
});

test("a delivery or collection added to an existing run notifies with its destination and time", () => {
  const notices = diffRun(run(), run({ visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { lane: "collection", destination: "Commerzbank", time: "14:00" })] }));
  assert.deepEqual(kinds(notices), ["collection-assigned"]);
  assert.match(notices[0].inboxText, /Commerzbank at 14:00/);
  assert.equal(notices[0].pushBody.includes("Commerzbank"), false, "push text stays free of destinations");
});

test("a removed stop notifies once and names the former destination in the inbox", () => {
  const notices = diffRun(run({ visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { destination: "Haleon" })] }), run());
  assert.deepEqual(kinds(notices), ["stop-removed"]);
  assert.match(notices[0].inboxText, /Haleon/);
});

test("removing one item from a multi-item stop is a load change, not the removal of the physical stop", () => {
  const notices = diffRun(run({ visits: [visit("stop-a", ["job-1", "job-2"])] }), run({ visits: [visit("stop-a", ["job-1"])] }));
  assert.deepEqual(kinds(notices), ["load-details-changed"]);
});

test("a moved collection time notifies the affected visit with the old and new times", () => {
  const notices = diffRun(run({ visits: [visit("stop-a", ["job-1"], { lane: "collection", destination: "Commerzbank", time: "14:00" })] }), run({ visits: [visit("stop-a", ["job-1"], { lane: "collection", destination: "Commerzbank", time: "14:30" })] }));
  assert.deepEqual(kinds(notices), ["collection-time-changed"]);
  assert.match(notices[0].inboxText, /moved from 14:00 to 14:30/);
  assert.match(notices[0].pushBody, /14:00 → 14:30/);
});

test("an identical save produces no notices, so replays and unchanged values stay silent", () => {
  assert.deepEqual(diffRun(run(), run()), []);
});

test("a stop order change notifies once; the same order does not", () => {
  const before = run({ visits: [visit("stop-a", ["job-1"]), visit("stop-b", ["job-2"], { destination: "Haleon" })] });
  const swapped = run({ visits: [visit("stop-b", ["job-2"], { destination: "Haleon" }), visit("stop-a", ["job-1"])] });
  assert.deepEqual(kinds(diffRun(before, swapped)), ["route-order-updated"]);
  assert.deepEqual(diffRun(before, before), []);
});

test("departure and return time changes notify separately", () => {
  assert.deepEqual(kinds(diffRun(run(), run({ departure: "12:00" }))), ["departure-time-changed"]);
  assert.deepEqual(kinds(diffRun(run(), run({ return: "17:00" }))), ["return-time-changed"]);
});

test("a dispatched run's time change is high priority", () => {
  const notices = diffRun(run({ status: "dispatched" }), run({ status: "dispatched", departure: "12:00" }));
  assert.equal(notices[0].priority, "high");
});

test("cancelling an active run is high priority", () => {
  const notices = diffRun(run({ status: "dispatched" }), undefined);
  assert.deepEqual(kinds(notices), ["run-cancelled"]);
  assert.equal(notices[0].priority, "high");
});

test("a collection moved from Van 1 to Van 2 notifies Van 1 of the reassignment and Van 2 of the new assignment", () => {
  const van1Before = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  const van1After = run({ runId: "r1", vehicleId: "van1", vehicleLabel: "Van 1", visits: [] });
  const van2Before = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"])] });
  const van2After = run({ runId: "r2", vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"]), visit("s9", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  const notices = diffBatch(TODAY, [van1Before, van2Before], [van1After, van2After]);
  const van1 = notices.filter(n => n.vehicleId === "van1");
  const van2 = notices.filter(n => n.vehicleId === "van2");
  assert.deepEqual(kinds(van1), ["work-reassigned"]);
  assert.equal(van1[0].title, "Work reassigned");
  assert.ok(van2.some(n => n.title === "New delivery assigned"), "Van 2 receives the assignment");
  assert.equal(notices.filter(n => n.vehicleId === "van1").length, 1, "Van 1 is not also told its whole stop was removed");
});

test("only today's runs notify: tomorrow's and past runs never create notices", () => {
  const tomorrow = run({ serviceDate: "2026-10-29" });
  assert.deepEqual(diffBatch(TODAY, [], [tomorrow]), []);
  assert.deepEqual(diffBatch(TODAY, [tomorrow], [run({ serviceDate: "2026-10-29", visits: [] })]), []);
  const yesterday = run({ serviceDate: "2026-10-27" });
  assert.deepEqual(diffBatch(TODAY, [yesterday], [run({ serviceDate: "2026-10-27", departure: "12:00" })]), []);
});

test("the service date comes from Europe/London, not the device clock", () => {
  assert.equal(londonServiceDate(new Date("2026-10-27T23:30:00Z")), "2026-10-27");
  assert.equal(londonServiceDate(new Date("2026-10-28T00:30:00Z")), "2026-10-28", "after UK midnight the London date has advanced");
});

test("dedupe keys are stable for the same change, so a replay cannot create a second inbox row", () => {
  const first = diffRun(run(), run({ departure: "12:00" }));
  const replay = diffRun(run(), run({ departure: "12:00" }));
  assert.equal(first[0].dedupeKey, replay[0].dedupeKey);
});
