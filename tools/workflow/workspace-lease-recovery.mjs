import path from 'node:path';
import { existsSync } from 'node:fs';
import { command, git, common, stateDir, lock, save, ancestor, ref, ghApi } from './runtime.mjs';
import { REPO, digest, safeScope, exactSha } from './policy.mjs';
import { workspaceRecords, worktrees, preserveWorkspace, assertLeaseIdentitiesUnique } from './workspaces.mjs';
import { leaseIdentity, registryFingerprint } from './workspace-state.mjs';
import { criticalConditions, repositoryAdministrator } from './workspace-admin.mjs';
import { changelogPath } from './changelog.mjs';

const scoped = (file, scopes) => changelogPath(file) || scopes.some(s => file === s || file.startsWith(`${s}/`));
const lines = value => value.split('\n').filter(Boolean);
const paths = (run, from, to) => run('diff', '--name-only', '--no-renames', '-z', from, to).split('\0').filter(Boolean).sort();
const remoteHead = branch => {
  const rows = lines(git('ls-remote', '--exit-code', 'origin', `refs/heads/${branch}`));
  if (rows.length !== 1 || rows[0].split(/\s+/)[1] !== `refs/heads/${branch}`) throw Error('Ambiguous or missing remote branch');
  return exactSha(rows[0].split(/\s+/)[0]);
};
const pullRequest = number => ghApi(`repos/${REPO}/pulls/${number}`);

function identity(name, options, records) {
  const record = records.find(r => r.name === name);
  if (!record || record.state !== 'active' || !options.owner || record.owner !== options.owner || !options['lease-id'] || leaseIdentity(record) !== options['lease-id']) throw Error('Recovery requires the exact active lease ID and owner');
  const predecessor = records.find(r => r.name === options.predecessor);
  if (!predecessor || predecessor.state !== 'retired' || !options['predecessor-lease-id'] || leaseIdentity(predecessor) !== options['predecessor-lease-id']) throw Error('Recovery requires an exact already-retired predecessor lease ID');
  exactSha(options.head);
  if (!/^[1-9]\d*$/.test(String(options.pr || '')) || !options.reason?.trim() || options.reason.trim().length < 8) throw Error('Recovery requires a PR and explicit reason of at least eight characters');
  const scopes = String(options.scope || '').split(',').map(safeScope).sort();
  return { record, predecessor, scopes };
}

