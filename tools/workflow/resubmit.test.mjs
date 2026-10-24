import test from 'node:test';
import assert from 'node:assert/strict';
import { target } from './policy.mjs';
import { assertNeverSubmitted, resubmitNeverSubmitted, submissionAttempts, describeSubmissionEvidence, RESUBMIT_QUIET_MS } from './recovery.mjs';
import { firebaseAuthPreflight, auditCreateEvents } from './releases.mjs';

const INTENT_AT = Date.parse('2026-10-24T14:33:10Z');
const FINISHED_AT = Date.parse('2026-10-24T14:33:17Z');
const LATER = FINISHED_AT + RESUBMIT_QUIET_MS + 60_000;

function fixture(overrides = {}) {
  const t = target('hub', 'staging'); const sourceSha = 'a'.repeat(40); const old = 'b'.repeat(40);
  const plan = { ...t, sourceSha, scopeHash: 'candidate', approval: { id: 'staging:hub:candidate' } };
  const before = { sourceSha: old, rollout: 'build-old', state: 'SUCCEEDED', percent: 100 };
  const journal = { releaseId: 'r1', plan, before, observedBefore: before, previousGoodRecord: 'd'.repeat(40), createdAt: '2026-10-24T14:33:10Z', submissionStartedAt: '2026-10-24T14:33:15Z', submissionFinishedAt: '2026-10-24T14:33:17Z', submissionFailure: { exitStatus: 1, message: 'Authentication Error: credentials no longer valid' }, ...overrides.journal };
  const intent = { schema: 'fika.release.v1', ...plan, kind: 'intent', state: 'PENDING', releaseId: 'r1', previousGood: before, previousGoodRecord: journal.previousGoodRecord };
  const old1 = { name: `${t.backend}/builds/build-old`, state: 'READY', sourceSha: old, createTime: '2026-10-22T13:56:46Z', reconciling: false };
  const oldRollout = { name: `${t.backend}/rollouts/build-old`, build: old1.name, state: 'SUCCEEDED', createTime: '2026-10-22T13:56:47Z', reconciling: false };
  const snapshot = { builds: [old1], rollouts: [oldRollout], operations: [], traffic: { current: [{ build: `${t.backend}/builds/build-old`, percent: 100 }], target: [], reconciling: false, autoDisabled: true }, current: structuredClone(before), ...overrides.snapshot };
  return { t, intent, journal, snapshot, audit: { readable: true, events: [], ...overrides.audit } };
}
const ready = overrides => { const f = fixture(overrides); return { ...f, args: { intent: f.intent, journal: f.journal, first: f.snapshot, second: structuredClone(f.snapshot), audit: f.audit, now: LATER } }; };
const refused = (overrides, pattern) => { const { args } = ready(overrides); assert.throws(() => assertNeverSubmitted(args), pattern); };

test('verified never-submitted staging intent is eligible and reports its single original attempt with recorded CLI failure', () => {
  const { args, journal } = ready();
  const attempts = assertNeverSubmitted(args);
  assert.equal(attempts.length, 1);
  assert.match(attempts[0].failure.message, /Authentication Error/);
  assert.deepEqual(submissionAttempts(journal)[0].failure, journal.submissionFailure);
});

