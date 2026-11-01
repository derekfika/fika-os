const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const { createECDH, randomBytes } = require('node:crypto');
const webpush = require('web-push');
const { NextRequest } = require('next/server');
const { fixture } = require('./helpers/authority-route-harness.cjs');

const appRoot = path.resolve(__dirname, '..');
const londonToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const RUNS = 'fikaLogisticsDeliveryRunsV1';
const SUBS = 'fikaLogisticsPushSubscriptionsV1';
const NOTICES = 'fikaLogisticsDriverNotificationsV1';
const SECRET = 'driver-push-android-test-secret-0123456789';
const VERIFIER = { van1: 'van1-verifier-fixture', van2: 'van2-verifier-fixture' };
const PUSH_URL = 'https://logistics.test/api/logistics/driver-notifications/push';
const ENDPOINT = id => `https://fcm.googleapis.com/fcm/send/${id}`;
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const ecdh = createECDH('prime256v1');
ecdh.setPrivateKey(randomBytes(32));
const TEST_PRIVATE_KEY = ecdh.getPrivateKey().toString('base64url');

// Every push the server attempts is recorded; `failures` makes the next sends to an endpoint fail with the given status.
function fakePush() {
  const sent = [];
  const failures = new Map();
  const original = webpush.sendNotification;
  webpush.sendNotification = async (subscription, payload) => {
    const status = failures.get(subscription.endpoint);
    if (status) throw Object.assign(new Error('push failed'), { statusCode: status });
    sent.push({ endpoint: subscription.endpoint, payload: JSON.parse(payload) });
    return {};
  };
  return { sent, failures, restore: () => { webpush.sendNotification = original; } };
}

// Deterministic: these fixtures never see a staging mode from the environment; the original is restored afterwards.
const ORIGINAL_RUNTIME_MODE = process.env.FIKA_RUNTIME_MODE;
test.after(() => { if (ORIGINAL_RUNTIME_MODE === undefined) delete process.env.FIKA_RUNTIME_MODE; else process.env.FIKA_RUNTIME_MODE = ORIGINAL_RUNTIME_MODE; });

function setup() {
  Object.assign(process.env, { FIKA_RUNTIME_MODE: 'local', LOGISTICS_MOBILE_SESSION_SECRET: SECRET, LOGISTICS_MOBILE_VAN1_PIN_VERIFIER: VERIFIER.van1, LOGISTICS_MOBILE_VAN2_PIN_VERIFIER: VERIFIER.van2, LOGISTICS_VAPID_PRIVATE_KEY: TEST_PRIVATE_KEY });
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
  const subscribe = (vehicle, id, extra = {}) => call(route.POST, request(vehicle, { method: 'POST', body: { action: 'subscribe', scope: vehicle, subscription: { endpoint: ENDPOINT(id), keys: KEYS }, ...extra } }));
  const docs = () => [...f.records].filter(([key]) => key.startsWith(SUBS + '/') && !key.includes('_test')).map(([key, value]) => ({ key: key.slice(SUBS.length + 1), ...structuredClone(value) }));
  const docFor = id => docs().find(item => item.endpoint === ENDPOINT(id));
  const seedLegacy = (id, vehicleId) => f.records.set(`${SUBS}/${require('node:crypto').createHash('sha256').update(ENDPOINT(id)).digest('hex')}`, { vehicleId, endpoint: ENDPOINT(id), p256dh: KEYS.p256dh, auth: KEYS.auth, failureCount: 0 });
  const seedNotice = (id, vehicleId) => f.records.set(`${NOTICES}/${id}`, { id, vehicleId, kind: 'delivery-time-changed', title: 'Delivery time changed', inboxText: 'x', pushBody: `${vehicleId} · a delivery time changed.`, priority: 'normal', serviceDate: today, runId: 'r1', createdAt: new Date().toISOString(), readAt: null, pushStatus: 'pending' });
  return { f, route, push, request, call, subscribe, docs, docFor, seedLegacy, seedNotice, today };
}

test('a van can only register a worker scope for its own van: the scope must match the signed session', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, docs } = setup();
  const wrong = await subscribe('van1', 'cross', { scope: 'van2' });
  assert.equal(wrong.response.status, 403, 'van1 session cannot register van2 scope');
  assert.equal(docs().length, 0);
  const right = await subscribe('van1', 'own');
  assert.equal(right.response.status, 200);
  assert.equal(docs()[0].scope, 'van1');
});

test('a new van-scoped device is verified with a real push to its own endpoint only, and then is marked verified', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, docFor } = setup();
  const result = await subscribe('van1', 'pixel');
  assert.equal(result.response.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.verified, true);
  assert.equal(fake.sent.length, 1, 'exactly one verification push');
  assert.equal(fake.sent[0].endpoint, ENDPOINT('pixel'));
  assert.equal(fake.sent[0].payload.vehicleId, 'van1');
  assert.equal(fake.sent[0].payload.tag, 'verify');
  assert.equal(docFor('pixel').verified, true);
});

