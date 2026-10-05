const assert = require('node:assert/strict');
const { fixture } = require('./authority-route-harness.cjs');
const rows = (f, name) => [...f.records].filter(([key]) => key.startsWith(name + '/')).map(([, value]) => structuredClone(value));
const jobs = f => rows(f, 'fikaLogisticsJobsV1');
const loads = f => rows(f, 'fikaLogisticsDeliveryLoadsV1');
const run = (f, id = 'r1') => structuredClone(f.records.get('fikaLogisticsDeliveryRunsV1/' + id));
async function setup({ count = 2, collection = false, merged = false, native = false, draft = false } = {}) {
  const f = fixture(['van1', 'van2'], ['logistics.reconcile'], true); f.requirements.length = 0;
  for (const key of [...f.records.keys()]) if (!key.startsWith('fikaLogisticsDeliveryRunsV1/')) f.records.delete(key);
  for (const value of f.records.values()) value.orderedStopIds = [];
  if (draft) f.records.get("fikaLogisticsDeliveryRunsV1/r1").status = "draft";
  for (let i = 0; i < count; i++) f.requirements.push({ canonicalId: 'req:' + i, sourceDomain: 'cpu-production', sourceEntityId: 'order:' + i, sourceVersion: 1, serviceDate: f.date, productionLocationId: 'cpu', destinationOplocId: 'site', destinationLabelSnapshot: 'Execution site', requiredDeliveryWindow: { startTime: '10:00', endTime: '11:00' }, status: 'ready_for_planning', lines: [{ displayNameSnapshot: 'Subload ' + i, quantity: 10, unit: 'portion' }] });
  await f.materialisation.reconcileLogisticsDay(f.date, 'Operator');
  if (native) {
    f.seed('fikaLogisticsDeliveryStopsV1', 'native', { canonicalId: 'native', runId: 'r1', sequence: 1, locationOplocId: 'site', locationLabelSnapshot: 'Native site', requirementRefs: [{ requirementId: 'req:0', sourceVersion: 1 }], movementRequestIds: [], plannedArrivalTime: '10:30', status: 'planned', loaded: false, version: 1, createdAt: 'now', updatedAt: 'now', audit: [] });
    f.records.get('fikaLogisticsDeliveryRunsV1/r1').orderedStopIds = ['native'];
  } else for (const job of jobs(f)) {
    const response = await f.post({ action: 'assign-job-to-load', jobId: job.id, expectedJobVersion: job.version, expectedLoadVersions: Object.fromEntries(loads(f).map(load => [load.id, load.version])), scheduledTime: '10:30', targetRunId: 'r1', collectionRequired: collection });
    assert.equal(response.response.status, 200, JSON.stringify(response.body));
  }
  if (merged) {
    const load = loads(f)[0], job = jobs(f).at(-1);
    const second = { ...load, id: 'historical:merged' }; f.seed('fikaLogisticsDeliveryLoadsV1', second.id, second);
    f.records.get('fikaLogisticsJobsV1/' + job.id).activeLoadId = second.id;
    for (const [key, value] of f.records) if (key.startsWith('fikaLogisticsAssignmentsV1/') && value.jobId === job.id) value.loadId = second.id;
  }
  if (collection) for (const load of loads(f)) f.records.get('fikaLogisticsDeliveryLoadsV1/' + load.id).collectionScheduledTime = '14:00';
  const driver = await f.post({ action: 'set-run-driver', runId: 'r1', expectedRunVersion: run(f).version, driverId: 'person:driver' }); assert.equal(driver.response.status, 200);
  await f.materialisation.rebuildLogisticsProjection(f.date, 'Operator'); return f;
}
async function lifecycle(f, action, id = 'r1', extra = {}) { return f.post({ action, runId: id, expectedRunVersion: run(f, id).version, ...extra }); }
async function execute(f, action, lane = 'delivery', extra = {}) {
  const selected = loads(f); const owner = lane === 'delivery' ? selected[0].runId : selected[0].collectionRunId || selected[0].runId;
  return f.post({ action, runId: owner, expectedRunVersion: run(f, owner).version, stopId: `projection-stop:${lane}:${selected[0].id}`, loadIds: selected.map(load => load.id), expectedLoadVersions: Object.fromEntries(selected.map(load => [load.id, load.version])), expectedJobVersions: Object.fromEntries(jobs(f).map(job => [job.id, job.version])), ...extra });
}
async function nativeExecute(f, action, extra = {}) { const stop = f.records.get('fikaLogisticsDeliveryStopsV1/native'); return f.post({ action, runId: 'r1', stopId: 'native', expectedRunVersion: run(f).version, expectedStopVersion: stop.version, ...extra }); }
async function depart(f, native = false) { const loaded = native ? await nativeExecute(f, 'mark-stop-loaded') : await execute(f, 'mark-stop-loaded'); assert.equal(loaded.response.status, 200, JSON.stringify(loaded.body)); const dispatched = await lifecycle(f, 'dispatch-run'); assert.equal(dispatched.response.status, 200, JSON.stringify(dispatched.body)); }
module.exports = { setup, jobs, loads, run, execute, lifecycle, nativeExecute, depart };
