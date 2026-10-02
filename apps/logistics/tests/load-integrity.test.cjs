const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');
function setup() {
  const f = fixture(['van1', 'van2'], ['logistics.reconcile'], true);
  for (const key of [...f.records.keys()]) if (!key.startsWith('fikaLogisticsDeliveryRunsV1/')) f.records.delete(key);
  for (const run of f.records.values()) run.orderedStopIds = [];
  return f;
}
function requirement(f, id = 'a', overrides = {}) {
  return { canonicalId: 'req:' + id, sourceDomain: 'cpu-production', sourceEntityId: 'order:' + id, sourceVersion: 1, sourceContentHash: 'hash:' + id, serviceDate: f.date, productionLocationId: 'cpu', destinationOplocId: 'site', destinationLabelSnapshot: 'Site', requiredDeliveryWindow: { startTime: '10:00', endTime: '11:00' }, lines: [{ displayNameSnapshot: 'Lunch', quantity: 10, unit: 'portion' }], status: 'ready_for_planning', ...overrides };
}
const values = (f, collection) => [...f.records].filter(([key]) => key.startsWith(collection + '/')).map(([, value]) => structuredClone(value));
const jobs = f => values(f, 'fikaLogisticsJobsV1');
const loads = f => values(f, 'fikaLogisticsDeliveryLoadsV1');
const assignments = f => values(f, 'fikaLogisticsAssignmentsV1');
async function reconcile(f) { return f.materialisation.reconcileLogisticsDay(f.date, 'Operator'); }
async function assign(f, id = 'logistics-job:req:a', extra = {}) {
  return f.post({ action: 'assign-job-to-load', jobId: id, targetRunId: 'r1', scheduledTime: '10:30', scheduledEnd: '11:30', expectedJobVersion: jobs(f).find(j => j.id === id)?.version, expectedLoadVersions: Object.fromEntries(loads(f).map(l => [l.id, l.version])), ...extra });
}
async function assigned(overrides = {}) {
  const f = setup(); f.requirements.push(requirement(f, 'a', overrides)); await reconcile(f);
  const result = await assign(f); assert.equal(result.response.status, 200, JSON.stringify(result.body)); return f;
}
for (const [window, arrival, expected] of [
  [{ startTime: '10:00', endTime: '11:00' }, '10:30', true],
  [{ startTime: '10:00', endTime: '11:00' }, '09:45', false],
  [{ startTime: '10:00', endTime: '11:00' }, '11:15', false],
  [{ startTime: '10:00' }, '10:30', true],
  [{ startTime: '10:00' }, '09:45', false],
  [{ startTime: '10:00', endTime: '11:00' }, '10:00', true],
  [{ startTime: '10:00', endTime: '11:00' }, '11:00', true],
  [undefined, '09:45', true],
]) test('source arrival constraint ' + JSON.stringify(window) + ' / ' + arrival, () => {
  const f = setup(); const { compatibleLoad } = f.load(path.resolve(__dirname, '../lib/delivery-loads.ts'));
  const job = { serviceDate: f.date, originOplocId: 'cpu', destinationOplocId: 'site', requestedWindow: window };
  assert.equal(compatibleLoad(job, { ...job, scheduledTime: arrival, scheduledEnd: '12:00', status: 'planned' }), expected);
});
test('assignment and rescheduling keep source window separate from operator duration', async () => {
  const f = await assigned(); const window = structuredClone(jobs(f)[0].requestedWindow); const load = loads(f)[0];
  assert.equal(load.scheduledEnd, '11:30');
  const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45', scheduledEnd: '12:00', targetRunId: 'r1' });
  assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.deepEqual(jobs(f)[0].requestedWindow, window); assert.equal(loads(f)[0].scheduledEnd, '12:00');
});
for (const window of [{ startTime: '09:00', endTime: '12:00' }, { startTime: '10:15', endTime: '10:45' }]) test('compatible broadened/narrowed amendment preserves load schedule ' + JSON.stringify(window), async () => {
  const f = await assigned(); const load = loads(f)[0]; const assignment = assignments(f)[0];
  Object.assign(f.requirements[0], { sourceVersion: 2, sourceContentHash: 'amended', status: 'amended', requiredDeliveryWindow: window });
  await reconcile(f); assert.deepEqual(loads(f)[0], load); assert.deepEqual(assignments(f)[0], assignment); assert.deepEqual(jobs(f)[0].requestedWindow, window);
});
for (const change of [
  { requiredDeliveryWindow: { startTime: '10:45', endTime: '11:00' } },
  { requiredDeliveryWindow: { startTime: '09:00', endTime: '10:15' } },
  { destinationOplocId: 'other-site' }, { productionLocationId: 'other-cpu' },
]) test('incompatible source amendment returns work to planning ' + JSON.stringify(change), async () => {
  const f = await assigned(); Object.assign(f.requirements[0], change, { sourceVersion: 2, status: 'amended' });
  const result = await reconcile(f); assert.equal(assignments(f).length, 0); assert.equal(loads(f)[0].status, 'cancelled'); assert.equal(result.projection.planningQueue.length, 1); assert.equal(jobs(f)[0].activeLoadId, undefined);
});
test('withdrawal cancels final empty load, retains evidence and removes driver output; replay is inert', async () => {
  const f = await assigned(); Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 2 });
  const result = await reconcile(f); assert.equal(assignments(f).length, 0); assert.equal(loads(f)[0].status, 'cancelled'); assert.equal(jobs(f)[0].sourceStatus, 'withdrawn'); assert.equal(result.projection.deliveryLoads.length, 0); assert.equal(result.projection.planningQueue.length, 0);
  const before = structuredClone([...f.records]); const writes = f.writes; await reconcile(f); assert.deepEqual([...f.records], before); assert.equal(f.writes, writes);
});
test('one withdrawn member leaves other members and shared load intact', async () => {
  const f = setup(); f.requirements.push(requirement(f), requirement(f, 'b')); await reconcile(f); await assign(f); const second = await assign(f, 'logistics-job:req:b'); assert.equal(second.response.status, 200, JSON.stringify(second.body));
  assert.equal(loads(f).length, 1); Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 2 }); const result = await reconcile(f);
  assert.deepEqual(assignments(f).map(a => a.jobId), ['logistics-job:req:b']); assert.equal(loads(f)[0].status, 'planned'); assert.equal(result.projection.deliveryLoads[0].jobs.length, 1);
});
test('unchanged delivery truth and readiness changes keep existence without false amendment churn', async () => {
  const f = await assigned(); const before = structuredClone([...f.records]); await reconcile(f); assert.deepEqual([...f.records], before);
  Object.assign(f.requirements[0], { status: 'pending', sourceVersion: 2 }); await reconcile(f); assert.equal(jobs(f).length, 1); assert.equal(assignments(f).length, 1); assert.equal(jobs(f)[0].productionReadiness, 'pending');
});
test('older source replay cannot resurrect withdrawal', async () => {
  const f = await assigned(); Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 3 }); await reconcile(f); Object.assign(f.requirements[0], { status: 'ready_for_planning', sourceVersion: 2 }); await reconcile(f); assert.equal(jobs(f)[0].sourceStatus, 'withdrawn'); assert.equal(assignments(f).length, 0);
});
test('concurrent reconciliation converges without duplicate source events', async () => {
  const f = setup(); f.requirements.push(requirement(f)); await Promise.all([reconcile(f), reconcile(f)]); assert.equal(jobs(f).length, 1); assert.equal(values(f, 'fikaLogisticsChangesV1').length, 1);
});
test('pending non-Xchange production materialises immediately and stable Xchange alone is excluded', async () => {
  const f = setup(); const { CPU_SITE_OPLOC_ID } = f.load(path.resolve(__dirname, '../../shared/production-location.ts'));
  f.requirements.push(requirement(f, 'a', { status: 'pending' }), requirement(f, 'local', { destinationOplocId: CPU_SITE_OPLOC_ID }), requirement(f, 'named', { destinationLabelSnapshot: 'FIKA Xchange', destinationOplocId: 'customer' })); await reconcile(f); assert.equal(jobs(f).length, 2); assert(jobs(f).some(j => j.productionReadiness === 'pending'));
});
test('same source with separate requirement IDs produces separate jobs', async () => {
  const f = setup(); f.requirements.push(requirement(f), requirement(f, 'b', { sourceEntityId: 'order:a', destinationOplocId: 'other' })); await reconcile(f); assert.equal(jobs(f).length, 2); await reconcile(f); assert.equal(jobs(f).length, 2);
});
test('different run and vehicle produce different immutable load identities without transferring old owner', async () => {
  const f = setup(); f.requirements.push(requirement(f), requirement(f, 'b')); await reconcile(f); await assign(f); const first = loads(f)[0]; await assign(f, 'logistics-job:req:b', { targetRunId: 'r2' }); assert.equal(loads(f).length, 2); assert.deepEqual(loads(f).find(l => l.id === first.id), first); assert.deepEqual(new Set(loads(f).map(l => l.vehicleId)), new Set(['van1', 'van2']));
});
test('same assignment replay is idempotent despite its original expected tokens', async () => {
  const f = await assigned(); const before = structuredClone([...f.records]); const result = await assign(f, undefined, { expectedJobVersion: 1, expectedLoadVersions: {} }); assert.equal(result.response.status, 200); assert.deepEqual([...f.records], before);
});
test('concurrent same-job assignment to two runs commits one active assignment', async () => {
  const f = setup(); f.requirements.push(requirement(f)); await reconcile(f);
  const results = await Promise.all([assign(f, undefined, { expectedJobVersion: 1, targetRunId: 'r1' }), assign(f, undefined, { expectedJobVersion: 1, targetRunId: 'r2' })]);
  assert.deepEqual(results.map(r => r.response.status).sort(), [200, 409]); assert.equal(assignments(f).length, 1); assert.equal(loads(f).filter(l => l.status !== 'cancelled').length, 1); assert.equal(jobs(f)[0].activeLoadId, assignments(f)[0].loadId);
});
for (const action of ['mark-delivery-load-loaded', 'dispatch-delivery-load', 'reschedule-delivery-load', 'remove-job-from-load', 'mark-stop-loaded']) test('operator stale version fails closed: ' + action, async () => {
  const f = await assigned(); const load = loads(f)[0]; const before = structuredClone([...f.records]);
  const result = await f.post({ action, loadId: load.id, jobId: jobs(f)[0].id, stopId: action === 'mark-stop-loaded' ? 'projection-stop:delivery:' + load.id : undefined, expectedLoadVersion: 0, scheduledTime: '10:45' }); assert.equal(result.response.status, 409, JSON.stringify(result.body)); assert.deepEqual([...f.records], before);
});
test('current load version succeeds once; missing token fails', async () => {
  const f = await assigned(); const load = loads(f)[0]; assert.equal((await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id })).response.status, 422); const result = await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id, expectedLoadVersion: load.version }); assert.equal(result.response.status, 200); assert.equal(loads(f)[0].version, load.version + 1);
});
test('stale removal cannot remove a newer assignment', async () => {
  const f = await assigned(); const old = loads(f)[0]; await assign(f, undefined, { targetRunId: 'r2' }); const before = structuredClone(assignments(f)); const result = await f.post({ action: 'remove-job-from-load', jobId: jobs(f)[0].id, expectedJobVersion: 2, expectedLoadVersion: 1 }); assert.equal(result.response.status, 409); assert.deepEqual(assignments(f), before);
});
test('inconsistent vehicle ownership and unauthorized collection owner are rejected', async () => {
  const f = await assigned(); const load = loads(f)[0]; f.records.get('fikaLogisticsDeliveryLoadsV1/' + load.id).vehicleId = 'van2'; assert.equal((await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id, expectedLoadVersion: load.version })).response.status, 409);
  f.records.get('fikaLogisticsDeliveryLoadsV1/' + load.id).vehicleId = 'van1'; f.principal.permittedVehicleIds = ['van1']; const before = f.writes; assert.equal((await f.post({ action: 'reschedule-delivery-load', loadId: load.id, lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00', expectedLoadVersion: load.version })).response.status, 403); assert.equal(f.writes, before);
});
test('collection schedule owns its run and duration independently; delivery ownership and source remain intact', async () => {
  const f = await assigned(); const load = loads(f)[0]; const source = jobs(f)[0].requestedWindow;
  const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00', scheduledEnd: '14:45', expectedLoadVersion: load.version }); assert.equal(result.response.status, 200, JSON.stringify(result.body)); const next = loads(f)[0]; assert.equal(result.body.runId, 'r1'); assert.equal(next.collectionRunId, 'r2'); assert.equal(next.vehicleId, 'van1'); assert.equal(next.collectionRequired, true); assert.equal(next.collectionScheduledEnd, '14:45'); assert.deepEqual(jobs(f)[0].requestedWindow, source);
});
test('native assign and assign-group create the same canonical load and assignment as projection delivery', async () => {
  const states = [];
  for (const action of ['assign-job-to-load', 'assign', 'assign-group']) {
    const f = setup(); f.requirements.push(requirement(f)); await reconcile(f);
    const result = action === 'assign-job-to-load' ? await assign(f, undefined, { collectionRequired: true }) : await f.post({ action, runId: 'r1', requirementId: action === 'assign' ? 'req:a' : undefined, requirementIds: action === 'assign-group' ? ['req:a'] : undefined, expectedSourceVersion: 1, expectedSourceVersions: { 'req:a': 1 }, expectedRunVersion: 1, plannedWindow: { startTime: '10:30', endTime: '11:30' }, collectionRequired: true });
    assert.equal(result.response.status, 200, JSON.stringify(result.body)); const load = loads(f)[0]; const projection = (await f.rebuild()).deliveryLoads[0];
    states.push({ id: load.id, runId: load.runId, vehicleId: load.vehicleId, collectionRunId: load.collectionRunId, collectionRequired: load.collectionRequired, time: load.scheduledTime, end: load.scheduledEnd, version: load.version, assignments: assignments(f).map(a => [a.jobId, a.loadId]), projection: [projection.runId, projection.jobCount, projection.scheduledTime, projection.scheduledEnd] });
  }
  assert.deepEqual(states[1], states[0]); assert.deepEqual(states[2], states[0]);
});
test('native group combines two compatible jobs once without duplicate assignments', async () => {
  const f = setup(); f.requirements.push(requirement(f), requirement(f, 'b')); await reconcile(f);
  const result = await f.post({ action: 'assign-group', runId: 'r1', requirementIds: ['req:a', 'req:b'], expectedSourceVersions: { 'req:a': 1, 'req:b': 1 }, expectedRunVersion: 1, plannedArrivalTime: '10:30' }); assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(loads(f).length, 1); assert.equal(assignments(f).length, 2); assert.equal((await f.rebuild()).deliveryLoads[0].jobCount, 2);
});
test('withdrawal also removes retained native delivery and linked collection projection stops', async () => {
  const f = await assigned(); f.seed('fikaLogisticsDeliveryStopsV1', 'legacy', { canonicalId: 'legacy', runId: 'r1', sequence: 1, locationOplocId: 'site', requirementRefs: [{ requirementId: 'req:a', sourceVersion: 1 }], movementRequestIds: [], linkedStopId: 'legacy-collection', status: 'planned', plannedArrivalTime: '10:30', version: 1, audit: [] }); f.seed('fikaLogisticsDeliveryStopsV1', 'legacy-collection', { canonicalId: 'legacy-collection', runId: 'r2', sequence: 1, requirementRefs: [], movementRequestIds: [], status: 'planned', version: 1, audit: [] });
  Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 2 }); const result = await reconcile(f); assert.equal(result.projection.stops.length, 0); assert.equal(values(f, 'fikaLogisticsDeliveryRunsV1').find(r => r.canonicalId === 'r1').version, 2);
});
test('old cancelled source assignments cannot execute even with a fresh load version', async () => {
  const f = await assigned(); Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 2 }); await reconcile(f); const load = loads(f)[0]; assert.equal((await f.post({ action: 'mark-stop-loaded', stopId: 'projection-stop:delivery:' + load.id, expectedLoadVersion: load.version })).response.status, 409);
});
test('republishing after withdrawal creates a new load incarnation and preserves cancelled history', async () => {
  const f = await assigned(); const old = loads(f)[0]; Object.assign(f.requirements[0], { status: 'withdrawn', sourceVersion: 2 }); await reconcile(f);
  Object.assign(f.requirements[0], { status: 'ready_for_planning', sourceVersion: 3 }); await reconcile(f); const result = await assign(f); assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(loads(f).length, 2); assert.equal(loads(f).find(l => l.id === old.id).status, 'cancelled'); assert.notEqual(assignments(f)[0].loadId, old.id);
});
test('a rescheduled load keeps its ID; adding at its old time never overwrites it', async () => {
  const f = await assigned(); const old = loads(f)[0]; await f.post({ action: 'reschedule-delivery-load', loadId: old.id, scheduledTime: '10:45', scheduledEnd: '11:45', expectedLoadVersion: old.version });
  f.requirements.push(requirement(f, 'b')); await reconcile(f); const result = await assign(f, 'logistics-job:req:b'); assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(loads(f).find(l => l.id === old.id).scheduledTime, '10:45'); assert.equal(loads(f).length, 2);
});
test('reusing a load needs its current observed version and increments it once', async () => {
  const f = await assigned(); const load = loads(f)[0]; f.requirements.push(requirement(f, 'b')); await reconcile(f);
  assert.equal((await assign(f, 'logistics-job:req:b', { expectedLoadVersions: { [load.id]: 0 } })).response.status, 409);
  assert.equal((await assign(f, 'logistics-job:req:b')).response.status, 200); assert.equal(loads(f)[0].version, load.version + 1);
});
test('source date incompatibility invalidates assignment without rewriting source timing', async () => {
  const f = await assigned(); const req = { ...f.requirements[0], sourceVersion: 2, serviceDate: '2099-01-06' };
  await f.materialisation.reconcileRequirementJob(jobs(f)[0].id, req, 'Operator', '2099-01-05T12:00:00Z'); assert.equal(assignments(f).length, 0); assert.equal(loads(f)[0].status, 'cancelled'); assert.deepEqual(jobs(f)[0].requestedWindow, req.requiredDeliveryWindow);
});
test('ordinary planning and reconciliation queries stay constrained by date or known relationships', async () => {
  const f = await assigned(); const load = loads(f)[0]; await f.post({ action: 'reschedule-delivery-load', loadId: load.id, lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00', expectedLoadVersion: load.version });
  Object.assign(f.requirements[0], { sourceVersion: 2, status: 'withdrawn' }); await reconcile(f); assert(f.queries.length > 0); assert(f.queries.every(query => query.filters.length > 0), JSON.stringify(f.queries));
});
test('projection retains independent origin, duration and collection ownership with per-load versions', () => {
  const f = setup(); const { buildLogisticsDayProjection } = f.load(path.resolve(__dirname, '../lib/logistics-projection.ts'));
  const base = { serviceDate: f.date, originOplocId: 'cpu', destinationOplocId: 'site', scheduledTime: '10:30', runId: 'r1', status: 'planned', version: 4 };
  const loadRecords = [{ ...base, id: 'one', collectionRequired: true, collectionRunId: 'r1' }, { ...base, id: 'two', collectionRequired: true, collectionRunId: 'r2' }, { ...base, id: 'three', scheduledEnd: '12:00' }, { ...base, id: 'four', originOplocId: 'other' }];
  const jobRecords = loadRecords.map(l => ({ ...l, id: 'j:' + l.id, sourceType: 'cpu-production', sourceId: l.id, contents: [], audit: [] })); const projection = buildLogisticsDayProjection({ serviceDate: f.date, loads: loadRecords, jobs: jobRecords, assignments: loadRecords.map(l => ({ loadId: l.id, jobId: 'j:' + l.id })) }); assert.equal(projection.deliveryLoads.length, 4); assert.deepEqual(projection.deliveryLoads[0].loadVersions, { one: 4 });
});
test('current removal requires job and load versions and preserves cancelled history', async () => {
  const f = await assigned(); const load = loads(f)[0]; const job = jobs(f)[0]; const result = await f.post({ action: 'remove-job-from-load', jobId: job.id, loadId: load.id, expectedJobVersion: job.version, expectedLoadVersion: load.version }); assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(assignments(f).length, 0); assert.equal(loads(f)[0].status, 'cancelled'); assert.equal(loads(f)[0].version, load.version + 1);
});
test('source-incompatible operator rescheduling fails without modifying job or load', async () => {
  const f = await assigned(); const before = structuredClone([...f.records]); const load = loads(f)[0]; assert.equal((await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '11:15' })).response.status, 409); assert.deepEqual([...f.records], before);
});
test('readyAt earliest arrival uses UK time across BST and GMT', () => {
  const f = setup(); const make = readyAt => f.materialisation.logisticsJobForRequirement(requirement(f, 'a', { requiredDeliveryWindow: undefined, readyAt }), undefined, 'Operator', 'now').requestedWindow;
  assert.deepEqual(make('2026-07-01T09:00:00Z'), { startTime: '10:00' }); assert.deepEqual(make('2026-12-01T09:00:00Z'), { startTime: '09:00' });
});
test('legacy native ownership cannot be duplicated through the projection job API', async () => {
  const f = setup(); f.requirements.push(requirement(f)); await reconcile(f); f.seed('fikaLogisticsDeliveryStopsV1', 'old', { canonicalId: 'old', runId: 'r2', requirementRefs: [{ requirementId: 'req:a', sourceVersion: 1 }], movementRequestIds: [], status: 'planned', version: 1, audit: [] }); const before = f.writes; const result = await assign(f); assert.equal(result.response.status, 409); assert.equal(f.writes, before); assert.equal(assignments(f).length, 0);
});

