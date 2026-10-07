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
  const result = await f.post({ action: 'save-movement', movement });
  assert.equal(result.response.status, 200);
  assert.equal(result.body.toOplocId, 'oploc:canonical');
});
