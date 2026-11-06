import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixture } from './lifecycle-fixture.mjs';
import { createWorkspace, workspaceRecords } from './workspaces.mjs';
import { integrateSourceWorkspace, createSourceWorkspace, completeSourceWorkspace } from './source-workspaces.mjs';
import { migrateSourceHistory } from './source-migration.mjs';
import { governedReleaseOperation } from './workspace-state.mjs';
import { lock, SOURCE_HISTORY_BARRIER, stateDir } from './runtime.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const runAsync = promisify(execFile);
const migration = { authorize: () => ({ administrator: true, login: 'fixture-owner' }), verifySource: () => {} };

test('overlapping workers in independent worktrees ignore legacy history and orphan mutex', async () => {
  const f = fixture();
  try {
    const legacy = f.within(() => createWorkspace('legacy-task', { owner: 'fixture-owner', scope: 'src' }));
    const legacyFile = path.join(f.repo, '.git', 'fika-workflow', 'workspaces', 'legacy-task.json');
    const before = readFileSync(legacyFile);
    const orphan = path.join(f.repo, '.git', 'fika-workflow', 'workspaces.lock');
    writeFileSync(orphan, '');
    const args = name => [cli, 'workspace', 'create', name, '--owner', 'fixture-owner', '--scope', 'src'];
    const run = async name => JSON.parse((await runAsync(process.execPath, args(name), { cwd: f.repo })).stdout);
    const [a,b] = await Promise.all([run('fixture-one'), run('fixture-two')]);
    assert.notEqual(a.directory, b.directory);
    assert.equal(a.baseline, legacy.baseline);
    assert.equal(b.baseline, legacy.baseline);
    assert.deepEqual(readFileSync(legacyFile), before);
    assert.equal(readFileSync(orphan, 'utf8'), '');
    await assert.rejects(run('fixture-one'), /already exists/);
    mkdirSync(path.join(a.directory, 'tools', 'workflow'), { recursive: true });
    const plan = JSON.parse(execFileSync(process.execPath, [cli, 'validate', '--plan'], { cwd: a.directory, encoding: 'utf8' }));
    assert.equal(plan.executed, false);
    assert.equal(existsSync(path.join(f.repo, '.git', 'fika-workflow', 'workspaces', 'fixture-one.json')), false);
    assert.throws(() => f.within(() => migrateSourceHistory({}, migration)), /Legacy workspace lock is protected/);
    assert.throws(() => execFileSync(process.execPath, [cli, 'workspace', 'release-all', '--execute'], { cwd: f.repo, stdio: 'pipe' }), /retired/);
  } finally { f.dispose(); }
});

test('completion protects dirty, ignored and unique commits and records pushed evidence', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('source-dirty', { owner: 'fixture-owner' });
    writeFileSync(path.join(task.directory, 'unfinished.txt'), 'draft');
    writeFileSync(path.join(task.directory, '.env'), 'private fixture');
    const options = { owner: task.owner };
    assert.throws(() => completeSourceWorkspace(task.name, options), /Dirty or unpushed/);
    const kept = completeSourceWorkspace(task.name, { ...options, preserve: true, reason: 'Interrupted fixture' });
    assert.equal(kept.outcome, 'unfinished-preserved');
    assert.equal(kept.ignored, true);
    f.run(task.directory, 'add', 'unfinished.txt');
    f.run(task.directory, 'commit', '-m', 'Unique commit');
    assert.throws(() => completeSourceWorkspace(task.name, options), /Dirty or unpushed/);
    f.run(task.directory, 'push', 'origin', task.branch);
    const completed = completeSourceWorkspace(task.name, options);
    assert.equal(completed.pushed, true);
    assert.equal(completed.retirement, 'retained');
    assert.equal(readFileSync(path.join(task.directory, '.env'), 'utf8'), 'private fixture');
    assert.equal(f.git('rev-parse', task.branch), completed.finalSha);
  }); } finally { f.dispose(); }
});

