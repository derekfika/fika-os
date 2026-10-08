const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');

function setup() {
  const f = fixture(['van1', 'van2'], ['logistics.reconcile'], true);
  f.requirements.length = 0;
  for (const [key] of [...f.records]) if (!key.startsWith('fikaLogisticsDeliveryRunsV1/')) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  return f;
}
const records = (f, collection) => [...f.records].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => structuredClone(value));
const loads = f => records(f, 'fikaLogisticsDeliveryLoadsV1');
const jobs = f => records(f, 'fikaLogisticsJobsV1');
const assignments = f => records(f, 'fikaLogisticsAssignmentsV1');
function requirement(f, id, destinationOplocId = 'site') {
  return { canonicalId: `req:${id}`, sourceDomain: 'cpu-production', sourceEntityId: `order:${id}`, sourceVersion: 1, sourceContentHash: `hash:${id}`, serviceDate: f.date, productionLocationId: 'cpu', destinationOplocId, destinationLabelSnapshot: destinationOplocId, requiredDeliveryWindow: { startTime: '09:00', endTime: '12:00' }, lines: [{ displayNameSnapshot: 'Lunch', quantity: 2, unit: 'portion' }], status: 'ready_for_planning' };
}
async function assigned(f = setup()) {
  f.requirements.push(requirement(f, 'a'));
  await f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
  const job = jobs(f)[0];
  const run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const result = await f.post({ action: 'assign-job-to-load', jobId: job.id, targetRunId: 'r1', scheduledTime: '10:30', scheduledEnd: '11:30', expectedJobVersion: job.version, expectedLoadVersions: {}, expectedRunVersion: run.version });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  return f;
}
function stop(id, timing = {}) {
  return { canonicalId: id, runId: 'r1', sequence: 1, locationOplocId: `site:${id}`, locationLabelSnapshot: id, requirementRefs: [], movementRequestIds: [], status: 'planned', version: 1, audit: [], createdAt: 'now', updatedAt: 'now', ...timing };
}
function assertPersistedWindowsValid(f) {
  for (const load of loads(f)) if (load.scheduledEnd || load.collectionScheduledEnd) {
    for (const [start, end] of [[load.scheduledTime, load.scheduledEnd], [load.collectionScheduledTime, load.collectionScheduledEnd]]) if (end) {
      assert.notEqual(end, '24:00'); assert.notEqual(end, '23:59');
      assert.ok(end <= '23:45');
      assert.ok(Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))) >= 15);
    }
  }
  for (const item of records(f, 'fikaLogisticsDeliveryStopsV1')) if (item.plannedWindow?.endTime) {
    const start = item.plannedWindow.startTime; const end = item.plannedWindow.endTime;
    assert.notEqual(end, '24:00'); assert.notEqual(end, '23:59'); assert.ok(end <= '23:45');
    assert.ok(Number(end.slice(0, 2)) * 60 + Number(end.slice(3, 5)) - (Number(start.slice(0, 2)) * 60 + Number(start.slice(3, 5))) >= 15);
  }
}

test('native schedule switching replaces the entire mutually-exclusive timing value', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'native', stop('native', { plannedWindow: { startTime: '09:00', endTime: '09:30' } }));
  let run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  let saved = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedArrivalTime: '10:00', expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.stop.plannedArrivalTime, '10:00');
  assert.equal(Object.hasOwn(saved.body.stop, 'plannedWindow'), false);
  run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  saved = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedWindow: { startTime: '11:00', endTime: '11:45' }, expectedRunVersion: run.version, expectedStopVersion: 2 });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(Object.hasOwn(saved.body.stop, 'plannedArrivalTime'), false);
  assert.deepEqual(saved.body.stop.plannedWindow, { startTime: '11:00', endTime: '11:45' });
  run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  saved = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedWindow: { startTime: '12:00' }, expectedRunVersion: run.version, expectedStopVersion: 3 });
  assert.equal(saved.response.status, 200, JSON.stringify(saved.body));
  assert.equal(saved.body.stop.plannedArrivalTime, '12:00');
  assert.equal(Object.hasOwn(saved.body.stop, 'plannedWindow'), false);
});

test('full operational-day native timing accepts the latest supported arrival and rejects beyond it', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'native', stop('native'));
  let run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const late = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedArrivalTime: '23:45', expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(late.response.status, 200, JSON.stringify(late.body));
  run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const before = structuredClone([...f.records]);
  const beyond = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'native', plannedArrivalTime: '23:46', expectedRunVersion: run.version, expectedStopVersion: 2 });
  assert.equal(beyond.response.status, 422);
  assert.deepEqual([...f.records], before);
});

