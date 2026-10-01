const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');
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
  assert.equal(result.response.status, 403); assert.equal(f.writes, before);
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
  f.deactivateDriver(); assert.equal((await f.drivers()).body.drivers.length, 0);
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
