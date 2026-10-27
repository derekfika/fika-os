import assert from "node:assert/strict";
import test from "node:test";
import {
  driverChangeEventId, driverVisitsFromLegs, inboxFor, markAllNotificationsRead, markNotificationRead, processPendingDriverChanges,
  type DriverChangeEvent, type DriverNotificationStore, type InboxNotification,
} from "../lib/driver-change-events";
import type { DriverRunSnapshot, DriverVisit } from "../lib/driver-notifications";

const TODAY = "2026-10-28";
const NOON_TODAY = new Date("2026-10-28T11:00:00Z");
const visit = (visitId: string, jobIds: string[], extra: Partial<DriverVisit> = {}): DriverVisit => ({ visitId, lane: "delivery", destination: "One Angel Court", time: "10:00", jobIds, quantities: "7 items", instructions: "", ...extra });
const run = (extra: Partial<DriverRunSnapshot> = {}): DriverRunSnapshot => ({ runId: "run-1", version: 1, vehicleId: "van1", vehicleLabel: "Van 1", serviceDate: TODAY, status: "planned", departure: "11:30", return: "16:00", visits: [visit("stop-a", ["job-1"])], ...extra });

/** In-memory store with failure injection, mirroring the transactional contract of the Firestore store. */
function memoryStore(options: { failCommits?: number } = {}) {
  const events = new Map<string, DriverChangeEvent & { attempts?: number }>();
  const notices = new Map<string, InboxNotification>();
  let failuresLeft = options.failCommits ?? 0;
  const store: DriverNotificationStore = {
    async listPendingEvents(limit) { return [...events.values()].filter(event => event.status === "pending").slice(0, limit); },
    async commitProcessedEvent(eventId, created, status, processedAt) {
      if (failuresLeft > 0) { failuresLeft -= 1; throw new Error("transient write failure"); }
      for (const notice of created) if (!notices.has(notice.id)) notices.set(notice.id, notice);
      const event = events.get(eventId)!;
      events.set(eventId, { ...event, status, processedAt });
    },
    async listNotifications(vehicleId, limit) { return [...notices.values()].filter(n => n.vehicleId === vehicleId).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit); },
    async markRead(vehicleId, id, readAt) { const notice = notices.get(id); if (!notice || notice.vehicleId !== vehicleId) return false; notices.set(id, { ...notice, readAt: notice.readAt ?? readAt }); return true; },
    async markAllRead(vehicleId, readAt) { let count = 0; for (const [id, notice] of notices) if (notice.vehicleId === vehicleId && !notice.readAt) { notices.set(id, { ...notice, readAt }); count += 1; } return count; },
  };
  const stage = (event: Omit<DriverChangeEvent, "status">) => events.set(event.eventId, { ...event, status: "pending" });
  return { store, stage, events, notices };
}

const eventFor = (sourceAction: string, before: DriverRunSnapshot[], after: DriverRunSnapshot[], serviceDate = TODAY) => {
  const runs = after.map(next => ({ runId: next.runId, beforeVersion: before.find(item => item.runId === next.runId)?.version ?? 0, afterVersion: next.version }));
  return { eventId: driverChangeEventId(sourceAction, runs), serviceDate, sourceAction, actorId: "planner", committedAt: NOON_TODAY.toISOString(), before, after };
};

test("rapid consecutive edits 11:30 → 12:00 → 11:30 → 12:00 all survive, each as its own notice", async () => {
  const { store, stage, notices } = memoryStore();
  const v1 = run({ version: 1, departure: "11:30" }), v2 = run({ version: 2, departure: "12:00" }), v3 = run({ version: 3, departure: "11:30" }), v4 = run({ version: 4, departure: "12:00" });
  stage(eventFor("update-run-timing", [v1], [v2]));
  stage(eventFor("update-run-timing", [v2], [v3]));
  stage(eventFor("update-run-timing", [v3], [v4]));
  const result = await processPendingDriverChanges(store, NOON_TODAY);
  assert.equal(result.created, 3);
  const departures = [...notices.values()].filter(n => n.kind === "departure-time-changed");
  assert.equal(departures.length, 3);
  assert.equal(new Set(departures.map(n => n.id)).size, 3, "identical values from separate commits are distinct notices");
});

