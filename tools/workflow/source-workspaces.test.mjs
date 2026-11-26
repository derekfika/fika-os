import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fixture } from './lifecycle-fixture.mjs';
import { createWorkspace, workspaceRecords } from './workspaces.mjs';
import { integrateSourceWorkspace, assignSourceWriter, createInfrastructureRecoveryWorkspace, createSourceWorkspace, completeSourceWorkspace, recoverSourceReservation, runSourceOperation } from './source-workspaces.mjs';
import { completionFile, managedRoot, sourceTaskFile, workspaceInventory } from './workspace-capacity.mjs';
import { cleanupSourceWorkspaces, integrationEvidence, pruneStaleSourceRegistrations, reconcileOrphanedBootstrapRecords } from './workspace-retirement.mjs';
import { installSourceDependencies, recordGenerated, validationOutputCandidates, verifiedPythonCache, verifiedTypeScriptBuildInfo } from './workspace-cache.mjs';
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

test('ten concurrent claims fill the slots and startup retirement promotes the queue in order', async () => {
  const f = fixture();
  try {
    const runCli = async (...args) => JSON.parse((await runAsync(process.execPath, [cli, 'workspace', ...args], { cwd: f.repo })).stdout);
    const run = name => runCli('create', name, '--owner', name);
    async function finishAll(processes) {
      // Let every child release its Git and SQLite handles before the fixture is removed.
      const results = await Promise.allSettled(processes);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Workspace CLI processes failed');
      return results.map(result => result.value);
    }
    const claims = await finishAll(Array.from({ length: 11 }, (_, index) => run(`slot-${index}`)));
    const active = claims.filter(claim => claim.state === 'active');
    const waiting = claims.filter(claim => claim.state === 'queued');
    assert.equal(active.length, 10);
    assert.equal(waiting.length, 1);
    const [queued] = waiting;
    assert.equal(queued.limit, 10);
    assert.equal(queued.available, 0);
    const deferredPath = path.join(path.dirname(active[0].directory), queued.name);
    assert.equal(existsSync(deferredPath), false);
    assert.equal(f.git('branch', '--list', `codex/${queued.name}`), '');
    const health = f.within(() => sourceWorkspaceHealth({ 'inventory-only': true }));
    assert.equal(health.limit, 10);
    const lightweightHealth = f.within(() => sourceWorkspaceHealth());
    assert.equal(lightweightHealth.disk.physicalScan, 'not requested');
    assert.equal(Object.hasOwn(lightweightHealth, 'readyForCleanup'), false);
    assert.equal(health.occupied, 10);
    assert.equal(health.entries.some(entry => entry.branch === 'main'), false);
    assert.deepEqual(health.queue.map(entry => entry.name), [queued.name]);

    const [released] = active;
    f.within(() => runSourceOperation('dev', () => {
      const completion = completeSourceWorkspace(released.name, { owner: released.owner });
      assert.match(completion.cleanup.protected[0].reason, /operation/);
    }, released.name));
    // Whether the new claim runs before or after startup frees a slot, it waits for the older claim.
    const [startup, newer] = await finishAll([runCli('startup'), run('slot-new')]);
    assert.equal(startup.cleanup.retired[0].name, released.name);
    assert.equal(startup.health.limit, 10);
    assert.equal(startup.health.available, 0);
    assert.deepEqual(startup.promotion.admitted.map(entry => entry.name), [queued.name]);
    assert.equal(newer.state, 'queued');
    const promoted = await run(queued.name);
    assert.equal(promoted.state, 'active');
    assert.equal(promoted.queuedAt, queued.queuedAt);
    assert.equal(existsSync(deferredPath), true);
    await assert.rejects(runCli('create', queued.name, '--owner', 'different-owner'), /already exists/);
    assert.equal(f.within(workspaceInventory).queue[0].name, 'slot-new');
    assert.equal(f.within(workspaceInventory).occupied, 10);
    const bootstrap = 'workspace-build-artifact-retirement';
    const bootstrapPath = f.within(() => path.join(managedRoot(), bootstrap));
    f.git('worktree', 'add', '--quiet', '-b', `codex/${bootstrap}`, bootstrapPath, 'origin/main');
    const bootstrapRecord = { name: bootstrap, owner: `codex-${bootstrap}`, branch: `codex/${bootstrap}`, directory: bootstrapPath,
      baseline: f.git('rev-parse', 'origin/main'), state: 'active', bootstrapException: {
        authorization: 'explicit-owner-directive', issue: 687, scope: 'workspace-retirement-repair',
        capacityExempt: true, authorizedAt: '2026-11-25',
      } };
    f.within(() => save(sourceTaskFile(bootstrap), bootstrapRecord));
    const exceptionInventory = f.within(workspaceInventory);
    assert.equal(exceptionInventory.physicalOccupied, 11);
    assert.equal(exceptionInventory.governedOccupied, 10, JSON.stringify(exceptionInventory.entries));
    assert.equal(exceptionInventory.bootstrapExceptions, 1);
    assert.equal(exceptionInventory.available, 0);
    assert.deepEqual(exceptionInventory.violations, []);
    const badException = { ...bootstrapRecord, bootstrapException: { ...bootstrapRecord.bootstrapException, capacityExempt: false } };
    f.within(() => save(sourceTaskFile(bootstrap), badException));
    const denied = f.within(workspaceInventory);
    assert.equal(denied.governedOccupied, 11);
    assert.ok(denied.violations.some(reason => reason.includes('unauthorized bootstrap exception')));
    f.within(() => save(sourceTaskFile(bootstrap), bootstrapRecord));
    f.git('worktree', 'remove', bootstrapPath);
    f.within(() => unlinkSync(sourceTaskFile(bootstrap)));
    const unmanaged = path.join(f.base, 'unmanaged outside managed root');
    f.git('worktree', 'add', '--detach', unmanaged);
    const over = f.within(workspaceInventory);
    assert.equal(over.occupied, 11);
    assert.equal(over.available, 0);
    assert.ok(over.violations.includes('11 governed task workspaces exceed the limit of 10'));
    const detached = over.entries.filter(entry => entry.branch === null);
    assert.equal(detached.length, 1, JSON.stringify(over.entries));
    assert.equal(detached[0].state, 'unmanaged');
    assert.equal((await run('slot-new')).state, 'queued');
    assert.equal(existsSync(unmanaged), true);
  } finally { f.dispose(); }
});

