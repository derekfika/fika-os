const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');

function fresh(permittedVehicleIds = ['van1', 'van2']) {
  const f = fixture(permittedVehicleIds, [], true);
  f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith('fikaLogisticsDeliveryRunsV1/')) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  f.seed('fikaLogisticsDeliveryStopsV1', 's1', stop('s1', 'r1', 1));
  f.seed('fikaLogisticsDeliveryStopsV1', 's2', stop('s2', 'r2', 1));
  f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['s1'];
  f.records.get('fikaLogisticsDeliveryRunsV1/r2').orderedStopIds = ['s2'];
  return f;
}
const values = (f, collection) => [...f.records].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => structuredClone(value));
const jobs = f => values(f, 'fikaLogisticsJobsV1');
const loads = f => values(f, 'fikaLogisticsDeliveryLoadsV1');
const requirements = (f, id = 'a') => ({ canonicalId: 'req:' + id, sourceDomain: 'cpu-production', sourceEntityId: 'order:' + id, sourceVersion: 1, sourceContentHash: 'hash:' + id, serviceDate: f.date, productionLocationId: 'cpu', destinationOplocId: 'site:' + id, destinationLabelSnapshot: 'Site ' + id, requiredDeliveryWindow: { startTime: '10:00', endTime: '11:00' }, lines: [{ displayNameSnapshot: 'Lunch', quantity: 2, unit: 'portion' }], status: 'ready_for_planning' });
async function canonicalJob(f, id = 'a') { f.requirements.push(requirements(f, id)); await f.materialisation.reconcileLogisticsDay(f.date, 'Operator'); return jobs(f).find(job => job.requirementId === 'req:' + id); }
async function assign(f, job, extra = {}) { return f.post({ action: 'assign-job-to-load', jobId: job.id, targetRunId: 'r1', scheduledTime: '10:30', expectedJobVersion: job.version, expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), ...extra }); }
async function assigned() { const f = fresh(); const job = await canonicalJob(f); const response = await assign(f, job); assert.equal(response.response.status, 200, JSON.stringify(response.body)); return f; }
function stop(id, runId, sequence, overrides = {}) { return { canonicalId: id, runId, sequence, locationOplocId: 'site:' + id, locationLabelSnapshot: id, requirementRefs: [], movementRequestIds: [], status: 'planned', version: 1, createdAt: 'now', updatedAt: 'now', audit: [], ...overrides }; }
function movement(id, type = 'transfer') { return { canonicalId: id, entityType: 'Movement Request', type, serviceDate: '2099-01-05', fromOplocId: 'site:pickup', toOplocId: 'site:dropoff', items: [], createdBy: 'Operator', status: 'planned', version: 1, createdAt: 'now', updatedAt: 'now', audit: [] }; }