test("delayed processing uses each event's own captured state, not the latest run", async () => {
  const { store, stage, notices } = memoryStore();
  stage(eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]));
  // Franco edits again before processing; the processor only ever sees the captured event, never the newer state.
  stage(eventFor("update-run-timing", [run({ version: 2, departure: "12:00" })], [run({ version: 3, departure: "12:30" })]));
  await processPendingDriverChanges(store, NOON_TODAY);
  const texts = [...notices.values()].map(n => n.inboxText);
  assert.ok(texts.some(t => t.includes("from 11:30 to 12:00")));
  assert.ok(texts.some(t => t.includes("from 12:00 to 12:30")), "the intermediate change is not lost");
});

test("a failed commit leaves the event pending, and the retry creates exactly one set of notices", async () => {
  const { store, stage, notices, events } = memoryStore({ failCommits: 1 });
  const event = eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]);
  stage(event);
  await assert.rejects(() => processPendingDriverChanges(store, NOON_TODAY), /transient write failure/);
  assert.equal(events.get(event.eventId)!.status, "pending");
  assert.equal(notices.size, 0);
  await processPendingDriverChanges(store, NOON_TODAY);
  assert.equal(events.get(event.eventId)!.status, "processed");
  assert.equal(notices.size, 1);
});

test("a duplicate delivery of the same committed event creates no second notice", async () => {
  const { store, stage, notices } = memoryStore();
  const event = eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]);
  stage(event);
  stage(event);
  await processPendingDriverChanges(store, NOON_TODAY);
  await processPendingDriverChanges(store, NOON_TODAY);
  assert.equal(notices.size, 1);
});

test("an unchanged save is never staged as a notifiable event", async () => {
  const { store, stage, notices } = memoryStore();
  stage(eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2 })]));
  await processPendingDriverChanges(store, NOON_TODAY);
  assert.equal(notices.size, 0);
});

test("midnight boundary: an event for today processed after UK midnight expires without notices", async () => {
  const { store, stage, notices, events } = memoryStore();
  const event = eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]);
  stage(event);
  const afterMidnight = new Date("2026-10-28T23:30:00Z"); // London is already 29 Oct at 00:30 BST? (BST, +1h): 2026-10-29T00:30
  const later = new Date("2026-10-29T00:30:00Z");
  const result = await processPendingDriverChanges(store, later);
  assert.equal(result.expired, 1);
  assert.equal(notices.size, 0);
  assert.equal(events.get(event.eventId)!.status, "expired");
  assert.ok(afterMidnight < later);
});

test("future-dated and past events never create notices", async () => {
  const { store, stage, notices } = memoryStore();
  stage(eventFor("update-run-timing", [run({ version: 1, serviceDate: "2026-10-29" })], [run({ version: 2, serviceDate: "2026-10-29", departure: "12:00" })], "2026-10-29"));
  stage(eventFor("update-run-timing", [run({ version: 1, serviceDate: "2026-10-27" })], [run({ version: 2, serviceDate: "2026-10-27", departure: "12:00" })], "2026-10-27"));
  await processPendingDriverChanges(store, NOON_TODAY);
  assert.equal(notices.size, 0);
});