test('infrastructure recovery has one owner-recorded exception slot and rejects app scope', () => {
  const f = fixture();
  try { f.within(() => {
    const recovery = createInfrastructureRecoveryWorkspace('infra-recovery-capacity-repair', {
      owner: 'recovery-owner', reason: 'Reproduce and repair the SQLite admission lock timeout.', scope: 'tools/workflow,AGENTS.md',
    });
    assert.equal(recovery.state, 'active');
    assert.equal(workspaceInventory().bootstrapExceptions, 1);
    assert.throws(() => createInfrastructureRecoveryWorkspace('infra-recovery-second-repair', {
      owner: 'recovery-owner', reason: 'A second repair must not acquire another exception slot.', scope: 'tools/workflow',
    }), /single infrastructure-recovery slot/);
    assert.throws(() => createInfrastructureRecoveryWorkspace('infra-recovery-app-change', {
      owner: 'recovery-owner', reason: 'This scope attempts to alter an application feature.', scope: 'apps/hospitality-menu-studio',
    }), /limited to tools\/workflow/);
  }); } finally { f.dispose(); }
});

test('recovery admission ignores physically absent stale exceptions but protects nonallowlisted metadata', () => {
  const f = fixture();
  try { f.within(() => {
    const name = 'workspace-build-artifact-retirement', owner = `codex-${name}`;
    const directory = path.join(managedRoot(), name), branch = `codex/${name}`;
    const finalSha = f.git('rev-parse', 'origin/main');
    save(sourceTaskFile(name), { name, owner, branch, directory, baseline: finalSha, state: 'active',
      bootstrapException: { authorization: 'old-owner-directive', capacityExempt: true } });
    save(completionFile(name), { name, owner, branch, directory, finalSha, outcome: 'completed', retirement: 'retired' });
    const recovery = createInfrastructureRecoveryWorkspace('infra-recovery-next-fix', {
      owner: 'recovery-owner', reason: 'Repair a confirmed defect in workspace retirement admission.', scope: 'tools/workflow',
    });
    assert.equal(recovery.state, 'active');
    assert.equal(workspaceInventory().bootstrapExceptions, 1);
    const result = reconcileOrphanedBootstrapRecords({ execute: true, readPulls: () => [], containsMain: () => true });
    assert.deepEqual(result.archived, []);
    assert.ok(result.protected.some(record => record.name === name));
    assert.equal(existsSync(sourceTaskFile(name)), true);
    assert.equal(existsSync(completionFile(name)), true);
    assert.equal(existsSync(path.join(stateDir(), 'source-archive', `${name}.json`)), false);
    const held = reconcileOrphanedBootstrapRecords({ execute: true, readPulls: () => [], containsMain: () => true });
    assert.ok(held.protected.some(record => record.name === recovery.name));
  }); } finally { f.dispose(); }
});