test('re-registering an already verified device sends no further verification push (no repeat notifications on every app open)', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe } = setup();
  await subscribe('van1', 'pixel');
  await subscribe('van1', 'pixel');
  await subscribe('van1', 'pixel');
  assert.equal(fake.sent.length, 1);
});

test('migration: a legacy shared subscription keeps delivering until the van-scoped replacement is verified, then is retired (one copy per device)', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedLegacy, seedNotice, push, f, docFor } = setup();
  seedLegacy('legacy', 'van1');
  // Before migration: the legacy subscription is the one that delivers.
  seedNotice('before', 'van1');
  await push.deliverNoticePush('before', {});
  assert.deepEqual(fake.sent.map(item => item.endpoint), [ENDPOINT('legacy')]);
  fake.sent.length = 0;

  // The replacement arrives and its verification push succeeds: it takes over and the legacy one is retired.
  const migrated = await subscribe('van1', 'scoped', { replaces: ENDPOINT('legacy') });
  assert.equal(migrated.body.verified, true);
  assert.equal(migrated.body.legacyRetired, true);
  assert.equal(docFor('legacy').supersededBy !== undefined, true);
  fake.sent.length = 0;

  seedNotice('after', 'van1');
  await push.deliverNoticePush('after', {});
  assert.deepEqual(fake.sent.map(item => item.endpoint), [ENDPOINT('scoped')], 'exactly one copy, from the replacement');
  assert.ok(f);
});

test('safe recovery: if the replacement cannot be verified, the legacy subscription is kept and keeps delivering', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedLegacy, seedNotice, push, docFor } = setup();
  seedLegacy('legacy', 'van1');
  fake.failures.set(ENDPOINT('scoped'), 503);
  const attempt = await subscribe('van1', 'scoped', { replaces: ENDPOINT('legacy') });
  assert.equal(attempt.response.status, 200);
  assert.equal(attempt.body.verified, false, 'not verified, so not trusted yet');
  assert.equal(attempt.body.legacyRetired, false);
  assert.equal(docFor('legacy').supersededBy, undefined, 'the legacy subscription is untouched');
  fake.sent.length = 0;
  seedNotice('still', 'van1');
  await push.deliverNoticePush('still', {});
  assert.deepEqual(fake.sent.map(item => item.endpoint), [ENDPOINT('legacy')], 'the unverified replacement does not double-send');
});

test('a replacement whose endpoint the push service rejects is removed, and the legacy subscription is left alone', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedLegacy, docFor, docs } = setup();
  seedLegacy('legacy', 'van1');
  fake.failures.set(ENDPOINT('dead'), 410);
  const result = await subscribe('van1', 'dead', { replaces: ENDPOINT('legacy') });
  assert.equal(result.response.status, 422);
  assert.equal(docs().some(item => item.endpoint === ENDPOINT('dead')), false, 'removed');
  assert.equal(docFor('legacy').supersededBy, undefined);
});

test('a van can only retire a legacy subscription that belongs to that same van', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedLegacy, docFor } = setup();
  seedLegacy('theirs', 'van2');
  const result = await subscribe('van1', 'mine', { replaces: ENDPOINT('theirs') });
  assert.equal(result.body.legacyRetired, false, 'a van cannot retire another van\'s subscription');
  assert.equal(docFor('theirs').supersededBy, undefined);
});

test('van isolation: each van\'s worker endpoint only ever receives its own van\'s notices', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedNotice, push } = setup();
  await subscribe('van1', 'pixel');
  await subscribe('van2', 'iphone');
  fake.sent.length = 0;
  seedNotice('n1', 'van1');
  await push.deliverNoticePush('n1', {});
  assert.deepEqual(fake.sent.map(item => [item.endpoint, item.payload.vehicleId]), [[ENDPOINT('pixel'), 'van1']]);
});

test('a re-verified device is not sent its notice twice when two senders race during migration', async t => {
  const fake = fakePush(); t.after(fake.restore);
  const { subscribe, seedLegacy, seedNotice, push } = setup();
  seedLegacy('legacy', 'van1');
  await subscribe('van1', 'scoped', { replaces: ENDPOINT('legacy') });
  fake.sent.length = 0;
  seedNotice('race', 'van1');
  await Promise.all([push.deliverNoticePush('race', {}), push.deliverNoticePush('race', {})]);
  assert.equal(fake.sent.length, 1);
});

// ---- The service worker: its push and click handling, run as the browser would ---------------------------------------------

const workerSource = fs.readFileSync(path.join(appRoot, 'public/pwa-sw.js'), 'utf8');