test('native explicit 23:30–23:45 window persists exactly; arrival at 23:45 remains valid', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'edge-window', stop('edge-window'));
  let run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const window = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'edge-window', plannedWindow: { startTime: '23:30', endTime: '23:45' }, expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(window.response.status, 200, JSON.stringify(window.body));
  assert.deepEqual(window.body.stop.plannedWindow, { startTime: '23:30', endTime: '23:45' });
  f.seed('fikaLogisticsDeliveryStopsV1', 'edge-arrival', stop('edge-arrival', { sequence: 2, locationOplocId: 'different-site' }));
  run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const arrival = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'edge-arrival', plannedArrivalTime: '23:45', expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(arrival.response.status, 200, JSON.stringify(arrival.body));
  assert.equal(arrival.body.stop.plannedArrivalTime, '23:45');
  assertPersistedWindowsValid(f);
});

test('native explicit collision at 23:30 rejects instead of storing 23:45–23:59', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'edge-target', stop('edge-target'));
  f.seed('fikaLogisticsDeliveryStopsV1', 'edge-conflict', stop('edge-conflict', { sequence: 2, locationOplocId: 'other-site', plannedWindow: { startTime: '23:30', endTime: '23:45' } }));
  const run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const before = structuredClone([...f.records]); const writes = f.writes;
  const result = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'edge-target', plannedWindow: { startTime: '23:30', endTime: '23:45' }, expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(result.response.status, 409, JSON.stringify(result.body));
  assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  assertPersistedWindowsValid(f);
});

test('native fixed-start resize may end at 23:45 but cannot exceed the persisted bound', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'edge-resize', stop('edge-resize', { plannedWindow: { startTime: '23:30', endTime: '23:45' } }));
  const run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const valid = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'edge-resize', plannedWindow: { startTime: '23:30', endTime: '23:45' }, resizeEndOnly: true, expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(valid.response.status, 200, JSON.stringify(valid.body));
  assert.deepEqual(valid.body.stop.plannedWindow, { startTime: '23:30', endTime: '23:45' });
  const nextRun = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const before = structuredClone([...f.records]); const writes = f.writes;
  const beyond = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'edge-resize', plannedWindow: { startTime: '23:30', endTime: '23:46' }, resizeEndOnly: true, expectedRunVersion: nextRun.version, expectedStopVersion: 2 });
  assert.equal(beyond.response.status, 422); assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  assertPersistedWindowsValid(f);
});

test('native end-only resize rejects a current collision without writes and retains its canonical start', async () => {
  const f = setup();
  f.seed('fikaLogisticsDeliveryStopsV1', 'window', stop('window', { plannedWindow: { startTime: '10:00', endTime: '10:30' } }));
  f.seed('fikaLogisticsDeliveryStopsV1', 'conflict', stop('conflict', { sequence: 2, locationOplocId: 'other-site', plannedWindow: { startTime: '10:30', endTime: '11:00' } }));
  const run = f.records.get('fikaLogisticsDeliveryRunsV1/r1');
  const before = structuredClone([...f.records]); const writes = f.writes;
  const conflict = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'window', plannedWindow: { startTime: '10:00', endTime: '11:00' }, resizeEndOnly: true, expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body));
  assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  f.records.delete('fikaLogisticsDeliveryStopsV1/conflict');
  const accepted = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 'window', plannedWindow: { startTime: '10:00', endTime: '11:00' }, resizeEndOnly: true, expectedRunVersion: run.version, expectedStopVersion: 1 });
  assert.equal(accepted.response.status, 200, JSON.stringify(accepted.body));
  assert.deepEqual(accepted.body.stop.plannedWindow, { startTime: '10:00', endTime: '11:00' });
});

test('projected timing replacement preserves an existing delivery duration when the end is omitted', async () => {
  const f = await assigned(); const load = loads(f)[0]; const requestedWindow = jobs(f)[0].requestedWindow;
  const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45', targetRunId: 'r1' });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.scheduledTime, '10:45');
  assert.equal(result.body.scheduledEnd, '11:45');
  assert.deepEqual(jobs(f)[0].requestedWindow, requestedWindow);
});

