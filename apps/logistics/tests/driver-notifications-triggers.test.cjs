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

test('trigger 5: an upstream quantity amendment on assigned work notifies the van that owns it', async t => {
  const { f, text, clear, inbox } = await world(t, { count: 2 });
  clear();
  f.requirements[0].sourceVersion++; f.requirements[0].lines[0].quantity += 5;
  await f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
  assert.deepEqual(await inbox('van1'), ['load-details-changed']);
  assert.match((await text('van1'))[0], /Execution site/);
  assert.deepEqual(await inbox('van2'), []);
});

test('trigger 5: a delivery instruction edit notifies, and saving identical instructions again does not', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 1 });
  clear();
  const job = jobs(f)[0];
  const save = notes => f.post({ action: 'save-logistics-job', job: { ...jobs(f)[0], notes, version: jobs(f)[0].version + 1 } });
  assert.equal((await save('Use the side door')).response.status, 200);
  assert.deepEqual(await inbox('van1'), ['delivery-instructions-updated']);
  assert.equal((await save('Use the side door')).response.status, 200);
  assert.equal((await inbox('van1')).length, 1, 'an unchanged re-save is not a driver-visible change');
  assert.equal(docs(EVENTS).length, 1);
  assert.deepEqual(await inbox('van2'), []);
  assert.ok(job);
});

test('trigger 5: withdrawing one of two requirements reports the load change; withdrawing the rest removes the stop', async t => {
  const { f, clear, inbox } = await world(t, { count: 2 });
  clear();
  f.requirements[1].status = 'withdrawn'; f.requirements[1].sourceVersion++;
  await f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
  assert.deepEqual(await inbox('van1'), ['load-details-changed']);
  f.requirements[0].status = 'withdrawn'; f.requirements[0].sourceVersion++;
  await f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
  assert.ok((await inbox('van1')).includes('stop-removed'));
  assert.deepEqual(await inbox('van2'), []);
});

test('trigger 6: changing a run vehicle tells the old van the run left and the new van it arrived', async t => {
  const { f, clear, inbox } = await world(t, { count: 1 });
  clear();
  const before = run(f);
  const moved = await f.post({ action: 'update-run', run: { ...before, vehicleId: 'van2', driverId: undefined, driverLabel: undefined }, expectedRunVersion: before.version });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  const van1 = await inbox('van1'), van2 = await inbox('van2');
  assert.deepEqual(van1, ['work-reassigned'], 'the old van is told its work left');
  assert.deepEqual(van2, ['run-assigned'], 'the new van is told the run arrived');
});

test('trigger 6: a planning-day reset cancels every run for the day and tells the affected van once', async t => {
  const { f, docs, clear, inbox } = await world(t, { count: 1 });
  clear();
  f.principal.maintenanceAuthorities.push('logistics.reset');
  const reset = await f.post({ action: 'reset-planning-day', serviceDate: f.date });
  assert.equal(reset.response.status, 200, JSON.stringify(reset.body));
  assert.deepEqual(await inbox('van1'), ['run-cancelled']);
  assert.deepEqual(await inbox('van2'), [], 'a van with no run that day hears nothing');
  assert.equal(docs(EVENTS).length, 1);
});

test('trigger 6: a reviewed vehicle-identity repair on today run notifies the mapped van', async t => {
  const { f, clear, inbox } = await world(t, { count: 1 });
  f.records.get('fikaLogisticsDeliveryRunsV1/r2').vehicleId = 'van2';
  delete f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId;
  clear();
  f.principal.maintenanceAuthorities.push('logistics.repair');
  const repaired = await f.post({ action: 'repair-run-vehicle-identity', runId: 'r1', vehicleId: 'van1', expectedRunVersion: run(f).version });
  assert.equal(repaired.response.status, 200, JSON.stringify(repaired.body));
  assert.deepEqual(await inbox('van1'), ['run-assigned']);
  assert.deepEqual(await inbox('van2'), []);
});

test('trigger 3 (partial load): moving one of two items to Van 2 leaves Van 1 with a smaller load and gives Van 2 the item', async t => {
  const { f, text, clear, inbox } = await world(t, { count: 2 });
  clear();
  const job = jobs(f)[1];
  const moved = await f.post({ action: 'assign-job-to-load', jobId: job.id, expectedJobVersion: job.version, expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '10:30', targetRunId: 'r2' });
  assert.equal(moved.response.status, 200, JSON.stringify(moved.body));
  assert.deepEqual((await inbox('van1')).sort(), ['load-details-changed', 'work-reassigned']);
  assert.ok((await text('van1')).some(item => /^Part of the delivery at Execution site has been moved to another vehicle/.test(item)), 'part of the stop moved, the stop was not removed');
  assert.deepEqual(await inbox('van2'), ['delivery-assigned']);
});

test('native stops are covered too: scheduling a native stop notifies its van only', async t => {
  const { f, clear, inbox, text } = await world(t, { count: 1, native: true });
  clear();
  const stop = f.records.get('fikaLogisticsDeliveryStopsV1/native');
  const result = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedArrivalTime: '12:45', expectedRunVersion: run(f).version, expectedStopVersion: stop.version });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(await inbox('van1'), ['delivery-time-changed']);
  assert.match((await text('van1'))[0], /moved from 10:30 to 12:45/);
  assert.deepEqual(await inbox('van2'), []);
});