test('any doubt refuses resubmission: late build, late rollout, unparsable time, operation, traffic, serving, audit, quiet period, production', () => {
  const t = target('hub', 'staging');
  const late = { name: `${t.backend}/builds/new`, state: 'BUILDING', sourceSha: 'a'.repeat(40), createTime: '2026-10-24T14:33:30Z', reconciling: false };
  const base = fixture().snapshot;
  refused({ snapshot: { ...base, builds: [...base.builds, late] } }, /may have reached Firebase/);
  refused({ snapshot: { ...base, builds: [...base.builds, { ...late, state: 'FAILED' }] } }, /may have reached Firebase/);
  refused({ snapshot: { ...base, rollouts: [...base.rollouts, { name: `${t.backend}/rollouts/new`, build: late.name, state: 'SKIPPED', createTime: '2026-10-24T14:34:00Z' }] } }, /may have reached Firebase/);
  refused({ snapshot: { ...base, builds: [...base.builds, { ...late, createTime: undefined }] } }, /may have reached Firebase/);
  refused({ snapshot: { ...base, operations: [{ name: 'op', done: false, target: t.backend }] } }, /in flight/);
  refused({ snapshot: { ...base, traffic: { ...base.traffic, reconciling: true } } }, /Traffic is not quiescent/);
  refused({ snapshot: { ...base, traffic: { ...base.traffic, autoDisabled: false } } }, /Traffic is not quiescent/);
  refused({ snapshot: { ...base, current: { ...base.current, sourceSha: 'c'.repeat(40) } } }, /Serving state differs/);
  refused({ snapshot: { ...base, current: { ...base.current, percent: 50 } } }, /Traffic|Serving/);
  refused({ audit: { readable: false } }, /could not be read/);
  refused({ audit: { events: [{ at: '2026-10-24T14:33:16Z', method: 'CreateRollout' }] } }, /App Hosting create call/);
  const prod = fixture(); const pt = target('hub', 'prod');
  const prodPlan = { ...prod.journal.plan, ...pt }; const prodIntent = { ...prod.intent, ...pt };
  assert.throws(() => assertNeverSubmitted({ intent: prodIntent, journal: { ...prod.journal, plan: prodPlan }, first: prod.snapshot, second: structuredClone(prod.snapshot), audit: prod.audit, now: LATER }), /limited to staging/);
  const f = ready(); assert.throws(() => assertNeverSubmitted({ ...f.args, now: FINISHED_AT + 60_000 }), /Quiet period not elapsed/);
  assert.throws(() => assertNeverSubmitted({ ...f.args, second: { ...f.snapshot, builds: [] } }), /changed between snapshots/);
  refused({ journal: { createdAt: undefined } }, /outcome is unknown/);
  refused({ journal: { submissionFinishedAt: undefined } }, /outcome is unknown/);
});

function harness(overrides) {
  const f = ready(overrides); let journal = structuredClone(f.journal); let snapshot = structuredClone(f.snapshot); const submits = []; let claimGate;
  const io = {
    now: () => LATER,
    inspect: async () => structuredClone(snapshot),
    audit: async () => structuredClone(f.audit),
    claim: async (expected, next) => { await claimGate; if (submissionAttempts(journal).length !== expected) throw Error('Another resume already claimed the resubmission'); journal = structuredClone(next); },
    // A real submission makes a build and rollout appear in Firebase, exactly what a later resume would see.
    submit: async () => { submits.push(journal.submissionAttempts.at(-1).n); snapshot = { ...snapshot, builds: [...snapshot.builds, { name: `${f.t.backend}/builds/new`, state: 'BUILDING', sourceSha: f.intent.sourceSha, createTime: '2026-10-24T15:00:00Z' }] }; },
    finish: async (n, patch) => { journal = { ...journal, submissionAttempts: journal.submissionAttempts.map(a => a.n === n ? { ...a, ...patch } : a) }; },
  };
  return { f, io, submits, get journal() { return journal; }, set gate(value) { claimGate = value; } };
}

test('resume resubmits exactly once for the same intent, durably recording the attempt before and after', async () => {
  const h = harness();
  const { attempt } = await resubmitNeverSubmitted({ intent: h.f.intent, journal: h.journal }, h.io);
  assert.equal(attempt.n, 2);
  assert.equal(attempt.reason, 'verified-never-submitted');
  assert.deepEqual(h.submits, [2]);
  assert.equal(h.journal.releaseId, 'r1', 'same release ID');
  assert.equal(h.journal.submissionAttempts.length, 2);
  assert.ok(h.journal.submissionAttempts[1].finishedAt);
  assert.match(h.journal.submissionAttempts[1].previousFailure.message, /Authentication/);
});

test('repeated resume cannot create a duplicate rollout: the second invocation is refused by durable state and by Firebase evidence', async () => {
  const h = harness();
  await resubmitNeverSubmitted({ intent: h.f.intent, journal: h.journal }, h.io);
  await assert.rejects(resubmitNeverSubmitted({ intent: h.f.intent, journal: h.journal }, h.io), /already recorded|may have reached Firebase/);
  assert.equal(h.submits.length, 1);
});

