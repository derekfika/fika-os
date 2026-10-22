import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { APPS, REPO, MAIN_CHECK, target, exactSha, assertClean, validateRecord, validateApproval, risk, assertResume, assertServingLineage } from './policy.mjs';
import { git, command, ancestor, ref, ghApi, scopeHash, asyncLock, save, stateDir, jsonFile, serving, cloud, backendPath } from './runtime.mjs';

export function releaseRecord(branch) {
  const sha = ref(`refs/remotes/origin/${branch}`);
  return sha ? { commit: sha, record: JSON.parse(git('show', `${sha}:release.json`)) } : undefined;
}
export function appendRecord(t, record, expected) {
  // Release branches are append-only records, NEVER application source trees.
  const blob = command('git', ['hash-object', '-w', '--stdin'], { input: `${JSON.stringify(record, null, 2)}\n` });
  const tree = command('git', ['mktree'], { input: `100644 blob ${blob}\trelease.json\n` });
  const parents = [...new Set([expected, record.sourceSha].filter(Boolean))].flatMap(p => ['-p', p]);
  const commit = command('git', ['commit-tree', tree, ...parents], { input: `Release record: ${t.app} ${t.environment} ${record.kind} ${record.sourceSha}\n` });
  // Non-force push is a distributed compare-and-swap: both contenders use the same first parent, only one wins.
  command('git', ['push', 'origin', `${commit}:refs/heads/${t.branch}`]);
  git('fetch', 'origin', `refs/heads/${t.branch}:refs/remotes/origin/${t.branch}`);
  return commit;
}
export async function bootstrap(t, options = {}) {
  const current = await serving(t);
  if (!ref(current.sourceSha)) git('fetch', 'origin', current.sourceSha);
  const historicalException = !ancestor(current.sourceSha, 'origin/main');
  const record = { schema: 'fika.release.v1', ...t, ...current, kind: 'baseline', scopeHash: scopeHash(t.app, current.sourceSha), observedAt: new Date().toISOString(), historicalException, reconciliation: historicalException ? 'Existing deployed source not integrated into main; preserve, reconcile by reviewed PR before any new production promotion' : undefined };
  const existing = releaseRecord(t.branch);
  if (existing) { validateRecord(existing.record, t); return { status: 'existing', ...existing }; }
  if (!options.execute) return { status: 'dry-run', record };
  const commit = appendRecord(t, record); git('branch', t.branch, commit); return { status: 'created', commit, record };
}
export function successfulValidation(sha) {
  const checks = ghApi(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`).check_runs || [];
  const check = checks.find(c => c.name === MAIN_CHECK && c.head_sha === sha && c.app?.slug === 'github-actions' && c.conclusion === 'success');
  if (!check) throw Error(`Required GitHub Actions check ${MAIN_CHECK} has not passed for exact source ${sha}`);
  return { id: check.id, url: check.html_url, sha };
}
export function rolloutArguments(plan) {
  const t = target(plan.app, plan.environment);
  if (plan.backend !== t.backend || plan.project !== t.project) throw Error('Rollout target differs from governed mapping');
  // --force skips Firebase's interactive confirmation only, after our exact-SHA approval gates.
  return ['apphosting:rollouts:create', t.backend, '--project', t.project, '--git-commit', exactSha(plan.sourceSha), '--non-interactive', '--force'];
}
export function approval(options, t, sha) {
  const match = /^https:\/\/github\.com\/derekfika\/fika-os\/(?:pull|issues)\/(\d+)#issuecomment-(\d+)$/.exec(options['approval-url'] || '');
  if (!match) throw Error('--approval-url must identify a GitHub issue/PR comment in this repository');
  const comment = ghApi(`repos/${REPO}/issues/comments/${match[2]}`);
  if (comment.issue_url?.split('/').at(-1) !== match[1]) throw Error('Approval comment does not belong to the linked PR/issue');
  const lines = comment.body.trim().split(/\r?\n/);
  const fields = lines[0].split(' ');
  if (fields.length !== 6 || fields[0] !== '/fika-approve') throw Error('Approval comment syntax invalid');
  if (fields[4] === 'owner-exception' && !lines.slice(1).join('\n').startsWith('Reason: ')) throw Error('Owner exception requires a recorded Reason: line');
  const result = validateApproval({ ...comment, body: lines[0] }, ghApi(`repos/${REPO}`), { app: t.app, environment: t.environment, sha, lane: fields[4], expires: fields[5] });
  return { ...result, reason: lines.slice(1).join('\n'), issue: Number(match[1]) };
}
function sourceReview(t, sha, lane, attestation = '') {
  const pulls = ghApi(`repos/${REPO}/commits/${sha}/pulls?per_page=100`);
  const pr = pulls.find(p => p.head?.repo?.full_name === REPO && (p.head.sha === sha || (p.merged_at && ancestor(p.head.sha, sha) && scopeHash(t.app, p.head.sha) === scopeHash(t.app, sha))));
  if (!pr) throw Error('Source must have a repository PR with the same selected-app dependency tree');
  const paths = git('diff', '--name-only', `${pr.base.sha}...${pr.head.sha}`).split(/\r?\n/).filter(Boolean);
  if (lane === 'fast' && risk(paths) !== 'fast') {
    const uiOnly = paths.every(p => p === 'CHANGELOG.md' || /\.md$/.test(p) || /^apps\/[^/]+\/app\/(?:ui\/.*\.tsx|page\.tsx|.*\.css)$/.test(p));
    if (!uiOnly || !attestation.split(/\r?\n/).includes('Risk: cosmetic-only')) throw Error('Fast Track source changes need owner Risk: cosmetic-only attestation and UI-only scope; backend/shared/operational changes require Standard');
  }
  if (lane === 'standard') {
    const reviews = ghApi(`repos/${REPO}/pulls/${pr.number}/reviews?per_page=100`);
    const latest = new Map(); for (const r of reviews) if (r.state !== 'COMMENTED') latest.set(r.user.login, r);
    if (![...latest.values()].some(r => r.state === 'APPROVED' && r.commit_id === pr.head.sha && r.user.type === 'User' && r.user.login !== pr.user.login && ['OWNER','MEMBER','COLLABORATOR'].includes(r.author_association))) throw Error('Standard Track needs an independent trusted approval on the exact PR head, or a documented owner-exception');
  }
  return { number: pr.number, url: pr.html_url, head: pr.head.sha, risk: risk(paths) };
}
export function planRelease(app, environment, options = {}) {
  const t = target(app, environment); assertClean(git('status', '--porcelain')); git('fetch', 'origin');
  const sha = exactSha(options.sha || git('rev-parse', 'origin/main'));
  const current = releaseRecord(t.branch); if (!current) throw Error('Bootstrap the verified release baseline first');
  const hash = scopeHash(app, sha);
  const result = { ...t, sourceSha: sha, scopeHash: hash, inMain: ancestor(sha, 'origin/main'), rollback: Boolean(options.record) };
  if (environment === 'prod' && !result.inMain && !options.record) throw Error('Production source must already be integrated into origin/main');
  if (options.record) {
    exactSha(options.record); if (!ancestor(options.record, `origin/${t.branch}`)) throw Error('Rollback record is not in the selected release history');
    const old = validateRecord(JSON.parse(git('show', `${options.record}:release.json`)), t);
    if (old.sourceSha !== sha || old.scopeHash !== hash) throw Error('Rollback source does not match the verified historical record');
    result.rollbackRecord = options.record;
  }
  if (options.execute) {
    result.validation = options.record ? { verifiedHistoricalRecord: options.record } : successfulValidation(sha);
    // A previous verified baseline may predate CI. Rollback still needs explicit owner approval, never fabricated CI.
    result.approval = approval(options, t, sha);
    if (!options.record) result.review = sourceReview(t, sha, environment === 'prod' ? result.approval.lane : 'owner-exception', result.approval.reason);
    if (environment === 'prod' && !options.record && result.approval.lane !== 'fast') {
      const staged = releaseRecord(target(app, 'staging').branch);
      validateRecord(staged?.record, { app, environment: 'staging' });
      if (staged.record.scopeHash !== hash || !ancestor(staged.record.sourceSha, 'origin/main')) throw Error('Standard production promotion requires a verified staging release of the same app/dependency tree, integrated into main');
      result.stagingEvidence = staged.commit;
    }
  }
  return result;
}
export async function deploy(app, environment, options) {
  return asyncLock(`release-${app}-${environment}`, async () => {
    const plan = planRelease(app, environment, options);
    const backend = await cloud(backendPath(plan));
    const journalFile = path.join(stateDir(), `release-${app}-${environment}.json`);
    if (!options.execute) {
      const before = await serving(plan);
      assertServingLineage(plan, before, ancestor(before.sourceSha, plan.sourceSha), scopeHash(app,before.sourceSha) === plan.scopeHash);
      return { dryRun: true, plan, before, url: backend.uri, next: 'Add --execute --approval-url <exact owner comment> after CI/review. No rollout or release pointer changed.' };
    }
    let journal = existsSync(journalFile) ? jsonFile(journalFile) : undefined;
    const pointer = releaseRecord(plan.branch);
    if (pointer?.record.kind === 'intent') {
      if (!options.resume) throw Error('Pending distributed release intent: use --resume; never submit another rollout');
      assertResume(pointer.record, journal, plan);
    } else {
      if (options.resume) throw Error('No matching pending release to resume');
      validateRecord(pointer.record, plan);
      const before = await serving(plan);
      if (pointer.record.sourceSha !== before.sourceSha) throw Error('Live serving source differs from release ledger; reconcile the external release before proceeding');
      assertServingLineage(plan, before, ancestor(before.sourceSha, plan.sourceSha), scopeHash(app,before.sourceSha) === plan.scopeHash);
      if (before.sourceSha === plan.sourceSha) return { alreadyServing: true, before };
      journal = { releaseId: randomUUID(), plan, before, state: 'pending', createdAt: new Date().toISOString() };
      save(journalFile, journal);
      journal.intentCommit = appendRecord(plan, { schema: 'fika.release.v1', ...plan, kind: 'intent', state: 'PENDING', releaseId: journal.releaseId, previousGood: before, createdAt: journal.createdAt }, pointer.commit);
      save(journalFile, journal);
      // Exactly one selected backend; no branch-based or project-wide deployment command.
      try { command('firebase', rolloutArguments(plan), { stdio: ['ignore', 'inherit', 'inherit'] }); }
      catch { throw Error(`Rollout submission/completion uncertain. Journal ${journalFile}; use --resume, NEVER blindly resubmit.`); }
    }
    let verified; const deadline = Date.now() + Number(options['timeout-ms'] || 1200000);
    while (Date.now() < deadline) {
      try { const s = await serving(plan); if (s.sourceSha === plan.sourceSha) { verified = s; break; } } catch { /* transient rollout state, no resubmission */ }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    if (!verified) throw Error(`Serving verification incomplete; retain pending intent and ${journalFile}. Resume without duplicate submission.`);
    const health = await fetch(`https://${backend.uri.replace(/^https?:\/\//, '')}/`, { redirect: 'error', signal: AbortSignal.timeout(30000) });
    if (!health.ok) throw Error('Non-destructive root smoke failed; preserve journal and stop for rollback decision');
    git('fetch', 'origin'); const latest = releaseRecord(plan.branch);
    if (latest?.record.releaseId !== journal.releaseId || latest.record.kind !== 'intent') throw Error('Release intent changed unexpectedly; do not overwrite it');
    const record = { schema: 'fika.release.v1', ...plan, ...verified, kind: options.record ? 'rollback' : 'deploy', previousGood: journal.before, releaseId: journal.releaseId, completedAt: new Date().toISOString(), smoke: { status: health.status, url: `https://${backend.uri}/` } };
    validateRecord(record, plan); const commit = appendRecord(plan, record, latest.commit);
    save(journalFile, { ...journal, state: 'completed', record, commit }); return { commit, record };
  });
}