test('orphan bootstrap preview recognizes only the three exact merged legacy task heads', () => {
  const f = fixture();
  try { f.within(() => {
    const names = [
      'workspace-build-artifact-retirement',
      'workspace-capacity-10',
      'workspace-retirement-repair-bootstrap',
    ];
    const head = f.git('rev-parse', 'origin/main');
    const merge = head;
    const heads = {
      'workspace-build-artifact-retirement': 'bdc955f624109faaea9cca8749aeec81bec2aca1',
      'workspace-capacity-10': '5250e37a081bacc1910810092dd79f6641f97178',
      'workspace-retirement-repair-bootstrap': 'c8f1de7246eff0f6bfed514a8f9320c1349cb57b',
    };
    const baselines = {
      'workspace-build-artifact-retirement': 'e349482b12ea68445665b84f47fa43f9380a1590',
      'workspace-capacity-10': 'a54308b9bda948a23efbe61d3abbc3055f10975e',
      'workspace-retirement-repair-bootstrap': 'a3d7173674a818c90a36807ef7344f73999bc673',
    };
    const containsMain = sha => sha === merge || Object.values(baselines).includes(sha);
    const legacy = [
      { name: names[0], owner: 'codex-workspace-build-artifact-retirement',
        bootstrapException: { authorization: 'explicit-owner-directive', issue: 687,
          scope: 'workspace-retirement-repair', capacityExempt: true, authorizedAt: '2026-11-25', permanentSlots: 10 } },
      { name: names[1], owner: 'codex-workspace-capacity-sol',
        bootstrapException: { authorization: 'explicit owner directive in current thread', authorizedAt: '2026-11-25',
          purpose: 'Implement #687 capacity expansion only', oldLimit: 5, temporaryAdmission: 6, permanentLimit: 10,
          preserveExisting: true, retireAfter: 'capacity PR merged and local ten-slot enforcement verified' },
        bootstrapVerifiedAt: '2026-11-25T19:23:27.774Z' },
      { name: names[2], owner: 'codex-workspace-retirement-repair-bootstrap',
        bootstrapException: { schema: 'fika.workspace-bootstrap-exception.v1', authorizedBy: 'owner directive',
          authorizedAt: '2026-11-25', issue: 687, oneTime: true, outsideGovernedLimit: 10,
          reason: 'Permanent retirement repair is queued behind verified retirement residue.',
          protections: ['unique source', 'uncommitted changes', 'user attachments', 'active leases', 'unmerged work',
            'protected PR and CI gates'] } },
    ];
    const pulls = legacy.map(({ name }) => ({
      number: ({
        'workspace-build-artifact-retirement': 709,
        'workspace-capacity-10': 700,
        'workspace-retirement-repair-bootstrap': 705,
      })[name],
      state: 'closed', merged_at: '2026-11-25T23:42:57Z', html_url: `https://github.com/derekfika/fika-os/pull/${name}`,
      head: { ref: `codex/${name}`, sha: heads[name], repo: { full_name: 'derekfika/fika-os' } },
      base: { ref: 'main', repo: { full_name: 'derekfika/fika-os' } }, merge_commit_sha: merge,
    }));
    for (const task of legacy) {
      const record = { ...task, branch: `codex/${task.name}`, directory: path.join(managedRoot(), task.name),
        baseline: baselines[task.name], state: 'active' };
      save(sourceTaskFile(task.name), record);
      assert.equal(existsSync(path.join(managedRoot(), task.name)), false);
      assert.equal(existsSync(completionFile(task.name)), false);
    }

    const eligible = reconcileOrphanedBootstrapRecords({ readPulls: () => pulls, readRemoteHead: branch => {
      const task = legacy.find(candidate => branch === `codex/${candidate.name}`);
      assert.ok(task);
      return heads[task.name];
    }, containsMain });
    assert.deepEqual(eligible.eligible.map(record => record.name).sort(), [...names].sort(), JSON.stringify(eligible));
    assert.deepEqual(eligible.protected, []);
    assert.deepEqual(eligible.archived, []);
    for (const { name } of legacy) {
      assert.equal(existsSync(sourceTaskFile(name)), true, `${name} stays registered after preview`);
      assert.equal(existsSync(path.join(stateDir(), 'source-archive', `${name}.json`)), false);
      assert.equal(existsSync(completionFile(name)), false, 'preview must not synthesize a completion');
    }

    const wrongHead = reconcileOrphanedBootstrapRecords({ readPulls: () => pulls, readRemoteHead: branch =>
      branch === `codex/${names[1]}` ? 'f'.repeat(40) : heads[branch.slice('codex/'.length)], containsMain });
    assert.ok(wrongHead.protected.some(record => record.name === names[1]));
    assert.ok(!wrongHead.eligible.some(record => record.name === names[1]));

    const alteredMetadata = { ...legacy[1], bootstrapException: { ...legacy[1].bootstrapException } };
    delete alteredMetadata.bootstrapException.temporaryAdmission;
    save(sourceTaskFile(names[1]), { ...alteredMetadata, branch: `codex/${names[1]}`,
      directory: path.join(managedRoot(), names[1]), baseline: baselines[names[1]], state: 'active' });
    const invalidMetadata = reconcileOrphanedBootstrapRecords({ readPulls: () => pulls,
      readRemoteHead: branch => heads[branch.slice('codex/'.length)], containsMain });
    assert.ok(invalidMetadata.protected.some(record => record.name === names[1]));
    assert.ok(!invalidMetadata.eligible.some(record => record.name === names[1]));
    save(sourceTaskFile(names[1]), { ...legacy[1], branch: `codex/${names[1]}`,
      directory: path.join(managedRoot(), names[1]), baseline: baselines[names[1]], state: 'active' });

    const openPulls = pulls.map(pr => pr.head.ref === `codex/${names[2]}` ? { ...pr, state: 'open', merged_at: null } : pr);
    const open = reconcileOrphanedBootstrapRecords({ readPulls: () => openPulls,
      readRemoteHead: branch => heads[branch.slice('codex/'.length)], containsMain });
    assert.ok(open.protected.some(record => record.name === names[2]));
    assert.ok(!open.eligible.some(record => record.name === names[2]));
    for (const { name } of legacy) assert.equal(existsSync(sourceTaskFile(name)), true, `${name} remains untouched`);

    assert.throws(() => reconcileOrphanedBootstrapRecords({ execute: true, readPulls: () => pulls,
      readRemoteHead: branch => {
        if (branch === `codex/${names[0]}`) {
          const file = sourceTaskFile(names[0]), record = JSON.parse(readFileSync(file, 'utf8'));
          record.bootstrapException.capacityExempt = false;
          save(file, record);
        }
        return heads[branch.slice('codex/'.length)];
      }, containsMain }), /changed after GitHub and physical-state verification/);
    assert.equal(existsSync(sourceTaskFile(names[0])), true, 'changed authorization metadata remains registered');
    assert.equal(existsSync(path.join(stateDir(), 'source-archive', `${names[0]}.json`)), false);
    save(sourceTaskFile(names[0]), { ...legacy[0], branch: `codex/${names[0]}`,
      directory: path.join(managedRoot(), names[0]), baseline: baselines[names[0]], state: 'active' });

    const racingOperation = path.join(stateDir(), 'source-operations', 'orphan-race.json');
    assert.throws(() => reconcileOrphanedBootstrapRecords({ execute: true, readPulls: () => pulls,
      readRemoteHead: branch => {
        if (branch === `codex/${names[0]}`) save(racingOperation, { name: names[0], source: { directory: path.join(managedRoot(), names[0]) } });
        return heads[branch.slice('codex/'.length)];
      }, containsMain }), /changed after GitHub and physical-state verification/);
    assert.equal(existsSync(sourceTaskFile(names[0])), true, 'new operation prevents archival');
    assert.equal(existsSync(path.join(stateDir(), 'source-archive', `${names[0]}.json`)), false);
    unlinkSync(racingOperation);

    const executed = reconcileOrphanedBootstrapRecords({ execute: true, readPulls: () => pulls,
      readRemoteHead: branch => heads[branch.slice('codex/'.length)], containsMain });
    assert.deepEqual(executed.archived.map(record => record.name).sort(), [...names].sort());
    assert.deepEqual(executed.protected, []);
    for (const { name } of legacy) {
      assert.equal(existsSync(sourceTaskFile(name)), false, `${name} is archived`);
      assert.equal(existsSync(completionFile(name)), false, 'reconciliation does not fabricate completion');
      const archived = JSON.parse(readFileSync(path.join(stateDir(), 'source-archive', `${name}.json`), 'utf8'));
      assert.equal(archived.archiveKind, 'verified-orphaned-bootstrap-task');
      assert.equal(archived.orphanVerification.exactRemoteBranchHead, heads[name]);
    }
  }); } finally { f.dispose(); }
});

