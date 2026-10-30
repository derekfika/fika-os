import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { writeFileSync, readFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'node:fs';
import { fixture } from './lifecycle-fixture.mjs';
import { stateDir, save, jsonFile, withRepository } from './runtime.mjs';
import { createWorkspace } from './workspaces.mjs';
import { workspaceRecords, checkWorkspace } from './workspaces.mjs';
import { completeWorkspace, repositoryAdministrator } from './workspace-admin.mjs';
import { recoverStackedLease } from './workspace-lease-recovery.mjs';
import { beginWorkspaceOperation, authorityForCurrentWorkspace } from './workspace-state.mjs';
import { parse } from './cli.mjs';

function stack(f) {
  const commit = (r, file, content) => { mkdirSync(path.dirname(path.join(r.directory, file)), { recursive: true }); writeFileSync(path.join(r.directory, file), content); f.run(r.directory, 'add', '.'); f.run(r.directory, 'commit', '-m', file); return f.run(r.directory, 'rev-parse', 'HEAD'); };
  const prior = createWorkspace('prior-task', { owner: 'prior-owner', scope: 'provider' });
  const priorHead = commit(prior, 'provider/rules.txt', 'retired rules'); f.run(prior.directory, 'push', '-u', 'origin', prior.branch);
  completeWorkspace(prior.name, { owner: prior.owner }, { evidenceFor: () => ({ pushed: true, inMain: false, pr: { number: 1 } }) });
  const target = createWorkspace('portal-task', { owner: 'portal-owner', scope: 'portal' });
  f.run(target.directory, 'merge', '--no-edit', prior.branch);
  commit(target, 'portal/form.txt', 'portal');
  // Reproduce #128's additional test committed after the retired tip: disclose, never misattribute it.
  const head = commit(target, 'tests/emulator.txt', 'reviewed test'); f.run(target.directory, 'push', '-u', 'origin', target.branch);
  const unrelated = createWorkspace('rotations-task', { owner: 'other-owner', scope: 'rotations' });
  const options = { owner: target.owner, 'lease-id': target.leaseId, predecessor: prior.name, 'predecessor-lease-id': prior.leaseId, head, pr: '128', scope: 'portal,provider,tests', reason: 'Owner requests preserved stacked lease recovery' };
  const pr = () => ({ number: 128, state: 'open', draft: true, merged_at: null, head: { sha: head, ref: target.branch, repo: { full_name: 'derekfika/fika-os' } }, base: { ref: 'main', repo: { full_name: 'derekfika/fika-os' } } });
  const deps = { authorize: () => ({ login: 'fixture-admin', administrator: true }), readPr: pr };
  const recover = (extra = {}, extraDeps = {}) => recoverStackedLease(target.name, { ...options, ...extra }, { ...deps, ...extraDeps });
  return { target, prior, priorHead, unrelated, head, options, deps, pr, recover, commit };
}

test('stacked recovery releases exactly one lease, preserves ignored files/history/PR and fences the former owner', () => {
  const f = fixture(); try { f.within(() => {
    const s = stack(f); const { target, unrelated, recover } = s;
    writeFileSync(path.join(target.directory, '.env'), 'private fixture'); mkdirSync(path.join(target.directory, 'node_modules')); writeFileSync(path.join(target.directory, 'node_modules', 'keep'), 'dependency');
    const registry = path.join(stateDir(), 'workspaces'); const before = new Map(readdirSync(registry).map(n => [n, readFileSync(path.join(registry, n), 'utf8')]));
    const refs = f.git('for-each-ref', '--format=%(refname) %(objectname)');
    assert.throws(() => checkWorkspace(target.name, { owner: target.owner }), /exceed owned scope/);
    const plan = recover(); assert.equal(plan.dryRun, true); assert.equal(plan.leaseReleased, false);
    assert.deepEqual(plan.inherited, ['provider/rules.txt']); assert.deepEqual(plan.additionalReviewPaths, ['tests/emulator.txt']); assert.ok(plan.ignoredRetained.includes('.env'));
    assert.ok(!existsSync(path.join(stateDir(), 'workspace-revocations')));
    const result = recover({ execute: true, 'approve-hash': plan.planHash });
    assert.equal(result.leaseReleased, true); assert.equal(result.retirement, 'protected');
    assert.equal(workspaceRecords().find(r => r.name === target.name).state, 'revoked'); assert.equal(workspaceRecords().find(r => r.name === unrelated.name).state, 'active');
    for (const [n, bytes] of before) assert.equal(readFileSync(path.join(registry, n), 'utf8'), bytes);
    assert.equal(readFileSync(path.join(target.directory, '.env'), 'utf8'), 'private fixture'); assert.equal(readFileSync(path.join(target.directory, 'node_modules', 'keep'), 'utf8'), 'dependency');
    for (const line of refs.split('\n')) assert.ok(f.git('for-each-ref', '--format=%(refname) %(objectname)').includes(line));
    assert.equal(f.run(target.directory, 'rev-parse', 'HEAD'), s.head); assert.equal(f.git('rev-parse', `origin/${target.branch}`), s.head); assert.equal(s.pr().state, 'open');
    f.git('bundle', 'verify', result.preservation.bundle);
    const event = jsonFile(path.join(stateDir(), 'workspace-revocations', `${plan.planHash}.json`)); assert.equal(event.released.length, 1); assert.equal(event.actor.login, 'fixture-admin'); assert.equal(event.recovery.plan.head, s.head);
    assert.throws(() => withRepository(target.directory, authorityForCurrentWorkspace), /revoked/); assert.throws(() => recover({ execute: true, 'approve-hash': plan.planHash }), /exact active lease/);
    // Fresh scope acquisition is a distinct decision; inherited changes remain checked on the new branch.
    const fresh = createWorkspace('fresh-integration', { owner: 'integration-owner', scope: plan.scopes.join(',') });
    f.run(fresh.directory, 'merge', '--no-edit', target.branch); assert.equal(checkWorkspace(fresh.name, { owner: fresh.owner }).withinScope, true);
    const journal = path.join(stateDir(), 'workspace-revocations', `${plan.planHash}.json`);
    save(journal, { ...event, reason: 'tampered' }); assert.throws(() => workspaceRecords(), /integrity failure/);
  }); } finally { f.dispose(); }
});

test('wrong owners, IDs, authority, predecessor, head, scope, reason and PR fail closed', () => {
  const f = fixture(); try { f.within(() => {
    const s = stack(f);
    for (const extra of [{ owner: 'wrong' }, { 'lease-id': 'wrong' }, { 'lease-id': '' }, { 'predecessor-lease-id': 'wrong' }, { predecessor: s.unrelated.name, 'predecessor-lease-id': s.unrelated.leaseId }, { head: 'a'.repeat(40) }, { scope: 'portal,provider' }, { reason: '' }, { pr: '0' }]) assert.throws(() => s.recover(extra));
    assert.throws(() => s.recover({}, { authorize: () => ({ login: 'writer', administrator: false }) }), /Administrator/);
    assert.throws(() => s.recover({}, { readPr: () => ({ ...s.pr(), head: { ...s.pr().head, sha: 'b'.repeat(40) } }) }), /Open PR/);
    assert.throws(() => s.recover({}, { readPr: () => ({ ...s.pr(), state: 'closed' }) }), /Open PR/);
    assert.throws(() => withRepository(s.target.directory, repositoryAdministrator), /canonical/);
    assert.equal(workspaceRecords().find(r => r.name === s.target.name).state, 'active');
  }); } finally { f.dispose(); }
});

test('stale previews reject concurrent registry, main, ignored inventory, reason, PR and HEAD changes', () => {
  const f = fixture(); try { f.within(() => {
    const s = stack(f); const plan = s.recover(); const execute = { execute: true, 'approve-hash': plan.planHash };
    assert.throws(() => s.recover({ ...execute, reason: 'Different owner instruction' }), /fresh preview/);
    assert.throws(() => s.recover(execute, { readPr: () => ({ ...s.pr(), draft: false }) }), /fresh preview/);
    writeFileSync(path.join(s.target.directory, '.env'), 'retained'); assert.throws(() => s.recover(execute), /fresh preview/);
    const next = s.recover(); createWorkspace('concurrent-task', { owner: 'another-owner', scope: 'another' }); assert.throws(() => s.recover({ execute: true, 'approve-hash': next.planHash }), /fresh preview/);
    const current = s.recover(); const head = s.commit(s.target, 'portal/next.txt', 'next'); f.run(s.target.directory, 'push', 'origin', s.target.branch);
    assert.throws(() => s.recover({ execute: true, 'approve-hash': current.planHash, head }, { readPr: () => ({ ...s.pr(), head: { ...s.pr().head, sha: head } }) }), /fresh preview/);
    const beforeMain = s.recover({ head }, { readPr: () => ({ ...s.pr(), head: { ...s.pr().head, sha: head } }) });
    writeFileSync(path.join(f.repo, 'README.md'), 'concurrent main'); f.git('add', '.'); f.git('commit', '-m', 'main advanced'); f.git('push', 'origin', 'main');
    assert.throws(() => s.recover({ ...execute, 'approve-hash': beforeMain.planHash, head }, { readPr: () => ({ ...s.pr(), head: { ...s.pr().head, sha: head } }) }), /fresh preview/);
  }); } finally { f.dispose(); }
});

test('operations, registry inconsistencies, dirty work, unpushed commits and unproven ancestry remain protected', () => {
  const f = fixture(); try { f.within(() => {
    const s = stack(f); const op = beginWorkspaceOperation('validate', { workspace: s.unrelated.name, owner: s.unrelated.owner });
    assert.throws(() => s.recover(), /Active or interrupted/); op.end();
    const workspaceLock = path.join(stateDir(), 'workspaces.lock'); writeFileSync(workspaceLock, 'fixture lock'); assert.throws(() => s.recover(), /Another operation holds/); unlinkSync(workspaceLock);
    const releaseLock = path.join(stateDir(), 'release-cpu-staging.lock'); writeFileSync(releaseLock, 'protected'); assert.throws(() => s.recover(), /Active or interrupted/); unlinkSync(releaseLock);
    const marker = f.run(s.target.directory, 'rev-parse', '--path-format=absolute', '--git-path', 'MERGE_HEAD'); writeFileSync(marker, s.priorHead); assert.throws(() => s.recover(), /Git operation/); unlinkSync(marker);
    const original = jsonFile(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`));
    save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), { ...original, directory: s.target.directory }); assert.throws(() => s.recover(), /duplicated/); save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), original);
    save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), { ...original, finalSha: s.head }); assert.throws(() => s.recover(), /matching preserved/); save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), original);
    const unrelatedBundle = path.join(f.base, 'unrelated.bundle'); f.git('bundle', 'create', unrelatedBundle, 'main');
    save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), { ...original, bundle: unrelatedBundle }); assert.throws(() => s.recover(), /bundle does not preserve/); save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), original);
    writeFileSync(path.join(s.target.directory, 'untracked.txt'), 'keep'); assert.throws(() => s.recover(), /dirty/); unlinkSync(path.join(s.target.directory, 'untracked.txt'));
    writeFileSync(path.join(f.repo, 'README.md'), 'unrelated history'); f.git('add', '.'); f.git('commit', '-m', 'unrelated history'); f.git('push', 'origin', 'main');
    save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), { ...original, finalSha: f.git('rev-parse', 'HEAD') }); assert.throws(() => s.recover(), /History is not/); save(path.join(stateDir(), 'workspaces', `${s.prior.name}.json`), original);
    writeFileSync(path.join(s.target.directory, 'portal', 'form.txt'), 'dirty'); assert.throws(() => s.recover(), /dirty/); f.run(s.target.directory, 'add', '.'); assert.throws(() => s.recover(), /dirty/);
    f.run(s.target.directory, 'commit', '-m', 'unpublished'); const head = f.run(s.target.directory, 'rev-parse', 'HEAD'); assert.throws(() => s.recover({ head }), /not exactly pushed/);
    assert.equal(workspaceRecords().find(r => r.name === s.target.name).state, 'active');
  }); } finally { f.dispose(); }
});

test('changes during preservation leave additive recovery evidence but never release the lease', () => {
  const f = fixture(); try { f.within(() => {
    const s = stack(f); const plan = s.recover(); let calls = 0;
    assert.throws(() => s.recover({ execute: true, 'approve-hash': plan.planHash }, { readPr: () => { if (++calls === 2) writeFileSync(path.join(s.target.directory, 'late-untracked.txt'), 'concurrent writer'); return s.pr(); } }), /changed|dirty/);
    assert.equal(workspaceRecords().find(r => r.name === s.target.name).state, 'active'); assert.ok(!existsSync(path.join(stateDir(), 'workspace-revocations')));
    assert.match(f.git('for-each-ref', '--format=%(refname)', `refs/preserve/workspace/${s.target.name}`), /preserve/);
  }); } finally { f.dispose(); }
});

test('recovery CLI accepts exact selectors and rejects conflicting execution modes', () => {
  assert.equal(parse(['workspace', 'recover-stacked', 'portal-task', '--lease-id', 'exact', '--predecessor', 'prior-task', '--predecessor-lease-id', 'prior', '--dry-run']).options['lease-id'], 'exact');
  assert.throws(() => parse(['workspace', 'recover-stacked', 'portal-task', '--execute', '--dry-run']), /either/);
});
