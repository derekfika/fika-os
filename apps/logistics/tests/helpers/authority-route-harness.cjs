const path = require('node:path');
const { typescriptLoader } = require('../../../../scripts/testing/load-typescript.cjs');
const { NextRequest } = require('next/server');
exports.fixture = function (permittedVehicleIds = ['van1'], maintenanceAuthorities = []) {
  const appRoot = path.resolve(__dirname, '../..');
  const records = new Map();
  let writes = 0;
  let beforeTransaction;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  class Query {
    constructor(name, filters = [], limit = Infinity) { this.name = name; this.filters = filters; this.cap = limit; }
    where(field, op, value) { return new Query(this.name, [...this.filters, [field, op, value]], this.cap); }
    limit(n) { return new Query(this.name, this.filters, n); }
    orderBy() { return this; }
    async get() {
      const docs = [...records].filter(([key, value]) => key.startsWith(this.name + '/') && this.filters.every(([field, op, input]) => op === '==' ? value[field] === input : op === 'in' ? input.includes(value[field]) : op === 'array-contains' ? value[field]?.includes(input) : op === '>' ? value[field] > input : false)).slice(0, this.cap).map(([key]) => new Ref(key).snapshot());
      return { docs, size: docs.length, empty: !docs.length };
    }
    doc(id) { return new Ref(this.name + '/' + id); }
  }
  class Ref {
    constructor(key) { this.path = key; this.id = key.split('/').at(-1); this.parent = { id: key.split('/')[0] }; }
    snapshot() { return { exists: records.has(this.path), id: this.id, ref: this, data: () => copy(records.get(this.path)) }; }
    async get() { return this.snapshot(); }
    async set(value, options) { records.set(this.path, options?.merge ? { ...records.get(this.path), ...copy(value) } : copy(value)); writes++; }
    async update(value) { await this.set(value, { merge: true }); }
    async delete() { records.delete(this.path); writes++; }
  }
  function transaction() {
    const pending = [];
    const value = { get: ref => ref.get(), set: (...args) => { pending.push(() => args[0].set(...args.slice(1))); return value; }, create: (...args) => { pending.push(() => args[0].set(...args.slice(1))); return value; }, update: (...args) => { pending.push(() => args[0].update(...args.slice(1))); return value; }, delete: ref => { pending.push(() => ref.delete()); return value; }, commit: async () => { for (const write of pending) await write(); } };
    return value;
  }
  const db = { collection: name => new Query(name), batch: transaction, runTransaction: async callback => { if (beforeTransaction) { const hook = beforeTransaction; beforeTransaction = undefined; hook(); } const tx = transaction(); const result = await callback(tx); await tx.commit(); return result; } };
  const principal = { type: 'interactive', id: 'operator', displayName: 'Operator', identityKind: 'person', permittedVehicleIds, maintenanceAuthorities };
  const driver = { driverId: 'person:driver', displayName: 'Governed Driver', permittedDriverVehicleIds: ['van1'] };
  let driverActive = true;
  const alternateDriver = { driverId: 'person:replacement', displayName: 'Replacement Driver', permittedDriverVehicleIds: ['van1'] };
  const requirements = [];
  const localFetch = async input => {
    const url = new URL(String(input));
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
    [path.resolve(appRoot, '../../shared/auth-diagnostics.ts')]: { logAuthDiagnostic() {} },
    '@/lib/upstream': { fetchRequirements: async () => requirements, fetchRequirementsForDateRange: async () => requirements, fetchProductionContexts: async () => [], fetchOplocs: async () => [] },
  };
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
  async function rebuild(serviceDate = date) {
    const state = await store.listState(serviceDate);
    const loads = await store.listDeliveryLoadState(serviceDate);
    const projection = buildLogisticsDayProjection({ serviceDate, ...state, ...loads, lastChangeSequence: 1 });
    await store.saveLogisticsProjection(projection);
    return projection;
  }
  mocks['@/lib/logistics-materialisation'] = { rebuildLogisticsProjection: rebuild, reconcileLogisticsDay: async serviceDate => ({ projection: await rebuild(serviceDate), requirements: [] }) };
  const route = load(path.join(appRoot, 'app/api/logistics/route.ts'));
  const driversRoute = load(path.join(appRoot, 'app/api/logistics/drivers/route.ts'));
  return { date, records, run, principal, seed, rebuild, requirements, get writes() { return writes; }, deactivateDriver() { driverActive = false; },
    beforeNextTransaction(hook) { beforeTransaction = hook; },
    async get(query = '') { const response = await route.GET(new NextRequest('https://logistics.test/api/logistics?serviceDate=' + date + (query ? '&' + query : ''))); return { response, body: await response.json() }; },
    async drivers() { const response = await driversRoute.GET(new NextRequest('https://logistics.test/api/logistics/drivers')); return { response, body: await response.json() }; },
    async post(body, query = '') { const response = await route.POST(new NextRequest('https://logistics.test/api/logistics' + query, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { response, body: await response.json() }; },
  };
};
