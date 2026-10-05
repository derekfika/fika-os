const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');
for (const both of [false, true]) {
  test('R1 shared job assignment ' + (both ? 'allowed for both vehicles' : 'denied for van1 only'), async () => {
    const f = fixture(both ? ['van1', 'van2'] : ['van1']);
    const job = { ...f.records.get('fikaLogisticsJobsV1/jl1'), id: 'shared-job', destinationOplocId: 'shared-site' };
    f.seed('fikaLogisticsJobsV1', job.id, job); await f.rebuild(); const before = f.writes;
    const result = await f.post({ action: 'assign-job-to-load', jobId: job.id, targetRunId: 'r1', scheduledTime: '10:00', expectedJobVersion: 1, expectedLoadVersions: { l1: 1 } });
    assert.equal(result.response.status, both ? 200 : 403);
    if (!both) assert.equal(f.writes, before);
  });
  for (const action of ['assign-group', 'assign']) test('R1 shared native requirement ' + action + ' ' + (both ? 'allowed' : 'denied'), async () => {
    const f = fixture(both ? ['van1', 'van2'] : ['van1']);
    f.requirements.push({ canonicalId: 'shared-requirement', sourceDomain: 'cpu-production', sourceEntityId: 'test-order', sourceVersion: 1, serviceDate: f.date, status: 'ready_for_planning', destinationOplocId: 'shared-site', destinationLabelSnapshot: 'Shared site', lines: [] });
    const before = f.writes;
    const result = await f.post({ action, runId: 'r1', expectedRunVersion: 1, plannedArrivalTime: '10:00', requirementId: action === 'assign' ? 'shared-requirement' : undefined, expectedSourceVersion: 1, requirementIds: action === 'assign-group' ? ['shared-requirement'] : undefined, expectedSourceVersions: { 'shared-requirement': 1 } });
    assert.equal(result.response.status, both ? 200 : 403);
    if (!both) assert.equal(f.writes, before);
  });
  test('R1 shared open movement ' + (both ? 'allowed' : 'denied'), async () => {
    const f = fixture(both ? ['van1', 'van2'] : ['van1']);
    f.seed('fikaLogisticsMovementRequestsV1', 'shared-movement', { canonicalId: 'shared-movement', serviceDate: f.date, type: 'delivery', toAddress: 'Reviewed one-off address', status: 'open', version: 1, items: [], audit: [] });
    const before = f.writes;
    const result = await f.post({ action: 'assign', runId: 'r1', movementId: 'shared-movement', expectedRunVersion: 1 });
    assert.equal(result.response.status, both ? 200 : 403);
    if (!both) assert.equal(f.writes, before);
  });
}
test('R1 van1 assigned job remains manageable by van1 operator', async () => {
  const f = fixture(); await f.rebuild();
  assert.equal((await f.post({ action: 'assign-job-to-load', jobId: 'jl1', targetRunId: 'r1', scheduledTime: '10:00', expectedJobVersion: 1, expectedLoadVersions: { l1: 1 } })).response.status, 200);
});
test('R1 previously assigned native requirement remains manageable on van1', async () => {
  const f = fixture(); const requirement = { canonicalId: 'owned-requirement', sourceDomain: 'cpu-production', sourceEntityId: 'test-order', sourceVersion: 1, serviceDate: f.date, status: 'ready_for_planning', destinationOplocId: 'site:s1', destinationLabelSnapshot: 's1', lines: [] };
  f.requirements.push(requirement); f.records.get('fikaLogisticsDeliveryStopsV1/s1').requirementRefs = [{ requirementId: requirement.canonicalId, sourceVersion: 1 }];
  assert.equal((await f.post({ action: 'schedule-stop', runId: 'r1', stopId: 's1', plannedArrivalTime: '10:00', expectedStopVersion: 1, expectedRunVersion: 1 })).response.status, 200);
});
test('R1 ownership removed after preflight cannot be replaced with proposed job assignment', async () => {
  const f = fixture(); await f.rebuild(); const before = f.writes;
  f.beforeNextTransaction(() => f.records.delete('fikaLogisticsAssignmentsV1/jl1:l1'));
  assert.equal((await f.post({ action: 'assign-job-to-load', jobId: 'jl1', targetRunId: 'r1', scheduledTime: '10:00', expectedJobVersion: 1, expectedLoadVersions: { l1: 1 } })).response.status, 403);
  assert.equal(f.writes, before);
});
async function assignedDriver(f) {
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:driver', expectedRunVersion: 1 })).response.status, 200);
}
test('R1 native ownership removed after preflight cannot be replaced by a proposed stop', async () => {
  const f = fixture(); f.seed('fikaLogisticsDeliveryRunsV1', 'r3', f.run('r3', 'van1'));
  const requirement = { canonicalId: 'race-requirement', sourceDomain: 'cpu-production', sourceEntityId: 'test-order', sourceVersion: 1, serviceDate: f.date, status: 'ready_for_planning', destinationOplocId: 'site:race', destinationLabelSnapshot: 'Race site', lines: [] };
  f.requirements.push(requirement); f.records.get('fikaLogisticsDeliveryStopsV1/s1').requirementRefs = [{ requirementId: requirement.canonicalId, sourceVersion: 1 }];
  f.beforeNextTransaction(() => { f.records.get('fikaLogisticsDeliveryStopsV1/s1').requirementRefs = []; });
  const before = f.writes;
  assert.equal((await f.post({ action: 'assign-group', runId: 'r3', requirementIds: [requirement.canonicalId], expectedSourceVersions: { [requirement.canonicalId]: 1 }, expectedRunVersion: 1, plannedArrivalTime: '10:00' })).response.status, 403);
  assert.equal(f.writes, before);
});
test('R1 movement ownership removed after preflight cannot be replaced by a proposed stop', async () => {
  const f = fixture(); f.records.get('fikaLogisticsDeliveryStopsV1/s1').movementRequestIds = ['race-movement'];
  f.seed('fikaLogisticsMovementRequestsV1', 'race-movement', { canonicalId: 'race-movement', serviceDate: f.date, type: 'delivery', toAddress: 'Reviewed one-off address', status: 'open', version: 1, items: [], audit: [] });
  f.beforeNextTransaction(() => { f.records.get('fikaLogisticsDeliveryStopsV1/s1').movementRequestIds = []; });
  const before = f.writes;
  assert.equal((await f.post({ action: 'assign', runId: 'r1', movementId: 'race-movement', expectedRunVersion: 1 })).response.status, 403);
  assert.equal(f.writes, before);
});
test('R2 revoked driver blocks Ready, preserves snapshot and permits eligible replacement', async () => {
  const f = fixture(); await assignedDriver(f); f.deactivateDriver();
  const snapshot = structuredClone(f.records.get('fikaLogisticsDeliveryRunsV1/r1')); const before = f.writes;
  const rejected = await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 2, driverLabel: 'Forged eligible label' });
  assert.equal(rejected.response.status, 422); assert.match(JSON.stringify(rejected.body), /no longer eligible.*Reassign/);
  assert.deepEqual(f.records.get('fikaLogisticsDeliveryRunsV1/r1'), snapshot); assert.equal(f.writes, before);
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:replacement', expectedRunVersion: 2 })).response.status, 200);
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 3 })).response.status, 200);
});
test('R2 revoked driver blocks Dispatch after valid Ready and preserves history', async () => {
  const f = fixture(); await assignedDriver(f);
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 2 })).response.status, 200);
  f.records.get('fikaLogisticsDeliveryStopsV1/s1').loaded = true; f.deactivateDriver();
  const snapshot = structuredClone(f.records.get('fikaLogisticsDeliveryRunsV1/r1'));
  assert.equal((await f.post({ action: 'dispatch-run', runId: 'r1', expectedRunVersion: 3 })).response.status, 422);
  assert.deepEqual(f.records.get('fikaLogisticsDeliveryRunsV1/r1'), snapshot);
});
test('R2 driver revoked between preflight and Ready transaction is rejected', async () => {
  const f = fixture(); await assignedDriver(f); f.beforeNextTransaction(() => f.deactivateDriver());
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 2 })).response.status, 422);
});
test('R2 already-dispatched execution remains allowed after driver revocation', async () => {
  const f = fixture(); await assignedDriver(f);
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 2 })).response.status, 200);
  f.records.get('fikaLogisticsDeliveryStopsV1/s1').loaded = true;
  assert.equal((await f.post({ action: 'dispatch-run', runId: 'r1', expectedRunVersion: 3 })).response.status, 200);
  f.deactivateDriver(); f.records.get('fikaLogisticsDeliveryStopsV1/s1').status = 'completed'; f.records.get('fikaLogisticsDeliveryRunsV1/r1').returnToCpuRequired = false; f.records.get('fikaLogisticsJobsV1/jl1').deliveryStatus = 'delivered'; f.records.get('fikaLogisticsDeliveryLoadsV1/l1').status = 'delivered';
  assert.equal((await f.post({ action: 'complete-run', runId: 'r1', expectedRunVersion: 4 })).response.status, 200);
  assert.equal(f.records.get('fikaLogisticsDeliveryRunsV1/r1').driverLabel, 'Governed Driver');
});
test('ownership changed after preflight is rejected before transactional writes', async () => {
  const f = fixture(); const before = f.writes;
  f.beforeNextTransaction(() => { f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId = 'van2'; });
  const result = await f.post({ action: 'set-run-return-required', runId: 'r1', returnToCpuRequired: false, expectedRunVersion: 1 });
  assert.equal(result.response.status, 403); assert.equal(f.writes, before);
});
for (const mode of ['', 'projection=1', 'changesSince=1', 'weekSummary=1', 'weekCommencing=2099-01-05', 'planningAttention=1', 'syncHead=1']) test('restricted omitted vehicle query is safe: ' + (mode || 'normal day'), async () => {
  const f = fixture(); await f.rebuild(); const { response, body } = await f.get(mode);
  assert.equal(response.status, 200);
  const json = JSON.stringify(body);
  for (const secret of ['"r2"', '"s2"', '"l2"', 'order:l2']) assert.ok(!json.includes(secret), secret + ' leaked');
  if (mode === 'changesSince=1') { assert.deepEqual(body.changes, []); assert.ok(body.nextCursor >= 1); }
});
test('explicit van1 allowed; van2 denied; both principals see both', async () => {
  const f = fixture(); await f.rebuild(); assert.equal((await f.get('projection=1&vehicle=van1')).response.status, 200); assert.equal((await f.get('projection=1&vehicle=van2')).response.status, 403);
  const both = fixture(['van1', 'van2']); await both.rebuild(); assert.equal((await both.get('projection=1')).body.projection.runs.length, 2);
});
for (const ids of [[], ['truck1']]) test('empty or invalid authority cannot use omitted query: ' + JSON.stringify(ids), async () => {
  const f = fixture(ids); assert.equal((await f.get()).response.status, 403); assert.equal((await f.drivers()).response.status, 403);
});
for (const body of [
  { action: 'set-run-return-required', runId: 'r2', returnToCpuRequired: false, expectedRunVersion: 1 },
  { action: 'schedule-stop', runId: 'r1', stopId: 's2', plannedArrivalTime: '10:00', expectedRunVersion: 1, expectedStopVersion: 1 },
  { action: 'mark-delivery-load-loaded', loadId: 'l2' },
  { action: 'mark-stop-loaded', stopId: 'projection-stop:delivery:l2', loaded: true },
  { action: 'move-stop', runId: 'r1', stopId: 's1', targetRunId: 'r2', expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 },
  { action: 'move-stop', runId: 'r2', stopId: 's2', targetRunId: 'r1', expectedRunVersion: 1, expectedTargetRunVersion: 1, expectedStopVersion: 1 },
  { action: 'remove-job-from-load', jobId: 'jl2' },
  { action: 'assign-job-to-load', jobId: 'jl1', targetRunId: 'r2' },
  { action: 'set-run-driver', runId: 'r2', driverId: 'person:driver', expectedRunVersion: 1 },
  { action: 'reorder', runId: 'r1', stopIds: ['s2'], expectedRunVersion: 1 },
]) test('actual POST rejects forged resource: ' + JSON.stringify(body), async () => {
  const f = fixture(); await f.rebuild(); const before = f.writes; const result = await f.post(body);
  assert.equal(result.response.status, body.action === 'reorder' ? 422 : 403); assert.equal(f.writes, before);
});
test('unauthorized collection run withheld and mutations rejected', async () => {
  const f = fixture(); Object.assign(f.records.get('fikaLogisticsDeliveryLoadsV1/l1'), { collectionRunId: 'r2', collectionRequired: true }); await f.rebuild();
  assert.ok(!(await f.get('projection=1')).body.projection.deliveryLoads.some(load => load.id === 'l1'));
  assert.equal((await f.post({ action: 'mark-delivery-load-loaded', loadId: 'l1' })).response.status, 403);
  assert.equal((await f.post({ action: 'reschedule-delivery-load', loadId: 'l1', collectionRunId: 'r2', lane: 'collection', scheduledTime: '11:00' })).response.status, 403);
});
test('display spoof and legacy labels never grant authority; mismatched load fails closed', async () => {
  const f = fixture(); f.records.get('fikaLogisticsDeliveryRunsV1/r2').vehicleLabel = 'Van 1';
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r2', driverId: 'person:driver', expectedRunVersion: 1 })).response.status, 403);
  delete f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId;
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:driver', expectedRunVersion: 1 })).response.status, 409);
  const g = fixture(['van1', 'van2']); g.records.get('fikaLogisticsDeliveryLoadsV1/l1').vehicleId = 'van2';
  assert.equal((await g.post({ action: 'mark-delivery-load-loaded', loadId: 'l1' })).response.status, 409);
});
for (const action of ['reset-planning-day', 'repair-logistics-assignment-dates', 'repair-run-vehicle-identity', 'rebuild-logistics-projection', 'reconcile-logistics-day', 'save-logistics-job']) test('ordinary vehicle authority cannot invoke maintenance: ' + action, async () => {
  const f = fixture(['van1', 'van2']); const before = f.writes;
  assert.equal((await f.post({ action, serviceDate: f.date })).response.status, 403); assert.equal(f.writes, before);
});
test('reviewed legacy mapping requires repair authority, stable ID and CAS', async () => {
  const f = fixture([], ['logistics.repair']); delete f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId;
  assert.equal((await f.post({ action: 'repair-run-vehicle-identity', runId: 'r1', vehicleId: 'van1', expectedRunVersion: 99 })).response.status, 409);
  const mapped = await f.post({ action: 'repair-run-vehicle-identity', runId: 'r1', vehicleId: 'van1', expectedRunVersion: 1 });
  assert.equal(mapped.response.status, 200); assert.equal(mapped.body.vehicleId, 'van1');
  assert.equal((await f.post({ action: 'repair-run-vehicle-identity', runId: 'r1', vehicleId: 'van2', expectedRunVersion: 2 })).response.status, 409);
});
test('explicit organisation maintenance authority is accepted without vehicle access', async () => {
  const f = fixture([], ['logistics.reset', 'logistics.repair', 'logistics.reconcile']);
  assert.equal((await f.post({ action: 'reset-planning-day', serviceDate: f.date })).response.status, 200);
  assert.equal((await f.post({ action: 'repair-logistics-assignment-dates' })).response.status, 200);
  assert.equal((await f.post({ action: 'rebuild-logistics-projection', serviceDate: f.date })).response.status, 200);
});
test('fresh catalogue, create and existing-run assignment use governed name', async () => {
  const f = fixture(); const catalogue = await f.drivers(); assert.equal(catalogue.response.status, 200); assert.equal(catalogue.body.drivers[0].driverId, 'person:driver');
  const created = await f.post({ action: 'create-run', run: { ...f.run('new-run', 'van1'), driverId: 'person:driver', driverLabel: 'FORGED LABEL' } });
  assert.equal(created.response.status, 200); assert.equal(created.body.driverLabel, 'Governed Driver');
  const assigned = await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:driver', driverLabel: 'FORGED LABEL', expectedRunVersion: 1 });
  assert.equal(assigned.response.status, 200); assert.equal(assigned.body.driverLabel, 'Governed Driver');
  const ready = await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 2 }); assert.equal(ready.response.status, 200);
});
test('arbitrary/revoked driver rejected; historical snapshot preserved', async () => {
  const f = fixture();
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'forged', expectedRunVersion: 1 })).response.status, 422);
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:driver', expectedRunVersion: 1 })).response.status, 200);
  f.deactivateDriver(); assert.ok(!(await f.drivers()).body.drivers.some(driver => driver.driverId === 'person:driver'));
  assert.equal((await f.post({ action: 'set-run-driver', runId: 'r1', driverId: 'person:driver', driverLabel: 'Governed Driver', expectedRunVersion: 2 })).response.status, 422);
  assert.equal((await f.post({ action: 'create-run', run: { ...f.run('revoked-run', 'van1'), driverId: 'person:driver' } })).response.status, 422);
  assert.equal(f.records.get('fikaLogisticsDeliveryRunsV1/r1').driverLabel, 'Governed Driver');
});
test('driver valid for van1 cannot be newly assigned to van2', async () => {
  const f = fixture(['van1', 'van2']); assert.equal((await f.post({ action: 'set-run-driver', runId: 'r2', driverId: 'person:driver', expectedRunVersion: 1 })).response.status, 422);
});
test('update-run cannot trust driver label or change to unauthorized vehicle', async () => {
  const f = fixture();
  assert.equal((await f.post({ action: 'update-run', run: { ...f.run('r1', 'van2'), driverId: 'person:driver' }, expectedRunVersion: 1 })).response.status, 403);
  const result = await f.post({ action: 'update-run', run: { ...f.run('r1', 'van1'), driverId: 'person:driver', driverLabel: 'FORGED' }, expectedRunVersion: 1 });
  assert.equal(result.response.status, 200); assert.equal(result.body.driverLabel, 'Governed Driver');
});