test('a task owner records disjoint cooperating writer scopes', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('shared-task-writers', { owner: 'task-owner' });
    const first = assignSourceWriter(task.name, { owner: task.owner, writer: 'agent-one', scope: 'apps/menu-planning' });
    assert.deepEqual(first.scope, ['apps/menu-planning']);
    assert.deepEqual(assignSourceWriter(task.name, { owner: task.owner, writer: 'agent-two', scope: 'apps/hospitality-booking' }).scope,
      ['apps/hospitality-booking']);
    assert.throws(() => assignSourceWriter(task.name, { owner: task.owner, writer: 'agent-three', scope: 'apps/menu-planning/app' }), /scopes overlap/);
    assert.throws(() => assignSourceWriter(task.name, { owner: 'other-owner', writer: 'agent-three', scope: 'tools/workflow' }), /accountable task owner/);
  }); } finally { f.dispose(); }
});

test('operation markers do not start from a stale observed checkout head', () => {
  const f = fixture();
  try { f.within(() => {
    const task = createSourceWorkspace('operation-head-race', { owner: 'operation-owner' });
    const capacityLock = action => {
      writeFileSync(path.join(task.directory, 'concurrent-owner-commit.txt'), 'new head');
      f.run(task.directory, 'add', 'concurrent-owner-commit.txt');
      f.run(task.directory, 'commit', '-m', 'Advance task head before operation lock');
      return action();
    };
    assert.throws(() => runSourceOperation('validate', () => assert.fail('stale operation must not start'), task.name,
      { capacityLock }), /Task checkout changed while starting the operation/);
    assert.equal(existsSync(path.join(stateDir(), 'source-operations')), false,
      'stale-head detection happens before operation marker creation');
    assert.equal(runSourceOperation('validate', workspace => workspace.head,
      task.name), f.run(task.directory, 'rev-parse', 'HEAD'));
  }); } finally { f.dispose(); }
});