test('integration holds on wrong repository, changed PR, failed CI and stale main', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('source-integrate', { owner: 'fixture-owner' });
    writeFileSync(path.join(task.directory, 'change.txt'), 'feature');
    f.run(task.directory, 'add', '.');
    f.run(task.directory, 'commit', '-m', 'Independent change');
    const head = f.run(task.directory, 'rev-parse', 'HEAD');
    const repo = { full_name: 'derekfika/fika-os' };
    const pr = { state: 'open', head: { sha: head, ref: task.branch, repo }, base: { sha: task.baseline, ref: 'main', repo } };
    let merged = 0;
    const run = overrides => integrateSourceWorkspace(task.name, '1', { readPr: () => pr, validate: () => {}, merge: () => merged++, ...overrides });
    assert.throws(() => run({ readPr: () => ({ ...pr, head: { ...pr.head, repo: { full_name: 'other/fork' } } }) }), /same-repository/);
    assert.throws(() => run({ validate: () => { throw Error('CI required'); } }), /CI required/);
    let checks = 0;
    assert.throws(() => run({ readPr: () => ++checks === 1 ? pr : { ...pr, state: 'closed' } }), /changed during integration/);
    assert.equal(merged, 0);
    assert.equal(run({}).sourceSha, head);
    assert.equal(merged, 1);
    writeFileSync(path.join(f.repo, 'change.txt'), 'main conflict');
    f.git('add', '.'); f.git('commit', '-m', 'Concurrent main change'); f.git('push', 'origin', 'main');
    assert.throws(() => run({}), /Merge current origin\/main/);
    assert.equal(merged, 1);
  }); } finally { f.dispose(); }
});

test('migration freezes legacy writers, preserves history, and keeps release operation evidence', async () => {
  const f = fixture();
  try { await f.within(async () => {
    const legacy = createWorkspace('legacy-active', { owner: 'fixture-owner', scope: 'src' });
    const historical = path.join(stateDir(), 'workspaces', 'legacy-active.json');
    const lockFile = path.join(stateDir(), 'workspaces.lock');
    const original = readFileSync(historical);
    const reason = 'Retain exact source history';
    const execute = hash => migrateSourceHistory({ execute: true, 'approve-hash': hash, reason }, migration);
    assert.throws(() => migrateSourceHistory({}, { ...migration, authorize: () => ({}) }), /administration/);
    const stale = migrateSourceHistory({ reason }, migration);
    f.git('branch', 'preserved-fixture-ref');
    assert.throws(() => execute(stale.planHash), /current migration preview/);
    assert.equal(existsSync(lockFile), false);
    const preview = migrateSourceHistory({ reason }, migration);
    const report = execute(preview.planHash);
    assert.equal(report.historyPreserved, true);
    assert.equal(execute(preview.planHash).alreadyApplied, true);
    assert.deepEqual(readFileSync(historical), original);
    assert.equal(workspaceRecords()[0].state, 'active');
    assert.equal(readFileSync(lockFile, 'utf8'), SOURCE_HISTORY_BARRIER);
    assert.throws(() => lock('workspaces', () => {}), /Another operation holds/);
    assert.equal(existsSync(legacy.directory), true);
    const operations = path.join(stateDir(), 'workspace-operations');
    const releaseLock = path.join(stateDir(), 'release-hospitality-prod.lock');
    writeFileSync(releaseLock, 'fixture release lock');
    await assert.rejects(governedReleaseOperation('deploy', async () => {
      const [marker] = readdirSync(operations);
      assert.equal(JSON.parse(readFileSync(path.join(operations, marker), 'utf8')).kind, 'deploy');
      assert.equal(readFileSync(releaseLock, 'utf8'), 'fixture release lock');
      throw Error('fixture release refused');
    }), /fixture release refused/);
    assert.deepEqual(readdirSync(operations), []);
    unlinkSync(releaseLock);
  }); } finally { f.dispose(); }
});
