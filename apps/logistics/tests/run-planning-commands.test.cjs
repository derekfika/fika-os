const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');

// Actual route handlers + domain code against the isolated optimistic-transaction test store.
// This is NOT the Firestore emulator; tests/api.integration.ts remains the emulator-backed suite
// and must be run separately where the emulator is available.
const RUNS = 'fikaLogisticsDeliveryRunsV1';
function setup(permitted = ['van1', 'van2']) {
  const f = fixture(permitted, ['logistics.reconcile'], true); f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith(RUNS + '/')) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  return f;
}
const requirement = (f, id, site, window = { startTime: '10:00', endTime: '11:00' }) => ({ canonicalId: 'req:' + id, sourceDomain: 'cpu-production', sourceEntityId: 'order:' + id, sourceVersion: 1, sourceContentHash: 'hash:' + id, serviceDate: f.date, productionLocationId: 'cpu', destinationOplocId: site, destinationLabelSnapshot: site, requiredDeliveryWindow: window, lines: [{ displayNameSnapshot: 'Lunch ' + id, quantity: 10, unit: 'portion' }], status: 'ready_for_planning' });
const run = (f, id) => f.records.get(RUNS + '/' + id);
const reconcile = f => f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
const jobVersion = (f, id) => f.records.get('fikaLogisticsJobsV1/logistics-job:req:' + id).version;
async function assign(f, id, runId, time) {
  // Joining an existing placement (same run, OPLOC and time) must name that load's current version.
  const existing = [...f.records].filter(([key]) => key.startsWith('fikaLogisticsDeliveryLoadsV1/')).map(([, load]) => load).find(load => load.runId === runId && load.scheduledTime === time && load.status !== 'cancelled' && f.records.get('fikaLogisticsJobsV1/logistics-job:req:' + id).destinationOplocId === load.destinationOplocId);
  const result = await f.post({ action: 'assign-job-to-load', jobId: 'logistics-job:req:' + id, targetRunId: runId, scheduledTime: time, expectedJobVersion: jobVersion(f, id), expectedRunVersion: run(f, runId).version, ...(existing ? { expectedLoadVersion: existing.version, expectedLoadVersions: { [existing.id]: existing.version } } : {}) });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
}
async function withThreeStops() {
  const f = setup();
  f.requirements.push(requirement(f, 'a', 'site:a'), requirement(f, 'b', 'site:b'), requirement(f, 'c', 'site:c'));
  await reconcile(f);
  await assign(f, 'a', 'r1', '09:00'); await assign(f, 'b', 'r1', '10:00'); await assign(f, 'c', 'r1', '11:00');
  const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date);
  const ids = projection.deliveryLoads.map(load => `projection-stop:delivery:${load.id}`);
  assert.equal(ids.length, 3);
  return { f, ids };
}
const adapter = f => f.load(path.resolve(__dirname, '../lib/projection-dashboard-adapter.ts')).projectionToDashboardData;
const orderOf = (f, runId = 'r1') => {
  const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date);
  return adapter(f)(projection).runs.find(item => item.canonicalId === runId).orderedStopIds;
};