test('governed validation refreshes verified output and dev preserves nested attachments', () => {
  const f = fixture();
  try { f.within(() => {
    writeFileSync(path.join(f.repo, '.gitignore'), '\n.next/\n*.tsbuildinfo\nattachments/\n', { flag: 'a' });
    const app = { path: 'apps/menu-planning' };
    const appDir = path.join(f.repo, app.path);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(path.join(appDir, 'package.json'), JSON.stringify({ name: 'fixture', scripts: { dev: 'node dev.cjs' } }));
    writeFileSync(path.join(appDir, 'dev.cjs'), "require('node:fs').writeFileSync('.next/interactive-attachment.txt', 'interactive fixture attachment');");
    f.git('add', '.');
    f.git('commit', '-m', 'Add fixture dev script');
    f.git('push', 'origin', 'main');
    const task = createSourceWorkspace('source-rebuild', { owner: 'agent-a' });
    const outputPath = `${app.path}/.next`;
    const infoPath = `${app.path}/tsconfig.tsbuildinfo`;
    const nextPath = `${app.path}/next-env.d.ts`;
    const output = path.join(task.directory, outputPath);
    const contents = path.join(output, 'build');
    const prior = path.join(task.directory, infoPath);

    function build(value, writeExtra = () => {}) {
      return runSourceOperation('validate', workspace => {
        const candidates = validationOutputCandidates(workspace, [app]);
        assert.deepEqual(candidates.map(candidate => candidate.relative ?? candidate), [outputPath, nextPath]);
        mkdirSync(output, { recursive: true });
        writeFileSync(contents, value);
        writeExtra();
        return recordGenerated(workspace, candidates);
      }, task.name);
    }

    // A prior build file with no governed provenance must stay protected through each rebuild.
    writeFileSync(prior, 'prior artifact');
    assert.deepEqual(build('initial output').paths, [outputPath]);
    assert.deepEqual(build('rebuilt output').paths, [outputPath]);

    writeFileSync(contents, 'operator changes');
    runSourceOperation('validate', workspace => {
      assert.deepEqual(validationOutputCandidates(workspace, [app]), [nextPath]);
    }, task.name);
    assert.equal(readFileSync(contents, 'utf8'), 'operator changes');
    writeFileSync(contents, 'rebuilt output');

    const duringBuild = path.join(output, 'unverified-build-attachment.txt');
    const protectedBuild = build('rebuilt output', () => writeFileSync(duringBuild, 'extra fixture attachment'));
    assert.deepEqual(protectedBuild.paths, []);
    assert.match(protectedBuild.protectedPaths[0].reason, /new or changed entry/);
    assert.equal(readFileSync(duringBuild, 'utf8'), 'extra fixture attachment');
    renameSync(duringBuild, path.join(f.base, 'retained-build-attachment'));

    const dev = JSON.parse(command(process.execPath, [cli, 'dev', 'menu', '--workspace', task.name, '--port', '13100'], { cwd: f.repo, env: { ...process.env, NPM_CONFIG_LOGLEVEL: 'silent' } }));
    assert.equal(dev.stopped, true);
    const duringDev = path.join(output, 'interactive-attachment.txt');
    const complete = () => completeSourceWorkspace(task.name, { owner: task.owner });
    renameSync(prior, path.join(f.base, 'retained-prior-artifact'));
    // The nested attachment alone must prevent retirement.
    assert.match(complete().cleanup.protected[0].reason, /ignored/);
    assert.equal(readFileSync(duringDev, 'utf8'), 'interactive fixture attachment');
    renameSync(duringDev, path.join(f.base, 'retained-interactive-attachment'));

    const attachments = path.join(task.directory, 'attachments');
    mkdirSync(attachments);
    const attachment = path.join(attachments, 'reference.txt');
    writeFileSync(attachment, 'owner attachment');
    assert.match(complete().cleanup.protected[0].reason, /ignored/);
    assert.equal(readFileSync(attachment, 'utf8'), 'owner attachment');
    renameSync(attachments, path.join(f.base, 'retained-attachments'));
    assert.equal(complete().retirement, 'retired');
    assert.equal(existsSync(task.directory), false);
  }); } finally { f.dispose(); }
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

function lockedNpmWorktree(f, name = 'retirement-dependency') {
  const app = 'apps/hospitality-menu-studio';
  const appDir = path.join(f.repo, app);
  mkdirSync(appDir, { recursive: true });
  const shared = path.join(f.repo, 'packages/server-shared');
  mkdirSync(shared, { recursive: true });
  writeFileSync(path.join(shared, 'package.json'), '{"name":"@fika/server-shared","version":"1.0.0"}');
  writeFileSync(path.join(appDir, 'tsconfig.json'), '{}');
  writeFileSync(path.join(appDir, 'package-lock.json'), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      'node_modules/@fika/server-shared': { link: true, resolved: '../../packages/server-shared' },
      'node_modules/next': { version: '16.2.12' },
      'node_modules/typescript': { version: '5.9.3' },
    },
  }));
  writeFileSync(path.join(appDir, '.gitignore'), 'next-env.d.ts\n.next/\ntsconfig.tsbuildinfo\n');
  f.git('add', '.');
  f.git('commit', '-m', 'Track Next app and npm local package link');
  f.git('push', 'origin', 'main');
  const task = createSourceWorkspace(name, { owner: name });
  const dependencyRoot = app + '/node_modules';
  const relative = dependencyRoot + '/@fika/server-shared';
  const dependency = path.join(task.directory, relative);
  const target = path.join(task.directory, 'packages/server-shared');
  const placeLink = () => {
    mkdirSync(path.dirname(dependency), { recursive: true });
    symlinkSync(target, dependency, process.platform === 'win32' ? 'junction' : 'dir');
  };
  placeLink();
  runSourceOperation('install', workspace => {
    assert.deepEqual(recordGenerated(workspace, [dependencyRoot]).paths, [dependencyRoot]);
  }, task.name);
  return { app, task, dependency, target, placeLink, relative };
}