test("a cross-vehicle reassignment notifies both vehicles with the actual work that moved", async () => {
  const { store, stage, notices } = memoryStore();
  const van1Before = run({ runId: "r1", version: 1, vehicleId: "van1", vehicleLabel: "Van 1", visits: [visit("s1", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  const van1After = run({ runId: "r1", version: 2, vehicleId: "van1", vehicleLabel: "Van 1", visits: [] });
  const van2Before = run({ runId: "r2", version: 1, vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"])] });
  const van2After = run({ runId: "r2", version: 2, vehicleId: "van2", vehicleLabel: "Van 2", visits: [visit("s2", ["job-1"]), visit("s9", ["job-9"], { lane: "collection", destination: "Bridgepoint" })] });
  stage(eventFor("assign-job-to-load", [van1Before, van2Before], [van1After, van2After]));
  await processPendingDriverChanges(store, NOON_TODAY);
  const all = [...notices.values()];
  assert.ok(all.some(n => n.vehicleId === "van1" && n.kind === "work-reassigned" && n.inboxText.includes("removed")));
  assert.ok(all.some(n => n.vehicleId === "van2" && n.kind === "collection-assigned"));
});

test("inbox isolation: each vehicle sees only its own notices, and cannot mark another vehicle's notice read", async () => {
  const { store, stage, notices } = memoryStore();
  stage(eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]));
  stage(eventFor("update-run-timing", [run({ runId: "r2", version: 1, vehicleId: "van2", vehicleLabel: "Van 2" })], [run({ runId: "r2", version: 2, vehicleId: "van2", vehicleLabel: "Van 2", departure: "13:00" })]));
  await processPendingDriverChanges(store, NOON_TODAY);
  const van1 = await inboxFor(store, "van1");
  const van2 = await inboxFor(store, "van2");
  assert.ok(van1.items.every(item => item.vehicleId === "van1"));
  assert.ok(van2.items.every(item => item.vehicleId === "van2"));
  const van2Notice = [...notices.values()].find(n => n.vehicleId === "van2")!;
  assert.equal(await markNotificationRead(store, "van1", van2Notice.id, NOON_TODAY), false, "Van 1 cannot touch Van 2's notice");
  assert.equal(await markNotificationRead(store, "van2", van2Notice.id, NOON_TODAY), true);
});

test("read state: unread count, mark one read, and mark all read, without changing the history", async () => {
  const { store, stage } = memoryStore();
  stage(eventFor("update-run-timing", [run({ version: 1 })], [run({ version: 2, departure: "12:00" })]));
  stage(eventFor("update-run-timing", [run({ version: 2, departure: "12:00" })], [run({ version: 3, departure: "12:30" })]));
  await processPendingDriverChanges(store, NOON_TODAY);
  let inbox = await inboxFor(store, "van1");
  assert.equal(inbox.unreadCount, 2);
  assert.equal(inbox.items.length, 2, "history is retained");
  await markNotificationRead(store, "van1", inbox.items[0].id, NOON_TODAY);
  inbox = await inboxFor(store, "van1");
  assert.equal(inbox.unreadCount, 1);
  assert.equal(await markAllNotificationsRead(store, "van1", NOON_TODAY), 1);
  assert.equal((await inboxFor(store, "van1")).unreadCount, 0);
  assert.equal((await inboxFor(store, "van1")).items.length, 2);
});

test("the event identity changes with each committed run version, so independent edits never collide", () => {
  const first = driverChangeEventId("update-run-timing", [{ runId: "r1", beforeVersion: 1, afterVersion: 2 }]);
  const second = driverChangeEventId("update-run-timing", [{ runId: "r1", beforeVersion: 2, afterVersion: 3 }]);
  const replay = driverChangeEventId("update-run-timing", [{ runId: "r1", beforeVersion: 1, afterVersion: 2 }]);
  assert.notEqual(first, second);
  assert.equal(first, replay);
});

test("driver visits are built from the authoritative legs, with quantities and instructions", () => {
  const visits = driverVisitsFromLegs([
    { lane: "delivery", load: { id: "L1", destinationLabelSnapshot: "Haleon", scheduledTime: "10:00", notes: "Use bay 2" }, jobs: [{ id: "J1", contents: [{ quantity: 7, unit: "items" }, { quantity: 85, unit: "pieces" }] }] },
    { lane: "collection", load: { id: "L2", destinationLabelSnapshot: "Commerzbank", collectionScheduledTime: "14:00" }, jobs: [{ id: "J2" }] },
  ]);
  assert.equal(visits.find(item => item.visitId === "L1:delivery")!.quantities, "7 items · 85 pieces");
  assert.equal(visits.find(item => item.visitId === "L1:delivery")!.instructions, "Use bay 2");
  assert.equal(visits.find(item => item.visitId === "L2:collection")!.time, "14:00");
});
