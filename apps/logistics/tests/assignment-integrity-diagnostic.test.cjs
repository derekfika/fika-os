const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { fixture } = require('./helpers/authority-route-harness.cjs');
const modulePath = name => path.resolve(__dirname, '../lib/' + name + '.ts');

test('shared compatibility explanations preserve production arrival and location predicates', () => {
  const f = fixture();
  const { compatibleLoad, explainLoadCompatibility } = f.load(modulePath('delivery-loads'));
  const baseJob = { serviceDate: f.date, originOplocId: 'cpu', destinationOplocId: 'site', requestedWindow: { startTime: '10:00', endTime: '11:00' } };
  const baseLoad = { ...baseJob, scheduledTime: '10:30', scheduledEnd: '12:00', status: 'planned' };
  const cases = [
    [{}, {}, true, []],
    [{ sourceStatus: 'withdrawn' }, {}, false, ['job_withdrawn']],
    [{}, { status: 'cancelled' }, false, ['load_cancelled']],
    [{ originOplocId: undefined }, {}, false, ['missing_canonical_origin_or_destination', 'origin_oploc_mismatch']],
    [{}, { serviceDate: '2099-01-06' }, false, ['service_date_mismatch']],
    [{}, { originOplocId: 'other' }, false, ['origin_oploc_mismatch']],
    [{}, { destinationOplocId: 'other' }, false, ['destination_oploc_mismatch']],
    [{}, { scheduledTime: '09:45' }, false, ['scheduled_arrival_outside_current_requested_window']],
    [{}, { scheduledTime: '11:15' }, false, ['scheduled_arrival_outside_current_requested_window']],
    [{ requestedWindow: { startTime: '10:00' } }, {}, true, []],
    [{ requestedWindow: undefined }, { scheduledTime: '09:45' }, true, []],
  ];
  for (const [jobChanges, loadChanges, expected, reasons] of cases) {
    const job = { ...baseJob, ...jobChanges }, load = { ...baseLoad, ...loadChanges };
    const result = explainLoadCompatibility(job, load);
    assert.equal(result.compatible, expected);
    assert.equal(compatibleLoad(job, load), expected);
    assert.deepEqual(result.reasons, reasons);
  }
});

test('merged cards retain canonical coverage and do not trigger a count-only sync error', async () => {
  const f = fixture(['van1', 'van2'], ['logistics.repair']);
  Object.assign(f.records.get('fikaLogisticsDeliveryLoadsV1/l2'), { runId: 'r1', destinationOplocId: 'site:l1' });
  Object.assign(f.records.get('fikaLogisticsJobsV1/jl2'), { destinationOplocId: 'site:l1' });
  await f.rebuild();
  const before = f.writes;
  const { response, body } = await f.get('diagnostic=1');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'In sync');
  assert.equal(body.runIntegrity.entityCounts.loads, 2);
  assert.equal(body.assignmentIntegrity.projectionCards.length, 1);
  assert.deepEqual(body.assignmentIntegrity.projectionCards[0].loadIds, ['l1', 'l2']);
  assert.deepEqual(body.assignmentIntegrity.coverage.loads, { missingFromProjection: [], projectionOnly: [] });
  assert.deepEqual(body.assignmentIntegrity.summary, { persistedAssignments: 2, acceptedAssignments: 2, rejectedAssignments: 0, validAssignedJobs: 2, invalidAssignedJobs: 0, trulyUnassignedJobs: 0 });
  assert.equal(f.writes, before);
});