const nextDeclaration = [
  '/// <reference types="next" />', '/// <reference types="next/image-types/global" />',
  'import "./.next/types/routes.d.ts";', '', '// NOTE: This file should not be edited',
  '// see https://nextjs.org/docs/app/api-reference/config/typescript for more information.', '',
].join('\n');

test('Next declarations are recorded by validation and independently verified at retirement', () => {
  const f = fixture();
  try { f.within(() => {
    const { app, task } = lockedNpmWorktree(f);
    const relative = app + '/next-env.d.ts';
    const declaration = path.join(task.directory, relative);
    const complete = () => completeSourceWorkspace(task.name, { owner: task.owner });
    writeFileSync(declaration, nextDeclaration + '// operator attachment\n');
    assert.match(complete().cleanup.protected[0].reason, /Unverified ignored output: .*next-env.d.ts/);

    // An exact generated declaration from before this repair needs no fingerprint.
    writeFileSync(declaration, nextDeclaration.replaceAll('\n', '\r\n'));
    assert.equal(cleanupSourceWorkspaces({ name: task.name }).ready.length, 1);
    completeSourceWorkspace(task.name, { owner: task.owner, preserve: true, reason: 'Resume fixture validation' });

    // Fresh validation records the exact generated file and build output. A changed
    // build remains protected even while the declaration can be reproduced.
    unlinkSync(declaration);
    const buildDir = path.join(task.directory, app, '.next');
    const builtFile = path.join(buildDir, 'built');
    runSourceOperation('validate', workspace => {
      const candidates = validationOutputCandidates(workspace, [{ path: app }]);
      mkdirSync(buildDir);
      writeFileSync(builtFile, 'verified output');
      writeFileSync(declaration, nextDeclaration);
      assert.deepEqual(recordGenerated(workspace, candidates).paths, [app + '/.next', relative]);
    }, task.name);
    writeFileSync(builtFile, 'unique evidence');
    assert.match(complete().cleanup.protected[0].reason, /Unverified ignored output: .*\.next/);
    assert.equal(readFileSync(builtFile, 'utf8'), 'unique evidence');
    writeFileSync(builtFile, 'verified output');
    assert.equal(complete().retirement, 'retired');
  }); } finally { f.dispose(); }
});

test('retirement removes a structurally valid compiler cache matching the tracked compiler and config', () => {
  const f = fixture();
  try { f.within(() => {
    const app = 'apps/hospitality-menu-studio';
    const appDir = path.join(f.repo, app);
    mkdirSync(appDir, { recursive: true });
    writeFileSync(path.join(appDir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { incremental: true } }));
    writeFileSync(path.join(appDir, 'package-lock.json'), JSON.stringify({ lockfileVersion: 3, packages: {
      'node_modules/next': { version: '16.2.12' }, 'node_modules/typescript': { version: '5.9.3' },
    } }));
    writeFileSync(path.join(appDir, '.gitignore'), 'tsconfig.tsbuildinfo\n');
    f.git('add', '.');
    f.git('commit', '-m', 'Track incremental TypeScript fixture');
    f.git('push', 'origin', 'main');
    const task = createSourceWorkspace('retirement-tsbuildinfo', { owner: 'retirement-tsbuildinfo' });
    const cache = path.join(task.directory, app, 'tsconfig.tsbuildinfo');
    const complete = () => completeSourceWorkspace(task.name, { owner: task.owner });
    writeFileSync(cache, JSON.stringify({ fileNames: ['a.ts'], fileInfos: [], root: [0], options: {}, version: '5.9.3' }));
    const protectedCache = complete();
    assert.equal(protectedCache.retirement, 'retained');
    assert.match(protectedCache.cleanup.protected[0].reason, /Unverified ignored output/);
    assert.equal(existsSync(cache), true);
    writeFileSync(cache, JSON.stringify({ fileNames: ['a.ts', 'b.ts'], fileInfos: [{ version: 'hash' }, { version: 'hash' }], root: [[0, 1]], options: {}, version: '5.9.3' }));
    assert.equal(verifiedTypeScriptBuildInfo(task, `${app}/tsconfig.tsbuildinfo`, task.baseline), true);
    const completed = complete();
    assert.equal(completed.retirement, 'retired', JSON.stringify(completed));
    assert.equal(existsSync(task.directory), false);
  }); } finally { f.dispose(); }
});

