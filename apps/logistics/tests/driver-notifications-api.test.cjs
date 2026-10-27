const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

const appRoot = path.resolve(__dirname, '..');
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RUNS = 'fikaLogisticsDeliveryRunsV1';
const EVENTS = 'fikaLogisticsDriverChangeEventsV1';
const SECRET = 'driver-inbox-test-secret-0123456789abcdef';
const VERIFIER = { van1: 'van1-verifier-fixture', van2: 'van2-verifier-fixture' };
const URL = 'https://logistics.test/api/logistics/driver-notifications';

function setup() {
  Object.assign(process.env, { LOGISTICS_MOBILE_SESSION_SECRET: SECRET, LOGISTICS_MOBILE_VAN1_PIN_VERIFIER: VERIFIER.van1, LOGISTICS_MOBILE_VAN2_PIN_VERIFIER: VERIFIER.van2, FIKA_INTERNAL_API_TOKEN: 'internal-processor-test-token' });
  const f = fixture(['van1', 'van2'], [], true);
  const today = londonToday();
  for (const id of ['r1', 'r2']) Object.assign(f.records.get(`${RUNS}/${id}`), { serviceDate: today, plannedCpuDepartureTime: '10:00', plannedCpuReturnTime: '16:00' });
  const route = f.load(path.join(appRoot, 'app/api/logistics/driver-notifications/route.ts'));
  const session = f.load(path.join(appRoot, 'lib/mobile-pin-session.ts'));
  const store = f.load(path.join(appRoot, 'lib/driver-notification-store.ts'));
  const cookieFor = vehicle => `fika_logistics_mobile_session_${vehicle}=${session.signMobilePinSession({ vehicleId: vehicle, verifier: VERIFIER[vehicle], secret: SECRET })}`;
  const request = (vehicle, { method = 'GET', body, query = '', cookie } = {}) => new NextRequest(URL + query, {
    method,
    headers: { 'content-type': 'application/json', ...(vehicle ? { 'x-fika-logistics-mobile-request': '1', 'x-fika-logistics-vehicle': vehicle, cookie: cookie ?? cookieFor(vehicle) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const call = async (handler, req) => { const response = await handler(req); return { response, body: await response.json() }; };
  const timing = (id, departure) => f.post({ action: 'update-run-timing', runId: id, expectedRunVersion: structuredClone(f.records.get(`${RUNS}/${id}`)).version, plannedCpuDepartureTime: departure, plannedCpuReturnTime: '16:00' });
  return { f, route, store, request, call, timing, cookieFor };
}

test('each van sees only its own notifications, newest first, with a correct unread count', async () => {
  const { route, request, call, timing } = setup();
  await timing('r1', '11:30');
  await timing('r1', '12:00');
  await timing('r2', '13:00');
  const van1 = await call(route.GET, request('van1'));
  assert.equal(van1.response.status, 200, JSON.stringify(van1.body));
  assert.equal(van1.body.vehicleId, 'van1');
  assert.equal(van1.body.items.length, 2);
  assert.equal(van1.body.unreadCount, 2);
  assert.ok(van1.body.items.every(item => item.runId === 'r1'));
  assert.deepEqual([...van1.body.items].map(i => i.createdAt), [...van1.body.items].map(i => i.createdAt).sort().reverse(), 'newest first');
  const van2 = await call(route.GET, request('van2'));
  assert.equal(van2.body.items.length, 1);
  assert.ok(van2.body.items.every(item => item.runId === 'r2'));
  assert.equal(van1.response.headers.get('cache-control'), 'no-store');
});

test('the response exposes only what the driver app needs, never internal fields', async () => {
  const { route, request, call, timing } = setup();
  await timing('r1', '11:30');
  const { body } = await call(route.GET, request('van1'));
  const item = body.items[0];
  assert.deepEqual(Object.keys(item).sort(), ['createdAt', 'detail', 'id', 'kind', 'priority', 'runId', 'serviceDate', 'title']);
  const text = JSON.stringify(body);
  for (const internal of ['eventId', 'dedupeKey', 'pushBody', 'expiresAt', 'revision']) assert.equal(text.includes(internal), false, `${internal} must not be exposed`);
});

test('no session, a forged or wrong-vehicle session and a desktop session are all refused', async () => {
  const { route, request, call, timing, cookieFor } = setup();
  await timing('r1', '11:30');
  assert.equal((await call(route.GET, request('van1', { cookie: 'fika_logistics_mobile_session_van1=forged' }))).response.status, 401);
  assert.equal((await call(route.GET, request('van1', { cookie: cookieFor('van2') }))).response.status, 401, 'a Van 2 session cannot act as Van 1');
  const desktop = await call(route.GET, request(undefined));
  assert.ok([401, 403].includes(desktop.response.status), 'a desktop session is not a vehicle session');
  assert.notEqual(desktop.response.status, 200);
});

test('a vehicle cannot ask for another vehicle\'s inbox through the URL', async () => {
  const { route, request, call, timing } = setup();
  await timing('r2', '13:00');
  const result = await call(route.GET, request('van1', { query: '?vehicle=van2' }));
  assert.equal(result.response.status, 403);
  assert.equal(JSON.stringify(result.body).includes('r2'), false);
});

test('mark read persists, decrements the unread count, and is refused for another vehicle\'s notification', async () => {
  const { route, request, call, timing } = setup();
  await timing('r1', '11:30');
  await timing('r1', '12:00');
  await timing('r2', '13:00');
  const van1 = (await call(route.GET, request('van1'))).body;
  const van2 = (await call(route.GET, request('van2'))).body;
  const marked = await call(route.POST, request('van1', { method: 'POST', body: { action: 'mark-read', id: van1.items[0].id } }));
  assert.equal(marked.response.status, 200);
  assert.equal(marked.body.unreadCount, 1);
  assert.ok(marked.body.items.find(item => item.id === van1.items[0].id).readAt);
  const again = (await call(route.GET, request('van1'))).body;
  assert.equal(again.unreadCount, 1, 'read state is durable across requests');
  const cross = await call(route.POST, request('van1', { method: 'POST', body: { action: 'mark-read', id: van2.items[0].id } }));
  assert.equal(cross.response.status, 404, 'another vehicle\'s notification is treated as missing');
  assert.equal((await call(route.GET, request('van2'))).body.unreadCount, 1, 'the refused write changed nothing');
});

test('mark all read clears only the caller\'s unread notices and keeps history', async () => {
  const { route, request, call, timing } = setup();
  await timing('r1', '11:30');
  await timing('r1', '12:00');
  await timing('r2', '13:00');
  const result = await call(route.POST, request('van1', { method: 'POST', body: { action: 'mark-all-read' } }));
  assert.equal(result.body.unreadCount, 0);
  assert.equal(result.body.items.length, 2, 'history is kept');
  assert.equal((await call(route.GET, request('van2'))).body.unreadCount, 1, 'the other vehicle is untouched');
});

test('a vehicle session cannot trigger processing; only the internal-token route recovers interrupted events', async () => {
  const { f, route, store, request, call, timing } = setup();
  const original = store.firestoreDriverNotificationStore.commitProcessedEvent;
  store.firestoreDriverNotificationStore.commitProcessedEvent = async () => { throw new Error('transient'); };
  const saved = await timing('r1', '11:30');
  assert.equal(saved.response.status, 200, 'the planner save is unaffected');
  store.firestoreDriverNotificationStore.commitProcessedEvent = original;
  assert.equal((await call(route.GET, request('van1'))).body.items.length, 0, 'nothing in the inbox yet');
  assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'process-pending' } }))).response.status, 422, 'vehicles have no processing action');
  assert.equal((await call(route.GET, request('van1'))).body.items.length, 0, 'still nothing: a vehicle cannot recover for any van');
  const processor = f.load(path.join(__dirname, '..', 'app/api/logistics/driver-notifications/process/route.ts'));
  const internal = headers => new NextRequest('https://logistics.example.test/api/logistics/driver-notifications/process', { method: 'POST', headers });
  assert.equal((await processor.POST(internal({}))).status, 403, 'no token, no processing');
  assert.equal((await processor.POST(internal({ cookie: 'fika_logistics_mobile_session_van1=x', 'x-fika-logistics-vehicle': 'van1' }))).status, 403, 'a vehicle cookie is not enough');
  const recovered = await processor.POST(internal({ 'x-fika-internal-token': 'internal-processor-test-token' }));
  assert.equal(recovered.status, 200);
  assert.deepEqual(await recovered.json(), { processed: 1, created: 1, expired: 0, openCaptureGaps: 0 }, 'counts only, no content');
  assert.equal((await call(route.GET, request('van1'))).body.items.length, 1);
  const repeated = await (await processor.POST(internal({ 'x-fika-internal-token': 'internal-processor-test-token' }))).json();
  assert.deepEqual(repeated, { processed: 0, created: 0, expired: 0, openCaptureGaps: 0 }, 'recovery never duplicates');
  assert.equal([...f.records].filter(([key]) => key.startsWith(EVENTS + '/')).length, 1);
});