for (const status of ['ready', 'dispatched', 'completed']) test(`A6-R assignment rejects ${status} owner without writes`, async () => {
  const f = fresh(); const job = await canonicalJob(f); f.records.get('fikaLogisticsDeliveryRunsV1/r1').status = status;
  const before = f.writes; const result = await assign(f, job);
  assert.equal(result.response.status, 422); assert.equal(f.writes, before); assert.equal(values(f, 'fikaLogisticsAssignmentsV1').length, 0);
});
test('A6-R assignment into planned owner succeeds', async () => { const f = fresh(); const job = await canonicalJob(f); assert.equal((await assign(f, job)).response.status, 200); assert.equal(values(f, 'fikaLogisticsAssignmentsV1').length, 1); });
test('A6-R planned-to-planned reschedule succeeds and dispatched current owner rejects without writes', async () => {
  const f = await assigned(); const load = loads(f)[0];
  assert.equal((await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45', targetRunId: 'r1' })).response.status, 200);
  const current = loads(f)[0]; f.records.get('fikaLogisticsDeliveryRunsV1/r1').status = 'dispatched'; const before = f.writes;
  const result = await f.post({ action: 'reschedule-delivery-load', loadId: current.id, expectedLoadVersion: current.version, scheduledTime: '10:50', targetRunId: 'r1' });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
});
test('A6-R reschedule into dispatched proposed owner rejects without writes', async () => {
  const f = await assigned(); const load = loads(f)[0]; const target = structuredClone(f.records.get('fikaLogisticsDeliveryRunsV1/r2')); target.vehicleId = 'van1'; target.status = 'dispatched'; f.seed('fikaLogisticsDeliveryRunsV1', 'r3', { ...target, canonicalId: 'r3', status: 'dispatched' });
  const before = f.writes; const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45', targetRunId: 'r3' });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
});
test('A6-R collection reschedule checks its separate current owner', async () => {
  const f = await assigned(); const load = loads(f)[0]; Object.assign(f.records.get('fikaLogisticsDeliveryLoadsV1/' + load.id), { collectionRequired: true, collectionRunId: 'r2', collectionScheduledTime: '14:00' }); f.records.get('fikaLogisticsDeliveryRunsV1/r2').status = 'dispatched';
  const before = f.writes; const result = await f.post({ action: 'reschedule-delivery-load', lane: 'collection', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '14:30', targetRunId: 'r1' });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
});
test('A6-R removal from planned load succeeds; dispatched delivery owner rejects without writes', async () => {
  const f = await assigned(); const job = jobs(f)[0], load = loads(f)[0];
  const removed = await f.post({ action: 'remove-job-from-load', jobId: job.id, expectedJobVersion: job.version, expectedLoadVersion: load.version });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  const g = await assigned(); const currentJob = jobs(g)[0], currentLoad = loads(g)[0]; g.records.get('fikaLogisticsDeliveryRunsV1/r1').status = 'dispatched'; const before = g.writes;
  const denied = await g.post({ action: 'remove-job-from-load', jobId: currentJob.id, expectedJobVersion: currentJob.version, expectedLoadVersion: currentLoad.version });
  assert.equal(denied.response.status, 422); assert.equal(g.writes, before);
});
test('A7 identifies both persisted transfer leg movement types and blocks either independent move', async () => {
  for (const [id, movementType] of [['pickup', 'collection'], ['dropoff', 'delivery']]) {
    const f = fresh(); const transferId = 'transfer:' + id; f.seed('fikaLogisticsMovementRequestsV1', transferId, movement(transferId));
    const pickup = stop('pickup', 'r1', 1, { movementType: 'collection', movementRequestIds: [transferId] }); const dropoff = stop('dropoff', 'r1', 2, { movementType: 'delivery', movementRequestIds: [transferId] });
    f.seed('fikaLogisticsDeliveryStopsV1', 'pickup', pickup); f.seed('fikaLogisticsDeliveryStopsV1', 'dropoff', dropoff); f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['pickup', 'dropoff'];
    const before = f.writes; const result = await f.post({ action: 'move-stop', runId: 'r1', targetRunId: 'r2', stopId: id, expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 });
    assert.equal(result.response.status, 422, JSON.stringify(result.body)); assert.equal(f.writes, before);
  }
});
test('A7 ordinary stop still moves within the same service date', async () => {
  const f = fresh(); const before = f.writes; const result = await f.post({ action: 'move-stop', runId: 'r1', targetRunId: 'r2', stopId: 's1', expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 });
  assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.ok(f.writes > before); assert.equal(f.records.get('fikaLogisticsDeliveryStopsV1/s1').runId, 'r2');
});
test('A7 transfer schedule preserves pickup-before-dropoff and rejects either inversion', async () => {
  async function scheduled(action, time) {
    const f = fresh(); const transferId = 'transfer:schedule'; f.seed('fikaLogisticsMovementRequestsV1', transferId, movement(transferId));
    f.seed('fikaLogisticsDeliveryStopsV1', 'pickup', stop('pickup', 'r1', 1, { movementType: 'collection', movementRequestIds: [transferId], plannedArrivalTime: '09:00' }));
    f.seed('fikaLogisticsDeliveryStopsV1', 'dropoff', stop('dropoff', 'r1', 2, { movementType: 'delivery', movementRequestIds: [transferId], plannedArrivalTime: '10:00' }));
    f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['pickup', 'dropoff'];
    const before = f.writes; const result = await f.post({ action: 'schedule-stop', runId: 'r1', stopId: action === 'pickup' ? 'pickup' : 'dropoff', plannedArrivalTime: time, expectedRunVersion: 1, expectedStopVersion: 1 });
    return { f, before, result };
  }
  assert.equal((await scheduled('pickup', '09:00')).result.response.status, 200);
  const latePickup = await scheduled('pickup', '10:30'); assert.equal(latePickup.result.response.status, 422); assert.equal(latePickup.f.writes, latePickup.before);
  const earlyDropoff = await scheduled('dropoff', '08:30'); assert.equal(earlyDropoff.result.response.status, 422); assert.equal(earlyDropoff.f.writes, earlyDropoff.before);
});
test('A7 defer-stop and collection deferral both reject a persisted transfer leg', async () => {
  const f = fresh(); const id = 'transfer:defer'; f.seed('fikaLogisticsMovementRequestsV1', id, movement(id));
  f.seed('fikaLogisticsDeliveryStopsV1', 'pickup', stop('pickup', 'r1', 1, { movementType: 'collection', movementRequestIds: [id] }));
  f.seed('fikaLogisticsDeliveryStopsV1', 'dropoff', stop('dropoff', 'r1', 2, { movementType: 'delivery', movementRequestIds: [id] }));
  const sourceRun = f.records.get('fikaLogisticsDeliveryRunsV1/r1'); sourceRun.status = 'dispatched'; sourceRun.orderedStopIds = ['pickup', 'dropoff'];
  const before = f.writes;
  const result = await f.post({ action: 'defer-stop', runId: 'r1', stopId: 'pickup', expectedRunVersion: sourceRun.version, expectedStopVersion: 1 });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
  const collection = await f.post({ action: 'defer-collection', runId: 'r1', stopId: 'pickup', targetServiceDate: '2099-01-06', expectedRunVersion: sourceRun.version, expectedStopVersion: 1 });
  assert.equal(collection.response.status, 422); assert.equal(f.writes, before);
});
test('A10 ordinary cross-date move rejects without writes and same-date move remains valid', async () => {
  const f = fresh(); f.records.get('fikaLogisticsDeliveryRunsV1/r2').serviceDate = '2099-01-06'; const before = f.writes;
  const result = await f.post({ action: 'move-stop', runId: 'r1', targetRunId: 'r2', stopId: 's1', expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
  f.records.get('fikaLogisticsDeliveryRunsV1/r2').serviceDate = f.date;
  assert.equal((await f.post({ action: 'move-stop', runId: 'r1', targetRunId: 'r2', stopId: 's1', expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 })).response.status, 200);
});
test('A10 native collection defer publishes both source and target dates and is replay guarded', async () => {
  const f = fresh(); const targetDate = '2099-01-06';
  f.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection' })); f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['collect'];
  const payload = { action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: targetDate, expectedRunVersion: 1, expectedStopVersion: 1 };
  const result = await f.post(payload); assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.deepEqual(result.body.affectedServiceDates, [f.date, targetDate]);
  for (const date of [f.date, targetDate]) {
    const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + date);
    assert.equal(projection.serviceDate, date);
    assert.equal(projection.lastChangeSequence, result.body.changeCursors[date]);
  }
  const changeDocs = values(f, 'fikaLogisticsChangesV1');
  assert.ok(changeDocs.some(event => event.serviceDate === f.date && event.changeType === 'collection-postponed-out'));
  assert.ok(changeDocs.some(event => event.serviceDate === targetDate && event.changeType === 'collection-postponed-in'));
  const before = f.writes; const replay = await f.post(payload); assert.equal(replay.response.status, 409); assert.equal(f.writes, before);
});

test('A10 movement-backed collection defer moves canonical movement and both date projections', async () => {
  const f = fresh(); const targetDate = '2099-01-06'; const id = 'movement:collection-defer';
  const canonicalMovement = movement(id, 'collection');
  f.seed('fikaLogisticsMovementRequestsV1', id, canonicalMovement);
  f.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection', movementRequestId: id }));
  f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['collect'];
  const payload = { action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: targetDate, expectedRunVersion: 1, expectedStopVersion: 1 };
  const result = await f.post(payload);
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const saved = f.records.get('fikaLogisticsMovementRequestsV1/' + id);
  assert.equal(saved.serviceDate, targetDate);
  assert.equal(saved.canonicalId, id);
  assert.equal(saved.version, canonicalMovement.version + 1);
  assert.equal(saved.status, canonicalMovement.status);
  assert.equal(saved.audit.at(-1).action, 'collection-postponed');
  assert.equal(saved.audit.at(-1).version, saved.version);
  const sourceProjection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date);
  const targetProjection = f.records.get('fikaLogisticsDayProjectionsV1/' + targetDate);
  assert.equal(sourceProjection.stops.some(item => item.canonicalId === 'collect'), false);
  assert.equal(sourceProjection.movements.some(item => item.canonicalId === id), false);
  assert.ok(targetProjection.stops.some(item => item.canonicalId === 'collect'));
  assert.ok(targetProjection.movements.some(item => item.canonicalId === id));
  const targetStop = targetProjection.stops.find(item => item.canonicalId === 'collect');
  const planning = f.load(require('node:path').resolve(__dirname, '../lib/planning.ts'));
  assert.deepEqual(planning.movementsForStop(targetStop, targetProjection.movements).map(item => item.canonicalId), [id]);
  const beforeReplay = f.writes;
  const replay = await f.post(payload);
  assert.equal(replay.response.status, 409);
  assert.equal(f.writes, beforeReplay);
  assert.equal(values(f, 'fikaLogisticsDeliveryStopsV1').filter(item => item.canonicalId === 'collect').length, 1);
  assert.equal(values(f, 'fikaLogisticsMovementRequestsV1').filter(item => item.canonicalId === id).length, 1);
  assert.equal(values(f, 'fikaLogisticsDeliveryRunsV1').filter(item => item.canonicalId === `run:${targetDate}:deferred-collections:r1`).length, 1);
});

test('A10 movement-backed collection with an unexpected date or canonical identity fails without writes', async () => {
  const f = fresh(); const id = 'movement:wrong-source-date';
  f.seed('fikaLogisticsMovementRequestsV1', id, { ...movement(id, 'collection'), serviceDate: '2099-01-04' });
  f.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection', movementRequestIds: [id] }));
  const before = f.writes;
  const result = await f.post({ action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: '2099-01-06', expectedRunVersion: 1, expectedStopVersion: 1 });
  assert.equal(result.response.status, 409); assert.equal(f.writes, before);
  const g = fresh(); const mismatch = 'movement:canonical-mismatch';
  g.seed('fikaLogisticsMovementRequestsV1', mismatch, { ...movement(mismatch, 'collection'), canonicalId: 'movement:other' });
  g.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection', movementRequestIds: [mismatch] }));
  const beforeMismatch = g.writes;
  const inconsistent = await g.post({ action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: '2099-01-06', expectedRunVersion: 1, expectedStopVersion: 1 });
  assert.equal(inconsistent.response.status, 409); assert.equal(g.writes, beforeMismatch);
});

test('A10 movement-backed collection shared by another source-date stop fails without writes', async () => {
  const f = fresh(); const id = 'movement:shared-source-stop';
  f.seed('fikaLogisticsMovementRequestsV1', id, movement(id, 'collection'));
  f.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection', movementRequestIds: [id] }));
  f.seed('fikaLogisticsDeliveryStopsV1', 'also-collect', stop('also-collect', 'r2', 1, { movementType: 'collection', movementRequestIds: [id] }));
  const before = f.writes;
  const result = await f.post({ action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: '2099-01-06', expectedRunVersion: 1, expectedStopVersion: 1 });
  assert.equal(result.response.status, 409); assert.equal(f.writes, before);
});

test('A10 authorizes selected future owner before writes and accepts permitted vehicle scopes', async () => {
  async function deferWithScope(scope, targetVehicle) {
    const f = fresh(scope); const targetDate = '2099-01-06';
    const source = f.records.get('fikaLogisticsDeliveryRunsV1/r1'); source.driverId = 'person:shared-driver';
    const target = { ...f.run('target', targetVehicle), serviceDate: targetDate, driverId: 'person:shared-driver' };
    f.seed('fikaLogisticsDeliveryRunsV1', 'target', target);
    f.seed('fikaLogisticsDeliveryStopsV1', 'collect', stop('collect', 'r1', 1, { movementType: 'collection' }));
    source.orderedStopIds = ['collect'];
    const before = f.writes;
    const result = await f.post({ action: 'defer-collection', runId: 'r1', stopId: 'collect', targetServiceDate: targetDate, expectedRunVersion: 1, expectedStopVersion: 1 });
    return { f, before, result };
  }
  const denied = await deferWithScope(['van1'], 'van2');
  assert.equal(denied.result.response.status, 403); assert.equal(denied.f.writes, denied.before);
  assert.equal(denied.f.records.get('fikaLogisticsDeliveryStopsV1/collect').runId, 'r1');
  const permitted = await deferWithScope(['van1'], 'van1');
  assert.equal(permitted.result.response.status, 200, JSON.stringify(permitted.result.body));
  assert.equal(permitted.f.records.get('fikaLogisticsDeliveryStopsV1/collect').runId, 'target');
  const planner = await deferWithScope(['van1', 'van2'], 'van2');
  assert.equal(planner.result.response.status, 200, JSON.stringify(planner.result.body));
  assert.equal(planner.f.records.get('fikaLogisticsDeliveryStopsV1/collect').runId, 'target');
});

for (const [label, ids] of [['duplicate', ['s1', 's1']], ['omitted', ['s1']], ['unknown', ['s1', 's2', 'unknown']], ['foreign-run', ['s1', 's2']]]) test(`A11 reorder rejects ${label} IDs without writes`, async () => {
  const f = fresh(); f.seed('fikaLogisticsDeliveryStopsV1', 's3', stop('s3', 'r1', 2)); f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['s1', 's3'];
  const before = f.writes; const result = await f.post({ action: 'reorder', runId: 'r1', stopIds: ids, expectedRunVersion: 1 });
  assert.equal(result.response.status, 422); assert.equal(f.writes, before);
});
test('A11 reorder rejects non-string IDs and a non-array payload without writes', async () => {
  for (const stopIds of [['s1', 17], 's1,s3']) {
    const f = fresh(); f.seed('fikaLogisticsDeliveryStopsV1', 's3', stop('s3', 'r1', 2)); const before = f.writes;
    const result = await f.post({ action: 'reorder', runId: 'r1', stopIds, expectedRunVersion: 1 });
    assert.equal(result.response.status, 422); assert.equal(f.writes, before);
  }
});
test('A11 exact reverse reorder of unrelated stops succeeds', async () => {
  const f = fresh(); f.seed('fikaLogisticsDeliveryStopsV1', 's3', stop('s3', 'r1', 2)); const result = await f.post({ action: 'reorder', runId: 'r1', stopIds: ['s3', 's1'], expectedRunVersion: 1 });
  assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.deepEqual(result.body.orderedStopIds, ['s3', 's1']);
});
test('A11 exact permutation validates transfer order, stale CAS and lifecycle', async () => {
  const f = fresh(); const id = 'transfer:reorder'; f.seed('fikaLogisticsMovementRequestsV1', id, movement(id));
  f.seed('fikaLogisticsDeliveryStopsV1', 'pickup', stop('pickup', 'r1', 1, { movementType: 'collection', movementRequestIds: [id] }));
  f.seed('fikaLogisticsDeliveryStopsV1', 'dropoff', stop('dropoff', 'r1', 2, { movementType: 'delivery', movementRequestIds: [id] }));
  const before = f.writes; const invalid = await f.post({ action: 'reorder', runId: 'r1', stopIds: ['dropoff', 'pickup'], expectedRunVersion: 1 });
  assert.equal(invalid.response.status, 422); assert.equal(f.writes, before);
  assert.equal((await f.post({ action: 'reorder', runId: 'r1', stopIds: ['pickup', 'dropoff'], expectedRunVersion: 99 })).response.status, 409);
  f.records.get('fikaLogisticsDeliveryRunsV1/r1').status = 'dispatched';
  assert.equal((await f.post({ action: 'reorder', runId: 'r1', stopIds: ['pickup', 'dropoff'], expectedRunVersion: 1 })).response.status, 422);
});
