const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { createECDH, randomBytes } = require('node:crypto');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

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

// A real P-256 private key in the same format as the staging secret; nothing here is a deployed key.
const ecdh = createECDH('prime256v1'); ecdh.setPrivateKey(randomBytes(32));
const TEST_PRIVATE_KEY = ecdh.getPrivateKey().toString('base64url');

function setup() {
  Object.assign(process.env, { LOGISTICS_MOBILE_SESSION_SECRET: SECRET, LOGISTICS_MOBILE_VAN1_PIN_VERIFIER: VERIFIER.van1, LOGISTICS_MOBILE_VAN2_PIN_VERIFIER: VERIFIER.van2, LOGISTICS_VAPID_PRIVATE_KEY: TEST_PRIVATE_KEY });
  // Subscribing now proves the endpoint with a real push first; these tests use a push service that accepts everything.
  require('web-push').sendNotification = async () => ({});
  const f = fixture(['van1', 'van2'], [], true);
  const today = londonToday();
  for (const id of ['r1', 'r2']) Object.assign(f.records.get(`${RUNS}/${id}`), { serviceDate: today, plannedCpuDepartureTime: '10:00', plannedCpuReturnTime: '16:00' });
  const route = f.load(path.join(appRoot, 'app/api/logistics/driver-notifications/push/route.ts'));
  const session = f.load(path.join(appRoot, 'lib/mobile-pin-session.ts'));
  const push = f.load(path.join(appRoot, 'lib/driver-push.ts'));
  const cookieFor = vehicle => `fika_logistics_mobile_session_${vehicle}=${session.signMobilePinSession({ vehicleId: vehicle, verifier: VERIFIER[vehicle], secret: SECRET })}`;
  const request = (vehicle, { method = 'GET', body } = {}) => new NextRequest(PUSH_URL, {
    method,
    headers: { 'content-type': 'application/json', ...(vehicle ? { 'x-fika-logistics-mobile-request': '1', 'x-fika-logistics-vehicle': vehicle, cookie: cookieFor(vehicle) } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const call = async (handler, req) => { const response = await handler(req); return { response, body: await response.json() }; };
  const subscribe = (vehicle, id) => call(route.POST, request(vehicle, { method: 'POST', body: { action: 'subscribe', scope: vehicle, subscription: { endpoint: ENDPOINT(id), keys: KEYS } } }));
  const subs = () => [...f.records].filter(([key]) => key.startsWith(SUBS + '/') && !key.includes('_test')).map(([, value]) => structuredClone(value));
  const seedNotice = (id, vehicleId, extra = {}) => f.records.set(`${NOTICES}/${id}`, { id, vehicleId, kind: 'delivery-time-changed', title: 'Delivery time changed', inboxText: 'x', pushBody: 'Van 1 · Tue 27 Oct · A delivery time changed.', priority: 'normal', serviceDate: today, runId: 'r1', createdAt: new Date().toISOString(), readAt: null, pushStatus: 'pending', ...extra });
  const sender = () => { const calls = []; const send = async (subscription, payload, options) => { calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload), options }); }; return { calls, send }; };
  return { f, route, push, request, call, subscribe, subs, seedNotice, sender, today };
}

test('only a signed vehicle session can register, and the vehicle comes from the session, never the request', async () => {
  const { route, request, call, subscribe, subs } = setup();
  assert.notEqual((await call(route.GET, request(undefined))).response.status, 200, 'no session, no access');
  const info = await call(route.GET, request('van1'));
  assert.equal(info.response.status, 200);
  assert.equal(info.body.enabled, true);
  assert.match(info.body.publicKey, /^[A-Za-z0-9_-]{87}$/, 'the public key is derived from the private key');
  assert.equal(JSON.stringify(info.body).includes(TEST_PRIVATE_KEY), false, 'the private key never leaves the server');
  assert.equal((await subscribe('van1', 'a')).response.status, 200);
  assert.deepEqual(subs().map(item => item.vehicleId), ['van1']);
  const forged = await call(route.POST, request('van1', { method: 'POST', body: { action: 'subscribe', scope: 'van1', vehicleId: 'van2', subscription: { endpoint: ENDPOINT('b'), keys: KEYS } } }));
  assert.equal(forged.response.status, 200);
  assert.deepEqual(subs().map(item => item.vehicleId).sort(), ['van1', 'van1'], 'a vehicle field in the body is ignored');
});

test('subscription input is validated: only real push-service HTTPS endpoints and well-formed keys', async () => {
  const { route, request, call } = setup();
  const attempt = subscription => call(route.POST, request('van1', { method: 'POST', body: { action: 'subscribe', scope: 'van1', subscription } }));
  for (const endpoint of ['http://fcm.googleapis.com/x', 'https://evil.example.com/x', 'https://fcm.googleapis.com.evil.com/x', 'https://user:pw@fcm.googleapis.com/x', 'https://169.254.169.254/latest', 'not a url', 42]) {
    assert.equal((await attempt({ endpoint, keys: KEYS })).response.status, 422, String(endpoint));
  }
  assert.equal((await attempt({ endpoint: ENDPOINT('ok'), keys: { p256dh: 'short', auth: KEYS.auth } })).response.status, 422);
  assert.equal((await attempt({ endpoint: 'https://web.push.apple.com/abc', keys: KEYS })).response.status, 200, 'Apple push is accepted');
  assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'delete-everything' } }))).response.status, 422);
});