test('unknown actions and a missing notification id are rejected', async () => {
  const { route, request, call } = setup();
  assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'delete-all' } }))).response.status, 422);
  assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'mark-read' } }))).response.status, 422);
});

test('the vehicle session may use the inbox path but still cannot reach planner routes', async () => {
  const { f } = setup();
  const auth = f.load(path.join(appRoot, 'lib/auth.ts'));
  const mobile = (pathname, method = 'GET') => ({ method, url: 'https://logistics.test' + pathname, cookies: { get: () => undefined }, headers: new Headers({ 'x-fika-logistics-mobile-request': '1', 'x-fika-logistics-vehicle': 'van1' }), nextUrl: { pathname, searchParams: new URLSearchParams() } });
  const session = async () => ({ vehicleId: 'van1', sessionId: 'session-1234567890123456' });
  for (const [pathname, method] of [['/api/logistics/driver-notifications', 'GET'], ['/api/logistics/driver-notifications', 'POST']]) {
    await assert.doesNotReject(() => auth.requireLogisticsAccess(mobile(pathname, method), { mobileSessionReader: session, allowLocalFallback: false }));
  }
  for (const pathname of ['/api/logistics/drivers', '/api/logistics/mobile/other', '/api/logistics/reconcile']) {
    await assert.rejects(() => auth.requireLogisticsAccess(mobile(pathname), { mobileSessionReader: session, allowLocalFallback: false }), /cannot access/);
  }
});
