import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test, { before } from "node:test";
import { driverChangeEventId, inboxFor, processPendingDriverChanges, stageDriverChangeEvent, type DriverChangeEvent } from "../../lib/driver-change-events";
import { londonServiceDate, type DriverRunSnapshot } from "../../lib/driver-notifications";

// These run against the real Firestore emulator (firebase emulators:exec): real transactions, real Timestamp round-trips, real
// aggregation and inequality queries and genuinely concurrent processors. The in-memory harness cannot prove any of those.
const emulatorEnabled = process.env.FIREBASE_PROJECT_ID === "demo-fika-os" && process.env.FIRESTORE_EMULATOR_HOST === "127.0.0.1:8292" && (process.env.FIKA_RUNTIME_MODE || "local") === "local";
const skip = !emulatorEnabled;

const loadModule = () => import("../../lib/driver-notification-store");
const loadStore = async () => (await loadModule()).firestoreDriverNotificationStore;

const now = new Date();
const today = londonServiceDate(now);
const run = (version: number, departure: string, vehicleId: "van1" | "van2" = "van1"): DriverRunSnapshot => ({ runId: `emu-run-${vehicleId}`, version, vehicleId, vehicleLabel: vehicleId === "van1" ? "Van 1" : "Van 2", serviceDate: today, status: "planned", departure, return: "16:00", visits: [] });

function eventFor(label: string, vehicleId: "van1" | "van2" = "van1", beforeVersion = 1): Omit<DriverChangeEvent, "status" | "processedAt" | "attempts"> {
  const before = [run(beforeVersion, "11:30", vehicleId)];
  const after = [run(beforeVersion + 1, "12:00", vehicleId)];
  const runs = [{ runId: before[0].runId, beforeVersion, afterVersion: beforeVersion + 1 }];
  const mutations = runs.map(item => ({ entityType: "run" as const, entityId: item.runId, beforeVersion: item.beforeVersion, afterVersion: item.afterVersion }));
  return { eventId: driverChangeEventId(`emulator:${label}`, runs, mutations), serviceDate: today, sourceAction: `emulator:${label}`, actorId: "emulator-test", committedAt: now.toISOString(), before, after, mutations };
}