// Sol correction: ambiguous assignment authority and atomic merged placement.
function duplicate(f, otherLoad = false) {
  const assignment = assignments(f)[0];
  if (otherLoad) { const load = loads(f)[0]; f.seed('fikaLogisticsDeliveryLoadsV1', 'duplicate-load', { ...load, id: 'duplicate-load' }); }
  f.seed('fikaLogisticsAssignmentsV1', 'legacy-duplicate', { ...assignment, ...(otherLoad ? { loadId: 'duplicate-load' } : {}) });
}
for (const action of ['mark-delivery-load-loaded', 'dispatch-delivery-load', 'reschedule-delivery-load', 'mark-stop-loaded']) test('duplicate same-load authority rejects ' + action + ' without writes', async () => {
  const f = await assigned(); duplicate(f); const load = loads(f)[0]; const before = structuredClone([...f.records]); const writes = f.writes;
  const result = await f.post({ action, loadId: load.id, stopId: action === 'mark-stop-loaded' ? 'projection-stop:delivery:' + load.id : undefined, expectedLoadVersion: load.version, scheduledTime: '10:45' });
  assert.equal(result.response.status, 409, JSON.stringify(result.body)); assert.equal(f.writes, writes); assert.deepEqual([...f.records], before);
});
test('cross-load duplicate ownership rejects mutation of either load', async () => {
  const f = await assigned(); duplicate(f, true); const before = structuredClone([...f.records]);
  for (const load of loads(f)) assert.equal((await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id, expectedLoadVersion: load.version })).response.status, 409);
  assert.deepEqual([...f.records], before);
});
test('mismatched activeLoadId rejects an otherwise unique load', async () => {
  const f = await assigned(); const job = jobs(f)[0]; f.seed('fikaLogisticsJobsV1', job.id, { ...job, activeLoadId: 'other' }); const load = loads(f)[0];
  assert.equal((await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id, expectedLoadVersion: load.version })).response.status, 409);
});
for (const unrelated of [false, true]) test('withdrawal aggregates duplicate removals per load; unrelated=' + unrelated, async () => {
  const f = await assigned();
  if (unrelated) { f.requirements.push(requirement(f, 'b')); await reconcile(f); assert.equal((await assign(f, 'logistics-job:req:b')).response.status, 200); }
  duplicate(f); const original = loads(f)[0]; f.requirements[0] = { ...f.requirements[0], status: 'withdrawn', sourceVersion: 2 }; await reconcile(f);
  assert.equal(assignments(f).length, unrelated ? 1 : 0); assert.equal(loads(f)[0].status, unrelated ? 'planned' : 'cancelled'); assert.equal(loads(f)[0].version, original.version + 1);
  const before = structuredClone([...f.records]); await reconcile(f); assert.deepEqual([...f.records], before);
});
async function merged() {
  const f = await assigned(); const first = loads(f)[0]; const job = jobs(f)[0];
  f.seed('fikaLogisticsDeliveryLoadsV1', 'historical-load:b', { ...first, id: 'historical-load:b' });
  f.seed('fikaLogisticsJobsV1', 'logistics-job:req:b', { ...job, id: 'logistics-job:req:b', requirementId: 'req:b', sourceId: 'order:b', activeLoadId: 'historical-load:b' });
  f.seed('fikaLogisticsAssignmentsV1', 'assignment:b', { ...assignments(f)[0], jobId: 'logistics-job:req:b', loadId: 'historical-load:b' });
  await f.materialisation.rebuildLogisticsProjection(f.date, 'Operator'); return f;
}
function bulk(f, extra = {}) { return { action: 'reschedule-delivery-loads', loadIds: loads(f).map(l => l.id), expectedLoadVersions: Object.fromEntries(loads(f).map(l => [l.id, l.version])), scheduledTime: '10:45', scheduledEnd: '12:00', targetRunId: 'r1', lane: 'delivery', ...extra }; }
for (const lane of ['delivery', 'collection']) test('merged ' + lane + ' placement commits common schedule and versions once', async () => {
  const f = await merged(); const originals = loads(f); const result = await f.post(bulk(f, lane === 'collection' ? { lane, scheduledTime: '14:00', scheduledEnd: '15:00', targetRunId: 'r2' } : {}));
  assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(result.body.loads.length, 2);
  for (const load of loads(f)) { const old = originals.find(l => l.id === load.id); assert.equal(load.version, old.version + 1); assert.equal(load.runId, 'r1'); assert.equal(load.vehicleId, 'van1'); if (lane === 'collection') { assert.equal(load.collectionRunId, 'r2'); assert.equal(load.collectionScheduledTime, '14:00'); assert.equal(load.scheduledTime, old.scheduledTime); } else assert.equal(load.scheduledTime, '10:45'); }
  const projection = f.records.get('fikaLogisticsDayProjectionsV1/' + f.date); assert.equal(projection.deliveryLoads.length, 1); assert.equal(projection.deliveryLoads[0].loadIds.length, 2);
});
test('second merged member stale CAS rolls back the whole placement', async () => {
  const f = await merged(); const command = bulk(f); command.expectedLoadVersions[command.loadIds[1]] = 0; const before = structuredClone([...f.records]);
  assert.equal((await f.post(command)).response.status, 409); assert.deepEqual([...f.records], before);
});
test('second merged member source incompatibility commits neither load', async () => {
  const f = await merged(); const job = jobs(f)[1]; f.seed('fikaLogisticsJobsV1', job.id, { ...job, requestedWindow: { startTime: '10:00', endTime: '10:35' } }); const before = structuredClone([...f.records]);
  assert.equal((await f.post(bulk(f))).response.status, 409); assert.deepEqual([...f.records], before);
});
test('proposed unauthorized collection owner commits neither merged member', async () => {
  const f = await merged(); f.principal.permittedVehicleIds = ['van1']; const before = structuredClone([...f.records]);
  assert.equal((await f.post(bulk(f, { lane: 'collection', targetRunId: 'r2', scheduledTime: '14:00' }))).response.status, 403); assert.deepEqual([...f.records], before);
});
test('second owner becoming unauthorized inside transaction commits neither member', async () => {
  const f = await merged(); f.principal.permittedVehicleIds = ['van1']; const command = bulk(f);
  f.beforeNextTransaction(() => { const second = loads(f)[1]; f.seed('fikaLogisticsDeliveryLoadsV1', second.id, { ...second, collectionRunId: 'r2' }); });
  const originals = loads(f); const result = await f.post(command); assert.equal(result.response.status, 403);
  for (const load of loads(f)) { assert.equal(load.scheduledTime, '10:30'); assert.equal(load.version, originals.find(l => l.id === load.id).version); }
});
for (const ids of [[], ['x', 'x'], Array.from({ length: 51 }, (_, i) => 'x' + i)]) test('bulk rejects invalid bounded ID set length=' + ids.length, async () => { const f = setup(); assert.equal((await f.post({ action: 'reschedule-delivery-loads', loadIds: ids, scheduledTime: '10:00' })).response.status, 422); });
test('one explicit divergent operation legitimately splits the projection', async () => {
  const f = await merged(); const load = loads(f)[0]; const result = await f.post({ action: 'reschedule-delivery-load', loadId: load.id, expectedLoadVersion: load.version, scheduledTime: '10:45' }); assert.equal(result.response.status, 200); assert.equal(f.records.get('fikaLogisticsDayProjectionsV1/' + f.date).deliveryLoads.length, 2);
});
test('clean multi-job load passes membership checks and marks loaded once', async () => { const f = await assigned(); f.requirements.push(requirement(f, 'b')); await reconcile(f); assert.equal((await assign(f, 'logistics-job:req:b')).response.status, 200); const load = loads(f)[0]; const result = await f.post({ action: 'mark-delivery-load-loaded', loadId: load.id, expectedLoadVersion: load.version }); assert.equal(result.response.status, 200); assert.equal(loads(f)[0].version, load.version + 1); });

test('merged placement resolves one collision-adjusted arrival for every constituent', async () => {
  const f = await merged(); const first = loads(f)[0]; f.seed('fikaLogisticsDeliveryLoadsV1', 'collision', { ...first, id: 'collision', destinationOplocId: 'other', scheduledTime: '10:45', scheduledEnd: '11:00' });
  const selected = loads(f).filter(l => l.id !== 'collision'); const result = await f.post(bulk(f, { loadIds: selected.map(l => l.id), scheduledTime: '10:45', scheduledEnd: undefined }));
  assert.equal(result.response.status, 200, JSON.stringify(result.body)); assert.equal(result.body.loads[0].scheduledTime, '11:00'); assert.equal(result.body.loads[1].scheduledTime, '11:00');
});
test('incompatible grouping semantics cannot be bundled into one placement', async () => { const f = await merged(); const second = loads(f)[1]; f.seed('fikaLogisticsDeliveryLoadsV1', second.id, { ...second, scheduledEnd: '12:00' }); const before = structuredClone([...f.records]); assert.equal((await f.post(bulk(f))).response.status, 409); assert.deepEqual([...f.records], before); });
