const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { setup, jobs, loads, run } = require('./helpers/execution-fixture.cjs');

// The fixtures are dated 2099-01-05; freezing the clock there makes that date "today" in Europe/London, so every trigger below
// runs through the real planner route, the real authorised transaction and the real capture.
const TODAY_CLOCK = new Date('2099-01-05T10:00:00Z');
const EVENTS = 'fikaLogisticsDriverChangeEventsV1';
const NOTICES = 'fikaLogisticsDriverNotificationsV1';

async function world(t, options = { count: 2 }, clock = TODAY_CLOCK) {
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  const f = await setup(options);
  const store = f.load(path.join(__dirname, '..', 'lib/driver-notification-store.ts'));
  const api = store.firestoreDriverNotificationStore;
  const docs = prefix => [...f.records].filter(([key]) => key.startsWith(prefix + '/')).map(([, value]) => structuredClone(value));
  const clear = () => { for (const key of [...f.records.keys()]) if (key.startsWith(EVENTS + '/') || key.startsWith(NOTICES + '/')) f.records.delete(key); };
  const inbox = async vehicle => (await api.listNotifications(vehicle, 100)).map(item => item.kind);
  const text = async vehicle => (await api.listNotifications(vehicle, 100)).map(item => item.inboxText);
  return { f, store, api, docs, clear, inbox, text };
}

test('trigger 1+2: assigning deliveries and collections to today\'s run notifies only the run\'s van', async t => {
  const { inbox, text } = await world(t, { count: 1, collection: true });
  const van1 = await inbox('van1');
  assert.ok(van1.includes('delivery-assigned'), 'a delivery added to the run');
  assert.ok(van1.includes('collection-assigned'), 'a collection added to the run');
  assert.deepEqual(await inbox('van2'), [], 'the other van is never notified');
  assert.ok((await text('van1')).some(item => /Execution site/.test(item)), 'the inbox names the real destination');
});

test('trigger 1+2: a second item on an existing stop is a load change, not a new stop', async t => {
  const { inbox } = await world(t, { count: 2 });
  assert.deepEqual((await inbox('van1')).sort(), ['delivery-assigned', 'load-details-changed']);
});

test('trigger 3: removing one of two items reports the item, then removing the last reports the stop', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 2 });
  clear();
  const [first, second] = jobs(f);
  let result = await f.post({ action: 'remove-job-from-load', jobId: first.id, expectedJobVersion: first.version, expectedLoadVersion: loads(f)[0].version });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(await inbox('van1'), ['load-details-changed'], 'one item removed; the physical stop remains');
  const current = jobs(f).find(job => job.id === second.id);
  result = await f.post({ action: 'remove-job-from-load', jobId: current.id, expectedJobVersion: current.version, expectedLoadVersion: loads(f)[0].version });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.ok((await inbox('van1')).includes('stop-removed'), 'removing the last item removes the stop');
  assert.equal(docs(EVENTS).length, 2);
  assert.deepEqual(await inbox('van2'), []);
});

test('trigger 4: a scheduled time change notifies the van with the old and new times', async t => {
  const { f, text, clear, inbox } = await world(t, { count: 1 });
  clear();
  const result = await f.post({ action: 'reschedule-delivery-loads', loadIds: loads(f).map(load => load.id), expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '11:15', targetRunId: 'r1', lane: 'delivery' });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(await inbox('van1'), ['delivery-time-changed']);
  assert.match((await text('van1'))[0], /moved from 10:30 to 11:15/);
  assert.deepEqual(await inbox('van2'), []);
});

test('trigger 3 (reassignment): moving a load from Van 1 to Van 2 tells Van 1 it was removed and Van 2 it was added, once each', async t => {
  const { f, text, clear, inbox } = await world(t, { count: 2 });
  clear();
  const result = await f.post({ action: 'reschedule-delivery-loads', loadIds: loads(f).map(load => load.id), expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '10:30', targetRunId: 'r2', lane: 'delivery' });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(await inbox('van1'), ['work-reassigned']);
  assert.deepEqual(await inbox('van2'), ['delivery-assigned']);
  assert.match((await text('van1'))[0], /Execution site has been removed from your run/);
  assert.match((await text('van2'))[0], /Execution site has been added to your run/);
  assert.equal((await text('van1'))[0].includes('job'), false, 'no internal ids in the inbox');
});

test('replay: repeating a committed mutation with stale versions is rejected and adds no event or notification', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 1 });
  clear();
  const payload = { action: 'reschedule-delivery-loads', loadIds: loads(f).map(load => load.id), expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '11:15', targetRunId: 'r1', lane: 'delivery' };
  assert.equal((await f.post(payload)).response.status, 200);
  const replay = await f.post(payload);
  assert.notEqual(replay.response.status, 200, 'stale expected versions are refused');
  assert.equal(docs(EVENTS).length, 1);
  assert.equal((await inbox('van1')).length, 1);
});

test('competing writes: two simultaneous identical requests commit exactly one change and one notification', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 1 });
  clear();
  const payload = { action: 'reschedule-delivery-loads', loadIds: loads(f).map(load => load.id), expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '11:15', targetRunId: 'r1', lane: 'delivery' };
  const results = await Promise.all([f.post(payload), f.post(payload)]);
  assert.equal(results.filter(result => result.response.status === 200).length, 1, 'exactly one write wins');
  assert.equal(docs(EVENTS).length, 1);
  assert.deepEqual(await inbox('van1'), ['delivery-time-changed']);
});

test('today-only: the same change on tomorrow\'s run records no event and no notification', async t => {
  // The clock is one day earlier, so the fixture date (2099-01-05) is tomorrow.
  const { f, docs, inbox } = await world(t, { count: 2, collection: true }, new Date('2099-01-04T10:00:00Z'));
  assert.equal(docs(EVENTS).length, 0, 'assigning work to tomorrow records nothing');
  const result = await f.post({ action: 'reschedule-delivery-loads', loadIds: loads(f).map(load => load.id), expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '11:15', targetRunId: 'r1', lane: 'delivery' });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(docs(EVENTS).length, 0);
  assert.deepEqual(await inbox('van1'), []);
  assert.equal(run(f).serviceDate, '2099-01-05');
});

test('driver execution never creates events, so driver taps cost no extra reads and never notify', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 1 });
  clear();
  const marked = await f.post({ action: 'mark-subload-loaded', runId: 'r1', stopId: `projection-stop:delivery:${loads(f)[0].id}`, loadIds: loads(f).map(load => load.id), expectedRunVersion: run(f).version, expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), expectedJobVersions: Object.fromEntries(jobs(f).map(job => [job.id, job.version])), jobId: jobs(f)[0].id });
  assert.equal(marked.response.status, 200, JSON.stringify(marked.body));
  assert.equal(docs(EVENTS).length, 0);
  assert.deepEqual(await inbox('van1'), []);
});
