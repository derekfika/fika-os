import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixture } from './lifecycle-fixture.mjs';
import { createWorkspace, workspaceRecords } from './workspaces.mjs';
import { integrateSourceWorkspace, createSourceWorkspace, completeSourceWorkspace, recoverSourceReservation, runSourceOperation } from './source-workspaces.mjs';
import { sourceTaskFile, withCapacityLock, workspaceInventory } from './workspace-capacity.mjs';
import { cleanupSourceWorkspaces, integrationEvidence, pruneStaleSourceRegistrations } from './workspace-retirement.mjs';
import { installSourceDependencies, recordGenerated } from './workspace-cache.mjs';
import { sourceWorkspaceHealth } from './workspace-health.mjs';
import { migrateSourceHistory } from './source-migration.mjs';
import { governedReleaseOperation } from './workspace-state.mjs';
import { command, lock, save, SOURCE_HISTORY_BARRIER, stateDir } from './runtime.mjs';

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

test('simultaneous independent processes reserve at most five slots and queue the sixth', async () => {
  const f = fixture();
  try {
    const run = async name => JSON.parse((await runAsync(process.execPath, [cli, 'workspace', 'create', name, '--owner', name], { cwd: f.repo })).stdout);
    const claims = await Promise.all(Array.from({ length: 6 }, (_, index) => run(`slot-${index}`)));
    const queued = claims.find(claim => claim.state === 'queued');
    assert.equal(claims.filter(claim => claim.state === 'active').length, 5);
    assert.equal(queued.available, 0);
    assert.equal(f.within(workspaceInventory).occupied, 5);
    assert.equal(f.within(() => withCapacityLock(() => sourceWorkspaceHealth({ 'inventory-only': true }))).occupied, 5);
    const released = claims.find(claim => claim.state === 'active');
    assert.equal(f.within(() => completeSourceWorkspace(released.name, { owner: released.owner })).retirement, 'retired');
    assert.equal(f.within(workspaceInventory).available, 1);
    assert.equal((await run('slot-new')).state, 'queued');
    assert.equal((await run(queued.name)).state, 'active');
    assert.equal(f.within(workspaceInventory).queue[0].name, 'slot-new');
    const unmanaged = path.join(f.base, 'unmanaged outside managed root');
    f.git('worktree', 'add', '--detach', unmanaged);
    const over = f.within(workspaceInventory);
    assert.equal(over.occupied, 6);
    assert.equal(over.available, 0);
    const detached = over.entries.filter(entry => entry.branch === null);
    assert.equal(detached.length, 1, JSON.stringify(over.entries));
    assert.equal(detached[0].state, 'unmanaged');
    assert.equal((await run('slot-new')).state, 'queued');
    assert.equal(existsSync(unmanaged), true);
  } finally { f.dispose(); }
});

test('known generated outputs are retired only while their full content matches', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('source-generated', { owner: 'agent-a' });
    const folder = path.join(task.directory, 'node_modules');
    mkdirSync(folder);
    const generated = path.join(folder, 'content');
    writeFileSync(generated, 'original');
    runSourceOperation('install', workspace => {
      assert.deepEqual(recordGenerated(workspace, ['node_modules']).paths, ['node_modules']);
    }, task.name);
    writeFileSync(generated, 'modified');
    const options = { owner: task.owner };
    assert.match(completeSourceWorkspace(task.name, options).cleanup.protected[0].reason, /ignored/);
    assert.equal(readFileSync(generated, 'utf8'), 'modified');
    writeFileSync(generated, 'original');
    assert.equal(completeSourceWorkspace(task.name, options).retirement, 'retired');
  }); } finally { f.dispose(); }
});