test('a van can remove only its own device', async () => {
  const { route, request, call, subscribe, subs } = setup();
  await subscribe('van1', 'one');
  const wrong = await call(route.POST, request('van2', { method: 'POST', body: { action: 'unsubscribe', endpoint: ENDPOINT('one') } }));
  assert.equal(wrong.response.status, 200);
  assert.equal(subs().length, 1, "van2 cannot remove van1's device");
  await call(route.POST, request('van1', { method: 'POST', body: { action: 'unsubscribe', endpoint: ENDPOINT('one') } }));
  assert.equal(subs().length, 0);
});

test('the same phone signing in as the other van moves its subscription: it can never receive both vans', async () => {
  const { subscribe, subs } = setup();
  await subscribe('van1', 'shared');
  await subscribe('van2', 'shared');
  assert.deepEqual(subs().map(item => item.vehicleId), ['van2']);
});

test('a push reaches only the notice\'s own van, with a short body and a same-origin deep link', async () => {
  const { push, subscribe, seedNotice, sender, today } = setup();
  await subscribe('van1', 'pixel'); await subscribe('van2', 'iphone');
  seedNotice('n1', 'van1');
  const { calls, send } = sender();
  assert.equal(await push.deliverNoticePush('n1', { send }), 'sent');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, ENDPOINT('pixel'), 'van2 devices are never sent van1 notices');
  assert.equal(calls[0].payload.title, 'Delivery time changed');
  assert.equal(calls[0].payload.vehicleId, 'van1');
  assert.match(calls[0].payload.url, new RegExp(`^/mobile/van1\\?notice=n1&serviceDate=${today}$`));
  assert.equal(calls[0].options.TTL, 900, 'a push that cannot be delivered within 15 minutes is dropped by the push service');
  assert.equal(JSON.stringify(calls[0].payload).includes('job'), false, 'no internal ids in the payload');
});

test('a notice is pushed at most once even when two senders race (post-save and recovery)', async () => {
  const { push, subscribe, seedNotice, sender } = setup();
  await subscribe('van1', 'pixel');
  seedNotice('n1', 'van1');
  const { calls, send } = sender();
  const results = await Promise.all([push.deliverNoticePush('n1', { send }), push.deliverNoticePush('n1', { send }), push.deliverNoticePush('n1', { send })]);
  assert.equal(calls.length, 1);
  assert.equal(results.filter(result => result === 'sent').length, 1);
  assert.equal(await push.deliverNoticePush('n1', { send }), 'skipped', 'a delivered notice is never re-sent');
});

test('eligibility is rechecked at send time: an old notice or one for another day is expired, never delivered late', async () => {
  const { push, subscribe, seedNotice, sender, f } = setup();
  await subscribe('van1', 'pixel');
  seedNotice('old', 'van1', { createdAt: new Date(Date.now() - 20 * 60_000).toISOString() });
  seedNotice('tomorrow', 'van1', { serviceDate: '2099-01-05' });
  const { calls, send } = sender();
  assert.equal(await push.deliverNoticePush('old', { send }), 'expired');
  assert.equal(await push.deliverNoticePush('tomorrow', { send }), 'expired');
  assert.equal(calls.length, 0);
  assert.equal(f.records.get('fikaLogisticsDriverNotificationsV1/old').pushStatus, 'expired');
});

