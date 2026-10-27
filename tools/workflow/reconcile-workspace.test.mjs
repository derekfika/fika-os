import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createHash as cryptoCreateHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyRecoveryArtifact } from './workspaces.mjs';

const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
function fixture(scope = 'apps/cpu-production') {
  const base = mktemp(); const remote = path.join(base, 'remote.git'); const repo = path.join(base, 'repo'); mkdirSync(repo);
  const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' }); git(repo, 'init', '-b', 'main'); git(repo, 'config', 'user.email', 'fixture@example.invalid'); git(repo, 'config', 'user.name', 'Reconcile fixture');
  mkdirSync(path.join(repo, 'apps/cpu-production'), { recursive: true }); mkdirSync(path.join(repo, 'apps/logistics'), { recursive: true });
  writeFileSync(path.join(repo, 'apps/cpu-production/task.txt'), 'alpha\nbeta\ngamma\n'); writeFileSync(path.join(repo, 'apps/logistics/base.txt'), 'baseline\n');
  git(repo, 'add', '.'); git(repo, 'commit', '-m', 'fixture baseline'); git(repo, 'remote', 'add', 'origin', remote); git(repo, 'push', '-u', 'origin', 'main');
  const run = (args, success = true) => {
    const result = spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status === 0, success, result.stderr || result.stdout);
    return success ? JSON.parse(result.stdout) : result.stderr;
  };
  const workspace = run(['workspace', 'create', 'cpu-source', '--owner', 'fixture-owner', '--scope', scope]);
  return { base, repo, remote, source: workspace.directory, run, git: (...args) => git(repo, ...args), gitAt: (cwd, ...args) => git(cwd, ...args), cleanup() { const target = path.resolve(base); assert.ok(target.startsWith(path.resolve(os.tmpdir()) + path.sep)); assert.ok(path.basename(target).startsWith('fika-reconcile-test-')); rmSync(target, { recursive: true, force: true }); } };
}
function mktemp() { return mkdtempSync(path.join(os.tmpdir(), 'fika-reconcile-test-')); }
function commitMainChange(f, file, contents) {
  writeFileSync(path.join(f.repo, file), contents); f.git('add', file); f.git('commit', '-m', `main change ${path.basename(file)}`); f.git('push', 'origin', 'main');
}

test('dry-run reports exact preservation, merged out-of-scope ancestry and makes no replacement', () => {
  const f = fixture(); try {
    writeFileSync(path.join(f.source, 'apps/logistics/already-merged.txt'), 'merged\n'); f.gitAt(f.source, 'add', '.'); f.gitAt(f.source, 'commit', '-m', 'merged unrelated logistics'); f.gitAt(f.source, 'push', 'origin', 'HEAD:main');
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'ALPHA\nbeta\ngamma\n'); f.gitAt(f.source, 'add', 'apps/cpu-production/task.txt');
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'ALPHA\nBETA\ngamma\n');
    writeFileSync(path.join(f.source, 'apps/cpu-production/new.bin'), Buffer.from([0, 1, 255]));
    const result = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-rebased']);
    assert.equal(result.dryRun, true); assert.deepEqual(result.wouldChange.outOfScopeCommitsProvenInTarget, ['apps/logistics/already-merged.txt']);
    assert.deepEqual(result.wouldChange.staged, ['apps/cpu-production/task.txt']); assert.deepEqual(result.wouldChange.unstaged, ['apps/cpu-production/task.txt']);
    assert.equal(result.wouldChange.untracked[0].sha256.length, 64); assert.equal(existsSync(path.join(f.base, 'agent-workspaces/fika-os/cpu-rebased')), false);
  } finally { f.cleanup(); }
});

test('unmerged source feature commits are rejected by the initial ancestor-only recovery mode', () => {
  const f = fixture(); try {
    writeFileSync(path.join(f.source, 'apps/cpu-production/unmerged-feature.txt'), 'not present in origin main\n');
    f.gitAt(f.source, 'add', 'apps/cpu-production/unmerged-feature.txt'); f.gitAt(f.source, 'commit', '-m', 'unmerged feature commit');
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-unmerged'], false), /Ancestor-only reconciliation requires/);
    assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active');
    assert.equal(existsSync(path.join(f.base, 'agent-workspaces/fika-os/cpu-unmerged')), false);
  } finally { f.cleanup(); }
});

