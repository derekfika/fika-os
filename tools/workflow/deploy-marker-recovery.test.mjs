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
  { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-a' } },
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
  assert.equal(preview.evidence.intents.length, 1);
  assert.equal(preview.evidence.intents[0].app, 'hub');
  assert.equal(preview.evidence.intents[0].environment, 'staging');
  assert.equal(preview.evidence.intents[0].intent.releaseId, 'r-a');
  assert.equal(preview.evidence.intents[0].terminal.kind, 'deploy');
  assert.match(preview.approveHash, /^[a-f0-9]{64}$/);
  assert.equal(preview.lease.workspace, 'staging-release-manager-3');
  assert.deepEqual(snapshot(), before, 'preview must not modify state');

  const executed = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': preview.approveHash }, deps);
  const audit = JSON.parse(readFileSync(path.join(stateDir(), 'workspace-audit', `deploy-recovery-${id}.json`)));
  assert.equal(audit.actor.login, 'fixture-admin');
  assert.equal(audit.reason, REASON);
  assert.deepEqual(audit.operation, marker);
  assert.deepEqual(audit.ledgerShas.intents, [preview.evidence.intents[0].intent.commit]);
  assert.deepEqual(audit.ledgerShas.terminals, [preview.evidence.intents[0].terminal.commit]);
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

const BASE = { seconds: -86400, record: { kind: 'baseline', sourceSha: SHA.c } };
const hubIntent = { seconds: 10, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-a' } };
const hubDone = { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-a' } };
const hospitalityLedger = (f, entries) => ledger(f, 'hospitality', 'staging', entries || [BASE,
  { seconds: 43, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-h' } },
  { seconds: 7200, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-h' } }]);

test('no candidate intent: absent ledgers, or intents outside the 120s window, are refused', () => run(async f => {
  const { id } = setup(f);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /No release intent/);
  standardLedger(f, { entries: [BASE,
    { seconds: -5, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-early' } },
    { seconds: 300, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-late' } },
    { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-b' } }] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /No release intent/);
}));

test('real-case shape: hub intent completed much later plus a hospitality intent in the window, both terminal, is recoverable', () => run(async f => {
  const { id, file } = setup(f);
  standardLedger(f, { entries: [BASE, hubIntent,
    { seconds: 1800, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-other' } }, hubDone] });
  hospitalityLedger(f);
  const preview = recoverDeployOperation(id, { reason: REASON }, deps);
  assert.deepEqual(preview.evidence.intents.map(i => i.app).sort(), ['hospitality', 'hub']);
  for (const item of preview.evidence.intents) {
    assert.equal(item.intent.releaseId, item.terminal.releaseId);
    assert.equal(item.terminal.kind, 'deploy');
    assert.match(item.terminal.commit, /^[a-f0-9]{40}$/);
  }
  assert.equal(preview.evidence.ledgerHeads.length, 2);
  const executed = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': preview.approveHash }, deps);
  assert.equal(executed.ledgerShas.terminals.length, 2);
  assert.equal(existsSync(file), false);
  assert.ok(existsSync(executed.archived));
}));

test('rollback and abandoned records are terminal; other record kinds are not', () => run(async f => {
  const { id } = setup(f);
  for (const kind of ['rollback', 'abandoned']) {
    standardLedger(f, { entries: [BASE, hubIntent, { seconds: 3600, record: { kind, sourceSha: SHA.a, releaseId: 'r-a' } }] });
    assert.equal(recoverDeployOperation(id, { reason: REASON }, deps).evidence.intents[0].terminal.kind, kind);
  }
  standardLedger(f, { entries: [BASE, hubIntent, { seconds: 3600, record: { kind: 'baseline', sourceSha: SHA.a, releaseId: 'r-a' } }] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /no terminal record/);
}));

test('any non-terminal intent in the window refuses', () => run(async f => {
  const { id, file } = setup(f);
  standardLedger(f, { entries: [BASE, hubIntent, hubDone] });
  // Second intent (hospitality) was never finished, but a different deploy of that app exists later.
  hospitalityLedger(f, [BASE,
    { seconds: 43, record: { kind: 'intent', sourceSha: SHA.a, releaseId: 'r-h' } },
    { seconds: 7200, record: { kind: 'deploy', sourceSha: SHA.b, releaseId: 'r-other' } }]);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /hospitality staging, release r-h\) has no terminal record/);
  // A terminal record with a different releaseId is not proof for this intent.
  standardLedger(f, { entries: [BASE, hubIntent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-wrong' } }] });
  hospitalityLedger(f);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /hub staging, release r-a\) has no terminal record/);
  // An intent without a releaseId cannot be proven finished.
  standardLedger(f, { entries: [BASE, { seconds: 10, record: { kind: 'intent', sourceSha: SHA.a } }, hubDone] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /no releaseId/);
  // A later record naming a different app is never trusted.
  standardLedger(f, { entries: [BASE, hubIntent, { seconds: 3600, record: { kind: 'deploy', sourceSha: SHA.a, releaseId: 'r-a', app: 'menu' } }] });
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /different app/);
  assert.ok(existsSync(file));
}));

test('a pending intent at the head of ANY ledger (even outside the window or another environment) refuses', () => run(async f => {
  const { id } = setup(f);
  standardLedger(f, { entries: [BASE, hubIntent, hubDone] });
  ledger(f, 'logistics', 'prod', [BASE, { seconds: 86400, record: { kind: 'intent', sourceSha: SHA.b, releaseId: 'r-l' } }]);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /logistics.*head is a pending intent/);
  standardLedger(f, { entries: [BASE, hubDone, hubIntent] }); // hub's own head is an intent
  ledger(f, 'logistics', 'prod', [BASE]);
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /hub.*head is a pending intent/);
}));

test('any release lock or non-completed/unreadable journal on any app/environment is never overridden', () => run(async f => {
  standardLedger(f, { entries: [BASE, hubIntent, hubDone] });
  const { id, file } = setup(f);
  const lockFile = path.join(stateDir(), 'release-menu-prod.lock');
  writeFileSync(lockFile, '');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /release lock exists.*fika reconcile/);
  assert.ok(existsSync(lockFile), 'lock is never broken');
  execFileSync(process.execPath, ['-e', `require('fs').unlinkSync(${JSON.stringify(lockFile)})`]);
  const journal = path.join(stateDir(), 'release-cpu-staging.json');
  writeFileSync(journal, JSON.stringify({ state: 'submitted' }));
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /non-completed release journal.*fika reconcile/);
  writeFileSync(journal, '{broken');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /unreadable/);
  writeFileSync(journal, JSON.stringify({ state: 'completed' }));
  assert.ok(recoverDeployOperation(id, { reason: REASON }, deps).approveHash);
  assert.ok(existsSync(file));
}));

test('a wrong approve-hash changes nothing; an interrupted run resumes with an appended entry; replay is idempotent', () => run(async f => {
  standardLedger(f, { entries: [BASE, hubIntent, hubDone] });
  const { id, file, marker } = setup(f);
  const { approveHash } = recoverDeployOperation(id, { reason: REASON }, deps);
  const before = snapshot();
  assert.throws(() => recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash.replace(/./, c => c === 'a' ? 'b' : 'a') }, deps), /fresh preview/);
  assert.deepEqual(snapshot(), before);

  // Simulate a crash after the audit was written but before the marker was moved.
  const auditFile = path.join(stateDir(), 'workspace-audit', `deploy-recovery-${id}.json`);
  save(auditFile, { schema: 'fika.deploy-marker-recovery.v2', at: '2026-11-01T00:00:00.000Z', actor: { login: 'earlier' }, reason: 'earlier run', operation: marker });
  const resumed = recoverDeployOperation(id, { reason: `${REASON} (resume)`, execute: true, 'approve-hash': approveHash }, { ...deps, authorize: () => ({ login: 'second-admin', administrator: true }) });
  assert.equal(resumed.actor.login, 'earlier', 'the original event is preserved');
  assert.equal(resumed.resumes.length, 1);
  assert.equal(resumed.resumes[0].actor.login, 'second-admin');
  assert.equal(resumed.resumes[0].reason, `${REASON} (resume)`);
  assert.equal(resumed.resumes[0].approveHash, approveHash);
  assert.deepEqual(JSON.parse(readFileSync(auditFile)).resumes, resumed.resumes);
  assert.equal(existsSync(file), false);

  const afterFirst = snapshot();
  const replay = recoverDeployOperation(id, { reason: REASON, execute: true, 'approve-hash': approveHash }, deps);
  assert.equal(replay.alreadyApplied, true);
  assert.deepEqual(snapshot(), afterFirst, 'replay changes nothing');
  assert.throws(() => recoverDeployOperation(id, { reason: REASON }, deps), /does not exist/);
}));

test('an existing archive is never overwritten', () => run(async f => {
  standardLedger(f, { entries: [BASE, hubIntent, hubDone] });
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