test('retirement revalidates only the two print-agent Python caches after checkout removal', () => {
  for (const changed of [false, true]) {
    const f = fixture();
    try { f.within(() => {
      f.git('config', 'core.autocrlf', 'false');
      const packagePath = 'apps/cpu-production/tools/xchange-print-agent';
      const packageDir = path.join(f.repo, packagePath);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(path.join(packageDir, '.gitignore'), '__pycache__/\n');
      writeFileSync(path.join(packageDir, 'agent.py'), 'def render(value):\n    return value.strip()\n');
      writeFileSync(path.join(packageDir, 'test_agent.py'), 'def test_render():\n    assert True\n');
      f.git('add', '.');
      f.git('commit', '-m', 'Track print agent sources for cache retirement fixture');
      f.git('push', 'origin', 'main');

      const task = createSourceWorkspace(changed ? 'retirement-python-cache-changed' : 'retirement-python-cache', { owner: 'python-cache-fixture' });
      const sourceFiles = ['agent.py', 'test_agent.py'].map(file => path.join(task.directory, packagePath, file));
      const cacheDirectory = path.join(task.directory, packagePath, '__pycache__');
      mkdirSync(cacheDirectory, { recursive: true });
      execFileSync('python', ['-B', '-c', `import importlib._bootstrap_external as e, pathlib, sys
for source_name in sys.argv[1:]:
 p=pathlib.Path(source_name); s=p.read_bytes(); stamp=int(p.stat().st_mtime)
 c=compile(s, str(p), 'exec', dont_inherit=True, optimize=0)
 (p.parent/'__pycache__'/f'{p.stem}.cpython-314.pyc').write_bytes(e._code_to_timestamp_pyc(c, stamp, len(s)))`, ...sourceFiles],
      { cwd: task.directory, windowsHide: true, stdio: 'pipe' });
      const cacheFiles = ['agent.cpython-314.pyc', 'test_agent.cpython-314.pyc'];
      const savedCaches = new Map(cacheFiles.map(file => [file, readFileSync(path.join(cacheDirectory, file))]));
      const taskChange = path.join(task.directory, 'retirement-fixture.txt');
      writeFileSync(taskChange, 'source head for exact PR evidence');
      f.run(task.directory, 'add', 'retirement-fixture.txt');
      f.run(task.directory, 'commit', '-m', 'Add exact PR source for Python cache retirement fixture');
      f.run(task.directory, 'push', 'origin', task.branch);
      const head = f.run(task.directory, 'rev-parse', 'HEAD');
      const firstCompletion = completeSourceWorkspace(task.name, { owner: task.owner });
      assert.equal(firstCompletion.retirement, 'retained');

      f.git('merge', '--no-ff', '--no-edit', head);
      f.git('push', 'origin', 'main');
      const merge = f.git('rev-parse', 'HEAD');
      const repo = { full_name: 'derekfika/fika-os' };
      const pr = { number: 93, state: 'closed', merged_at: 'observed', merge_commit_sha: merge,
        head: { sha: head, ref: task.branch, repo }, base: { ref: 'main', repo } };
      const remaining = new Map(savedCaches);
      if (changed) {
        const modified = Buffer.from(remaining.get(cacheFiles[0]));
        modified[modified.length - 1] ^= 1;
        remaining.set(cacheFiles[0], modified);
      }
      let removalCount = 0;
      const cleanup = cleanupSourceWorkspaces({ execute: true, name: task.name, readPulls: () => [pr],
        removeWorktree: directory => {
          removalCount++;
          f.git('worktree', 'remove', '--force', directory);
          mkdirSync(cacheDirectory, { recursive: true });
          for (const [file, bytes] of remaining) writeFileSync(path.join(cacheDirectory, file), bytes);
          assert.equal(existsSync(sourceFiles[0]), false, 'the registered checkout source has disappeared');
          assert.equal(existsSync(path.join(f.repo, packagePath, 'agent.py')), true, 'canonical source remains for verification');
          assert.deepEqual(readdirSync(cacheDirectory).sort(), [...cacheFiles].sort(), 'only the exact two cache files remain');
          if (!changed) {
            const persistedTask = JSON.parse(readFileSync(sourceTaskFile(task.name), 'utf8'));
            const persistedCompletion = JSON.parse(readFileSync(completionFile(task.name), 'utf8'));
            assert.equal(persistedTask.directory, task.directory);
            assert.equal(persistedCompletion.finalSha, head);
            assert.deepEqual(persistedCompletion.retirementGenerated,
              cacheFiles.map(file => `${packagePath}/__pycache__/${file}`).sort());
            assert.equal(verifiedPythonCache(persistedTask, `${packagePath}/__pycache__`, persistedCompletion.finalSha), true,
              'canonical fallback verifies with the exact persisted task and completion after source removal');
          }
        } });

      if (changed) {
        assert.equal(cleanup.retired.length, 0);
        assert.match(cleanup.protected[0].reason, /Unverified Python cache residue/);
        assert.equal(removalCount, 1);
        for (const [file, bytes] of remaining) assert.deepEqual(readFileSync(path.join(cacheDirectory, file)), bytes,
          'a changed cache remains untouched');
        assert.equal(existsSync(task.directory), true);
        assert.equal(existsSync(path.join(f.repo, packagePath, 'agent.py')), true);
      } else {
        assert.equal(cleanup.retired.length, 1, JSON.stringify(cleanup));
        assert.equal(removalCount, 1);
        assert.equal(existsSync(task.directory), false, 'verified residue and empty directories are removed');
        assert.equal(existsSync(path.join(f.repo, packagePath, 'agent.py')), true, 'canonical tracked sources remain');
        assert.equal(workspaceInventory().occupied, 0);
      }
    }); } finally { f.dispose(); }
  }
});