test('successful reconciliation preserves staged, unstaged, untracked and mixed edits; old checkout remains recoverable', () => {
  const f = fixture(); try {
    writeFileSync(path.join(f.source, 'apps/logistics/already-merged.txt'), 'merged\n'); f.gitAt(f.source, 'add', '.'); f.gitAt(f.source, 'commit', '-m', 'merged unrelated logistics'); f.gitAt(f.source, 'push', 'origin', 'HEAD:main');
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'ALPHA\nbeta\ngamma\n'); f.gitAt(f.source, 'add', 'apps/cpu-production/task.txt');
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'ALPHA\nBETA\ngamma\n');
    writeFileSync(path.join(f.source, 'apps/cpu-production/new.bin'), Buffer.from([0, 1, 255]));
    const result = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-rebased', '--execute']);
    const rows = f.run(['workspace', 'list']); assert.equal(rows.find(x => x.name === 'cpu-source').state, 'superseded'); assert.equal(rows.find(x => x.name === 'cpu-rebased').state, 'active');
    assert.equal(readFileSync(path.join(result.replacement.directory, 'apps/cpu-production/task.txt'), 'utf8').replace(/\r\n/g, '\n'), 'ALPHA\nBETA\ngamma\n');
    assert.deepEqual([...readFileSync(path.join(result.replacement.directory, 'apps/cpu-production/new.bin'))], [0, 1, 255]);
    assert.deepEqual(f.gitAt(result.replacement.directory, 'diff', '--cached', '--name-only').split(/\r?\n/), ['apps/cpu-production/task.txt']);
    assert.equal(f.run(['workspace', 'check', 'cpu-rebased', '--owner', 'fixture-owner']).withinScope, true);
    assert.equal(readFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'utf8').replace(/\r\n/g, '\n'), 'ALPHA\nBETA\ngamma\n');
  } finally { f.cleanup(); }
});

test('committed reconciliation overlays materialize safely for a later replacement in the chain', () => {
  const f = fixture(); try {
    const first = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-rebased', '--execute']);
    writeFileSync(path.join(first.replacement.directory, 'apps/cpu-production/later.txt'), 'second generation\n');
    const second = f.run(['workspace', 'reconcile', 'cpu-rebased', '--owner', 'fixture-owner', '--replacement', 'cpu-rebased-again', '--execute']);
    const rows = f.run(['workspace', 'list']); assert.equal(rows.find(x => x.name === 'cpu-source').state, 'superseded');
    assert.equal(rows.find(x => x.name === 'cpu-rebased').state, 'superseded'); assert.equal(rows.find(x => x.name === 'cpu-rebased-again').state, 'active');
    assert.equal(readFileSync(path.join(second.replacement.directory, 'apps/cpu-production/later.txt'), 'utf8').replace(/\r\n/g, '\n'), 'second generation\n');
  } finally { f.cleanup(); }
});

test('conflicting target edit fails closed, retains original and leaves a checksummed recovery journal for retry', () => {
  const f = fixture(); try {
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'alpha\nLOCAL\ngamma\n');
    commitMainChange(f, 'apps/cpu-production/task.txt', 'alpha\nREMOTE\ngamma\n');
    const error = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-conflict', '--execute'], false);
    assert.match(error, /recovery artifacts/); assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active');
    assert.equal(readFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'utf8'), 'alpha\nLOCAL\ngamma\n');
    const attention = f.run(['workspace', 'list']).find(x => x.name === 'cpu-conflict'); assert.equal(attention.state, 'attention');
    const journal = JSON.parse(readFileSync(attention.reconciles.journal, 'utf8')); assert.equal(journal.phase, 'attention'); assert.ok(existsSync(journal.recoveryFile));
    // A fresh named attempt can safely retry after resolving the conflict in the original checkout.
    writeFileSync(path.join(f.source, 'apps/cpu-production/task.txt'), 'alpha\nREMOTE\ngamma\n');
    writeFileSync(path.join(f.source, 'apps/cpu-production/retry.txt'), 'recovered local work\n');
    const recovered = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-retry', '--execute']); assert.equal(recovered.replacement.state, 'active');
  } finally { f.cleanup(); }
});

test('untracked out-of-scope work is rejected without changing source', () => {
  const f = fixture(); try {
    mkdirSync(path.join(f.source, 'apps/hospitality-booking'), { recursive: true }); writeFileSync(path.join(f.source, 'apps/hospitality-booking/unsafe.txt'), 'do not transfer');
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-outside'], false), /outside leased scopes/);
    assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active'); assert.equal(existsSync(path.join(f.base, 'agent-workspaces/fika-os/cpu-outside')), false);
  } finally { f.cleanup(); }
});

test('untracked root-level scoped files retain bytes and mode', () => {
  const f = fixture('notes.txt'); try {
    writeFileSync(path.join(f.source, 'notes.txt'), 'root-level recovery\n', { mode: 0o744 });
    const result = f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-root-file', '--execute']);
    assert.equal(readFileSync(path.join(result.replacement.directory, 'notes.txt'), 'utf8').replace(/\r\n/g, '\n'), 'root-level recovery\n');
    assert.equal(result.paths.includes('notes.txt'), true);
  } finally { f.cleanup(); }
});

test('stale lease ownership is rejected before preserving or replacing work', () => {
  const f = fixture(); try {
    const lease = path.join(f.repo, '.git/fika-workflow/workspaces/cpu-source.json'); const value = JSON.parse(readFileSync(lease, 'utf8')); value.owner = 'changed-owner'; writeFileSync(lease, JSON.stringify(value));
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-stale'], false), /current owner/);
    assert.equal(existsSync(path.join(f.base, 'agent-workspaces/fika-os/cpu-stale')), false);
  } finally { f.cleanup(); }
});