test('create-run accepts validated planned journey times and still creates untimed drafts', async () => {
  const f = setup();
  const timed = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:t1`, serviceDate: f.date, vehicleId: 'van1', status: 'draft', plannedCpuDepartureTime: '09:00', plannedCpuReturnTime: '12:00', orderedStopIds: [] } });
  assert.equal(timed.response.status, 200, JSON.stringify(timed.body));
  assert.deepEqual([run(f, `run:${f.date}:t1`).plannedCpuDepartureTime, run(f, `run:${f.date}:t1`).plannedCpuReturnTime, run(f, `run:${f.date}:t1`).status], ['09:00', '12:00', 'draft']);
  const bare = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:t2`, serviceDate: f.date, vehicleId: 'van2', status: 'draft', orderedStopIds: [] } });
  assert.equal(bare.response.status, 200);
  assert.equal(run(f, `run:${f.date}:t2`).plannedCpuDepartureTime, undefined);
  for (const [dep, ret] of [['09:00', undefined], ['12:00', '09:00'], ['09:10', '12:00']]) {
    const bad = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:bad${dep}`, serviceDate: f.date, vehicleId: 'van1', status: 'draft', plannedCpuDepartureTime: dep, plannedCpuReturnTime: ret, orderedStopIds: [] } });
    assert.equal(bad.response.status, 422, `${dep}/${ret}`);
  }
  assert.equal([...f.records.keys()].filter(key => key.includes(':bad')).length, 0, 'rejected creates must not persist');
});

test('set-run-stop-order stores the order on the canonical Run, bumps its version once, audits it, and the read model honours it', async () => {
  const { f, ids } = await withThreeStops();
  assert.deepEqual(orderOf(f), ids.slice().sort(), 'baseline: unordered work derives by planned time');
  const before = run(f, 'r1');
  const wanted = [ids[2], ids[0], ids[1]];
  const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: before.version, stopIds: wanted });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const after = run(f, 'r1');
  assert.deepEqual(after.orderedStopIds, wanted);
  assert.equal(after.version, before.version + 1);
  assert.equal(after.audit.at(-1).action, 'run-stop-order-saved');
  assert.deepEqual(orderOf(f), wanted, 'projection rebuild + adapter expose the stored order');
  // Reload/refresh: a fresh GET returns the same persisted order.
  const get = await f.get('projection=1');
  assert.equal(get.response.status, 200);
  assert.deepEqual(get.body.runs.find(item => item.canonicalId === 'r1').orderedStopIds, wanted, 'the served read model keeps the stored order (scoping must not strip load-backed stop ids)');
  assert.deepEqual(get.body.projection.runs.find(item => item.canonicalId === 'r1').orderedStopIds, wanted);
});

test('set-run-stop-order is idempotent on replay and rejects stale versions, non-permutations and foreign stops without changing state', async () => {
  const { f, ids } = await withThreeStops();
  const wanted = [ids[1], ids[2], ids[0]];
  const version = run(f, 'r1').version;
  assert.equal((await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: version, stopIds: wanted })).response.status, 200);
  const saved = structuredClone(run(f, 'r1'));
  // Replay of the same intent with the new version is a no-op (no extra version/audit).
  assert.equal((await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: saved.version, stopIds: wanted })).response.status, 200);
  assert.deepEqual(run(f, 'r1'), saved);
  // Stale version.
  const stale = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: version, stopIds: [ids[0], ids[1], ids[2]] });
  assert.equal(stale.response.status, 409);
  const rejected = [[[ids[0], ids[1]], /every physical stop/], [[...wanted, 'projection-stop:delivery:load:nope'], /./], [[ids[0], ids[0], ids[1]], /duplicate/], ['nope', /array|Reorder|stop/i]];
  for (const [stopIds, pattern] of rejected) {
    const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: saved.version, stopIds });
    assert.ok([404, 422].includes(result.response.status), `${JSON.stringify(stopIds)} -> ${result.response.status}`);
    assert.match(JSON.stringify(result.body), pattern);
  }
  assert.deepEqual(run(f, 'r1'), saved, 'every rejected command leaves the confirmed Run untouched');
});

test('a stop belonging to another Run cannot be smuggled into this Run\'s order', async () => {
  const { f, ids } = await withThreeStops();
  const other = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date).deliveryLoads;
  assert.ok(other.length === 3);
  f.requirements.push(requirement(f, 'd', 'site:d')); await reconcile(f); await assign(f, 'd', 'r2', '09:30');
  const foreign = `projection-stop:delivery:${f.records.get('fikaLogisticsDayProjectionsV1/' + f.date).deliveryLoads.find(load => load.runId === 'r2').id}`;
  const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run(f, 'r1').version, stopIds: [...ids, foreign] });
  assert.ok([404, 422].includes(result.response.status), String(result.response.status));
  assert.deepEqual(run(f, 'r1').orderedStopIds, []);
});

test('stop order cannot change once the Run has left planning', async () => {
  const { f, ids } = await withThreeStops();
  run(f, 'r1').status = 'dispatched';
  const result = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run(f, 'r1').version, stopIds: [ids[2], ids[1], ids[0]] });
  assert.equal(result.response.status, 422);
  assert.deepEqual(run(f, 'r1').orderedStopIds, []);
});

test('a vehicle-scoped operator cannot reorder or retire another vehicle\'s Run', async () => {
  const f = setup(['van1']);
  const order = await f.post({ action: 'set-run-stop-order', runId: 'r2', expectedRunVersion: 1, stopIds: [] });
  const retire = await f.post({ action: 'retire-empty-run', runId: 'r2', expectedRunVersion: 1 });
  for (const result of [order, retire]) assert.ok([403, 404].includes(result.response.status), String(result.response.status));
  assert.equal(run(f, 'r2').retiredAt, undefined);
});

test('retire-empty-run softly retires an empty draft/planned Run: audited, versioned, gone from the projection, idempotent', async () => {
  const f = setup();
  const created = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:empty`, serviceDate: f.date, vehicleId: 'van1', status: 'draft', orderedStopIds: [] } });
  assert.equal(created.response.status, 200);
  const id = `run:${f.date}:empty`;
  const stale = await f.post({ action: 'retire-empty-run', runId: id, expectedRunVersion: 99 });
  assert.equal(stale.response.status, 409);
  assert.equal(run(f, id).retiredAt, undefined);
  const result = await f.post({ action: 'retire-empty-run', runId: id, expectedRunVersion: run(f, id).version });
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  const retired = run(f, id);
  assert.ok(retired.retiredAt && retired.retiredBy, 'history retained, not physically deleted');
  assert.equal(retired.audit.at(-1).action, 'run-retired-empty');
  const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date);
  assert.ok(!projection.runs.some(item => item.canonicalId === id), 'retired Run leaves the day projection');
  const day = await f.get();
  assert.ok(!(day.body.runs || []).some(item => item.canonicalId === id), 'and the planner read');
  const replay = await f.post({ action: 'retire-empty-run', runId: id, expectedRunVersion: retired.version });
  assert.equal(replay.response.status, 200);
  assert.deepEqual(run(f, id), retired, 'replay changes nothing');
  assert.equal((await f.post({ action: 'set-run-stop-order', runId: id, expectedRunVersion: retired.version, stopIds: [] })).response.status, 409, 'a retired Run cannot be reordered');
});