test('the same npm download cache keeps locked versions and installed files isolated between task branches', () => {
  const f = fixture();
  const previousCache = process.env.NPM_CONFIG_CACHE;
  const isolatedCache = path.join(f.base, 'shared download cache');
  mkdirSync(isolatedCache);
  process.env.NPM_CONFIG_CACHE = isolatedCache;
  try { f.within(() => {
    const install = (name, version) => {
      const task = createSourceWorkspace(name, { owner: name });
      const dependency = path.join(task.directory, 'vendor', 'isolated');
      mkdirSync(dependency, { recursive: true });
      writeFileSync(path.join(dependency, 'package.json'), JSON.stringify({ name: 'isolated', version }));
      writeFileSync(path.join(task.directory, 'package.json'), JSON.stringify({ name: 'test-app', version: '1.0.0',
        dependencies: { isolated: 'file:vendor/isolated' } }));
      command('npm', ['install', '--package-lock-only', '--offline', '--ignore-scripts', '--no-audit'], { cwd: task.directory });
      f.run(task.directory, 'add', '.');
      f.run(task.directory, 'commit', '-m', `Fixture lockfile ${version}`);
      return { ...task, installed: runSourceOperation('install', installSourceDependencies, name) };
    };
    const one = install('source-version-one', '1.0.0');
    const two = install('source-version-two', '2.0.0');
    const resolve = task => path.join(task.directory, 'node_modules', 'isolated', 'package.json');
    assert.equal(one.installed.cache, isolatedCache);
    assert.equal(two.installed.cache, isolatedCache);
    assert.equal(JSON.parse(readFileSync(resolve(one), 'utf8')).version, '1.0.0');
    assert.equal(JSON.parse(readFileSync(resolve(two), 'utf8')).version, '2.0.0');
    writeFileSync(resolve(one), '{}');
    assert.equal(JSON.parse(readFileSync(resolve(two), 'utf8')).version, '2.0.0');
  }); } finally {
    if (previousCache === undefined) delete process.env.NPM_CONFIG_CACHE;
    else process.env.NPM_CONFIG_CACHE = previousCache;
    f.dispose();
  }
});

test('NTFS usage counts hardlinked allocation once and skips external junctions', { skip: process.platform !== 'win32' }, () => {
  const f = fixture();
  try {
    const scan = path.join(f.base, 'NTFS scan with spaces');
    const external = path.join(f.base, 'external bytes');
    mkdirSync(scan);
    mkdirSync(external);
    writeFileSync(path.join(scan, 'payload'), Buffer.alloc(8192, 1));
    linkSync(path.join(scan, 'payload'), path.join(scan, 'alias'));
    writeFileSync(path.join(external, 'should not be counted'), Buffer.alloc(32768, 2));
    symlinkSync(external, path.join(scan, 'junction'), 'junction');
    const script = fileURLToPath(new URL('./workspace-disk.ps1', import.meta.url));
    const candidates = path.join(f.base, 'candidate paths.json');
    writeFileSync(candidates, JSON.stringify([scan.replaceAll('\\', '/')]));
    const report = JSON.parse(command('pwsh', ['-NoProfile', '-File', script, '-ScanRoot', scan, '-CandidatesFile', candidates]));
    assert.equal(report.files, 2);
    assert.ok(report.fileAllocationBytes >= 8192);
    assert.equal(report.hardlinkAliasesDeduplicated, 1);
    assert.equal(report.reclaimableAllocationUpperBoundBytes, report.fileAllocationBytes);
    assert.equal(report.reparsePointsSkipped, 1);
    assert.equal(report.unreadableDirectories, 0);
  } finally { f.dispose(); }
});

test('exact same-repo squash merge retires checkout and branch while retaining the original tip', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('source-squash', { owner: 'fixture-owner' });
    writeFileSync(path.join(task.directory, 'change.txt'), 'feature');
    f.run(task.directory, 'add', '.');
    f.run(task.directory, 'commit', '-m', 'Independent change');
    f.run(task.directory, 'push', 'origin', task.branch);
    const head = f.run(task.directory, 'rev-parse', 'HEAD');
    assert.equal(completeSourceWorkspace(task.name, { owner: task.owner }).retirement, 'retained');
    f.git('merge', '--squash', head);
    f.git('commit', '-m', 'Different squash commit');
    f.git('push', 'origin', 'main');
    const merge = f.git('rev-parse', 'HEAD');
    assert.notEqual(head, merge);
    const repo = { full_name: 'derekfika/fika-os' };
    const pr = { number: 7, state: 'closed', merged_at: 'observed', merge_commit_sha: merge,
      head: { sha: head, ref: task.branch, repo }, base: { ref: 'main', repo } };
    const proof = { github: true, contains: sha => sha === merge };
    assert.equal(integrationEvidence([pr], task.branch, head, proof).number, 7);
    assert.equal(integrationEvidence([pr], task.branch, merge, proof), null);
    assert.equal(integrationEvidence([pr, { ...pr, state: 'open' }], task.branch, head, proof), null);
    assert.equal(integrationEvidence([{ ...pr, base: { ...pr.base, ref: 'release' } }], task.branch, head, proof), null);
    const cleanup = () => cleanupSourceWorkspaces({ execute: true, readPulls: () => [pr] });
    assert.equal(cleanup().retired[0].head, head);
    assert.equal(existsSync(task.directory), false);
    assert.equal(f.git('branch', '--list', task.branch), '');
    assert.equal(f.git('rev-parse', `refs/preserve/source-recovery/retirements/${task.name}/${head}`), head);
    assert.equal(cleanup().retired.length, 0);
    assert.equal(completeSourceWorkspace(task.name, { owner: task.owner }).retirement, 'retired');
  }); } finally { f.dispose(); }
});