test('lease compare-and-swap rejects ownership changing during replacement creation', () => {
  const f = fixture(); const lease = path.join(f.repo, '.git/fika-workflow/workspaces/cpu-source.json');
  const hook = path.join(f.repo, '.git/hooks/post-checkout'); const prior = process.env.FIKA_RECONCILE_TEST_LEASE;
  try {
    writeFileSync(hook, '#!/bin/sh\nnode -e "const f=require(\'fs\'),p=process.env.FIKA_RECONCILE_TEST_LEASE,j=JSON.parse(f.readFileSync(p));j.owner=\'racing-owner\';f.writeFileSync(p,JSON.stringify(j))"\n');
    chmodSync(hook, 0o755);
    process.env.FIKA_RECONCILE_TEST_LEASE = lease;
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-owner-race', '--execute'], false), /lease changed during reconciliation/);
    const rows = f.run(['workspace', 'list']); assert.equal(rows.find(x => x.name === 'cpu-source').owner, 'racing-owner'); assert.equal(rows.find(x => x.name === 'cpu-source').state, 'active');
    assert.equal(rows.find(x => x.name === 'cpu-owner-race').state, 'attention');
  } finally {
    if (prior === undefined) delete process.env.FIKA_RECONCILE_TEST_LEASE; else process.env.FIKA_RECONCILE_TEST_LEASE = prior;
    f.cleanup();
  }
});

test('a concurrent workspace operation lock prevents reconciliation without mutation', () => {
  const f = fixture(); try {
    const lock = path.join(f.repo, '.git/fika-workflow/workspaces.lock'); writeFileSync(lock, 'held by test');
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-locked'], false), /Another operation holds/);
    assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active');
  } finally { f.cleanup(); }
});

test('two concurrent reconciliation attempts have a single lease transition winner', async () => {
  const f = fixture(); try {
    const launch = replacement => new Promise(resolve => {
      const child = spawn(process.execPath, [cli, 'workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', replacement, '--execute'], { cwd: f.repo, windowsHide: true });
      let stdout = ''; let stderr = ''; child.stdout.setEncoding('utf8').on('data', chunk => stdout += chunk); child.stderr.setEncoding('utf8').on('data', chunk => stderr += chunk);
      child.on('close', code => resolve({ code, stdout, stderr }));
    });
    const results = await Promise.all([launch('cpu-race-a'), launch('cpu-race-b')]);
    assert.equal(results.filter(x => x.code === 0).length, 1); assert.equal(results.filter(x => x.code !== 0).length, 1);
    const rows = f.run(['workspace', 'list']); assert.equal(rows.filter(x => x.name === 'cpu-source' && x.state === 'superseded').length, 1);
    assert.equal(rows.filter(x => ['cpu-race-a', 'cpu-race-b'].includes(x.name) && x.state === 'active').length, 1);
  } finally { f.cleanup(); }
});

test('failed replacement creation leaves source active and recovery artifact intact', () => {
  const f = fixture(); try {
    const target = path.join(f.base, 'agent-workspaces/fika-os/cpu-collision'); mkdirSync(target, { recursive: true });
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-collision', '--execute'], false), /path\/branch exists/);
    assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active');
    const journals = path.join(f.repo, '.git/fika-workflow/reconciliations'); const dirs = readdirSync(journals); assert.equal(dirs.length, 1);
    assert.ok(existsSync(path.join(journals, dirs[0], 'recovery.json')));
  } finally { f.cleanup(); }
});

test('recovery checksum verification rejects tampering', () => {
  const f = fixture(); try {
    const file = path.join(f.base, 'recovery.json'); writeFileSync(file, '{"safe":true}'); const hash = verifyRecoveryArtifact(file, requireHash(file));
    assert.equal(hash.length, 64); writeFileSync(file, '{"safe":false}'); assert.throws(() => verifyRecoveryArtifact(file, hash), /checksum mismatch/);
  } finally { f.cleanup(); }
});
function requireHash(file) { return cryptoCreateHash('sha256').update(readFileSync(file)).digest('hex'); }

test('a stale recorded baseline is detected and cannot supersede the source lease', () => {
  const f = fixture(); try {
    const lease = path.join(f.repo, '.git/fika-workflow/workspaces/cpu-source.json'); const value = JSON.parse(readFileSync(lease, 'utf8')); value.baseline = '0'.repeat(40); writeFileSync(lease, JSON.stringify(value));
    assert.match(f.run(['workspace', 'reconcile', 'cpu-source', '--owner', 'fixture-owner', '--replacement', 'cpu-target', '--execute'], false), /recorded baseline/);
    assert.equal(f.run(['workspace', 'list']).find(x => x.name === 'cpu-source').state, 'active');
  } finally { f.cleanup(); }
});
