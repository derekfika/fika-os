import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { APPS, REPO, MAIN_CHECK, target, exactSha, assertClean, validateRecord, risk, assertResume, assertServingLineage, digest } from './policy.mjs';
import { git, command, ancestor, ref, ghApi, scopeHash, asyncLock, save, stateDir, jsonFile, serving, cloud, backendPath } from './runtime.mjs';
import { assertHostedContext } from './hosted.mjs';
import { recoverySnapshot, reconcileIntent } from './recovery.mjs';

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
export async function releaseHealthProbe(app, backendUri, sourceSha, fetchImpl = fetch) {
  const origin = `https://${String(backendUri).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  if (app !== 'menu') {
    const url = `${origin}/`;
    try {
      const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
      return { ok: response.ok, status: response.status, url };
    } catch {
      return { ok: false, status: null, url, reason: 'request_failed_or_redirected' };
    }
  }

  const url = `${origin}/api/build-info`;
  if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) return { ok: false, status: null, url, reason: 'invalid_expected_source_sha' };
  let response;
  try {
    response = await fetchImpl(url, { redirect: 'manual', cache: 'no-store', headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
  } catch {
    return { ok: false, status: null, url, reason: 'request_failed' };
  }
  if (response.status !== 200) return { ok: false, status: response.status, url, reason: response.status >= 300 && response.status < 400 ? 'unexpected_redirect' : 'unexpected_status' };
  let body;
  try { body = await response.json(); }
  catch { return { ok: false, status: response.status, url, reason: 'invalid_json' }; }
  if (body?.appId !== 'menu-planning') return { ok: false, status: response.status, url, reason: 'app_identity_mismatch', appId: body?.appId };
  if (!/^[a-f0-9]{40}$/.test(body?.buildSha || '')) return { ok: false, status: response.status, url, reason: 'missing_or_invalid_build_sha', appId: body.appId };
  if (body.buildSha !== sourceSha) return { ok: false, status: response.status, url, reason: 'source_sha_mismatch', appId: body.appId, buildSha: body.buildSha };
  return { ok: true, status: response.status, url, appId: body.appId, buildSha: body.buildSha };
}
export function authenticatedOperator(t, { env = process.env, github = ghApi } = {}) {
  const repo = github(`repos/${REPO}`); let identity;
  if (env.GITHUB_ACTIONS === 'true') identity = { ...assertHostedContext(env, t), method:'authorised-workflow-dispatch' };
  else {
    const user = github('user');
    if (!repo.permissions?.push || user.type !== 'User') throw Error('Release execution requires an authenticated repository writer');
    identity = { actor: user.login, method: 'authenticated-repository-writer' };
  }
  if (t.environment === 'prod' && identity.actor !== repo.owner?.login) throw Error('Production execution requires the authenticated solo owner');
  return identity;
}
export function executionAuthorization(t, sha, options = {}, access = {}) {
  exactSha(sha); const identity = authenticatedOperator(t, access);
  const action = options.action || 'deploy';
  if (!['deploy','rollback','reconcile:abandon','reconcile:complete'].includes(action)) throw Error('Unknown release action');
  if (t.environment === 'prod' && (options['owner-approved'] !== true || !options.reason?.trim() || options.reason.length > 1000)) throw Error('Explicit owner production authorisation required: agent records --owner-approved --reason <actual owner release instruction>; coding approval is not release approval');
  const instruction = options.reason?.trim() || 'Explicit staging execution';
  const binding = { app:t.app, environment:t.environment, sourceSha:sha, action, instruction, releaseId:options['release-id'] || null };
  return { ...identity, ...binding, id:digest(binding), method:t.environment === 'prod' ? 'owner-instruction' : identity.method, explicitExecute:true, authorisedAt:new Date().toISOString() };
}
export function productionDelta(from, to) {
  exactSha(from); exactSha(to);
  for (const sha of [from, to]) if (git('cat-file', '-t', sha) !== 'commit') throw Error('Complete production delta requires both exact commit objects');
  const paths = git('diff', '--no-renames', '--name-only', '-z', from, to).split('\0').filter(Boolean);
  return { from, to, paths, hash: digest({ from, to, paths }), risk: risk(paths) };
}
export function assertFastTrack(delta, lane, attestation = '') {
  if (!delta || !Array.isArray(delta.paths)) throw Error('Complete production delta is unavailable');
  if (lane !== 'fast') return;
  const uiOnly = delta.paths.every(p => p === 'CHANGELOG.md' || /\.md$/.test(p) || /^apps\/[^/]+\/app\/(?:ui\/.*\.tsx|page\.tsx|.*\.css)$/.test(p));
  if (risk(delta.paths) !== 'fast' && (!uiOnly || !attestation.split(/\r?\n/).includes('Risk: cosmetic-only'))) throw Error('Complete serving-to-candidate production delta requires Standard Track; backend/shared/operational changes cannot use Fast Track');
}
export function releaseLane(delta, cosmeticOnly = false, standard = false) {
  if (!delta || !Array.isArray(delta.paths)) throw Error('Complete production delta is unavailable');
  if (standard) return 'standard';
  if (risk(delta.paths) === 'fast') return 'fast';
  if (cosmeticOnly) { assertFastTrack(delta, 'fast', 'Risk: cosmetic-only'); return 'fast'; }
  return 'standard';
}
export function assertStagingEvidence(plan, staged, integrated) {
  validateRecord(staged?.record, { app:plan.app, environment:'staging' });
  if (staged.record.scopeHash !== plan.scopeHash || !integrated) throw Error('Operational production changes require a verified staging release of the same app/dependency tree, integrated into main');
  return staged.commit;
}
function bindProductionDelta(plan, before) {
  if (plan.environment !== 'prod' || plan.rollback) return;
  plan.productionDelta = productionDelta(before.sourceSha, plan.sourceSha);
  plan.lane = releaseLane(plan.productionDelta, plan.cosmeticOnly, plan.standard);
  if (plan.executing && plan.lane === 'standard') {
    const staged = plan.stagingEvidence ? { commit:plan.stagingEvidence, record:JSON.parse(git('show', `${plan.stagingEvidence}:release.json`)) } : releaseRecord(target(plan.app,'staging').branch);
    plan.stagingEvidence = assertStagingEvidence(plan, staged, Boolean(staged && ancestor(staged.record.sourceSha, 'origin/main')));
  }
}
function sourceProvenance(t, sha) {
  const pulls = ghApi(`repos/${REPO}/commits/${sha}/pulls?per_page=100`);
  const pr = pulls.find(p => p.head?.repo?.full_name === REPO && (p.head.sha === sha || (p.merged_at && ancestor(p.head.sha, sha) && scopeHash(t.app, p.head.sha) === scopeHash(t.app, sha))));
  if (!pr) throw Error('Source must have a repository PR with the same selected-app dependency tree');
  const paths = git('diff', '--name-only', `${pr.base.sha}...${pr.head.sha}`).split(/\r?\n/).filter(Boolean);
  return { number: pr.number, url: pr.html_url, head: pr.head.sha, pullRequestRisk: risk(paths) };
}
export function rollbackSelection(t, current, options = {}) {
  const requested = options.record || current.record.previousGoodRecord;
  if (requested) {
    const record = validateRecord(JSON.parse(git('show', `${exactSha(requested)}:release.json`)), t);
    return { record:requested, sha:options.sha || record.sourceSha };
  }
  // Compatibility with release records written before previousGoodRecord was stored.
  for (const commit of git('rev-list', '--first-parent', current.commit).split(/\r?\n/).slice(1)) {
    let record;
    try { record = JSON.parse(command('git', ['show', `${commit}:release.json`], {stdio:['ignore','pipe','pipe']})); } catch { break; }
    if (!['baseline','deploy','rollback'].includes(record.kind)) continue;
    validateRecord(record,t);
    if (record.sourceSha === current.record.previousGood?.sourceSha && record.rollout === current.record.previousGood?.rollout) return {record:commit,sha:options.sha || record.sourceSha};
  }
  throw Error('No earlier verified rollback target is recorded; preserve the current release and investigate rather than guessing a SHA');
}
export function planRelease(app, environment, supplied = {}) {
  const options = {...supplied};
  const t = target(app, environment); assertClean(git('status', '--porcelain')); git('fetch', 'origin');
  const current = releaseRecord(t.branch); if (!current) throw Error('Bootstrap the verified release baseline first');
  if (options.resume && current.record.kind === 'intent') { options.sha ||= current.record.sourceSha; options.record ||= current.record.rollbackRecord; }
  else if (options.rollback || options.record) Object.assign(options,rollbackSelection(t,current,options));
  const sha = exactSha(options.sha || git('rev-parse', environment === 'staging' ? 'HEAD' : 'origin/main'));
  const hash = scopeHash(app, sha);
  const result = { ...t, sourceSha: sha, scopeHash: hash, inMain: ancestor(sha, 'origin/main'), rollback: Boolean(options.record), executing:Boolean(options.execute), cosmeticOnly:Boolean(options['cosmetic-only']), standard:Boolean(options.standard) };
  if (environment === 'prod' && !result.inMain && !options.record) throw Error('Production source must already be integrated into origin/main');
  if (options.record) {
    exactSha(options.record); if (!ancestor(options.record, `origin/${t.branch}`)) throw Error('Rollback record is not in the selected release history');
    const old = validateRecord(JSON.parse(git('show', `${options.record}:release.json`)), t);
    if (old.sourceSha !== sha || old.scopeHash !== hash) throw Error('Rollback source does not match the verified historical record');
    result.rollbackRecord = options.record;
  }
  if (options.execute) {
    result.validation = result.rollback ? { verifiedHistoricalRecord: options.record } : successfulValidation(sha);
    if (options.resume) {
      result.resumeOperator = authenticatedOperator(t);
      const original = jsonFile(path.join(stateDir(), `release-${app}-${environment}.json`));
      // Resume never submits another rollout. Reuse the original bounded authorisation and staging proof.
      result.approval = original.plan.approval;
      result.cosmeticOnly = Boolean(original.plan.cosmeticOnly || original.plan.approval?.reason?.includes('Risk: cosmetic-only'));
      result.standard = Boolean(original.plan.standard); result.stagingEvidence = original.plan.stagingEvidence;
    } else {
      result.approval = executionAuthorization(t,sha,{...options,action:result.rollback ? 'rollback' : 'deploy'});
    }
    if (!result.rollback) result.provenance = sourceProvenance(t, sha);
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
      bindProductionDelta(plan, before);
      return { dryRun: true, plan, before, url: backend.uri, next: environment === 'prod'
        ? 'After explicit owner release authorisation, the agent adds --execute --owner-approved --reason <owner instruction>. SHA, lane and staging requirements are resolved internally; no rollout changed.'
        : 'After exact-source CI and PR validation, an authenticated repository writer may add --execute. No separate owner comment required; no rollout or release pointer changed.' };
    }
    let journal = existsSync(journalFile) ? jsonFile(journalFile) : undefined;
    const pointer = releaseRecord(plan.branch);
    if (pointer?.record.kind === 'intent') {
      if (!options.resume) throw Error('Pending distributed release intent: use --resume; never submit another rollout');
      assertResume(pointer.record, journal, plan);
      bindProductionDelta(plan, journal.before);
      if (digest(plan.productionDelta || null) !== digest(pointer.record.productionDelta || null) || digest(plan.productionDelta || null) !== digest(journal.plan.productionDelta || null)) throw Error('Resume production delta differs from original intent');
    } else {
      if (options.resume) throw Error('No matching pending release to resume');
      const abandoned = pointer.record.kind === 'abandoned';
      if (abandoned) {
        if (!pointer.record.smoke?.ok && !plan.rollback) throw Error('Abandoned unhealthy release requires an explicit verified rollback');
        const good = validateRecord(JSON.parse(git('show', `${exactSha(pointer.record.previousGoodRecord)}:release.json`)), plan);
        if (good.sourceSha !== pointer.record.previousGood?.sourceSha || good.rollout !== pointer.record.previousGood?.rollout) throw Error('Abandoned release rollback evidence differs');
      } else validateRecord(pointer.record, plan);
      const before = await serving(plan);
      if (pointer.record.sourceSha !== before.sourceSha) throw Error('Live serving source differs from release ledger; reconcile the external release before proceeding');
      assertServingLineage(plan, before, ancestor(before.sourceSha, plan.sourceSha), scopeHash(app,before.sourceSha) === plan.scopeHash);
      bindProductionDelta(plan, before);
      if (before.sourceSha === plan.sourceSha) {
        const health = await releaseHealthProbe(app, backend.uri, before.sourceSha);
        if (!health.ok || digest(before) !== digest(await serving(plan))) throw Error('Cannot verify already-serving release while health/traffic is unstable');
        if (!abandoned) return { alreadyServing: true, before, smoke: health };
        const record = { schema:'fika.release.v1', ...plan, ...before, kind: plan.rollback ? 'rollback' : 'deploy', previousGood:pointer.record.previousGood,
          previousGoodRecord:pointer.record.previousGoodRecord, releaseId:randomUUID(), reverifiedServing:true, completedAt:new Date().toISOString(), smoke:health };
        validateRecord(record, plan); const commit = appendRecord(plan, record, pointer.commit); return { alreadyServing:true, commit, record };
      }
      journal = { releaseId: randomUUID(), plan, before: abandoned ? pointer.record.previousGood : before, observedBefore: before,
        previousGoodRecord: abandoned ? pointer.record.previousGoodRecord : pointer.commit, state: 'pending', createdAt: new Date().toISOString() };
      save(journalFile, journal);
      journal.intentCommit = appendRecord(plan, { schema: 'fika.release.v1', ...plan, kind: 'intent', state: 'PENDING', releaseId: journal.releaseId,
        previousGood: journal.before, previousGoodRecord: journal.previousGoodRecord, createdAt: journal.createdAt }, pointer.commit);
      save(journalFile, journal);
      // Exactly one selected backend; no branch-based or project-wide deployment command.
      journal.submissionStartedAt = new Date().toISOString(); save(journalFile, journal);
      try { command('firebase', rolloutArguments(plan), { stdio: ['ignore', 'inherit', 'inherit'] }); }
      catch { throw Error(`Rollout submission/completion uncertain. Journal ${journalFile}; use --resume, NEVER blindly resubmit.`); }
      finally { journal.submissionFinishedAt = new Date().toISOString(); save(journalFile, journal); }
    }
    let verified; const deadline = Date.now() + Number(options['timeout-ms'] || 1200000);
    while (Date.now() < deadline) {
      try { const s = await serving(plan); if (s.sourceSha === plan.sourceSha) { verified = s; break; } } catch { /* transient rollout state, no resubmission */ }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    if (!verified) throw Error(`Serving verification incomplete; retain pending intent and ${journalFile}. Resume without duplicate submission.`);
    const health = await releaseHealthProbe(app, backend.uri, verified.sourceSha);
    if (!health.ok) throw Error(`Non-destructive release health probe failed (${health.reason || health.status}); preserve journal and stop for rollback decision`);
    git('fetch', 'origin'); const latest = releaseRecord(plan.branch);
    if (latest?.record.releaseId !== journal.releaseId || latest.record.kind !== 'intent') throw Error('Release intent changed unexpectedly; do not overwrite it');
    const record = { schema: 'fika.release.v1', ...plan, ...verified, kind: plan.rollback ? 'rollback' : 'deploy', previousGood: journal.before, previousGoodRecord:journal.previousGoodRecord, releaseId: journal.releaseId, completedAt: new Date().toISOString(), smoke: health };
    validateRecord(record, plan); const commit = appendRecord(plan, record, latest.commit);
    save(journalFile, { ...journal, state: 'completed', record, commit }); return { commit, record };
  });
}

export async function reconcile(app, environment, options) {
  return asyncLock(`release-${app}-${environment}`, async () => {
    const t = target(app, environment); assertClean(git('status', '--porcelain')); git('fetch', 'origin');
    const pointer = releaseRecord(t.branch);
    if (pointer?.record.kind !== 'intent' || (options['release-id'] && pointer.record.releaseId !== options['release-id'])) throw Error('No matching pending release intent');
    const journalFile = path.join(stateDir(), `release-${app}-${environment}.json`);
    const journal = jsonFile(journalFile);
    const snapshot = await recoverySnapshot(t);
    // Dry-run returns only selected, non-secret evidence and never changes ledger/journal.
    if (!options.execute) return { dryRun: true, releaseId: pointer.record.releaseId, snapshot, next: 'Agent verifies the terminal attempt before --resolution abandon|complete --rollout <ID> --reason <instruction> --execute. Production additionally needs explicit --owner-approved; no approval comment.' };
    const operator = executionAuthorization(t,pointer.record.sourceSha,{...options,action:`reconcile:${options.resolution}`,'release-id':pointer.record.releaseId});
    const previousGoodRecord = exactSha(journal.previousGoodRecord);
    const good = validateRecord(JSON.parse(git('show', `${previousGoodRecord}:release.json`)), t);
    if (good.sourceSha !== journal.before?.sourceSha || good.rollout !== journal.before?.rollout || !ancestor(previousGoodRecord, pointer.commit)) throw Error('Original known-good rollback evidence is invalid');
    const backend = await cloud(backendPath(t));
    return reconcileIntent({ pointer, journal, t, operator, rolloutId: options.rollout, resolution: options.resolution, reason: options.reason }, {
      inspect: () => recoverySnapshot(t),
      smoke: sourceSha => releaseHealthProbe(app, backend.uri, sourceSha),
      scopeHash: sha => scopeHash(app, sha),
      latest: () => { git('fetch', 'origin'); return releaseRecord(t.branch); },
      archive: original => {
        const archive = path.join(stateDir(), 'archives', `release-${digest(original.releaseId)}.json`);
        if (existsSync(archive) && digest(jsonFile(archive)) !== digest(original)) throw Error('Recovery journal archive differs; preserve both and investigate');
        if (!existsSync(archive)) save(archive, original);
      },
      append: (record, expected) => appendRecord(t, record, expected),
      finish: record => save(journalFile, record),
    });
  });
}
