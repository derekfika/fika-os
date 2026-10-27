const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');

const appRoot = path.resolve(__dirname, '..');
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RUNS = 'fikaLogisticsDeliveryRunsV1';
const EVENTS = 'fikaLogisticsDriverChangeEventsV1';
const NOTICES = 'fikaLogisticsDriverNotificationsV1';

function setup() {
  const f = fixture(['van1', 'van2'], [], true);
  const today = londonToday();
  for (const id of ['r1', 'r2']) Object.assign(f.records.get(`${RUNS}/${id}`), { serviceDate: today, plannedCpuDepartureTime: '10:00', plannedCpuReturnTime: '16:00' });
  const store = f.load(path.join(appRoot, 'lib/driver-notification-store.ts'));
  const events = f.load(path.join(appRoot, 'lib/driver-change-events.ts'));
  const firebase = f.load(path.join(appRoot, 'lib/firebase.ts'));
  const docs = prefix => [...f.records].filter(([key]) => key.startsWith(prefix + '/')).map(([key, value]) => ({ key, ...structuredClone(value) }));
  const run = id => structuredClone(f.records.get(`${RUNS}/${id}`));
  const timing = (id, departure, returnTime) => f.post({ action: 'update-run-timing', runId: id, expectedRunVersion: run(id).version, plannedCpuDepartureTime: departure, plannedCpuReturnTime: returnTime });
  return { f, today, store, events, firebase, docs, run, timing };
}

test('vertical slice: a committed run timing change reaches the right van\'s inbox and updates the unread count', async () => {
  const { f, store, docs, run, timing } = setup();
  const result = await timing('r1', '11:30', '16:00');
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(run('r1').plannedCpuDepartureTime, '11:30', 'the planner change itself committed');

  // The immutable event was recorded in the same transaction and then processed.
  const events = docs(EVENTS);
  assert.equal(events.length, 1);
  assert.equal(events[0].status, 'processed');
  assert.equal(events[0].sourceAction, 'update-run-timing');
  assert.equal(events[0].before[0].version + 1, events[0].after[0].version);

  const van1 = await store.firestoreDriverNotificationStore.listNotifications('van1', 50);
  assert.equal(van1.length, 1);
  assert.equal(van1[0].kind, 'departure-time-changed');
  assert.equal(van1[0].vehicleId, 'van1');
  assert.equal(van1[0].readAt, undefined, 'unread until opened');
  const van2 = await store.firestoreDriverNotificationStore.listNotifications('van2', 50);
  assert.equal(van2.length, 0, 'an unaffected vehicle is never notified');
  void f;
});

test('rapid consecutive timing edits each produce their own committed event and notice', async () => {
  const { store, docs, timing } = setup();
  await timing('r1', '11:30', '16:00');
  await timing('r1', '12:00', '16:00');
  await timing('r1', '11:30', '16:00');
  await timing('r1', '12:00', '16:00');
  assert.equal(docs(EVENTS).length, 4);
  const inbox = await store.firestoreDriverNotificationStore.listNotifications('van1', 50);
  assert.equal(inbox.length, 4, 'both 12:00 changes remain visible');
  assert.equal(new Set(inbox.map(item => item.id)).size, 4);
});

test('read state is durable: mark one read, then mark all read, and history is retained', async () => {
  const { store, timing } = setup();
  await timing('r1', '11:30', '16:00');
  await timing('r1', '12:00', '16:00');
  const api = store.firestoreDriverNotificationStore;
  let inbox = await api.listNotifications('van1', 50);
  assert.equal(inbox.filter(item => !item.readAt).length, 2);
  assert.equal(await api.markRead('van1', inbox[0].id, '2026-10-28T10:00:00.000Z'), true);
  assert.equal((await api.listNotifications('van1', 50)).filter(item => !item.readAt).length, 1);
  assert.equal(await api.markAllRead('van1', '2026-10-28T10:05:00.000Z'), 1);
  inbox = await api.listNotifications('van1', 50);
  assert.equal(inbox.filter(item => !item.readAt).length, 0);
  assert.equal(inbox.length, 2);
});

test('vehicle isolation: Van 2 cannot read or mark Van 1\'s notification', async () => {
  const { store, timing } = setup();
  await timing('r1', '11:30', '16:00');
  const api = store.firestoreDriverNotificationStore;
  const [van1Notice] = await api.listNotifications('van1', 50);
  assert.equal(await api.markRead('van2', van1Notice.id, '2026-10-28T10:00:00.000Z'), false);
  assert.equal((await api.listNotifications('van2', 50)).length, 0);
  assert.equal((await api.listNotifications('van1', 50))[0].readAt, undefined, 'the refused write changed nothing');
});

test('a processing failure never fails or undoes the planner save, and the retry creates exactly one notice', async () => {
  const { store, docs, run, timing } = setup();
  const original = store.firestoreDriverNotificationStore.commitProcessedEvent;
  store.firestoreDriverNotificationStore.commitProcessedEvent = async () => { throw new Error('inbox write unavailable'); };
  const result = await timing('r1', '11:30', '16:00');
  assert.equal(result.response.status, 200, 'the planner save succeeds even though notification processing failed');
  assert.equal(run('r1').plannedCpuDepartureTime, '11:30');
  const [event] = docs(EVENTS);
  assert.equal(event.status, 'pending');
  assert.equal(event.attempts, 1, 'the failed attempt is recorded');
  assert.equal(docs(NOTICES).length, 0);

  store.firestoreDriverNotificationStore.commitProcessedEvent = original;
  const retry = await store.processDriverNotifications(new Date(), 25);
  assert.equal(retry.created, 1);
  await store.processDriverNotifications(new Date(), 25);
  assert.equal(docs(NOTICES).length, 1, 'repeated processing never duplicates the notice');
  assert.equal(docs(EVENTS)[0].status, 'processed');
});