test('concurrent resumes: exactly one claims the resubmission', async () => {
  const h = harness(); let release; h.gate = new Promise(resolve => { release = resolve; });
  const stale = structuredClone(h.journal);
  const runs = Promise.allSettled([resubmitNeverSubmitted({ intent: h.f.intent, journal: stale }, h.io), resubmitNeverSubmitted({ intent: h.f.intent, journal: structuredClone(stale) }, h.io)]);
  await new Promise(resolve => setTimeout(resolve, 5)); release();
  const results = await runs;
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected').length, 1);
  assert.equal(h.submits.length, 1, 'a single rollout submission');
});

test('a failed resubmission is recorded and can never be retried automatically', async () => {
  const h = harness(); h.io.submit = async () => { throw Object.assign(Error('firebase exited 1'), { status: 1 }); };
  await assert.rejects(resubmitNeverSubmitted({ intent: h.f.intent, journal: h.journal }, h.io), /Resubmission failed/);
  assert.equal(h.journal.submissionAttempts[1].failure.exitStatus, 1);
  await assert.rejects(resubmitNeverSubmitted({ intent: h.f.intent, journal: h.journal }, h.io), /already recorded/);
});

test('an original submission that DID reach Firebase is never resubmitted (resume verifies instead)', async () => {
  const f = fixture(); const t = f.t;
  const snapshot = { ...f.snapshot, builds: [...f.snapshot.builds, { name: `${t.backend}/builds/orig`, state: 'READY', sourceSha: f.intent.sourceSha, createTime: '2026-10-24T14:33:16Z' }], rollouts: [...f.snapshot.rollouts, { name: `${t.backend}/rollouts/orig`, build: `${t.backend}/builds/orig`, state: 'IN_PROGRESS', createTime: '2026-10-24T14:33:16Z' }] };
  let submitted = 0;
  await assert.rejects(resubmitNeverSubmitted({ intent: f.intent, journal: f.journal }, { now: () => LATER, inspect: async () => structuredClone(snapshot), audit: async () => f.audit, claim: async () => {}, submit: async () => { submitted += 1; }, finish: async () => {} }), /may have reached Firebase/);
  assert.equal(submitted, 0);
  assert.match(describeSubmissionEvidence(snapshot, f.journal), /orig \(IN_PROGRESS\)/);
  assert.match(describeSubmissionEvidence(f.snapshot, f.journal), /has not reached Firebase/);
});

test('firebase auth preflight fails before any state is written, with the operator action', () => {
  const t = target('hub', 'staging');
  assert.throws(() => firebaseAuthPreflight(t, () => { throw Error('Authentication Error'); }), /firebase login --reauth.*No release state was written/);
  assert.throws(() => firebaseAuthPreflight(t, () => '[]'), /cannot see backend/);
  assert.doesNotThrow(() => firebaseAuthPreflight(t, (program, args) => { assert.equal(program, 'firebase'); assert.deepEqual(args.slice(0, 2), ['apphosting:backends:list', '--project']); return JSON.stringify([{ name: `projects/p/locations/l/backends/${t.backend}` }]); }));
});

test('audit evidence is scoped to the backend and unreadable logs are reported, not assumed empty', () => {
  const t = target('hub', 'staging');
  const rows = [{ timestamp: 'x', protoPayload: { methodName: 'google.firebase.apphosting.v1beta.AppHosting.CreateRollout', resourceName: `projects/p/locations/l/backends/${t.backend}/rollouts/r` } }, { timestamp: 'y', protoPayload: { methodName: 'CreateBuild', resourceName: 'projects/p/locations/l/backends/other/builds/b' } }];
  const seen = []; const found = auditCreateEvents(t, INTENT_AT, (program, args) => { seen.push(args.join(' ')); return JSON.stringify(rows); });
  assert.equal(found.readable, true); assert.equal(found.events.length, 1);
  assert.match(seen[0], /CreateRollout\|CreateBuild.*timestamp>="2026-10-24T14:33:10/);
  assert.deepEqual(auditCreateEvents(t, INTENT_AT, () => { throw Error('permission denied'); }), { readable: false, events: [] });
  assert.equal(auditCreateEvents(t, INTENT_AT, () => 'not json').readable, false);
});