test('retirement resumes after native Git leaves a dangling own-target dependency junction', () => {
  const f = fixture();
  try { f.within(() => {
    const { task, dependency, target, placeLink, relative } = lockedNpmWorktree(f);
    const complete = () => completeSourceWorkspace(task.name, { owner: task.owner });
    runSourceOperation('dev', () => assert.match(complete().cleanup.protected[0].reason, /operation/), task.name);

    const extra = path.join(path.dirname(dependency), 'operator-attachment.txt');
    const interrupted = cleanupSourceWorkspaces({ execute: true, name: task.name, removeWorktree: directory => {
      // Model Git's observed post-removal state on Windows. The native call removes
      // tracked files and registration, and the own-target junction survives.
      unlinkSync(dependency);
      f.git('worktree', 'remove', directory);
      assert.equal(existsSync(target), false);
      placeLink();
      writeFileSync(extra, 'unverified user evidence');
      throw Error('fixture interrupted after Git registration removal');
    } });
    assert.match(interrupted.protected[0].reason, /operator-attachment.txt/);
    assert.equal(readFileSync(extra, 'utf8'), 'unverified user evidence');
    const saved = JSON.parse(readFileSync(completionFile(task.name), 'utf8'));
    assert.equal(saved.retirement, 'removing');
    assert.deepEqual(saved.retirementLinks, [[relative, 'packages/server-shared']]);
    const health = sourceWorkspaceHealth({ 'inventory-only': true });
    assert.equal(health.occupied, 1);
    assert.equal(health.retirementResidues, 1);
    assert.equal(f.git('rev-parse', task.branch), task.baseline);

    renameSync(extra, path.join(f.base, 'preserved-user-evidence'));
    assert.throws(() => completeSourceWorkspace(task.name, {
      owner: task.owner, preserve: true, reason: 'Inspect residue before choosing recovery',
    }), /Retirement already started/);
    assert.equal(workspaceInventory().occupied, 1);
    assert.deepEqual(cleanupSourceWorkspaces().ready.map(entry => entry.action), ['finish-retirement']);
    assert.equal(complete().retirement, 'retired');
    assert.equal(existsSync(task.directory), false);
    assert.equal(workspaceInventory().occupied, 0);
    assert.equal(cleanupSourceWorkspaces({ execute: true }).retired.length, 0);
    assert.equal(f.git('rev-parse', 'refs/preserve/source-recovery/retirements/' + task.name + '/' + task.baseline), task.baseline);
  }); } finally { f.dispose(); }
});

test('old false retirement is rechecked against its archive, lockfile and exact dangling target', () => {
  const f = fixture();
  try { f.within(() => {
    const { task, dependency, placeLink } = lockedNpmWorktree(f);
    const actual = completeSourceWorkspace(task.name, { owner: task.owner });
    assert.equal(actual.retirement, 'retired');
    const { retirementLinks: _unused, ...legacy } = actual;
    save(completionFile(task.name), legacy);
    placeLink();
    assert.equal(workspaceInventory().entries[0].state, 'retirement-residue');

    const archive = path.join(stateDir(), 'source-recovery', 'retirements', task.name);
    const gitdir = path.join(archive, 'gitdir');
    const archivedPointer = readFileSync(gitdir);
    writeFileSync(gitdir, path.join(f.base, 'another-checkout', '.git'));
    const cleanup = () => cleanupSourceWorkspaces({ execute: true, name: task.name });
    assert.match(cleanup().protected[0].reason, /archived Git/);
    writeFileSync(gitdir, archivedPointer);

    unlinkSync(dependency);
    const external = path.join(f.base, 'external-package');
    symlinkSync(external, dependency, process.platform === 'win32' ? 'junction' : 'dir');
    assert.match(cleanup().protected[0].reason, /Unverified retirement residue: .*server-shared/);
    assert.equal(workspaceInventory().occupied, 1);
    unlinkSync(dependency);
    placeLink();
    assert.equal(cleanup().retired.length, 1);
    assert.equal(existsSync(task.directory), false);
    assert.equal(workspaceInventory().occupied, 0);
  }); } finally { f.dispose(); }
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