test('a Run holding operational work, or past planning, can never be retired', async () => {
  const { f } = await withThreeStops();
  const busy = await f.post({ action: 'retire-empty-run', runId: 'r1', expectedRunVersion: run(f, 'r1').version });
  assert.equal(busy.response.status, 422);
  assert.match(JSON.stringify(busy.body), /operational work/);
  assert.equal(run(f, 'r1').retiredAt, undefined);
  for (const status of ['ready', 'dispatched', 'completed']) {
    run(f, 'r2').status = status;
    const result = await f.post({ action: 'retire-empty-run', runId: 'r2', expectedRunVersion: run(f, 'r2').version });
    assert.equal(result.response.status, 422, status);
    assert.equal(run(f, 'r2').retiredAt, undefined, status);
  }
});

test('after returning all work to the queue the Run becomes retireable, and its history is preserved', async () => {
  const f = setup();
  f.requirements.push(requirement(f, 'a', 'site:a')); await reconcile(f); await assign(f, 'a', 'r1', '09:00');
  assert.equal((await f.post({ action: 'retire-empty-run', runId: 'r1', expectedRunVersion: run(f, 'r1').version })).response.status, 422);
  const load = [...f.records].find(([key]) => key.startsWith('fikaLogisticsDeliveryLoadsV1/'))[1];
  const removed = await f.post({ action: 'remove-job-from-load', jobId: 'logistics-job:req:a', expectedJobVersion: jobVersion(f, 'a'), expectedLoadVersion: load.version, expectedLoadVersions: { [load.id]: load.version } });
  assert.equal(removed.response.status, 200, JSON.stringify(removed.body));
  const retired = await f.post({ action: 'retire-empty-run', runId: 'r1', expectedRunVersion: run(f, 'r1').version });
  assert.equal(retired.response.status, 200, JSON.stringify(retired.body));
  assert.equal(run(f, 'r1').audit.at(-1).action, 'run-retired-empty');
  assert.ok(run(f, 'r1').retiredAt, 'retired, not deleted');
});

test('ensure-vehicle-day-runs does not resurrect a vehicle whose runs were deliberately retired', async () => {
  const f = setup();
  for (const id of ['r1', 'r2']) f.records.delete(RUNS + '/' + id);
  const first = await f.post({ action: 'ensure-vehicle-day-runs', serviceDate: f.date });
  assert.equal(first.response.status, 200, JSON.stringify(first.body));
  const vanOne = [...f.records.values()].find(item => item.vehicleId === 'van1');
  assert.ok(vanOne, 'a vehicle with no runs still gets its draft');
  const retired = await f.post({ action: 'retire-empty-run', runId: vanOne.canonicalId, expectedRunVersion: vanOne.version });
  assert.equal(retired.response.status, 200, JSON.stringify(retired.body));
  const again = await f.post({ action: 'ensure-vehicle-day-runs', serviceDate: f.date });
  assert.equal(again.response.status, 200, JSON.stringify(again.body));
  assert.equal([...f.records.values()].filter(item => item.vehicleId === 'van1' && !item.retiredAt).length, 0, 'retired vehicle is not silently re-created');
});

