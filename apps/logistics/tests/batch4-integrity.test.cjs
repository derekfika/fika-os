const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');

function fresh() {
  const f = fixture(['van1', 'van2'], [], true);
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
