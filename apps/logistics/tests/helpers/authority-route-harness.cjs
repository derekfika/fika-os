const path = require('node:path');
const { typescriptLoader } = require('../../../../scripts/testing/load-typescript.cjs');
const { NextRequest } = require('next/server');
exports.fixture = function (permittedVehicleIds = ['van1'], maintenanceAuthorities = [], realReconciliation = false) {
  const appRoot = path.resolve(__dirname, '../..');
  const records = new Map();
  let writes = 0;
  const queries = [];
  let beforeTransaction;
  let commitTail = Promise.resolve();
  const copy = value => value === undefined ? undefined : structuredClone(value);
  class Query {
    constructor(name, filters = [], limit = Infinity) { this.name = name; this.filters = filters; this.cap = limit; }
    where(field, op, value) { return new Query(this.name, [...this.filters, [field, op, value]], this.cap); }
    limit(n) { return new Query(this.name, this.filters, n); }
    orderBy() { return this; }
    async get() {
      queries.push({ collection: this.name, filters: copy(this.filters), limit: this.cap });
      const docs = [...records].filter(([key, value]) => key.startsWith(this.name + '/') && this.filters.every(([field, op, input]) => op === '==' ? value[field] === input : op === 'in' ? input.includes(value[field]) : op === 'array-contains' ? value[field]?.includes(input) : op === '>' ? value[field] > input : false)).slice(0, this.cap).map(([key]) => new Ref(key).snapshot());
      return { docs, size: docs.length, empty: !docs.length };
    }
    doc(id) { return new Ref(this.name + '/' + id); }
  }
  class Ref {
    constructor(key) { this.path = key; this.id = key.split('/').at(-1); this.parent = { id: key.split('/')[0] }; }
    snapshot() { const captured = copy(records.get(this.path)); return { exists: records.has(this.path), id: this.id, ref: this, data: () => copy(captured) }; }
    async get() { return this.snapshot(); }
    async set(value, options) { records.set(this.path, options?.merge ? { ...records.get(this.path), ...copy(value) } : copy(value)); writes++; }
    async update(value) { await this.set(value, { merge: true }); }
    async delete() { records.delete(this.path); writes++; }
  }
  function transaction() {
    const pending = [], reads = [];
    const fingerprint = snapshot => JSON.stringify(snapshot.docs ? snapshot.docs.map(d => [d.id, d.data()]) : [snapshot.exists, snapshot.data()]);
    const value = { get: async ref => { const snapshot = await ref.get(); reads.push([ref, fingerprint(snapshot)]); return snapshot; }, set: (ref, data, options) => { pending.push(['set', ref, data, options]); return value; }, create: (ref, data) => { pending.push(['set', ref, data]); return value; }, update: (ref, data) => { pending.push(['set', ref, data, { merge: true }]); return value; }, delete: ref => { pending.push(['delete', ref]); return value; }, commit: async () => {
      const priorCommit = commitTail; let release; commitTail = new Promise(resolve => { release = resolve; }); await priorCommit;
      try {
      for (const [ref, expected] of reads) if (fingerprint(await ref.get()) !== expected) throw Object.assign(new Error('test transaction contention'), { retryTransaction: true });
      // Commit synchronously once every recorded read still agrees.
      for (const [method, ref, data, options] of pending) { if (method === 'delete') records.delete(ref.path); else records.set(ref.path, options?.merge ? { ...records.get(ref.path), ...copy(data) } : copy(data)); writes++; }
      } finally { release(); }
    } };
    return value;
  }
  const db = { collection: name => new Query(name), batch: transaction, runTransaction: async callback => { if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = undefined; hook(); } for (let attempt=0; attempt<8; attempt++) { const tx = transaction(); try { const result = await callback(tx); await tx.commit(); return result; } catch(error) { if (!error.retryTransaction || attempt === 7) throw error; } } } };
  const principal = { type: 'interactive', id: 'operator', displayName: 'Operator', identityKind: 'person', permittedVehicleIds, maintenanceAuthorities };
  const driver = { driverId: 'person:driver', displayName: 'Governed Driver', permittedDriverVehicleIds: ['van1'] };
  let driverActive = true;
  const alternateDriver = { driverId: 'person:replacement', displayName: 'Replacement Driver', permittedDriverVehicleIds: ['van1'] };
  const requirements = [];
  const oplocs = [], locationReads = [];
  let locationFailure;
  const authorityRequests = [];
  const localFetch = async input => {
    const url = new URL(String(input));
    authorityRequests.push(url.pathname);
    if (url.pathname.endsWith('/api/logistics/access')) return Response.json({ principal: { ...principal, authmodIdentityId: principal.id } });
    if (url.pathname.endsWith('/api/logistics/drivers')) {
      const eligible = driverActive ? [driver, alternateDriver] : [alternateDriver];
      if (url.searchParams.has('driverId') && (!eligible.some(item => item.driverId === url.searchParams.get('driverId')) || url.searchParams.get('vehicle') !== 'van1')) return Response.json({}, { status: 422 });
      return Response.json({ drivers: eligible });
    }
    throw new Error('Unexpected test network call: ' + url.pathname);
  };
  const mocks = {
    [path.join(appRoot, 'lib/firebase.ts')]: { db },
    [path.join(appRoot, 'lib/firebase-admin.ts')]: { db },
    [path.join(appRoot, 'lib/runtime.ts')]: { hostedRuntime: () => false, requiredUpstreamUrl: () => 'https://hub.test' },
    '@/lib/firebase': { db },
    '@/lib/firebase-admin': { db },
    '@/lib/runtime': { hostedRuntime: () => false, requiredUpstreamUrl: () => 'https://hub.test' },
    '@fika/server-shared/data-source-meter-server': { recordDataAccess() {}, withDataTrace: (_, callback) => callback() },
    '@fika/server-shared/data-source-meter-client': { recordDataAccess() {}, withDataTrace: (_, callback) => callback() },
    [path.resolve(appRoot, '../../shared/auth-diagnostics.ts')]: { logAuthDiagnostic() {} },
    '@/lib/upstream': { fetchRequirements: async () => requirements, fetchRequirementsForDateRange: async () => requirements, fetchProductionContexts: async () => [], fetchOplocs: async cookie => { locationReads.push(cookie); if (locationFailure) throw locationFailure; return oplocs; } },
  };
  mocks[path.join(appRoot, 'lib/upstream.ts')] = mocks['@/lib/upstream'];
  const load = typescriptLoader({ typescript: require('typescript'), appRoot, mocks, fetch: localFetch });
  const store = load(path.join(appRoot, 'lib/store.ts'));
  const { buildLogisticsDayProjection } = load(path.join(appRoot, 'lib/logistics-projection.ts'));
  const date = '2099-01-05';
  function seed(collection, id, data) { records.set(collection + '/' + id, copy(data)); }
  const run = (id, vehicleId) => ({ canonicalId: id, serviceDate: date, vehicleId, vehicleLabel: vehicleId === 'van1' ? 'Van 1' : 'Van 2', status: 'planned', orderedStopIds: [], version: 1, audit: [], createdAt: 'now', updatedAt: 'now' });
  seed('fikaLogisticsDeliveryRunsV1', 'r1', run('r1', 'van1'));
  seed('fikaLogisticsDeliveryRunsV1', 'r2', run('r2', 'van2'));
  for (const [id, runId] of [['s1', 'r1'], ['s2', 'r2']]) {
    seed('fikaLogisticsDeliveryStopsV1', id, { canonicalId: id, runId, sequence: 1, locationOplocId: 'site:' + id, locationLabelSnapshot: id, movementRequestIds: [], requirementRefs: [], status: 'planned', version: 1, audit: [], createdAt: 'now', updatedAt: 'now', plannedArrivalTime: '09:00' });
    records.get('fikaLogisticsDeliveryRunsV1/' + runId).orderedStopIds = [id];
  }
  for (const [id, runId] of [['l1', 'r1'], ['l2', 'r2']]) {
    seed('fikaLogisticsDeliveryLoadsV1', id, { id, runId, serviceDate: date, originOplocId: 'cpu', destinationOplocId: 'site:' + id, scheduledTime: '09:00', status: 'planned', version: 1, audit: [], createdAt: 'now', updatedAt: 'now' });
    seed('fikaLogisticsJobsV1', 'j' + id, { id: 'j' + id, serviceDate: date, sourceType: 'cpu-production', sourceId: 'order:' + id, originOplocId: 'cpu', destinationOplocId: 'site:' + id, productionReadiness: 'ready', collectionStatus: 'collected', contents: [], version: 1, audit: [], createdAt: 'now', updatedAt: 'now' });
    seed('fikaLogisticsAssignmentsV1', 'j' + id + ':' + id, { jobId: 'j' + id, loadId: id, serviceDate: date, assignedAt: 'now', assignedBy: 'operator', audit: [] });
  }
  // Seeded authority fixtures represent valid current, loaded projected work.
  for (const id of ['l1', 'l2']) {
    const job = records.get('fikaLogisticsJobsV1/j' + id); job.requirementId = 'req:' + id; job.sourceVersion = 1; job.deliveryStatus = 'loaded';
    records.get('fikaLogisticsDeliveryLoadsV1/' + id).loaded = true;
    requirements.push({ canonicalId: job.requirementId, sourceDomain: job.sourceType, sourceEntityId: job.sourceId, sourceVersion: 1, serviceDate: date, productionLocationId: job.originOplocId, destinationOplocId: job.destinationOplocId, destinationLabelSnapshot: job.destinationOplocId, status: 'ready_for_planning', lines: [], requiredDeliveryWindow: { startTime: '09:00' } });
  }
  async function rebuild(serviceDate = date) {
    const state = await store.listState(serviceDate);
    const loads = await store.listDeliveryLoadState(serviceDate);
    const projection = buildLogisticsDayProjection({ serviceDate, ...state, ...loads, lastChangeSequence: 1 });
    await store.saveLogisticsProjection(projection);
    return projection;
  }
  const materialisation = load(path.join(appRoot, 'lib/logistics-materialisation.ts'));
  mocks['@/lib/logistics-materialisation'] = { logisticsJobForRequirement: materialisation.logisticsJobForRequirement, rebuildLogisticsProjection: rebuild, reconcileLogisticsDay: async serviceDate => ({ projection: await rebuild(serviceDate), requirements: [] }) };
  if (realReconciliation) mocks['@/lib/logistics-materialisation'] = materialisation;
  const route = load(path.join(appRoot, 'app/api/logistics/route.ts'));
  const driversRoute = load(path.join(appRoot, 'app/api/logistics/drivers/route.ts'));
  const vehiclesRoute = load(path.join(appRoot, 'app/api/logistics/vehicles/route.ts'));
  return { date, queries, authorityRequests, materialisation, load, records, run, principal, seed, rebuild, requirements, oplocs, locationReads, failLocations(error) { locationFailure = error; }, get writes() { return writes; }, deactivateDriver() { driverActive = false; },
    beforeNextTransaction(hook) { beforeTransaction = hook; },
    async get(query = '') { const response = await route.GET(new NextRequest('https://logistics.test/api/logistics?serviceDate=' + date + (query ? '&' + query : ''))); return { response, body: await response.json() }; },
    async drivers() { const response = await driversRoute.GET(new NextRequest('https://logistics.test/api/logistics/drivers')); return { response, body: await response.json() }; },
    async vehicles(query = '') { const response = await vehiclesRoute.GET(new NextRequest('https://logistics.test/api/logistics/vehicles' + query)); return { response, body: await response.json() }; },
    async post(body, query = '') { const response = await route.POST(new NextRequest('https://logistics.test/api/logistics' + query, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { response, body: await response.json() }; },
  };
};