test('physical stops: work sharing one placement is ONE stop (any member id names it); a same-OPLOC visit at another time stays a separate repeat visit', async () => {
  const f = setup();
  f.requirements.push(requirement(f, 'a', 'site:m'), requirement(f, 'b', 'site:m'), requirement(f, 'c', 'site:m'));
  await reconcile(f);
  await assign(f, 'a', 'r1', '09:00'); await assign(f, 'b', 'r1', '09:00'); await assign(f, 'c', 'r1', '12:00');
  const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date);
  const stops = projection.deliveryLoads.filter(load => load.runId === 'r1');
  assert.equal(stops.length, 2, 'two physical stops: the shared 09:00 placement and the 12:00 repeat visit');
  const shared = stops.find(load => load.jobCount === 2);
  const repeat = stops.find(load => load.jobCount === 1);
  assert.ok(shared && repeat && shared.jobCount === 2, 'both pieces of work stay individually tracked inside the one stop');
  const dashboardStops = adapter(f)(projection).stops.filter(stop => stop.runId === 'r1');
  assert.equal(dashboardStops.length, 2);
  // Naming the stop by ANY member load is accepted and refers to the same single stop.
  const memberId = `projection-stop:delivery:${(shared.loadIds || [shared.id]).at(-1)}`; // any member id names the stop
  const repeatId = `projection-stop:delivery:${repeat.id}`;
  const ok = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run(f, 'r1').version, stopIds: [repeatId, memberId] });
  assert.equal(ok.response.status, 200, JSON.stringify(ok.body));
  // Listing the shared stop twice (once per member) or omitting the repeat visit is rejected.
  const both = [memberId, memberId];
  const dup = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run(f, 'r1').version, stopIds: [...both, repeatId] });
  assert.equal(dup.response.status, 422); assert.match(JSON.stringify(dup.body), /duplicate/);
  const omitted = await f.post({ action: 'set-run-stop-order', runId: 'r1', expectedRunVersion: run(f, 'r1').version, stopIds: [memberId] });
  assert.equal(omitted.response.status, 422); assert.match(JSON.stringify(omitted.body), /every physical stop/);
});

test('overlapping Runs are warned about by the client but never rejected: both saves succeed and the other Run is untouched', async () => {
  const f = setup();
  const a = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:oa`, serviceDate: f.date, vehicleId: 'van1', status: 'draft', plannedCpuDepartureTime: '08:00', plannedCpuReturnTime: '11:00', orderedStopIds: [] } });
  assert.equal(a.response.status, 200);
  const before = structuredClone(run(f, `run:${f.date}:oa`));
  const b = await f.post({ action: 'create-run', run: { canonicalId: `run:${f.date}:ob`, serviceDate: f.date, vehicleId: 'van1', status: 'draft', plannedCpuDepartureTime: '10:00', plannedCpuReturnTime: '13:00', orderedStopIds: [] } });
  assert.equal(b.response.status, 200, 'creating an overlapping Run is allowed');
  const moved = await f.post({ action: 'update-run-timing', runId: `run:${f.date}:ob`, plannedCpuDepartureTime: '09:00', plannedCpuReturnTime: '12:00', expectedRunVersion: run(f, `run:${f.date}:ob`).version });
  assert.equal(moved.response.status, 200, 're-timing into an overlap is allowed');
  assert.deepEqual(run(f, `run:${f.date}:oa`), before, 'the other Run is never silently changed');
  assert.equal(run(f, `run:${f.date}:ob`).audit.at(-1).action, 'run-journey-times-updated');
  const stale = await f.post({ action: 'update-run-timing', runId: `run:${f.date}:ob`, plannedCpuDepartureTime: '07:00', plannedCpuReturnTime: '12:00', expectedRunVersion: 1 });
  assert.equal(stale.response.status, 409, 'version checks still apply to overlapping schedules');
  assert.equal(run(f, `run:${f.date}:ob`).plannedCpuDepartureTime, '09:00');
  // Lifecycle rules still win: a dispatched Run cannot be re-timed even if the new time would not overlap.
  run(f, `run:${f.date}:oa`).status = 'dispatched';
  const locked = await f.post({ action: 'update-run-timing', runId: `run:${f.date}:oa`, plannedCpuDepartureTime: '08:15', plannedCpuReturnTime: '11:00', expectedRunVersion: run(f, `run:${f.date}:oa`).version });
  assert.equal(locked.response.status, 422);
});