function loadWorker({ scope, controlled = [] }) {
  const listeners = {};
  const shown = [];
  const opened = [];
  const self = {
    location: new URL('https://logistics.test/'),
    registration: { scope: `https://logistics.test${scope}`, showNotification: async (title, options) => { shown.push({ title, options }); } },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting() {},
    clients: { claim: async () => {}, matchAll: async () => controlled, openWindow: async url => { opened.push(url); } },
  };
  vm.runInNewContext(workerSource, { self, URL, Promise, JSON, Object, Set, Map, RegExp, String, Number, Boolean, Array, Error, console, caches: {}, fetch: async () => { throw new Error('offline'); } });
  return { listeners, shown, opened };
}
const push = (worker, data) => { const pending = []; worker.listeners.push({ data: { json: () => data }, waitUntil: promise => pending.push(promise) }); return Promise.all(pending); };
const click = (worker, data, pending = []) => { worker.listeners.notificationclick({ notification: { data, close() {} }, waitUntil: promise => pending.push(promise) }); return Promise.all(pending); };
const windowFor = (url, log) => ({ url: `https://logistics.test${url}`, focus: async () => { log.focused.push(url); }, postMessage: message => { log.messages.push({ url, message }); } });

test('a van worker shows its own van\'s push with that van\'s icon', async () => {
  const worker = loadWorker({ scope: '/mobile/van1/' });
  await push(worker, { v: 1, title: 'Delivery time changed', body: 'Van 1 · a delivery time changed.', tag: 'notice-1', url: '/mobile/van1?notice=n1', vehicleId: 'van1', priority: 'normal' });
  assert.equal(worker.shown[0].title, 'Delivery time changed');
  assert.equal(worker.shown[0].options.icon, '/pwa/van1-192.png');
  assert.equal(worker.shown[0].options.data.url, '/mobile/van1?notice=n1');
});

test('a van worker never shows the other van\'s content: a mismatched payload is generic and opens its own van', async () => {
  const worker = loadWorker({ scope: '/mobile/van1/' });
  await push(worker, { v: 1, title: 'Van 2 secret run', body: 'Van 2 detail', tag: 'x', url: '/mobile/van2?notice=n2', vehicleId: 'van2', priority: 'normal' });
  assert.equal(worker.shown[0].title, 'FIKA Logistics');
  assert.equal(worker.shown[0].options.body, 'You have a new notification.');
  assert.equal(worker.shown[0].options.data.url, '/mobile/van1');
  assert.equal(worker.shown[0].options.icon, '/pwa/van1-192.png');
});

test('a link to another site or path inside the app is never opened: it falls back to the van\'s own app', async () => {
  const worker = loadWorker({ scope: '/mobile/van2/' });
  await push(worker, { v: 1, title: 'Delivery', body: 'b', tag: 't', url: 'https://evil.example/steal', vehicleId: 'van2', priority: 'normal' });
  assert.equal(worker.shown[0].options.data.url, '/mobile/van2');
  await push(worker, { v: 1, title: 'Delivery', body: 'b', tag: 't', url: '/mobile/van1?notice=n', vehicleId: 'van2', priority: 'normal' });
  assert.equal(worker.shown[1].options.data.url, '/mobile/van2', 'never another van\'s path');
});

test('tapping a van\'s notification focuses only that van\'s window, never the other van\'s', async () => {
  const log = { focused: [], messages: [] };
  const van2Window = windowFor('/mobile/van2', log);
  const van1Window = windowFor('/mobile/van1?run=r1', log);
  const worker = loadWorker({ scope: '/mobile/van1/', controlled: [van2Window, van1Window] });
  await click(worker, { url: '/mobile/van1?notice=n1', vehicle: 'van1' });
  assert.deepEqual(log.focused, ['/mobile/van1?run=r1']);
  assert.deepEqual(log.messages.map(item => item.message.url), ['/mobile/van1?notice=n1'], 'the van1 window is told which notice to open');
  assert.ok(!log.messages.some(item => item.url.startsWith('/mobile/van2')), 'van2 is never messaged');
});

test('tapping a notification with no open window opens that van\'s app at the notice', async () => {
  const worker = loadWorker({ scope: '/mobile/van2/', controlled: [] });
  await click(worker, { url: '/mobile/van2?notice=n9', vehicle: 'van2' });
  assert.deepEqual(worker.opened, ['/mobile/van2?notice=n9']);
});

test('the legacy shared worker still shows its van\'s notice during migration, with that van\'s icon', async () => {
  const worker = loadWorker({ scope: '/mobile/' });
  await push(worker, { v: 1, title: 'Route order updated', body: 'Van 2 · order changed.', tag: 'y', url: '/mobile/van2?notice=z', vehicleId: 'van2', priority: 'normal' });
  assert.equal(worker.shown[0].title, 'Route order updated');
  assert.equal(worker.shown[0].options.icon, '/pwa/van2-192.png');
});
