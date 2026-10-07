const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const { NextRequest } = require('next/server');
const { typescriptLoader } = require('../../../scripts/testing/load-typescript.cjs');

function fixture() {
  const appRoot = path.resolve(__dirname, '..'), records = new Map(), reads = [], notifications = [];
  let role = 'integration-admin', actorId = 'operator:uat', writes = 0, failCommit = false, failNotification = false;
  const copy = value => value === undefined ? undefined : structuredClone(value);
  const ref = (collection, id) => ({ path: `${collection}/${id}`, async get() { reads.push(this.path); const value = copy(records.get(this.path)); return { exists: value !== undefined, data: () => copy(value) }; }, async set(value) { records.set(this.path, copy(value)); writes++; } });
  let tail = Promise.resolve();
  const db = { collection(name) { return { doc: id => ref(name, id) }; }, async runTransaction(callback) {
    const before = tail; let release; tail = new Promise(resolve => { release = resolve; }); await before;
    try {
      const staged = [];
      const result = await callback({ async get(ref) { assert.equal(staged.length, 0, 'all reads precede writes'); return ref.get(); }, create(ref, value) { staged.push([ref, copy(value), true]); }, set(ref, value) { staged.push([ref, copy(value), false]); } });
      if (failCommit) throw new Error('simulated atomic commit failure');
      for (const [ref, , create] of staged) if (create && records.has(ref.path)) throw new Error('existing immutable audit');
      for (const [ref, value] of staged) { records.set(ref.path, value); writes++; }
      return result;
    } finally { release(); }
  } };
  const notify = async payload => { notifications.push(copy(payload)); if (failNotification) throw new Error('controlled upstream outage'); };
  const mocks = { '@/lib/firebase-admin': { db }, [path.join(appRoot, 'lib/firebase-admin.ts')]: { db },
    '@/lib/auth': { async requireActor(_req, allowed) { if (!allowed.includes(role)) throw Object.assign(new Error('Denied'), { status: 403 }); return { uid: actorId, role }; } },
    [path.join(appRoot, 'lib/logistics-projection-client.ts')]: { notifyLogisticsProjection: notify, notifyLogisticsProjectionBatch: notify },
  };
  const load = typescriptLoader({ typescript: require('typescript'), appRoot, mocks });
  const outbox = load(path.join(appRoot, 'lib/logistics-projection-outbox.ts'));
  const route = load(path.join(appRoot, 'app/api/logistics-outbox/replay/route.ts'));
  const event = { eventId: 'uat:event:1', eventType: 'fulfilment.requirement.logistics-invalidation', sourceAggregateId: 'requirement:uat', sourceVersion: 2, occurredAt: '2099-01-05T10:00:00Z', schemaVersion: 'fika.logistics-projection-invalidation.v1', correlationId: 'booking:uat', payload: { serviceDate: '2099-01-05', sourceDomain: 'cpu-production', sourceEntityId: 'order:uat', sourceVersion: 2, changedAt: '2099-01-05T10:00:00Z', changeType: 'withdrawn' }, delivery: { status: 'dead-letter', attempts: 10, lastError: 'recorded failure', deadLetteredAt: '2099-01-05T10:01:00Z' }, outboxStatus: 'dead-letter' };
  records.set('fikaLogisticsProjectionOutboxV1/' + event.eventId, copy(event));
  const command = { eventId: event.eventId, commandId: 'ea8c93d7-c343-4fca-ae89-41f5e3a2ae13', reason: 'Owned UAT reviewed failure', expectedAttempts: 10, expectedDeadLetteredAt: event.delivery.deadLetteredAt };
  return { records, reads, notifications, event, command, outbox, setRole(value) { role = value; }, setActor(value) { actorId = value; }, failCommit(value) { failCommit = value; }, failNotification(value) { failNotification = value; }, get writes() { return writes; },
    async get(id = event.eventId) { const response = await route.GET(new NextRequest('https://hub.test/api/logistics-outbox/replay?eventId=' + encodeURIComponent(id))); return { response, body: await response.json() }; },
    async post(body = command) { const response = await route.POST(new NextRequest('https://hub.test/api/logistics-outbox/replay', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })); return { response, body: await response.json() }; },
  };
}
test('exact recovery requires administrator admission before any outbox read or write', async () => {
  for (const role of ['viewer', 'reviewer']) { const f = fixture(); f.setRole(role); assert.equal((await f.get()).response.status, 403); assert.equal((await f.post()).response.status, 403); assert.deepEqual(f.reads, []); assert.equal(f.writes, 0); }
});
test('lookup is one exact document read and excludes mutation payload from operator response', async () => {
  const f = fixture(); const result = await f.get(); assert.equal(result.response.status, 200); assert.deepEqual(f.reads, ['fikaLogisticsProjectionOutboxV1/uat:event:1']); assert.equal(result.body.event.payload, undefined); assert.equal(f.writes, 0);
});
test('one reviewed dead letter resets with atomic immutable evidence and delivers the same identity/payload', async () => {
  const f = fixture(); f.records.set('fikaLogisticsProjectionOutboxV1/untouched', structuredClone(f.event));
  const result = await f.post(); assert.equal(result.response.status, 200); assert.equal(result.body.event.delivery.status, 'delivered'); assert.equal(result.body.changed, true);
  const audit = f.records.get('fikaLogisticsProjectionReplayAuditV1/' + result.body.auditId);
  assert.deepEqual(audit.beforeDelivery, f.event.delivery); assert.equal(audit.actorId, 'operator:uat'); assert.equal(audit.reason, f.command.reason);
  assert.deepEqual(f.notifications, [f.event.payload]);
  const current = f.records.get('fikaLogisticsProjectionOutboxV1/' + f.event.eventId);
  for (const key of ['eventId', 'payload', 'sourceAggregateId', 'sourceVersion', 'correlationId', 'schemaVersion']) assert.deepEqual(current[key], f.event[key]);
  assert.deepEqual(f.records.get('fikaLogisticsProjectionOutboxV1/untouched'), f.event);
  const before = f.writes; assert.equal((await f.post()).body.changed, false); assert.equal(f.writes, before); assert.equal(f.notifications.length, 1);
});
test('reset commit failure cannot lose the dead letter or its audit history', async () => {
  const f = fixture(); f.failCommit(true); await assert.rejects(f.outbox.resetLogisticsProjectionDeadLetter({ ...f.command, actorId: 'operator:uat' }), /atomic commit failure/);
  assert.deepEqual([...f.records.values()], [f.event]); assert.equal(f.writes, 0);
});
test('failed delivery remains durably retryable after reviewed reset', async () => {
  const f = fixture(); f.failNotification(true); const result = await f.post(); assert.equal(result.response.status, 200); assert.equal(result.body.event.delivery.status, 'failed'); assert.equal(result.body.event.delivery.attempts, 1); assert.ok(result.body.event.delivery.nextEligibleAt); assert.ok(f.records.has('fikaLogisticsProjectionReplayAuditV1/' + result.body.auditId));
});
test('stale review, non-dead-letter state and conflicting replay command fail closed', async () => {
  const f = fixture(); assert.equal((await f.post({ ...f.command, expectedAttempts: 9 })).response.status, 409); assert.equal((await f.post({ ...f.command, expectedDeadLetteredAt: '2099-01-05T10:00:00Z' })).response.status, 409); assert.equal(f.writes, 0);
  const first = await f.post(); assert.equal(first.response.status, 200);
  assert.equal((await f.post({ ...f.command, reason: 'Different reviewed failure' })).response.status, 409);
  assert.equal((await f.post({ ...f.command, commandId: '0b535bc3-9daa-43f0-9049-67ba21c60022' })).response.status, 409);
});
test('concurrent distinct recoveries accept one command and preserve one audit', async () => {
  const f = fixture(); const results = await Promise.all([f.post(), f.post({ ...f.command, commandId: '0b535bc3-9daa-43f0-9049-67ba21c60022' })]); assert.deepEqual(results.map(r => r.response.status).sort(), [200, 409]); assert.equal([...f.records.keys()].filter(key => key.startsWith('fikaLogisticsProjectionReplayAuditV1/')).length, 1); assert.equal(f.notifications.length, 1);
});
test('bulk, malformed, missing reason and missing event commands cannot write', async () => {
  const f = fixture(); for (const body of [{ limit: 25 }, { ...f.command, eventId: 'path/injection' }, { ...f.command, reason: '' }, { ...f.command, extra: 'bulk' }]) assert.equal((await f.post(body)).response.status, 400);
  assert.equal((await f.post({ ...f.command, eventId: 'missing' })).response.status, 404); assert.equal(f.writes, 0);
});
