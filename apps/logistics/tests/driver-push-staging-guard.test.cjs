const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createHash, createECDH, randomBytes } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

// Issue #181: hosted staging must never emit real external Web Push, and must not falsely record a send.
// Determinism: this file NEVER writes FIKA_RUNTIME_MODE in its own process. Lib cases pass an explicit `env` through PushDeps;
// route cases (which read process.env) run in a child process started with FIKA_RUNTIME_MODE=staging.
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
const CHILD = process.env.STAGING_GUARD_CHILD === '1';
const STAGING = { FIKA_RUNTIME_MODE: 'staging' };

function setup() {
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
  // A stored, sendable (legacy-shaped) subscription, written directly so no runtime mode is needed to create it.
  const seedSub = (id, vehicleId = 'van1') => f.records.set(`${SUBS}/${createHash('sha256').update(ENDPOINT(id)).digest('hex')}`, { vehicleId, endpoint: ENDPOINT(id), p256dh: KEYS.p256dh, auth: KEYS.auth, failureCount: 0 });
  const seedNotice = id => f.records.set(`${NOTICES}/${id}`, { id, vehicleId: 'van1', kind: 'delivery-time-changed', title: 'Delivery time changed', inboxText: 'x', pushBody: 'Van 1 · A delivery time changed.', priority: 'normal', serviceDate: today, runId: 'r1', createdAt: new Date().toISOString(), readAt: null, pushStatus: 'pending' });
  return { f, route, processor, push, request, call, subscribe, subs, seedSub, seedNotice, network };
}

test.afterEach(() => { webpush.sendNotification = originalSend; });

if (!CHILD) {
  test('staging lib: verification and saved-notice delivery never reach web-push and record nothing', async () => {
    const { f, push, seedSub, subs, seedNotice, network } = setup();
    seedSub('phone'); seedNotice('n1');
    const before = structuredClone(f.records.get(`${NOTICES}/n1`));
    const subsBefore = subs();
    const deps = { env: STAGING };
    assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('x'), ...KEYS }, deps), 'disabled_in_staging');
    assert.equal(await push.deliverNoticePush('n1', deps), 'skipped');
    await push.deliverPushes(['n1'], deps);
    assert.equal(await push.retryPendingPushes(deps), 0);
    assert.equal(network.calls, 0, 'web-push sendNotification was never called');
    assert.deepEqual(f.records.get(`${NOTICES}/n1`), before, 'notice untouched: still pending, no attempt counted');
    assert.deepEqual(subs(), subsBefore, 'subscription neither deleted nor altered');
  });

  test('an injected sender keeps working in staging, and production/local/unset use the normal send path', async () => {
    const { push, seedSub, seedNotice, network } = setup();
    seedSub('phone');
    const injected = [];
    const send = async subscription => { injected.push(subscription.endpoint); };
    assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('y'), ...KEYS }, { send, env: STAGING }), 'delivered');
    seedNotice('n2');
    assert.equal(await push.deliverNoticePush('n2', { send, env: STAGING }), 'sent');
    assert.equal(injected.length >= 2, true);
    assert.equal(network.calls, 0);
    for (const env of [{ FIKA_RUNTIME_MODE: 'production' }, { FIKA_RUNTIME_MODE: 'local' }, {}]) {
      network.calls = 0;
      assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('z'), ...KEYS }, { env }), 'delivered', JSON.stringify(env));
      assert.equal(network.calls, 1, `${JSON.stringify(env)} reaches web-push as before`);
    }
  });

  test('staging routes: push route and process route, run in a child process started in staging', () => {
    const before = process.env.FIKA_RUNTIME_MODE;
    try {
      execFileSync(process.execPath, ['--import', 'tsx', __filename], { env: { ...process.env, NODE_TEST_CONTEXT: undefined, FIKA_RUNTIME_MODE: 'staging', STAGING_GUARD_CHILD: '1' }, cwd: appRoot, stdio: 'pipe', timeout: 120000 });
    } catch (error) {
      assert.fail(`staging child run failed:\n${error.stdout?.toString() ?? ''}\n${error.stderr?.toString() ?? ''}`);
    }
    assert.equal(process.env.FIKA_RUNTIME_MODE, before, 'this process env was not touched');
  });
} else {
  test('child (FIKA_RUNTIME_MODE=staging): push route refuses subscribe/test and reports disabled; nothing stored or verified', async () => {
    assert.equal(process.env.FIKA_RUNTIME_MODE, 'staging');
    const { route, request, call, subscribe, subs, seedSub, network } = setup();
    seedSub('phone');
    const subsBefore = subs();
    const refused = await subscribe('van1', 'new-phone');
    assert.equal(refused.response.status, 503);
    assert.equal(refused.body.error.code ?? refused.body.code, 'LOGISTICS_PUSH_DISABLED_IN_STAGING');
    assert.deepEqual(subs(), subsBefore, 'nothing new is stored');
    assert.equal((await call(route.POST, request('van1', { action: 'test' }))).response.status, 503);
    const info = await call(route.GET, request('van1'));
    assert.equal(info.body.enabled, false);
    assert.equal(info.body.publicKey, null);
    assert.equal(network.calls, 0, 'web-push sendNotification was never called');
  });

  test('child (FIKA_RUNTIME_MODE=staging): default lib and the process route leave pending notices pending and send nothing', async () => {
    const { f, push, processor, seedSub, seedNotice, subs, network } = setup();
    seedSub('phone'); seedNotice('n1');
    const before = structuredClone(f.records.get(`${NOTICES}/n1`));
    const subsBefore = subs();
    assert.equal(await push.sendVerification('van1', { endpoint: ENDPOINT('x'), ...KEYS }), 'disabled_in_staging');
    assert.equal(await push.retryPendingPushes(), 0);
    const response = await processor.POST(new NextRequest('https://logistics.example.test/api/logistics/driver-notifications/process', { method: 'POST', headers: { 'x-fika-internal-token': 'internal-processor-test-token' } }));
    assert.equal(response.status, 200);
    assert.equal((await response.json()).pushRetried, 0);
    assert.equal(network.calls, 0);
    assert.deepEqual(f.records.get(`${NOTICES}/n1`), before);
    assert.deepEqual(subs(), subsBefore);
  });
}