/** Inspection never changes ownership, source, refs, recovery artifacts or ignored files. */
function inspect(name, options, readPr) {
  const registry = registryFingerprint();
  const records = workspaceRecords();
  assertLeaseIdentitiesUnique(records);
  if (records.some(r => ['creating', 'attention', 'reconciling'].includes(r.state))) throw Error('Registry contains an unresolved workspace transition');
  const { record, predecessor, scopes } = identity(name, options, records);
  const conditions = criticalConditions();
  // An administrative handoff must be quiescent; even unrelated operations retain their markers.
  if (conditions.length) throw Error(`Active or interrupted operations protect recovery: ${conditions.map(c => c.reason).join('; ')}`);
  const run = (...args) => command('git', args, { cwd: record.directory });
  const registration = worktrees().find(t => path.resolve(t.worktree) === path.resolve(record.directory));
  if (!registration || registration.locked || registration.prunable || registration.branch !== `refs/heads/${record.branch}`) throw Error('Missing, locked or inconsistent worktree registration');
  if (path.resolve(run('rev-parse', '--show-toplevel')) !== path.resolve(record.directory) || path.resolve(run('rev-parse', '--path-format=absolute', '--git-common-dir')) !== path.resolve(common()) || run('branch', '--show-current') !== record.branch) throw Error('Checkout does not match its lease and repository');
  for (const marker of ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD', 'rebase-merge', 'rebase-apply', 'sequencer', 'BISECT_LOG', 'index.lock']) {
    if (existsSync(run('rev-parse', '--path-format=absolute', '--git-path', marker))) throw Error(`Git operation ${marker} is unresolved`);
  }
  const head = run('rev-parse', 'HEAD');
  if (head !== options.head || registration.HEAD !== head || run('status', '--porcelain', '--untracked-files=all')) throw Error('HEAD changed or checkout has dirty/untracked work; preserve it and stop');
  const main = remoteHead('main');
  if (ref('origin/main') !== main) throw Error('Fetch origin/main before obtaining a recovery preview');
  if (remoteHead(record.branch) !== head) throw Error('Source HEAD is not exactly pushed');
  exactSha(predecessor.finalSha);
  if (!ancestor(record.baseline, head) || !ancestor(predecessor.baseline, predecessor.finalSha) || !ancestor(predecessor.finalSha, head) || ancestor(head, main)) throw Error('History is not an unmerged stack descending from both recorded baselines and the retired tip');
  const bases = lines(run('merge-base', '--all', main, head));
  if (bases.length !== 1) throw Error('Ambiguous integration merge base');
  if (!predecessor.preservationRef || ref(predecessor.preservationRef) !== predecessor.finalSha || !predecessor.bundle) throw Error('Retired predecessor lacks matching preserved history');
  git('bundle', 'verify', predecessor.bundle);
  if (git('bundle', 'list-heads', predecessor.bundle, predecessor.preservationRef) !== `${predecessor.finalSha} ${predecessor.preservationRef}`) throw Error('Retired predecessor bundle does not preserve its recorded tip');
  const pr = readPr(Number(options.pr));
  if (pr.number !== Number(options.pr) || pr.state !== 'open' || pr.merged_at || pr.head?.sha !== head || pr.head?.ref !== record.branch || pr.head?.repo?.full_name !== REPO || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== REPO) throw Error('Open PR does not match the exact source branch, repository and HEAD');
  const integrationPaths = paths(run, bases[0], head);
  // Match normal scope semantics: main-identical content and bookkeeping are exempt.
  const outside = paths(run, record.baseline, head).filter(p => !scoped(p, record.scopes) && run('diff', '--name-only', head, main, '--', p));
  const inherited = outside.filter(p => scoped(p, predecessor.scopes) && !run('diff', '--name-only', predecessor.finalSha, head, '--', p));
  if (!outside.length || !inherited.length) throw Error('No scope-blocked stacked content is proven in the retired predecessor');
  const reviewPaths = [...new Set([...integrationPaths, ...outside])].sort();
  const uncovered = reviewPaths.filter(p => !scoped(p, scopes));
  if (uncovered.length) throw Error(`Explicit future integration scope must cover every path: ${uncovered.join(', ')}`);
  const ignoredRetained = run('ls-files', '--others', '--ignored', '--exclude-standard', '--directory', '-z').split('\0').filter(Boolean).sort();
  if (run('rev-parse', 'HEAD') !== head || run('status', '--porcelain', '--untracked-files=all') || run('branch', '--show-current') !== record.branch) throw Error('Checkout changed during recovery inspection');
  if (digest(registryFingerprint()) !== digest(registry)) throw Error('Registry changed during recovery inspection');
  return { schema: 'fika.workspace-single-recovery-plan.v1', registry, name, owner: record.owner, leaseId: leaseIdentity(record), branch: record.branch, head, main,
    reason: options.reason.trim(), pr: { number: pr.number, url: `https://github.com/${REPO}/pull/${pr.number}`, draft: Boolean(pr.draft) },
    predecessor: { name: predecessor.name, owner: predecessor.owner, leaseId: leaseIdentity(predecessor), head: predecessor.finalSha },
    integrationBase: bases[0], integrationPaths, outside, inherited, additionalReviewPaths: outside.filter(p => !inherited.includes(p)), scopes, ignoredRetained,
    sourcePreserved: true, retirement: 'protected; administrative recovery never retires a checkout' };
}

/** Single-lease revocation uses the existing atomic journal/overlay and Git fences. No scope exemption. */
export function recoverStackedLease(name, options, { authorize = repositoryAdministrator, readPr = pullRequest } = {}) {
  const actor = authorize();
  if (!actor?.administrator || !actor.login) throw Error('Administrator authorization required');
  return lock('workspaces', () => {
    const plan = inspect(name, options, readPr);
    const planHash = digest(plan);
    if (!options.execute) return { ...plan, planHash, dryRun: true, actor, leaseReleased: false };
    if (!/^[a-f0-9]{64}$/.test(options['approve-hash'] || '') || planHash !== options['approve-hash']) throw Error('Recovery preview changed; obtain and review a fresh preview');
    const record = workspaceRecords().find(r => r.name === name);
    // Additive bundle/ref/manifest only. Failed checks leave this recovery evidence and lease intact.
    const preservation = preserveWorkspace(record, options.reason.trim());
    const fresh = inspect(name, options, readPr);
    if (digest(fresh) !== planHash) throw Error('Source, registry, PR or operations changed during preservation; obtain a fresh preview');
    const event = { schema: 'fika.workspace-revocation.v1', phase: 'committed', planHash, at: new Date().toISOString(), actor, reason: plan.reason,
      kind: 'stacked-single-lease-recovery', released: [{ name, owner: record.owner, branch: record.branch, leaseId: leaseIdentity(record) }], protected: [], conditions: [],
      recovery: { plan, preservation }, sourcePreserved: true };
    const file = path.join(stateDir(), 'workspace-revocations', `${planHash}.json`);
    if (existsSync(file)) throw Error('Recovery journal already exists; inspect authoritative readback');
    // Sole authority commit point. Interrupted earlier work never revokes; later readers overlay one lease.
    save(file, { ...event, eventHash: digest(event) });
    const readback = workspaceRecords().find(r => r.name === name);
    return { leaseReleased: readback.state === 'revoked', retirement: 'protected', sourcePreserved: true, planHash, branch: record.branch, finalSha: plan.head, pr: plan.pr, preservation, record: readback };
  });
}