test('events that keep failing are parked after the bounded number of attempts', async () => {
  const { store, events, docs, timing } = setup();
  store.firestoreDriverNotificationStore.commitProcessedEvent = async () => { throw new Error('permanent failure'); };
  await timing('r1', '11:30', '16:00');
  for (let attempt = 1; attempt < events.MAX_PROCESSING_ATTEMPTS; attempt++) await store.processDriverNotificationsSafely();
  assert.equal(docs(EVENTS)[0].status, 'failed');
  assert.equal(docs(EVENTS)[0].attempts, events.MAX_PROCESSING_ATTEMPTS);
  const pending = await store.firestoreDriverNotificationStore.listPendingEvents(25);
  assert.equal(pending.length, 0, 'a parked event is no longer retried');
});

test('immutability: a retry or replay can never overwrite a processed event or reset it to pending', async () => {
  const { store, events, firebase, docs, timing } = setup();
  await timing('r1', '11:30', '16:00');
  const [processed] = docs(EVENTS);
  assert.equal(processed.status, 'processed');
  const staged = await firebase.db.runTransaction(async transaction => events.stageDriverChangeEvent(transaction, store.driverChangeEvents().doc(processed.eventId), {
    eventId: processed.eventId, serviceDate: processed.serviceDate, sourceAction: processed.sourceAction, actorId: 'attacker', committedAt: '2099-01-01T00:00:00.000Z',
    before: [], after: [], mutations: [],
  }));
  assert.equal(staged, 'exists');
  const [after] = docs(EVENTS);
  assert.equal(after.status, 'processed', 'status is not reset to pending');
  assert.equal(after.actorId, processed.actorId, 'captured content is not rewritten');
  assert.deepEqual(after.before, processed.before);
});

test('unchanged saves, future-dated runs and empty planner edits record no event', async () => {
  const { f, docs, timing } = setup();
  f.records.get(`${RUNS}/r2`).serviceDate = '2099-01-05';
  const future = await timing('r2', '11:30', '16:00');
  assert.equal(future.response.status, 200);
  assert.equal(docs(EVENTS).length, 0, 'tomorrow, next week and later dates never create events');
});

test('event identity distinguishes stop/load edits that leave the parent run version unchanged', () => {
  const { events } = setup();
  const first = events.driverChangeEventId('assign-job-to-load', [{ runId: 'r1', beforeVersion: 3, afterVersion: 3 }], [{ entityType: 'load', entityId: 'l1', beforeVersion: 1, afterVersion: 2 }]);
  const second = events.driverChangeEventId('assign-job-to-load', [{ runId: 'r1', beforeVersion: 3, afterVersion: 3 }], [{ entityType: 'load', entityId: 'l1', beforeVersion: 2, afterVersion: 3 }]);
  const otherLoad = events.driverChangeEventId('assign-job-to-load', [{ runId: 'r1', beforeVersion: 3, afterVersion: 3 }], [{ entityType: 'load', entityId: 'l2', beforeVersion: 1, afterVersion: 2 }]);
  const replay = events.driverChangeEventId('assign-job-to-load', [{ runId: 'r1', beforeVersion: 3, afterVersion: 3 }], [{ entityType: 'load', entityId: 'l1', beforeVersion: 1, afterVersion: 2 }]);
  assert.notEqual(first, second, 'a second edit of the same load differs by that load\'s version');
  assert.notEqual(first, otherLoad, 'a different load differs');
  assert.equal(first, replay, 'replaying the same committed mutation is the same event');
});

test('vertical slice: reordering stops records one event and notifies only the affected van', async () => {
  const { f, today, store, docs, run } = setup();
  const stop = f.records.get('fikaLogisticsDeliveryStopsV1/s1');
  f.seed('fikaLogisticsDeliveryStopsV1', 's3', { ...stop, canonicalId: 's3', sequence: 2, locationOplocId: 'site:s3', locationLabelSnapshot: 's3' });
  f.records.get(`${RUNS}/r1`).orderedStopIds = ['s1', 's3'];
  void today;
  const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run('r1').version, stopIds: ['s3', 's1'] });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(run('r1').orderedStopIds, ['s3', 's1'], 'the planner change committed');
  const events = docs(EVENTS);
  assert.equal(events.length, 1);
  assert.equal(events[0].sourceAction, 'set-run-stop-order');
  assert.deepEqual(events[0].before[0].stopOrder, ['s1', 's3']);
  assert.deepEqual(events[0].after[0].stopOrder, ['s3', 's1']);
  const van1 = await store.firestoreDriverNotificationStore.listNotifications('van1', 50);
  assert.deepEqual(van1.map(item => item.kind), ['route-order-updated']);
  assert.equal((await store.firestoreDriverNotificationStore.listNotifications('van2', 50)).length, 0);
});

test('saving the same stop order again is an idempotent no-op: no new event and no notification', async () => {
  const { f, store, docs, run } = setup();
  f.records.get(`${RUNS}/r1`).orderedStopIds = ['s1'];
  const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run('r1').version, stopIds: ['s1'] });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(docs(EVENTS).length, 0);
  assert.equal((await store.firestoreDriverNotificationStore.listNotifications('van1', 50)).length, 0);
});

test('a stale expected version is rejected and records no event', async () => {
  const { docs, run, f } = setup();
  const result = await f.post({ action: 'update-run-timing', runId: 'r1', expectedRunVersion: run('r1').version + 5, plannedCpuDepartureTime: '11:30', plannedCpuReturnTime: '16:00' });
  assert.equal(result.response.status, 409);
  assert.equal(docs(EVENTS).length, 0, 'a rejected mutation leaves no event behind');
});
