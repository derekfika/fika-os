const assert = require('node:assert/strict');
const test = require('node:test');
const { fixture } = require('./helpers/authority-route-harness.cjs');

test('run-integrity diagnostic remains denied without logistics.repair', async () => {
  const f = fixture([], []);
  const before = f.writes;
  const { response, body } = await f.get('diagnostic=1');
  assert.equal(response.status, 403);
  assert.equal(body.error?.code, 'LOGISTICS_RESOURCE_DENIED');
  assert.equal(f.writes, before);
});

test('repair authority receives raw, date-bounded run-integrity evidence without writes', async () => {
  const f = fixture([], ['logistics.repair']);
  const otherDate = '2099-01-06';
  f.seed('fikaLogisticsDeliveryRunsV1', 'other-run', { ...f.run('other-run', 'van1'), serviceDate: otherDate });
  f.seed('fikaLogisticsDeliveryStopsV1', 'other-stop', { canonicalId: 'other-stop', runId: 'other-run', requirementRefs: [], movementRequestIds: [], serviceDate: otherDate });
  f.seed('fikaLogisticsJobsV1', 'other-job', { id: 'other-job', serviceDate: otherDate });
  f.seed('fikaLogisticsDeliveryLoadsV1', 'other-load', { id: 'other-load', runId: 'other-run', serviceDate: otherDate, status: 'planned' });
  f.seed('fikaLogisticsAssignmentsV1', 'other-assignment', { jobId: 'other-job', loadId: 'other-load', serviceDate: otherDate });
  f.seed('fikaLogisticsMovementRequestsV1', 'other-movement', { canonicalId: 'other-movement', serviceDate: otherDate, type: 'delivery', items: [] });
  f.seed('fikaLogisticsDeliveryStopsV1', 'foreign-date-stop', { canonicalId: 'foreign-date-stop', runId: 'r1', serviceDate: otherDate, requirementRefs: [], movementRequestIds: [] });
  f.seed('fikaLogisticsDeliveryStopsV1', 'orphan-day-stop', { canonicalId: 'orphan-day-stop', serviceDate: f.date, requirementRefs: [], movementRequestIds: [] });
  f.seed('fikaLogisticsAssignmentsV1', 'foreign-date-assignment', { jobId: 'other-job', loadId: 'l1', serviceDate: otherDate });
  f.records.get('fikaLogisticsDeliveryStopsV1/s1').movementRequestIds = ['day-movement'];
  f.seed('fikaLogisticsMovementRequestsV1', 'day-movement', { canonicalId: 'day-movement', serviceDate: f.date, type: 'collection', items: [] });
  const before = f.writes;

  const { response, body } = await f.get('diagnostic=1');

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store, max-age=0');
  assert.deepEqual(body.runIntegrity.entityCounts, { runs: 2, stops: 3, jobs: 2, loads: 2, assignments: 2, movements: 1 });
  assert.deepEqual(body.runIntegrity.runs.map(run => run.canonicalId).sort(), ['r1', 'r2']);
  assert.deepEqual(body.runIntegrity.runs[0].movements, [{ id: 'day-movement', type: 'collection' }]);
  assert.ok(!JSON.stringify(body).includes('other-run'));
  assert.ok(!JSON.stringify(body).includes('other-load'));
  assert.ok(!JSON.stringify(body).includes('other-movement'));
  assert.ok(!JSON.stringify(body).includes('foreign-date-stop'));
  assert.ok(!JSON.stringify(body).includes('foreign-date-assignment'));
  assert.ok(!JSON.stringify(body).includes('orphan-day-stop'));
  assert.ok(f.queries.length > 0);
  assert.ok(f.queries.every(query => query.filters.length > 0), 'diagnostic must not issue an unbounded collection query');
  assert.equal(f.writes, before);
});

test('run-integrity diagnostic preserves missing and invalid vehicle identities', async () => {
  const f = fixture([], ['logistics.repair']);
  delete f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId;
  f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleLabel = 'Van 1';
  f.records.get('fikaLogisticsDeliveryRunsV1/r2').vehicleId = 'van-2';

  const { response, body } = await f.get('diagnostic=1');

  assert.equal(response.status, 200);
  const byId = new Map(body.runIntegrity.runs.map(run => [run.canonicalId, run]));
  assert.equal(byId.get('r1').vehicleId, null);
  assert.equal(byId.get('r1').vehicleIdPresent, false);
  assert.equal(byId.get('r1').validVehicleId, false);
  assert.equal(byId.get('r1').legacyVehicleEvidence.vehicleLabel, 'Van 1');
  assert.equal(Object.hasOwn(byId.get('r1').legacyVehicleEvidence, 'vehicleId'), false);
  assert.equal(byId.get('r2').vehicleId, 'van-2');
  assert.equal(byId.get('r2').validVehicleId, false);
});

test('ordinary Logistics GET does not expose administrative raw evidence', async () => {
  const f = fixture(['van1'], []);
  await f.rebuild();
  const { response, body } = await f.get();
  assert.equal(response.status, 200);
  assert.equal(Object.hasOwn(body, 'runIntegrity'), false);
  assert.equal(JSON.stringify(body).includes('legacyVehicleEvidence'), false);
});
