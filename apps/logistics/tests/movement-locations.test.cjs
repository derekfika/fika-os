const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

async function locations(f) {
  const route = f.load(path.resolve(__dirname, '../app/api/logistics/locations/route.ts'));
  const response = await route.GET(new NextRequest('https://logistics.test/api/logistics/locations', { headers: { cookie: 'test-session' } }));
  return { response, body: await response.json() };
}
test('movement catalogue denies missing or single-vehicle authority before reading Hub reference', async () => {
  for (const vehicles of [[], ['van1'], ['van2']]) {
    const f = fixture(vehicles);
    const result = await locations(f);
    assert.equal(result.response.status, 403);
    assert.equal(f.locationReads.length, 0);
    assert.equal(f.writes, 0);
  }
});
test('shared planner gets canonical locations from one reference call without operational scans or writes', async () => {
  const f = fixture(['van1', 'van2']);
  f.oplocs.push({ id: 'oploc:canonical', label: 'Governed site', address: 'Governed address' });
  const result = await locations(f);
  assert.equal(result.response.status, 200);
  assert.equal(result.response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(result.body.oplocs, f.oplocs);
  assert.deepEqual(f.locationReads, ['test-session']);
  assert.deepEqual(f.queries, []);
  assert.equal(f.writes, 0);
});
test('empty, malformed, excessive or unavailable reference fails explicitly and retry recovers', async () => {
  for (const bad of [[], [{ id: '', label: 'Label is not authority' }], Array.from({ length: 1501 }, (_, i) => ({ id: 'oploc:' + i, label: 'Site' }))]) {
    const f = fixture(['van1', 'van2']); f.oplocs.push(...bad);
    const result = await locations(f);
    assert.equal(result.response.status, 503);
    assert.equal(result.body.error.code, 'LOGISTICS_LOCATIONS_UNAVAILABLE');
    assert.equal(f.writes, 0);
  }
  const f = fixture(['van1', 'van2']); f.failLocations(new Error('Hub offline'));
  assert.equal((await locations(f)).response.status, 503);
  f.failLocations(undefined); f.oplocs.push({ id: 'oploc:recovered', label: 'Recovered' });
  assert.equal((await locations(f)).response.status, 200);
  assert.equal(f.locationReads.length, 2);
});
test('movement save still rejects a display label substituted for canonical identity', async () => {
  const f = fixture(['van1', 'van2']); f.oplocs.push({ id: 'oploc:canonical', label: 'Governed site' });
  const movement = { canonicalId: 'movement:test-location', type: 'delivery', serviceDate: f.date, toOplocId: 'Governed site', items: [{ description: 'UAT item', quantity: 1 }] };
  assert.equal((await f.post({ action: 'save-movement', movement })).response.status, 422);
  assert.equal(f.writes, 0);
  movement.toOplocId = 'oploc:canonical';
  movement.toLabelSnapshot = 'Forged client label';
  const result = await f.post({ action: 'save-movement', movement });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.toOplocId, 'oploc:canonical');
  assert.equal(result.body.toLabelSnapshot, 'Governed site');
});

test('legacy movement projection recovers governed labels without rewriting operational history', async () => {
  const f = fixture(['van1', 'van2'], ['logistics.reconcile'], true);
  const movement = { canonicalId: 'movement:legacy', entityType: 'Movement Request', type: 'transfer', serviceDate: f.date, fromOplocId: 'oploc:from', toOplocId: 'oploc:to', items: [{ description: 'UAT', quantity: 1 }], createdBy: 'operator', status: 'open', version: 7, createdAt: 'before', updatedAt: 'before', audit: [{ action: 'historical', at: 'before', by: 'operator', version: 7 }] };
  f.seed('fikaLogisticsMovementRequestsV1', movement.canonicalId, movement);
  f.oplocs.push({ id: 'oploc:from', label: 'Same display name' }, { id: 'oploc:to', label: 'Same display name' }, { id: 'oploc:unrelated', label: 'Private unrelated site' });
  await f.materialisation.rebuildLogisticsProjection(f.date, 'operator');
  const result = await f.materialisation.reconcileLogisticsDay(f.date, 'operator');
  const projected = result.projection.movements.find(item => item.canonicalId === movement.canonicalId);
  assert.equal(projected.fromLabelSnapshot, 'Same display name');
  assert.equal(projected.toLabelSnapshot, 'Same display name');
  assert.equal(projected.fromOplocId, 'oploc:from');
  assert.equal(projected.toOplocId, 'oploc:to');
  assert.deepEqual(f.records.get('fikaLogisticsMovementRequestsV1/' + movement.canonicalId), movement);
  assert.equal(JSON.stringify(result.projection).includes('Private unrelated site'), false);
  const reads = f.locationReads.length;
  const rebuilt = await f.materialisation.rebuildLogisticsProjection(f.date, 'operator');
  assert.equal(rebuilt.movements[0].toLabelSnapshot, 'Same display name');
  assert.equal(f.locationReads.length, reads, 'ordinary mutation rebuild must not reread Hub');
  const unchanged = await f.materialisation.reconcileLogisticsDay(f.date, 'operator');
  assert.equal(unchanged.projection.revision, rebuilt.revision, 'no projection write when labels and source are unchanged');
  const adapter = f.load(path.resolve(__dirname, '../lib/projection-dashboard-adapter.ts'));
  const view = adapter.projectionToDashboardData(unchanged.projection).planner.movements[0];
  assert.deepEqual(view.from, { id: 'oploc:from', label: 'Same display name' });
  assert.deepEqual(view.to, { id: 'oploc:to', label: 'Same display name' });
  const authority = f.load(path.resolve(__dirname, '../lib/resource-authority.ts'));
  assert.deepEqual(authority.scopeProjection(unchanged.projection, { ...f.principal, permittedVehicleIds: ['van1'] }).movements, [], 'unassigned labels remain hidden from vehicle-only sessions');
});

test('display snapshot retention follows canonical endpoint identity and never copies removed endpoints', () => {
  const f = fixture();
  const { movementDisplaySnapshots } = f.load(path.resolve(__dirname, '../lib/movement-labels.ts'));
  const old = { canonicalId: 'movement:1', fromOplocId: 'oploc:a', fromLabelSnapshot: 'Old A', toOplocId: 'oploc:b', toLabelSnapshot: 'Old B' };
  const current = { canonicalId: 'movement:1', toOplocId: 'oploc:c' };
  assert.deepEqual(movementDisplaySnapshots([current], [old]), [current]);
  assert.equal(movementDisplaySnapshots([old], [], [{ id: 'oploc:b', label: 'Updated B' }])[0].toLabelSnapshot, 'Updated B');
});