test('cleanup protects active tasks, operations, newly dirty files and ignored junctions', () => {
  const f = fixture();
  try { f.within(() => {
    const active = createSourceWorkspace('source-active', { owner: 'agent-a' });
    const finishing = createSourceWorkspace('source-finishing', { owner: 'agent-b' });
    const cleanup = () => cleanupSourceWorkspaces({ execute: true });
    assert.equal(cleanup().retired.length, 0);
    assert.equal(existsSync(active.directory), true);
    const options = { owner: finishing.owner };
    runSourceOperation('dev', () => {
      const result = completeSourceWorkspace(finishing.name, options);
      assert.match(result.cleanup.protected[0].reason, /operation/);
    }, finishing.name);
    writeFileSync(path.join(finishing.directory, 'untracked.txt'), 'keep');
    assert.match(cleanup().protected[0].reason, /untracked/);
    unlinkSync(path.join(finishing.directory, 'untracked.txt'));
    const external = path.join(f.base, 'files to keep');
    mkdirSync(external);
    writeFileSync(path.join(external, 'contents'), 'evidence');
    symlinkSync(external, path.join(finishing.directory, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    assert.match(cleanup().protected[0].reason, /tracked|ignored/);
    assert.equal(readFileSync(path.join(external, 'contents'), 'utf8'), 'evidence');
    unlinkSync(path.join(finishing.directory, 'node_modules'));
    assert.equal(cleanup().retired.length, 1);
  }); } finally { f.dispose(); }
});

test('interrupted reservations retain capacity and require confirmed process exit before recovery', async () => {
  const f = fixture();
  try {
    const exitedProcess = execFile(process.execPath, ['-e', '']);
    await new Promise((resolve, reject) => exitedProcess.once('exit', resolve).once('error', reject));
    f.within(() => {
      const task = createSourceWorkspace('source-interrupted', { owner: 'agent-a' });
      save(sourceTaskFile(task.name), { ...task, state: 'creating', pid: process.pid });
      const options = { owner: task.owner, reason: 'Confirmed child processes stopped' };
      assert.throws(() => recoverSourceReservation(task.name, options), /still be running/);
      save(sourceTaskFile(task.name), { ...task, state: 'creating', pid: exitedProcess.pid });
      assert.equal(workspaceInventory().occupied, 1);
      assert.equal(recoverSourceReservation(task.name, options).state, 'active');
      const failed = { ...task, name: 'source-failed', directory: path.join(path.dirname(task.directory), 'source-failed'),
        branch: 'codex/source-failed', state: 'creating', pid: exitedProcess.pid };
      save(sourceTaskFile(failed.name), failed);
      assert.equal(workspaceInventory().occupied, 2);
      assert.equal(recoverSourceReservation(failed.name, options).state, 'cancelled');
      assert.equal(workspaceInventory().occupied, 1);
    });
  } finally { f.dispose(); }
});

test('pruning a stale registration keeps the staged index and is idempotent in paths with spaces', () => {
  const f = fixture();
  try { f.within(() => {
    const directory = path.join(f.base, 'legacy worktree');
    f.git('worktree', 'add', '--detach', directory);
    writeFileSync(path.join(directory, 'staged'), 'unique orphaned index content');
    f.run(directory, 'add', 'staged');
    const admin = f.run(directory, 'rev-parse', '--absolute-git-dir');
    const name = path.basename(admin);
    renameSync(directory, path.join(f.base, 'moved checkout evidence'));
    assert.equal(pruneStaleSourceRegistrations().eligible.length, 1);
    assert.equal(pruneStaleSourceRegistrations({ execute: true }).pruned.length, 1);
    assert.equal(existsSync(admin), false);
    assert.match(f.git('ls-tree', `refs/preserve/source-recovery/stale/${name}/index`), /blob/);
    assert.equal(pruneStaleSourceRegistrations({ execute: true }).pruned.length, 0);
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