test('a gone device (410/404) is forgotten; other failures retry a bounded number of times; the inbox notice is never affected', async () => {
  const { push, subscribe, seedNotice, subs, f } = setup();
  await subscribe('van1', 'dead'); await subscribe('van1', 'alive');
  seedNotice('n1', 'van1');
  const gone = async subscription => { if (subscription.endpoint === ENDPOINT('dead')) throw Object.assign(new Error('gone'), { statusCode: 410 }); };
  assert.equal(await push.deliverNoticePush('n1', { send: gone }), 'sent');
  assert.deepEqual(subs().map(item => item.endpoint), [ENDPOINT('alive')], 'the expired subscription was removed');

  seedNotice('n2', 'van1');
  const flaky = async () => { throw Object.assign(new Error('busy'), { statusCode: 503 }); };
  assert.equal(await push.deliverNoticePush('n2', { send: flaky }), 'pending', 'first transient failure stays pending');
  assert.equal(await push.deliverNoticePush('n2', { send: flaky }), 'pending');
  assert.equal(await push.deliverNoticePush('n2', { send: flaky }), 'failed', 'bounded: the third failure parks it');
  assert.equal(f.records.get('fikaLogisticsDriverNotificationsV1/n2').title, 'Delivery time changed', 'the inbox notice is untouched by push failure');
  assert.equal(f.records.has('fikaLogisticsDriverNotificationsV1/n2'), true);
});

test('a van with no registered device simply has no push; recovery retries only pending notices', async () => {
  const { push, seedNotice, sender } = setup();
  seedNotice('n1', 'van2');
  const { calls, send } = sender();
  assert.equal(await push.deliverNoticePush('n1', { send }), 'none');
  assert.equal(calls.length, 0);
  seedNotice('n2', 'van2');
  assert.equal(await push.retryPendingPushes({ send }), 1, 'only the pending notice is picked up');
});

test('end to end: a real planner change commits, reaches the inbox, and pushes to the right phone only', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2099-01-05T10:00:00Z') });
  const { f, subscribe, subs } = setup();
  for (const id of ['r1', 'r2']) Object.assign(f.records.get(`${RUNS}/${id}`), { serviceDate: '2099-01-05' });
  await subscribe('van1', 'pixel'); await subscribe('van2', 'iphone');
  assert.equal(subs().length, 2);
  const webpush = require('web-push');
  const calls = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async (subscription, payload) => { calls.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) }); return {}; };
  try {
    const result = await f.post({ action: 'update-run-timing', runId: 'r1', expectedRunVersion: f.records.get(`${RUNS}/r1`).version, plannedCpuDepartureTime: '11:30', plannedCpuReturnTime: '16:00' });
    assert.equal(result.response.status, 200, JSON.stringify(result.body));
  } finally { webpush.sendNotification = original; }
  const notices = [...f.records].filter(([key]) => key.startsWith(NOTICES + '/')).map(([, value]) => value);
  assert.equal(notices.length, 1, 'the inbox notice exists');
  assert.equal(notices[0].vehicleId, 'van1');
  assert.equal(calls.length, 1, 'one push');
  assert.equal(calls[0].endpoint, ENDPOINT('pixel'));
  assert.equal(notices[0].pushStatus, 'sent');
});

test('the test push is rate limited and goes only to the caller\'s own van', async () => {
  const { route, request, call, subscribe, f } = setup();
  await subscribe('van1', 'pixel');
  const webpush = require('web-push');
  const calls = [];
  const original = webpush.sendNotification;
  webpush.sendNotification = async subscription => { calls.push(subscription.endpoint); return {}; };
  try {
    const first = await call(route.POST, request('van1', { method: 'POST', body: { action: 'test' } }));
    assert.equal(first.response.status, 200);
    assert.deepEqual(calls, [ENDPOINT('pixel')]);
    assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'test' } }))).response.status, 429, 'a second test inside 20 seconds is refused');
    const other = await call(route.POST, request('van2', { method: 'POST', body: { action: 'test' } }));
    assert.equal(other.body.devices, 0, 'van2 has no device and van1\'s is never used');
  } finally { webpush.sendNotification = original; }
  assert.ok(f);
});

test('without a VAPID key push is simply off: registration is refused and nothing is sent', async () => {
  const { route, request, call } = setup();
  const saved = process.env.LOGISTICS_VAPID_PRIVATE_KEY;
  delete process.env.LOGISTICS_VAPID_PRIVATE_KEY;
  try {
    const info = await call(route.GET, request('van1'));
    assert.deepEqual({ enabled: info.body.enabled, publicKey: info.body.publicKey }, { enabled: false, publicKey: null });
    assert.equal((await call(route.POST, request('van1', { method: 'POST', body: { action: 'test' } }))).response.status, 503);
  } finally { process.env.LOGISTICS_VAPID_PRIVATE_KEY = saved; }
});