test('diagnostic separates canonical incompatibility, undated input exclusions and genuinely unassigned jobs', async () => {
  const f = fixture(['van1', 'van2'], ['logistics.repair']);
  f.records.get('fikaLogisticsJobsV1/jl1').requestedWindow = { startTime: '10:00', endTime: '11:00' };
  delete f.records.get('fikaLogisticsAssignmentsV1/jl2:l2').serviceDate;
  const template = f.records.get('fikaLogisticsJobsV1/jl1');
  f.seed('fikaLogisticsJobsV1', 'unassigned', { ...template, id: 'unassigned' });
  await f.rebuild();
  const before = f.writes;
  const { body } = await f.get('diagnostic=1');
  const rows = body.assignmentIntegrity.assignments;
  assert.equal(rows.find(r => r.jobId === 'jl1').compatible, false);
  assert.deepEqual(rows.find(r => r.jobId === 'jl1').failureReasons, ['scheduled_arrival_outside_current_requested_window']);
  const undated = rows.find(r => r.jobId === 'jl2');
  assert.equal(undated.compatible, true);
  assert.equal(undated.acceptedByProjection, false);
  assert.deepEqual(undated.failureReasons, ['missing_assignment_service_date']);
  assert.equal(body.assignmentIntegrity.summary.rejectedAssignments, 2);
  assert.equal(body.assignmentIntegrity.summary.trulyUnassignedJobs, 1);
  assert.deepEqual(body.assignmentIntegrity.trulyUnassignedJobs.map(j => j.id), ['unassigned']);
  assert.equal(body.status, 'In sync', 'faithfully rejecting invalid assignments is distinct from stale materialisation');
  assert.equal(f.writes, before);
});

test('duplicate, missing and date-mismatched references are reported with bounded direct lookups', async () => {
  const f = fixture(['van1', 'van2'], ['logistics.repair']);
  f.seed('fikaLogisticsAssignmentsV1', 'duplicate', { jobId: 'jl1', loadId: 'l1', serviceDate: f.date });
  f.seed('fikaLogisticsAssignmentsV1', 'missing-job', { jobId: 'absent', loadId: 'l1', serviceDate: f.date });
  f.seed('fikaLogisticsAssignmentsV1', 'missing-load', { jobId: 'jl2', loadId: 'absent', serviceDate: f.date });
  f.seed('fikaLogisticsJobsV1', 'foreign', { ...f.records.get('fikaLogisticsJobsV1/jl1'), id: 'foreign', serviceDate: '2099-01-06' });
  f.seed('fikaLogisticsAssignmentsV1', 'foreign-reference', { jobId: 'foreign', loadId: 'l1', serviceDate: f.date });
  f.seed('fikaLogisticsAssignmentsV1', 'unrelated', { jobId: 'unrelated', loadId: 'unrelated', serviceDate: '2099-01-06' });
  const before = f.writes;
  const { response, body } = await f.get('diagnostic=1');
  assert.equal(response.status, 200);
  const rows = body.assignmentIntegrity.assignments;
  assert.ok(rows.find(r => r.id === 'duplicate').failureReasons.includes('duplicate_assignment_for_job'));
  assert.deepEqual(rows.find(r => r.id === 'missing-job').failureReasons, ['missing_job']);
  assert.ok(rows.find(r => r.id === 'missing-load').failureReasons.includes('missing_load'));
  const foreign = rows.find(r => r.id === 'foreign-reference');
  assert.equal(foreign.jobExists, true);
  assert.ok(foreign.failureReasons.includes('service_date_mismatch'));
  assert.ok(foreign.failureReasons.includes('job_outside_requested_service_date'));
  assert.equal(body.runIntegrity.entityCounts.jobs, 2, 'related reference reads must not inflate raw day counts');
  assert.equal(rows.some(r => r.id === 'unrelated'), false);
  assert.ok(f.queries.every(query => query.filters.length > 0));
  assert.equal(f.writes, before);
});

test('repair authority and normal response privacy remain enforced for assignment evidence', async () => {
  const f = fixture(['van1'], []);
  const before = f.writes;
  const denied = await f.get('diagnostic=1');
  assert.equal(denied.response.status, 403);
  assert.equal(Object.hasOwn(denied.body, 'assignmentIntegrity'), false);
  await f.rebuild();
  const normal = await f.get();
  assert.equal(Object.hasOwn(normal.body, 'assignmentIntegrity'), false);
  assert.equal(f.writes, before + 2, 'only the explicit fixture rebuild writes projection and cursor');
});
