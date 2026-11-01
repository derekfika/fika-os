const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createECDH, randomBytes } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

// Issue #181: hosted staging must never emit real external Web Push, and must not falsely record a send.
const appRoot = path.resolve(__dirname, '..');
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RUNS = 'fikaLogisticsDeliveryRunsV1';
const SUBS = 'fikaLogisticsPushSubscriptionsV1';
const NOTICES = 'fikaLogisticsDriverNotificationsV1';
const SECRET = 'driver-push-test-secret-0123456789abcdef';
const VERIFIER = { van1: 'van1-verifier-fixture', van2: 'van2-verifier-fixture' };
const PUSH_URL = 'https://logistics.test/api/logistics/driver-notifications/push';
const ENDPOINT = id => `https://fcm.googleapis.com/fcm/send/${id}`;
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(randomBytes(32));
const TEST_PRIVATE_KEY = ecdh.getPrivateKey().toString('base64url');
const webpush = require('web-push');
const originalSend = webpush.sendNotification;
const originalMode = process.env.FIKA_RUNTIME_MODE;

function setup(mode) {
  Object.assign(process.env, { LOGISTICS_MOBILE_SESSION_SECRET: SECRET, LOGISTICS_MOBILE_VAN1_PIN_VERIFIER: VERIFIER.van1, LOGISTICS_MOBILE_VAN2_PIN_VERIFIER: VERIFIER.van2, LOGISTICS_VAPID_PRIVATE_KEY: TEST_PRIVATE_KEY, FIKA_INTERNAL_API_TOKEN: 'internal-processor-test-token' });
  const network = { calls: 0 };
  webpush.sendNotification = async () => { network.calls += 1; return {}; };
  const f = fixture(['van1', 'van2'], [], true);
  const today = londonToday();
  for (const id of ['r1', 'r2']) Object.assign(f.records.get(`${RUNS}/${id}`), { serviceDate: today, plannedCpuDepartureTime: '10:00', plannedCpuReturnTime: '16:00' });
  const route = f.load(path.join(appRoot, 'app/api/logistics/driver-notifications/push/route.ts'));
  const processor = f.load(path.join(appRoot, 'app/api/logistics/driver-notifications/process/route.ts'));
  const session = f.load(path.join(appRoot, 'lib/mobile-pin-session.ts'));
  const push = f.load(path.join(appRoot, 'lib/driver-push.ts'));
  const cookieFor = vehicle => `fika_logistics_mobile_session_${vehicle}=${session.signMobilePinSession({ vehicleId: vehicle, verifier: VERIFIER[vehicle], secret: SECRET })}`;
  const request = (vehicle, body) => new NextRequest(PUSH_URL, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-fika-logistics-mobile-request': '1', 'x-fika-logistics-vehicle': vehicle, cookie: cookieFor(vehicle) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const call = async (handler, req) => { const response = await handler(req); return { response, body: await response.json() }; };
  const subscribe = (vehicle, id) => call(route.POST, request(vehicle, { action: 'subscribe', scope: vehicle, subscription: { endpoint: ENDPOINT(id), keys: KEYS } }));
  const subs = () => [...f.records].filter(([key]) => key.startsWith(SUBS + '/') && !key.includes('_test')).map(([, value]) => structuredClone(value));
  const seedNotice = id => f.records.set(`${NOTICES}/${id}`, { id, vehicleId: 'van1', kind: 'delivery-time-changed', title: 'Delivery time changed', inboxText: 'x', pushBody: 'Van 1 · A delivery time changed.', priority: 'normal', serviceDate: today, runId: 'r1', createdAt: new Date().toISOString(), readAt: null, pushStatus: 'pending' });
  process.env.FIKA_RUNTIME_MODE = mode;
  return { f, route, processor, push, request, call, subscribe, subs, seedNotice, network };
}

test.afterEach(() => {
  webpush.sendNotification = originalSend;
  if (originalMode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = originalMode;
});

test('staging: verification never reaches web-push and never marks a device verified', async () => {
  const { push, route, request, call, subscribe, subs, network } = setup('production');
  assert.equal((await subscribe('van1', 'phone')).body.verified, true, 'baseline: production verifies');
  assert.equal(network.calls, 1);
  network.calls = 0;
  process.env.FIKA_RUNTIME_MODE = 'staging';
  assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('x'), ...KEYS }), 'disabled_in_staging');
  const refused = await subscribe('van1', 'new-phone');
  assert.equal(refused.response.status, 503);
  assert.equal(refused.body.error.code ?? refused.body.code, 'LOGISTICS_PUSH_DISABLED_IN_STAGING');
  assert.equal(subs().length, 1, 'nothing new is stored');
  assert.equal((await call(route.POST, request('van1', { action: 'test' }))).response.status, 503);
  const info = await call(route.GET, request('van1'));
  assert.equal(info.body.enabled, false);
  assert.equal(info.body.publicKey, null);
  assert.equal(network.calls, 0, 'web-push sendNotification was never called');
});

test('staging: saved-notice delivery and recovery leave notices pending, subscriptions intact and return 0', async () => {
  const { f, push, subscribe, subs, seedNotice, network } = setup('production');
  await subscribe('van1', 'phone');
  seedNotice('n1');
  const before = structuredClone(f.records.get(`${NOTICES}/n1`));
  const subsBefore = subs();
  network.calls = 0;
  process.env.FIKA_RUNTIME_MODE = 'staging';
  assert.equal(await push.deliverNoticePush('n1'), 'skipped');
  await push.deliverPushes(['n1']);
  assert.equal(await push.retryPendingPushes(), 0);
  assert.equal(network.calls, 0, 'web-push sendNotification was never called');
  assert.deepEqual(f.records.get(`${NOTICES}/n1`), before, 'notice untouched: still pending, no attempt counted');
  assert.equal(f.records.get(`${NOTICES}/n1`).pushStatus, 'pending');
  assert.deepEqual(subs(), subsBefore, 'subscription neither deleted nor altered');
});

test('staging: the process route still succeeds for non-push work and sends nothing', async () => {
  const { f, processor, subscribe, seedNotice, network } = setup('production');
  await subscribe('van1', 'phone');
  seedNotice('n1');
  network.calls = 0;
  process.env.FIKA_RUNTIME_MODE = 'staging';
  const response = await processor.POST(new NextRequest('https://logistics.example.test/api/logistics/driver-notifications/process', { method: 'POST', headers: { 'x-fika-internal-token': 'internal-processor-test-token' } }));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).pushRetried, 0);
  assert.equal(network.calls, 0);
  assert.equal(f.records.get(`${NOTICES}/n1`).pushStatus, 'pending');
});

test('an injected sender keeps working in staging, and production/local/unset use the normal send path'
, async () => {
  const { push, subscribe, seedNotice, network } = setup('production');
  await subscribe('van1', 'phone');
  network.calls = 0;
  const injected = [];
  const send = async subscription => { injected.push(subscription.endpoint); };
  process.env.FIKA_RUNTIME_MODE = 'staging';
  assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('y'), ...KEYS }, { send }), 'delivered');
  seedNotice('n2');
  assert.equal(await push.deliverNoticePush('n2', { send }), 'sent');
  assert.equal(injected.length >= 2, true);
  assert.equal(network.calls, 0);
  for (const mode of ['production', 'local', undefined]) {
    if (mode === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = mode;
    network.calls = 0;
    assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('z'), ...KEYS }), 'delivered', String(mode));
    assert.equal(network.calls, 1, `${mode} reaches web-push as before`);
  }
});
