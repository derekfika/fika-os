import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { fixture } from './lifecycle-fixture.mjs';
import { stateDir, save } from './runtime.mjs';
import { createWorkspace, workspaceRecords } from './workspaces.mjs';
import { beginWorkspaceOperation } from './workspace-state.mjs';
import { recoverDeployOperation } from './workspace-admin.mjs';
import { parseArguments } from './deploy-marker-recovery.mjs';

const T0 = '2026-10-31T08:12:47.498Z';
const at = (seconds) => new Date(Date.parse(T0) + seconds * 1000).toISOString();
const SHA = { a: 'a'.repeat(40), b: 'b'.repeat(40), c: 'c'.repeat(40) };
const REASON = 'Fixture: interrupted Hub staging deploy superseded by later deploys';
const admin = () => ({ login: 'fixture-admin', administrator: true });
const deps = { authorize: admin, processAlive: () => false };

/** Builds an append-only ledger on the fixture remote with controlled commit times, like appendRecord does. */
function ledger(f, app, environment, entries) {
  let parent;
  for (const { record, seconds } of entries) {
    const env = { ...process.env, GIT_COMMITTER_DATE: at(seconds), GIT_AUTHOR_DATE: at(seconds) };
    const run = (args, input) => execFileSync('git', args, { cwd: f.repo, encoding: 'utf8', input, env, windowsHide: true }).trim();
    const blob = run(['hash-object', '-w', '--stdin'], `${JSON.stringify({ schema: 'fika.release.v1', app, environment, ...record }, null, 2)}\n`);
    const tree = run(['mktree'], `100644 blob ${blob}\trelease.json\n`);
    parent = run(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Release record: ${app} ${environment} ${record.kind} ${record.sourceSha}`]);
  }
  f.git('push', 'origin', `+${parent}:refs/heads/release/${environment}/${app}`);
}
const standardLedger = (f, overrides = {}) => ledger(f, 'hub', 'staging', overrides.entries || [
  { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } },
  { seconds: 10, record: { kind: 'intent', state: 'PENDING', sourceSha: SHA.a, releaseId: 'r-a' } },
  { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b' } },
]);

function snapshot() {
  const out = {};
  const visit = dir => { for (const item of readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name);
    if (item.isDirectory()) visit(file); else out[path.relative(stateDir(), file)] = readFileSync(file, 'utf8');
  } };
  visit(stateDir());
  return out;
}
const remoteRefs = f => f.run(f.repo, 'ls-remote', 'origin');

/** Registers a lease and a deploy marker whose pid is "dead" (the process check is injected). */
function setup(f, patch = {}) {
  const record = createWorkspace('staging-release-manager-3', { owner: 'claude-staging-release', scope: 'src' });
  beginWorkspaceOperation('deploy', { workspace: record.name, owner: record.owner });
  const dir = path.join(stateDir(), 'workspace-operations');
  const file = path.join(dir, readdirSync(dir)[0]);
  const original = { ...JSON.parse(readFileSync(file)), kind: 'deploy', pid: 16448, startedAt: T0, ...patch };
  save(file, original);
  return { record, file, marker: original, id: original.id };
}
const run = async (fn) => { const f = fixture(); try { await f.within(() => fn(f)); } finally { f.dispose(); } };

test('happy path: preview is read-only; execution needs the approve-hash, audits and archives only the marker', () => run(async f => {
  standardLedger(f);
  const { file, marker, id } = setup(f);
  // A completed journal from the later successful deploy is not a live release control.
  writeFileSync(path.join(stateDir(), 'release-hub-staging.json'), JSON.stringify({ state: 'completed' }));
  const refsBefore = remoteRefs(f);
  const registryBefore = JSON.stringify(workspaceRecords());
  const before = snapshot();

  const preview = recoverDeployOperation(id, { reason: REASON }, deps);
  assert.equal(preview.dryRun, true);
  assert.equal(preview.evidence.app, 'hub');
  assert.equal(preview.evidence.environment, 'staging');
  assert.equal(preview.evidence.intent.sourceSha, SHA.a);
  assert.equal(preview.evidence.supersedingDeploy.sourceSha, SHA.b);
  assert.match(preview.approveHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.lease.workspace, 'staging-release-manager-3');
  assert.deepEqual(snapshot(), before, 'preview must not modify state');

  const executed = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': preview.approveHash }, deps);
  const audit = JSON.parse(readFileSync(path.join(stateDir(), 'workspace-audit', `deploy-recovery-${id}.json`)));
  assert.equal(audit.actor.login, 'fixture-admin');
  assert.equal(audit.reason, REASON);
  assert.deepEqual(audit.operation, marker);
  assert.equal(audit.ledgerShas.intent, preview.evidence.intent.commit);
  assert.equal(audit.ledgerShas.supersedingDeploy, preview.evidence.supersedingDeploy.commit);
  assert.equal(executed.archived, path.join(stateDir(), 'workspace-operations-archive', `${id}.json`));
  assert.equal(existsSync(file), false);
  assert.deepEqual(JSON.parse(readFileSync(executed.archived)), marker);

  const after = snapshot();
  const changed = Object.keys({ ...before, ...after }).filter(k => before[k] !== after[k]).sort();
  assert.deepEqual(changed, [
    path.join('workspace-audit', `deploy-recovery-${id}.json`),
    path.join('workspace-operations', `${id}.json`),
    path.join('workspace-operations-archive', `${id}.json`),
  ].sort(), 'only the audit, the removed marker and its archive differ');
  assert.equal(JSON.stringify(workspaceRecords()), registryBefore, 'lease registry unchanged');
  assert.equal(remoteRefs(f), refsBefore, 'ledgers unchanged');
}));

test('authorisation, id, reason and approve-hash inputs fail closed', () => run(async f => {
  standardLedger(f);
  const { id, file } = setup(f);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, { ...deps, authorize: () => ({ login: 'reader' }) }), /Administrator/);
  assert.throws(() => recoverDeployOperation('../bad', { reason: REASON }, deps), /operation id/);
  assert.throws(() => recoverDeployOperation(id, { reason: '' }, deps), /reason/);
  assert.throws(() => recoverDeployOperation(id, { reason: 'ok' }, deps), /reason/);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true }, deps), /approve-hash/);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': 'f'.repeat(64) }, deps), /fresh preview/);
  assert.throws(() => recoverDeployOperation('0'.repeat(8) + '-0000-0000-0000-' + '0'.repeat(12), { reason: REASON }, deps), /does not exist/);
  assert.ok(existsSync(file));
}));

test('live pid, wrong kind and non-integer pid are protected', () => run(async f => {
  standardLedger(f);
  const { id, file, marker } = setup(f);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, { ...deps, processAlive: () => true }), /confirmed exited/);
  let calls = 0;
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': recoverDeployOperation(id, { reason: REASON }, deps).approveHash }, { ...deps, processAlive: () => ++calls > 1 }), /live/);
  for (const patch of [{ kind: 'validate' }, { kind: 'dev' }, { kind: 'rollback' }, { kind: 'integrate' }, { pid: 'x' }, { pid: null }, { pid: 0 }]) {
    save(file, { ...marker, ...patch });
    assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /confirmed exited/);
  }
  assert.ok(existsSync(file));
}));

test('a marker that does not match the registry lease is refused', () => run(async f => {
  standardLedger(f);
  const { id, file, marker } = setup(f);
  for (const patch of [{ leaseId: 'different-lease' }, { leaseId: null }, { owner: 'someone-else' }, { name: 'unknown-workspace' }]) {
    save(file, { ...marker, ...patch });
    assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /recorded workspace lease/);
  }
  assert.ok(existsSync(file));
}));

test('no candidate intent: absent ledgers, or intents outside the 120s window, are refused', () => run(async f => {
  const { id } = setup(f);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /No release intent/);
  standardLedger(f, { entries: [
    { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } },
    { seconds: -5, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-early' } },
    { seconds: 300, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-late' } },
    { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b' } },
  ] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /No release intent/);
}));

test('multiple candidate intents (same ledger or another app) are ambiguous', () => run(async f => {
  const { id } = setup(f);
  standardLedger(f, { entries: [
    { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } },
    { seconds: 10, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-1' } },
    { seconds: 50, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-2' } },
    { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b' } },
  ] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /Ambiguous: 2/);
}));

test('an intent on another app within the window makes the evidence ambiguous', () => run(async f => {
  const { id } = setup(f);
  standardLedger(f);
  ledger(f, 'logistics', 'staging', [
    { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } },
    { seconds: 30, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-l' } },
    { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-lb' } },
  ]);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /Ambiguous: 2/);
}));

test('an intent that is not superseded by a completed deploy is refused', () => run(async f => {
  const { id } = setup(f);
  const base = { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } };
  const intent = { seconds: 10, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-a' } };
  const cases = [
    [[base, intent], /still the head|pending/],
    [[base, intent, { seconds: 3600, record: { kind: 'intent', sourceSha: SHA.b, releaseId: 'r-b' } }], /newer release intent is pending/],
    [[base, intent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-a' } }], /completed deploy record/],
    [[base, intent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-a' } }], /completed deploy record/],
    [[base, intent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b' } }, { seconds: 7200, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-x' } }], /completed deploy record/],
    [[base, intent, { seconds: 3600, record: { kind: 'rollback', sourceSha: SHA.b, releaseId: 'r-b' } }], /No later completed deploy/],
    [[base, intent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b', app: 'menu' } }], /different app/],
  ];
  for (const [entries, message] of cases) {
    standardLedger(f, { entries });
    assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), message);
  }
}));

test('a live release lock or pending journal for that app/environment is never overridden', () => run(async f => {
  standardLedger(f);
  const { id, file } = setup(f);
  const lockFile = path.join(stateDir(), 'release-hub-staging.lock');
  writeFileSync(lockFile, '');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /release lock exists.*fika reconcile/);
  assert.ok(existsSync(lockFile), 'lock is never broken');
  execFileSync(process.execPath, ['-e', `require('fs').unlinkSync(${JSON.stringify(lockFile)})`]);
  const journal = path.join(stateDir(), 'release-hub-staging.json');
  writeFileSync(journal, JSON.stringify({ state: 'submitted' }));
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /pending release journal.*fika reconcile/);
  writeFileSync(journal, '{broken');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /unreadable/);
  // Controls for other app/environment pairs are unrelated.
  writeFileSync(journal, JSON.stringify({ state: 'completed' }));
  writeFileSync(path.join(stateDir(), 'release-menu-prod.json'), JSON.stringify({ state: 'submitted' }));
  assert.ok(recoverDeployOperation(id, { reason: REASON }, deps).approveHash);
  assert.ok(existsSync(file));
}));

test('a wrong approve-hash changes nothing; replay is idempotent and an interrupted run resumes', () => run(async f => {
  standardLedger(f);
  const { id, file, marker } = setup(f);
  const { approveHash } = recoverDeployOperation(id, { reason: REASON }, deps);
  const before = snapshot();
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash.replace(/./, c => c === 'a' ? 'b' : 'a') }, deps), /fresh preview/);
  assert.deepEqual(snapshot(), before);

  // Simulate a crash after the audit was written but before the marker was moved.
  const auditFile = path.join(stateDir(), 'workspace-audit', `deploy-recovery-${id}.json`);
  save(auditFile, { schema: 'fika.deploy-marker-recovery.v1', at: '2026-11-01T00:00:00.000Z', actor: { login: 'earlier' }, reason: 'earlier run', operation: marker });
  const resumed = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash }, deps);
  assert.equal(resumed.actor.login, 'earlier', 'the original audit event is preserved');
  assert.equal(existsSync(file), false);

  const afterFirst = snapshot();
  const replay = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash }, deps);
  assert.equal(replay.alreadyApplied, true);
  assert.deepEqual(snapshot(), afterFirst, 'replay changes nothing');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /does not exist/);
}));

test('an existing archive is never overwritten', () => run(async f => {
  standardLedger(f);
  const { id, file } = setup(f);
  const { approveHash } = recoverDeployOperation(id, { reason: REASON }, deps);
  const archive = path.join(stateDir(), 'workspace-operations-archive', `${id}.json`);
  save(archive, { id: 'other' });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash }, deps), /already exists/);
  assert.ok(existsSync(file));
  assert.equal(statSync(archive).isFile(), true);
}));

test('standalone argument parsing is strict', () => {
  assert.deepEqual(parseArguments(['id', '--reason', 'because', '--execute', '--approve-hash', 'h']), { id: 'id', options: { reason: 'because', execute: true, 'approve-hash': 'h' } });
  assert.throws(() => parseArguments(['id', '--reason']), /requires a value/);
  assert.throws(() => parseArguments(['id', '--force']), /Unknown argument/);
});