test('projected delivery clear uses canonical load CAS, removes only delivery timing, and preserves collection authority', async () => {
  const f = await assigned(); const original = loads(f)[0];
  const setCollection = await f.post({ action: 'reschedule-delivery-load', loadId: original.id, expectedLoadVersion: original.version, lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00', scheduledEnd: '14:30' });
  assert.equal(setCollection.response.status, 200, JSON.stringify(setCollection.body));
  const scheduled = loads(f)[0];
  const clear = await f.post({ action: 'clear-delivery-load-schedule', loadId: scheduled.id, expectedLoadVersion: scheduled.version });
  assert.equal(clear.response.status, 200, JSON.stringify(clear.body));
  assert.equal(Object.hasOwn(clear.body, 'scheduledTime'), false); assert.equal(Object.hasOwn(clear.body, 'scheduledEnd'), false);
  assert.equal(clear.body.runId, scheduled.runId); assert.equal(clear.body.collectionRunId, 'r2');
  assert.equal(clear.body.collectionScheduledTime, '14:00'); assert.equal(clear.body.collectionScheduledEnd, '14:30');
  assert.equal(assignments(f).length, 1); assert.equal(jobs(f)[0].activeLoadId, scheduled.id);
});

test('projected collection clear retains delivery lane and stale/lifecycle guards perform no writes', async () => {
  const f = await assigned(); const original = loads(f)[0];
  const setCollection = await f.post({ action: 'reschedule-delivery-load', loadId: original.id, expectedLoadVersion: original.version, lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00', scheduledEnd: '14:30' });
  const scheduled = loads(f)[0]; const staleBefore = structuredClone([...f.records]); const staleWrites = f.writes;
  const stale = await f.post({ action: 'clear-collection-load-schedule', loadId: scheduled.id, expectedLoadVersion: scheduled.version - 1 });
  assert.equal(stale.response.status, 409); assert.equal(f.writes, staleWrites); assert.deepEqual([...f.records], staleBefore);
  const r2 = f.records.get('fikaLogisticsDeliveryRunsV1/r2'); r2.status = 'dispatched';
  const lifecycleBefore = structuredClone([...f.records]); const lifecycleWrites = f.writes;
  const closed = await f.post({ action: 'clear-collection-load-schedule', loadId: scheduled.id, expectedLoadVersion: scheduled.version });
  assert.equal(closed.response.status, 422); assert.equal(f.writes, lifecycleWrites); assert.deepEqual([...f.records], lifecycleBefore);
  r2.status = 'planned';
  const clear = await f.post({ action: 'clear-collection-load-schedule', loadId: scheduled.id, expectedLoadVersion: scheduled.version });
  assert.equal(clear.response.status, 200, JSON.stringify(clear.body));
  assert.equal(Object.hasOwn(clear.body, 'collectionScheduledTime'), false); assert.equal(Object.hasOwn(clear.body, 'collectionScheduledEnd'), false);
  assert.equal(clear.body.collectionRunId, 'r2'); assert.equal(clear.body.scheduledTime, '10:30'); assert.equal(clear.body.scheduledEnd, '11:30');
  assert.equal(assignments(f).length, 1); assert.equal(Object.hasOwn(setCollection.body, 'collectionScheduledEnd'), true);
});

test('projected end-only resize rejects a conflict and stale start without writes', async () => {
  const f = await assigned(); const load = loads(f)[0];
  f.seed('fikaLogisticsDeliveryLoadsV1', 'other-load', { ...load, id: 'other-load', destinationOplocId: 'other-site', scheduledTime: '10:45', scheduledEnd: '11:15', version: 1 });
  const before = structuredClone([...f.records]); const writes = f.writes;
  const conflict = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:30', scheduledEnd: '11:45', targetRunId: 'r1', resizeEndOnly: true });
  assert.equal(conflict.response.status, 409, JSON.stringify(conflict.body)); assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  const changedStart = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45', scheduledEnd: '11:00', targetRunId: 'r1', resizeEndOnly: true });
  assert.equal(changedStart.response.status, 409); assert.equal(f.writes, writes);
});

test('projected delivery explicit collision at 23:30 rejects without invalid settlement', async () => {
  const f = await assigned(); const load = loads(f)[0];
  f.seed('fikaLogisticsDeliveryLoadsV1', 'edge-conflict', { ...load, id: 'edge-conflict', destinationOplocId: 'other-site', scheduledTime: '23:30', scheduledEnd: '23:45', version: 1 });
  const before = structuredClone([...f.records]); const writes = f.writes;
  const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '23:30', scheduledEnd: '23:45', targetRunId: 'r1' });
  assert.equal(result.response.status, 409, JSON.stringify(result.body));
  assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  assertPersistedWindowsValid(f);
});

test('projected fixed-start resize allows 23:45 and rejects any later explicit end', async () => {
  const f = await assigned(); const load = loads(f)[0];
  const valid = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: load.scheduledTime, scheduledEnd: '23:45', targetRunId: 'r1', resizeEndOnly: true });
  assert.equal(valid.response.status, 200, JSON.stringify(valid.body));
  assert.equal(valid.body.scheduledTime, load.scheduledTime); assert.equal(valid.body.scheduledEnd, '23:45');
  const updated = loads(f)[0]; const before = structuredClone([...f.records]); const writes = f.writes;
  const beyond = await f.post({ action: 'reschedule-delivery-load', loadId: updated.id, expectedLoadVersion: updated.version, scheduledTime: updated.scheduledTime, scheduledEnd: '23:46', targetRunId: 'r1', resizeEndOnly: true });
  assert.equal(beyond.response.status, 422); assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
  assertPersistedWindowsValid(f);
});