async function clearAll() {
  const { db } = await import("../../lib/firebase");
  for (const name of ["fikaLogisticsDriverChangeEventsV1", "fikaLogisticsDriverNotificationsV1"]) {
    const snapshot = await db.collection(name).get();
    const batch = db.batch();
    snapshot.docs.forEach(doc => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function seedNotice(id: string, vehicleId: "van1" | "van2", options: { expiresAt: Date; readAt?: string | null; createdAt?: string }) {
  const { driverNotifications } = await loadModule();
  await driverNotifications().doc(id).set({ id, vehicleId, kind: "departure-time-changed", title: "t", inboxText: "x", pushBody: "x", priority: "normal", dedupeKey: id, revision: 1, serviceDate: today, runId: "r", eventId: "e", createdAt: options.createdAt ?? new Date().toISOString(), readAt: options.readAt ?? null, expiresAt: options.expiresAt });
}

before(async () => { if (!skip) await clearAll(); });

test("emulator: expiry works on real Firestore Timestamp values", { skip }, async () => {
  await clearAll();
  const store = await loadStore();
  const { driverNotifications } = await loadModule();
  await seedNotice("ts-expired", "van1", { expiresAt: new Date(Date.now() - 60_000) });
  await seedNotice("ts-live", "van1", { expiresAt: new Date(Date.now() + 86_400_000) });
  const raw = (await driverNotifications().doc("ts-live").get()).data()!;
  assert.equal(typeof raw.expiresAt.toDate, "function", "Firestore returns a Timestamp, not a Date");
  const ids = (await store.listNotifications("van1", 50)).map(item => item.id);
  assert.deepEqual(ids, ["ts-live"], "the expired Timestamp is filtered out");
  assert.equal(await store.countUnread("van1", new Date(), 100), 1, "the aggregate excludes the expired notice too");
});

test("emulator: the unread count is exact beyond the first 50 and capped at the documented limit", { skip }, async () => {
  await clearAll();
  const store = await loadStore();
  const future = new Date(Date.now() + 86_400_000);
  const base = Date.now();
  await Promise.all(Array.from({ length: 130 }, (_, index) => seedNotice(`bulk-${index}`, "van1", { expiresAt: future, createdAt: new Date(base + index).toISOString() })));
  await Promise.all(Array.from({ length: 3 }, (_, index) => seedNotice(`read-${index}`, "van1", { expiresAt: future, readAt: new Date().toISOString() })));
  await seedNotice("other-van", "van2", { expiresAt: future });
  assert.equal((await store.listNotifications("van1", 50)).length, 50, "the list page is bounded");
  assert.equal(await store.countUnread("van1", new Date(), 100), 100, "capped at the documented display cap");
  assert.equal((await inboxFor(store, "van1", 50)).unreadCount, 100);
  assert.equal(await store.countUnread("van2", new Date(), 100), 1);
  // Seven unread older than sixty newer read notices: the count is exact and independent of the 50-item list page.
  await clearAll();
  await Promise.all(Array.from({ length: 7 }, (_, index) => seedNotice(`few-${index}`, "van1", { expiresAt: future })));
  await Promise.all(Array.from({ length: 60 }, (_, index) => seedNotice(`done-${index}`, "van1", { expiresAt: future, readAt: new Date().toISOString(), createdAt: new Date(base + 10_000 + index).toISOString() })));
  assert.equal(await store.countUnread("van1", new Date(), 100), 7, "unread notices older than the newest 50 are still counted");
});

test("emulator: read isolation between vehicles for list, count, mark-read and mark-all-read", { skip }, async () => {
  await clearAll();
  const store = await loadStore();
  const future = new Date(Date.now() + 86_400_000);
  await seedNotice("iso-van1", "van1", { expiresAt: future });
  await seedNotice("iso-van2", "van2", { expiresAt: future });
  assert.deepEqual((await store.listNotifications("van1", 50)).map(item => item.id), ["iso-van1"]);
  assert.equal(await store.markRead("van1", "iso-van2", new Date().toISOString()), false, "another vehicle's notice is not found");
  assert.equal(await store.countUnread("van2", new Date(), 100), 1, "the refused write changed nothing");
  assert.equal(await store.markAllRead("van1", new Date().toISOString()), 1);
  assert.equal(await store.countUnread("van1", new Date(), 100), 0);
  assert.equal(await store.countUnread("van2", new Date(), 100), 1, "the other vehicle is untouched");
});

test("emulator: concurrent transactions stage one immutable event, and the losers are no-ops", { skip }, async () => {
  await clearAll();
  const { db } = await import("../../lib/firebase");
  const { driverChangeEvents } = await loadModule();
  const event = eventFor("staging");
  const results = await Promise.all(Array.from({ length: 6 }, () => db.runTransaction(transaction => stageDriverChangeEvent(transaction as never, driverChangeEvents().doc(event.eventId), event))));
  assert.equal(results.filter(result => result === "staged").length, 1, "exactly one transaction stages the event");
  assert.equal((await driverChangeEvents().get()).size, 1);
});

test("emulator: concurrent processors create each notice exactly once and mark each event processed once", { skip }, async () => {
  await clearAll();
  const store = await loadStore();
  const { driverChangeEvents, driverNotifications } = await loadModule();
  for (const label of ["a", "b", "c"]) {
    const event = eventFor(label, label === "b" ? "van2" : "van1");
    await driverChangeEvents().doc(event.eventId).create({ ...event, status: "pending", attempts: 0 });
  }
  await Promise.all(Array.from({ length: 5 }, () => processPendingDriverChanges(store, new Date(), 25)));
  const events = await driverChangeEvents().get();
  assert.ok(events.docs.every(doc => doc.data().status === "processed"), "every event processed");
  assert.equal((await driverNotifications().get()).size, 3, "one notice per event despite five overlapping processors");
  assert.equal((await store.listNotifications("van2", 50)).length, 1);
  assert.equal((await store.listNotifications("van1", 50)).length, 2);
  assert.deepEqual(await processPendingDriverChanges(store, new Date(), 25), { processed: 0, created: 0, expired: 0 }, "a later run finds nothing");
});

test("emulator: events for another service date expire without creating notices", { skip }, async () => {
  await clearAll();
  const store = await loadStore();
  const { driverChangeEvents, driverNotifications } = await loadModule();
  const event = { ...eventFor("stale"), serviceDate: "2000-01-01" };
  await driverChangeEvents().doc(event.eventId).create({ ...event, status: "pending", attempts: 0 });
  const result = await processPendingDriverChanges(store, new Date(), 25);
  assert.equal(result.expired, 1);
  assert.equal((await driverNotifications().get()).size, 0);
  assert.equal((await driverChangeEvents().doc(event.eventId).get()).data()?.status, "expired");
});

test("every query the notification store issues has a declared composite index (the emulator does not enforce indexes)", () => {
  const declared = JSON.parse(readFileSync(fileURLToPath(new URL("../../firestore.indexes.json", import.meta.url)), "utf8")).indexes as Array<{ collectionGroup: string; fields: Array<{ fieldPath: string; order: string }> }>;
  const has = (collection: string, fields: Array<[string, string]>) => declared.some(index => index.collectionGroup === collection && index.fields.length === fields.length && fields.every(([fieldPath, order], position) => index.fields[position].fieldPath === fieldPath && index.fields[position].order === order));
  assert.ok(has("fikaLogisticsDriverChangeEventsV1", [["status", "ASCENDING"], ["committedAt", "ASCENDING"]]), "pending events by commit time");
  assert.ok(has("fikaLogisticsDriverNotificationsV1", [["vehicleId", "ASCENDING"], ["createdAt", "DESCENDING"]]), "vehicle inbox, newest first");
  assert.ok(has("fikaLogisticsDriverNotificationsV1", [["vehicleId", "ASCENDING"], ["readAt", "ASCENDING"], ["expiresAt", "ASCENDING"]]), "unread count with expiry");
});
