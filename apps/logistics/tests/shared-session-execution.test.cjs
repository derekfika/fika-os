const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');
const { setup, jobs, loads, run, execute, lifecycle } = require('./helpers/execution-fixture.cjs');
const ok = result => assert.equal(result.response.status, 200, JSON.stringify(result.body));

test('shared operational session completes delivery, collection and return without a driver login/grant', async () => {
  const f = await setup({ sharedSession: true, collection: true });
  assert.equal(run(f).driverId, undefined);
  ok(await lifecycle(f, 'mark-run-ready'));
  assert.equal((await lifecycle(f, 'dispatch-run')).response.status, 422); // Loading remains mandatory.
  ok(await execute(f, 'mark-stop-loaded'));
  ok(await lifecycle(f, 'dispatch-run'));
  const stale = run(f).version - 1;
  const before = structuredClone([...f.records]);
  assert.equal((await lifecycle(f, 'dispatch-run', 'r1', { expectedRunVersion: stale })).response.status, 409);
  assert.deepEqual([...f.records], before);
  ok(await execute(f, 'complete-stop', 'delivery', { confirmDirect: true }));
  ok(await execute(f, 'complete-stop', 'collection', { confirmDirect: true }));
  assert.ok(jobs(f).every(job => job.deliveryStatus === 'delivered' && job.collectionStatus === 'collected'));
  assert.equal(run(f).returnToCpuPending, true);
  ok(await lifecycle(f, 'confirm-returned-to-cpu'));
  assert.equal(run(f).status, 'completed');
  assert.equal(run(f).driverId, undefined);
  assert.ok(run(f).audit.some(item => item.action === 'dispatch-run' && item.by === 'Shared Logistics'));
  assert.equal(f.authorityRequests.filter(url => url.endsWith('/drivers')).length, 0);
  await f.rebuild();
  const refreshed = await f.get('projection=1&vehicle=van1'); ok(refreshed);
  assert.equal(refreshed.body.projection.runs.find(item => item.canonicalId === 'r1').status, 'completed');
  assert.ok(loads(f).every(load => load.status === 'delivered'));
});

test('shared session vehicle selection is scoped without reading person driver grants', async () => {
  const f = fixture(['van1']); f.principal.identityKind = 'operational';
  const allowed = await f.vehicles(); ok(allowed); assert.deepEqual(allowed.body.permittedVehicleIds, ['van1']);
  assert.equal((await f.vehicles('?vehicle=van2')).response.status, 403);
  assert.equal(f.authorityRequests.filter(url => url.endsWith('/drivers')).length, 0);
  f.principal.permittedVehicleIds = [];
  assert.equal((await f.vehicles()).response.status, 403);
});

test('shared session cannot execute another vehicle or ownership changed inside transaction', async () => {
  const f = fixture(['van1']); f.principal.identityKind = 'operational';
  const before = f.writes;
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r2', expectedRunVersion: 1 })).response.status, 403);
  assert.equal(f.writes, before);
  f.beforeNextTransaction(() => { f.records.get('fikaLogisticsDeliveryRunsV1/r1').vehicleId = 'van2'; });
  assert.equal((await f.post({ action: 'mark-run-ready', runId: 'r1', expectedRunVersion: 1 })).response.status, 403);
  assert.equal(f.writes, before);
});

test('mobile operational selection uses stable vehicle ID, date and run identity rather than driver/name', () => {
  const f = fixture();
  const { selectMobileVehicleRuns } = f.load(path.resolve(__dirname, '../lib/planning.ts'));
  const rows = [{ ...f.run('a', 'van1'), driverId: 'person:historical' }, { ...f.run('b', 'van2'), vehicleLabel: 'Van 1' }, { ...f.run('c', 'van1'), serviceDate: '2099-01-06' }, { ...f.run('d', 'van1'), vehicleId: undefined, vehicleLabel: 'Van 1' }];
  assert.deepEqual(selectMobileVehicleRuns(rows, 'van1', f.date).map(item => item.canonicalId), ['a']);
  assert.deepEqual(selectMobileVehicleRuns(rows, 'Van 1', f.date), []);
});
