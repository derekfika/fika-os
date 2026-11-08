import path from 'node:path';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { APPS, REPO, MAIN_CHECK, target, exactSha, assertClean, validateRecord, assertResume, assertServingLineage, digest } from './policy.mjs';
import { git, command, ancestor, ref, ghApi, scopeHash, asyncLock, save, stateDir, jsonFile, serving, cloud, backendPath } from './runtime.mjs';
import { assertHostedContext } from './hosted.mjs';
import { discover } from './discovery.mjs';
import { releaseBackend, verifiedReleaseServing, releasePrestate } from './release-prestate.mjs';
import { recoverySnapshot, isDomainOperationTarget, isReleaseRelevantOperation, reconcileIntent, resubmitNeverSubmitted, submissionAttempts, describeSubmissionEvidence } from './recovery.mjs';
import { readCreateAuditEvents } from './audit.mjs';
import { assertCpuAdoptionTarget, observeCpuAdoption, adoptCompletedCpu } from './cpu-prod-adoption.mjs';

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

/** Read-only, backend-specific proof for an explicitly allowed empty first target. No missing
 * serving revision is interpreted as empty unless Firebase independently proves
 * backend identity, disabled automatic rollouts, zero traffic and no live ops. */
const allowedEmptyFirstTarget = t => (t.app === 'adhoc' && t.environment === 'prod') || (t.app === 'beverage' && t.environment === 'staging');
export async function inspectEmptyFirstReleaseState(t, read = cloud, { allowFailedHistory = false } = {}) {
  if (!allowedEmptyFirstTarget(t)) throw Error('First-release state inspection is restricted to Ad-Hoc production or Beverage staging');
  const base = backendPath(t);
  const [backend, traffic, builds, rollouts, operations] = await Promise.all([
    read(base), read(`${base}/traffic`),
    discover(`${base}/builds`, 'builds', b=>({name:b.name,state:b.state,reconciling:Boolean(b.reconciling),sourceSha:b.source?.codebase?.hash||b.source?.codebase?.commit||null}), read),
    discover(`${base}/rollouts`, 'rollouts', r=>({name:r.name,state:r.state,reconciling:Boolean(r.reconciling),build:r.build}), read),
    discover(`projects/${t.project}/locations/${t.region}/operations`, 'operations', o=>({name:o.name,done:o.done===true,target:o.metadata?.target||o.response?.name||''}), read),
  ]);
  const current=traffic.current?.splits||[], targetTraffic=traffic.target?.splits||[];
  const active=operations.filter(o=>isReleaseRelevantOperation(t,o));
  const domainOperations=operations.filter(o=>!o.done&&isDomainOperationTarget(t,o.target));
  const repo=String(backend.codebase?.repository||'');
  const expectedEnvironment=t.environment==='prod'?'production':'staging';
  if (backend.name!==base || backend.reconciling!==false || backend.environment!==expectedEnvironment || ![`/${APPS[t.app].path}`,APPS[t.app].path].includes(backend.codebase?.rootDirectory) || !repo.endsWith('/gitRepositoryLinks/derekfika-fika-os')) throw Error('First-release backend identity, environment, repository or root is not verified');
  if (traffic.rolloutPolicy?.disabled!==true || traffic.reconciling || targetTraffic.length || active.length) throw Error('First-release traffic is unstable or automatic rollouts are enabled');
  const retry=allowFailedHistory && typeof allowFailedHistory==='object' ? allowFailedHistory : null;
  const unhealthyServingRetry=Boolean(retry?.kind==='abandoned' && retry.recovery?.firstRelease===true && retry.recovery?.resolution==='abandon' && retry.smoke?.ok===false && retry.state==='SUCCEEDED' && retry.percent===100 && retry.previousGood==null && retry.previousGoodRecord==null && retry.firstReleaseBaselineRecord && retry.recovery?.rollout===retry.rollout && retry.rollout);
  if(unhealthyServingRetry){
    const id=name=>String(name||'').split('/').at(-1);
    const build=builds.length===1?builds[0]:null, rollout=rollouts.length===1?rollouts[0]:null;
    if(current.length!==1 || current[0].percent!==100 || id(current[0].build)!==id(build?.name) || id(retry.rollout)!==id(rollout?.name) || id(rollout?.build)!==id(build?.name) || rollout?.state!=='SUCCEEDED' || rollout?.reconciling || build?.state!=='READY' || build?.reconciling || build?.sourceSha!==retry.sourceSha) throw Error('First-release retry does not match the exact recorded unhealthy serving attempt');
    return {sourceSha:null,rollout:null,state:'EMPTY',percent:0,backend:base,builds,rollouts,operations:active,domainOperations,traffic:{current,target:targetTraffic,reconciling:Boolean(traffic.reconciling),autoDisabled:true},unhealthyFirstRelease:{sourceSha:retry.sourceSha,rollout:retry.rollout,baselineRecord:retry.firstReleaseBaselineRecord,smoke:retry.smoke}};
  }
  if(current.length) throw Error('First-release retry has unexpected serving traffic');
  if (allowFailedHistory) {
    if (builds.some(b=>!['FAILED','CANCELLED','DELETED'].includes(b.state)||b.reconciling) || rollouts.some(r=>!['FAILED','CANCELLED'].includes(r.state)||r.reconciling)) throw Error('First-release retry is blocked by a successful, active or unknown build/rollout');
  } else if (builds.length || rollouts.length) throw Error('Target has deployment history; the first-release empty baseline cannot be created');
  return { sourceSha:null, rollout:null, state:'EMPTY', percent:0, backend:base, builds, rollouts, operations:active, domainOperations, traffic:{current,target:targetTraffic,reconciling:Boolean(traffic.reconciling),autoDisabled:true} };
}
export async function stableFirstReleaseState(t, read=cloud, options={}) {
  const first=await inspectEmptyFirstReleaseState(t,read,options),second=await inspectEmptyFirstReleaseState(t,read,options);
  if(digest(first)!==digest(second))throw Error('First-release prestate changed between independent snapshots');
  return first;
}
export const inspectAdhocProductionState=inspectEmptyFirstReleaseState;
export const stableAdhocProductionState=stableFirstReleaseState;
export function emptyFirstReleaseBaselineRecord(t, current, observedAt = new Date().toISOString()) {
  if (!allowedEmptyFirstTarget(t)) throw Error('Empty first-release baselines are restricted to Ad-Hoc production or Beverage staging');
  return {schema:'fika.release.v1',...t,...current,backend:t.backend,kind:'empty-baseline',scopeHash:digest({app:t.app,project:t.project,backend:t.backend,root:APPS[t.app].path,state:'EMPTY'}),observedAt,recovery:{firstRelease:true,noPreviousRelease:true}};
}
export const adhocEmptyBaselineRecord=emptyFirstReleaseBaselineRecord;
export async function bootstrap(t, options = {}) {
  const existing = releaseRecord(t.branch);
  if (existing) { validateRecord(existing.record, t); return { status: 'existing', ...existing }; }
  if (allowedEmptyFirstTarget(t)) {
    const current=await stableFirstReleaseState(t);
    const record=emptyFirstReleaseBaselineRecord(t,current);
    if (!options.execute) return {status:'dry-run-empty-first-release',record};
    const commit=appendRecord(t,record,git('rev-parse','origin/main'));git('branch',t.branch,commit);return {status:'created-empty-first-release',commit,record};
  }
  const current = await serving(t);
  if (!ref(current.sourceSha)) git('fetch', 'origin', current.sourceSha);
  const historicalException = !ancestor(current.sourceSha, 'origin/main');
  const record = { schema: 'fika.release.v1', ...t, ...current, kind: 'baseline', scopeHash: scopeHash(t.app, current.sourceSha), observedAt: new Date().toISOString(), historicalException, reconciliation: historicalException ? 'Existing deployed source not integrated into main; preserve, reconcile by reviewed PR before any new production promotion' : undefined };
  if (!options.execute) return { status: 'dry-run', record };
  const commit = appendRecord(t, record); git('branch', t.branch, commit); return { status: 'created', commit, record };
}
export function successfulValidation(sha, github = ghApi) {
  const checks = github(`repos/${REPO}/commits/${sha}/check-runs?per_page=100`).check_runs || [];
  const check = checks.find(c => c.name === MAIN_CHECK && c.head_sha === sha && c.app?.slug === 'github-actions' && c.conclusion === 'success');
  if (!check) throw Error(`Required GitHub Actions check ${MAIN_CHECK} has not passed for exact source ${sha}`);
  return { id: check.id, url: check.html_url, sha };
}
export function rolloutArguments(plan) {
  const t = target(plan.app, plan.environment);
  if (plan.backend !== t.backend || plan.project !== t.project) throw Error('Rollout target differs from governed mapping');
  // --force skips Firebase's interactive confirmation only, after our exact-source and target verification.
  return ['apphosting:rollouts:create', t.backend, '--project', t.project, '--git-commit', exactSha(plan.sourceSha), '--non-interactive', '--force'];
}
export async function releaseHealthProbe(app, backendUri, sourceSha, fetchImpl = fetch, environment) {
  const origin = `https://${String(backendUri).replace(/^https?:\/\//, '').replace(/\/$/, '')}`;
  if (app === 'beverage') {
    const infoUrl = `${origin}/api/build-info`, url = `${origin}/`;
    if (!/^[a-f0-9]{40}$/.test(sourceSha || '')) return { ok: false, status: null, url: infoUrl, reason: 'invalid_expected_source_sha' };
    try {
      const options = { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000) };
      const info = await fetchImpl(infoUrl, { ...options, headers: { accept: 'application/json' } });
      if (info.status !== 200) return { ok: false, status: info.status, url: infoUrl, reason: 'unexpected_build_info_status' };
      const body = await info.json();
      if (body?.appId !== 'beverage-innovation' || body?.buildSha !== sourceSha || body?.previewOnly !== true) return { ok: false, status: info.status, url: infoUrl, reason: 'beverage_build_identity_mismatch', appId: body?.appId, buildSha: body?.buildSha };
      const entry = await fetchImpl(url, options);
      const location = entry.headers?.get?.('location');
      if (entry.status !== 307 || !location) return { ok: false, status: entry.status, url, reason: 'beverage_preview_auth_gate_missing' };
      const target = new URL(location, origin);
      const keys = [...target.searchParams.keys()].sort();
      const valid = target.protocol === 'https:' && target.origin === 'https://staging-os.fikacatering.com' && target.pathname === '/' &&
        target.username === '' && target.password === '' && target.hash === '' &&
        JSON.stringify(keys) === JSON.stringify(['appId', 'launchError']) &&
        target.searchParams.get('appId') === 'beverage-innovation' && target.searchParams.get('launchError') === 'FIKA_SESSION_MISSING' &&
        target.searchParams.size === 2;
      return { ok: valid, status: entry.status, url, buildInfoStatus: info.status, buildSha: body.buildSha, authGate: valid ? 'FIKA_SESSION_MISSING' : undefined, ...(valid ? {} : { reason: 'beverage_preview_auth_redirect_mismatch' }) };
    } catch { return { ok: false, status: null, url, reason: 'request_failed' }; }
  }
  if(app==='adhoc'){
    const options={redirect:'manual',cache:'no-store',signal:AbortSignal.timeout(30000)};
    try{
      const entry=await fetchImpl(`${origin}/`,options);
      if(entry.status!==200)return {ok:false,status:entry.status,url:`${origin}/`,reason:'adhoc_entry_unavailable_or_redirected'};
      const auth=await fetchImpl(`${origin}/api/me`,options);
      const ok=[401,403].includes(auth.status)&&!auth.headers?.get?.('location');
      return {ok,status:auth.status,url:`${origin}/api/me`,entryStatus:entry.status,authGate:ok?'unauthenticated_request_denied':undefined,...(ok?{}:{reason:'adhoc_auth_gate_not_fail_closed'})};
    }catch{return {ok:false,status:null,url:`${origin}/`,reason:'request_failed'};}
  }
  if (app === 'hospitality') {
    const url = `${origin}/`;
    try {
      const options = { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000) };
      const response = await fetchImpl(url, options);
      if (response.status !== 307 || response.headers?.get?.('location') !== '/workspace') return { ok: false, status: response.status, url, reason: 'unexpected_hospitality_entry_redirect' };
      const workspace = await fetchImpl(`${origin}/workspace`, { ...options, signal: AbortSignal.timeout(30000) });
      return { ok: workspace.status === 200, status: workspace.status, url, entryRedirect: '/workspace', ...(workspace.status === 200 ? {} : { reason: 'hospitality_workspace_unavailable' }) };
    } catch {
      return { ok: false, status: null, url, reason: 'request_failed' };
    }
  }
  if (app === 'logistics' && (environment === 'staging' || environment === 'prod')) {
    const url = `${origin}/`;
    try {
      const response = await fetchImpl(url, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      const location = response.headers?.get?.('location');
      if (response.status !== 307 || !location) return { ok: false, status: response.status, url, reason: 'unexpected_logistics_auth_response' };
      const target = new URL(location, origin);
      const keys = [...target.searchParams.keys()].sort();
      const expectedHubOrigin = environment === 'prod' ? 'https://os.fikacatering.com' : 'https://staging-os.fikacatering.com';
      const valid = target.protocol === 'https:' && target.origin === expectedHubOrigin && target.pathname === '/' &&
        target.username === '' && target.password === '' && target.hash === '' &&
        JSON.stringify(keys) === JSON.stringify(['appId', 'launchError', 'returnTo']) &&
        target.searchParams.get('appId') === 'logistics' && target.searchParams.get('launchError') === 'FIKA_SESSION_MISSING' &&
        target.searchParams.get('returnTo') === url;
      return { ok: valid, status: response.status, url, ...(valid ? { authGate: 'FIKA_SESSION_MISSING' } : { reason: 'unexpected_logistics_auth_redirect' }) };
    } catch {
      return { ok: false, status: null, url, reason: 'request_failed' };
    }
  }
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
  if (env.GITHUB_ACTIONS === 'true') return { ...assertHostedContext(env, t), method: 'authorised-workflow-dispatch' };
  const repo = github(`repos/${REPO}`);
  const user = github('user');
  if (!repo.permissions?.push || user.type !== 'User' || !user.login) throw Error('Release execution requires an authenticated repository writer');
  return { actor: user.login, method: 'authenticated-repository-writer' };
}
export function executionEvidence(t, sha, options = {}, access = {}) {
  exactSha(sha);
  const identity = authenticatedOperator(t, access);
  const action = options.action || 'deploy';
  const instruction = options.reason?.trim() || `Execute ${action}`;
  const binding = { app:t.app, environment:t.environment, sourceSha:sha, action, instruction, releaseId:options['release-id'] || null };
  return { ...identity, ...binding, id:digest(binding), explicitExecute:true, authorisedAt:new Date().toISOString() };
}

/** Validate authoritative, read-only App Hosting evidence before adopting an unledgered staging or production baseline. */
function assertServingBaselineTarget(t) {
  const staging = t.environment === 'staging' && t.project === 'fika-os-dev' && t.backend === APPS[t.app]?.staging;
  const production = t.environment === 'prod' && t.project === 'fika-os' && t.backend === APPS[t.app]?.prod;
  if (!['hub','menu'].includes(t.app) || (!staging && !production) || t.region !== 'europe-west4') throw Error('Serving baseline reconciliation is restricted to the governed Hub or Menu staging/production backend');
}
export function validateServingBaselineSnapshot(t, snapshot, expectedSha, expectedRollout) {
  exactSha(expectedSha);
  const backendName = backendPath(t);
  const b = snapshot?.backend, traffic = snapshot?.traffic, build = snapshot?.build, rollout = snapshot?.rollout;
  assertServingBaselineTarget(t);
  if (!/^[\w-]+$/.test(expectedRollout || '')) throw Error('An exact rollout identifier is required');
  const expectedEnvironment = t.environment === 'prod' ? 'production' : 'staging';
  if (b?.name !== backendName || b.environment !== expectedEnvironment || b.reconciling !== false || b.uri !== `${t.backend}--${t.project}.${t.region}.hosted.app`) throw Error('Firebase backend identity or health is not verified');
  if (!String(b.codebase?.repository || '').endsWith('/gitRepositoryLinks/derekfika-fika-os') || ![APPS[t.app].path,`/${APPS[t.app].path}`].includes(b.codebase?.rootDirectory)) throw Error('Firebase backend source repository/root does not match the selected FIKA application');
  const buildId = String(rollout?.build || '').split('/').at(-1);
  if (!/^[\w-]+$/.test(buildId || '')) throw Error('Rollout build identity is invalid');
  const expectedBuild = `${backendName}/builds/${buildId}`;
  const trafficBuild = traffic?.current?.splits?.[0]?.build;
  const expectedTrafficSuffix = `/locations/${t.region}/backends/${t.backend}/builds/${buildId}`;
  if (traffic?.rolloutPolicy?.disabled !== true || traffic.reconciling !== false || traffic.current?.splits?.length !== 1 || traffic.current.splits[0].percent !== 100 || !new RegExp(`^projects/[0-9]+${expectedTrafficSuffix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`).test(trafficBuild || '')) throw Error('Firebase traffic is not stable at the expected single 100% serving build');
  if (build?.name !== expectedBuild || build.state !== 'READY' || build.reconciling !== false || build.source?.codebase?.hash !== expectedSha || build.source?.codebase?.commit !== expectedSha || build.source?.codebase?.uri !== `https://github.com/${REPO}/commit/${expectedSha}`) throw Error('Firebase build source or READY state differs from the exact expected source');
  if (rollout?.name !== `${backendName}/rollouts/${expectedRollout}` || rollout.state !== 'SUCCEEDED' || rollout.reconciling !== false || rollout.build !== expectedBuild) throw Error('Firebase rollout is not the expected successful staging rollout');
  return { sourceSha: expectedSha, rollout: expectedRollout, state: 'SUCCEEDED', percent: 100 };
}

export async function observeServingBaseline(t, sha, rolloutId, read = cloud) {
  assertServingBaselineTarget(t);
  if (!/^[\w-]+$/.test(rolloutId || '')) throw Error('Pin the exact observed rollout with --rollout');
  const base = backendPath(t);
  const [backend, traffic, rollout] = await Promise.all([read(base), read(`${base}/traffic`), read(`${base}/rollouts/${rolloutId}`)]);
  const buildId = String(rollout?.build || '').slice(`${base}/builds/`.length);
  if (rollout?.build !== `${base}/builds/${buildId}` || !/^[\w-]+$/.test(buildId)) throw Error('Observed rollout build is outside the selected backend');
  const build = await read(`${base}/builds/${buildId}`);
  const snapshot = { backend, traffic, build, rollout };
  return { snapshot, serving:validateServingBaselineSnapshot(t, snapshot, sha, rolloutId) };
}

export function servingBaselineRecord(t, { snapshot, expectedSha, expectedRollout, previous, previousCommit, authorization, observedAt, health, scopeHashValue, validation }) {
  const servingState = validateServingBaselineSnapshot(t, snapshot, expectedSha, expectedRollout);
  if (!previous || !previousCommit || previous.record?.sourceSha === expectedSha || previous.record?.kind === 'intent') throw Error('A valid prior ledger baseline is required; pending intent cannot be reconciled');
  validateRecord(previous.record, t);
  if (!authorization?.explicitExecute || authorization.action !== 'reconcile:serving-baseline' || authorization.sourceSha !== expectedSha || authorization.releaseId !== previousCommit || !authorization.actor || !authorization.instruction || !authorization.authorisedAt) throw Error('Explicit authenticated authorization is required for this exact reconciliation');
  if (!health?.ok || health.status !== 200) throw Error(`Healthy ${t.environment === 'prod' ? 'production' : 'staging'} serving probe is required before adopting a baseline`);
  if (t.app === 'menu' && (health.appId !== 'menu-planning' || health.buildSha !== expectedSha)) throw Error('Menu staging health does not prove the exact expected build identity');
  if (!observedAt || !Number.isFinite(Date.parse(observedAt))) throw Error('Actual UTC observation timestamp is required');
  return { schema:'fika.release.v1', ...t, ...servingState, kind:'baseline', scopeHash:scopeHashValue || scopeHash(t.app, expectedSha), observedAt,
    previousGood:{ sourceSha:previous.record.sourceSha, rollout:previous.record.rollout, state:previous.record.state, percent:previous.record.percent },
    previousGoodRecord:previousCommit, reconciliation:{ type:'forward-serving-baseline-adoption', authorizedAt:authorization.authorisedAt, actor:authorization.actor, method:authorization.method,
      authorization:authorization.instruction, priorLedgerCommit:previousCommit, verifiedAt:observedAt, backend:t.backend, project:t.project, build:snapshot.build.name.split('/').at(-1), rollout:expectedRollout,
      evidence:{ backend:snapshot.backend.name, repository:snapshot.backend.codebase.repository, rootDirectory:snapshot.backend.codebase.rootDirectory,
        buildState:snapshot.build.state, rolloutState:snapshot.rollout.state, trafficPercent:100, trafficBuild:snapshot.traffic.current.splits[0].build, healthStatus:health.status },
      historicalGovernance:t.environment === 'prod' ? 'Historical production deployment authorization is not established by this reconciliation; this record only adopts the currently verified serving baseline.' : t.app === 'hub' ? 'Not established for historical rollouts 002/003; this record is prospective and does not assert prior authorization.' : 'Not established for historical external releases; this record is prospective and does not assert prior authorization.',
      ...(validation ? { exactSourceValidation: validation } : {}),
      excludedRollbackCandidates:t.app === 'hub' ? ['build-2026-10-24-002'] : [] } };
}

async function reconcileVerifiedServingBaseline(app, environment, options, access = {}) {
  assertServingBaselineTarget(target(app, environment));
  return asyncLock(`release-${app}-${environment}`, async () => {
    const t = target(app, environment); assertClean(git('status', '--porcelain')); git('fetch', 'origin');
    const prior = releaseRecord(t.branch); if (!prior || prior.record.kind === 'intent') throw Error('A non-pending prior release ledger record is required');
    validateRecord(prior.record, t);
    const sha = exactSha(options.sha); const rolloutId = options.rollout;
    if (!rolloutId) throw Error('Pin the exact observed rollout with --rollout');
    if (environment === 'prod' && !ancestor(sha, 'origin/main')) throw Error('Production serving source must already be integrated into origin/main before baseline reconciliation');
    const validation = environment === 'prod' ? successfulValidation(sha) : undefined;
    const observe = () => observeServingBaseline(t, sha, rolloutId);
    const first = await observe(), second = await observe();
    if (digest(first.snapshot) !== digest(second.snapshot)) throw Error('Firebase serving evidence changed between the two required snapshots');
    const health = await releaseHealthProbe(app, first.snapshot.backend.uri, sha, fetch, environment);
    if (!health.ok || health.status !== 200) throw Error(`${environment === 'prod' ? 'Production' : 'Staging'} serving health probe did not return HTTP 200`);
    if (!options.execute) return { dryRun:true, sourceSha:sha, rollout:rolloutId, priorLedgerCommit:prior.commit, snapshotsStable:true, health, ...(validation ? { validation } : {}) };
    const authorization = executionEvidence(t, sha, { ...options, action:'reconcile:serving-baseline', 'release-id':prior.commit }, access);
    const observedAt = new Date().toISOString();
    git('fetch', 'origin'); const latest = releaseRecord(t.branch);
    if (latest?.commit !== prior.commit) throw Error('Release ledger changed during reconciliation; retry from the new pointer');
    const record = servingBaselineRecord(t, { snapshot:second.snapshot, expectedSha:sha, expectedRollout:rolloutId, previous:prior, previousCommit:prior.commit, authorization, observedAt, health, validation });
    const commit = appendRecord(t, record, prior.commit);
    const written = releaseRecord(t.branch);
    if (written?.commit !== commit || written.record.reconciliation?.priorLedgerCommit !== prior.commit || written.record.sourceSha !== sha) throw Error('Reconciliation ledger readback did not match the appended record; preserve evidence and stop');
    return { status:'reconciled', commit, record, snapshotsStable:true, health };
  });
}
export async function reconcileServingBaseline(app, environment, options, access = {}) {
  if (environment !== 'staging') throw Error('The existing serving-baseline command is restricted to staging');
  return reconcileVerifiedServingBaseline(app, environment, options, access);
}
export async function reconcileProductionServingBaseline(app, environment, options, access = {}) {
  if (environment !== 'prod') throw Error('Production serving-baseline reconciliation requires the production target');
  return reconcileVerifiedServingBaseline(app, environment, options, access);
}
export function productionDelta(from, to) {
  exactSha(from); exactSha(to);
  for (const sha of [from, to]) if (git('cat-file', '-t', sha) !== 'commit') throw Error('Complete production delta requires both exact commit objects');
  const paths = git('diff', '--no-renames', '--name-only', '-z', from, to).split('\0').filter(Boolean);
  return { from, to, paths, hash: digest({ from, to, paths }) };
}

function mergedSource(sha, github, { historicalRollback = false } = {}) {
  if (!ancestor(sha, 'origin/main')) throw Error('Release source must already be integrated into origin/main');
  const pulls = github(`repos/${REPO}/commits/${sha}/pulls?per_page=100`);
  // Historical releases sometimes pinned the PR head before integration. A verified rollback can
  // reuse that exact green head once it is an ancestor of main and its own PR is merged.
  const pr = pulls.find(p => p.merged_at && p.base?.ref === 'main' && p.base?.repo?.full_name === REPO &&
    (p.merge_commit_sha === sha || (historicalRollback && p.head?.sha === sha)));
  if (!pr) throw Error('Exact release source must be the result of a merged PR into the protected main branch');
  return { validation: successfulValidation(sha, github), provenance: { number: pr.number, url: pr.html_url, head: pr.head.sha } };
}

export function rollbackSelection(t, current, options = {}, before) {
  if (!current) throw Error('No verified release history for rollback');
  const { record } = current;
  const isPrevious = ['baseline', 'deploy', 'rollback'].includes(record.kind) && record.sourceSha !== before?.sourceSha;
  const requested = options.record || (before && isPrevious ? current.commit : record.previousGoodRecord);
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
function firebaseCliErrorDetails(error) {
  const output = [error?.stderr, error?.stdout]
    .map(value => Buffer.isBuffer(value) ? value.toString('utf8') : String(value || ''))
    .find(value => value.trim());
  let details = output || error?.message || String(error || 'Unknown Firebase CLI error');
  details = details
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, 'Bearer [redacted]')
    .replace(/(["']?\b(?:access_token|refresh_token|id_token|subject_token|client_secret)\b["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1[redacted]')
    .replace(/\bya29\.[A-Za-z0-9._-]+/g, '[redacted]')
    .replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, '[redacted JWT]')
    .replace(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, '[redacted private key]')
    .trim();
  return (details || 'Unknown Firebase CLI error').slice(0, 1200);
}

/** Fails before any release state is written and preserves sanitized Firebase CLI diagnostics. */
export function firebaseAuthPreflight(t, run = command) {
  let listing;
  try { listing = JSON.parse(run('firebase', ['apphosting:backends:list', '--project', t.project, '--json'])); }
  catch (error) { throw Error(`Firebase CLI preflight failed for ${t.project}: ${firebaseCliErrorDetails(error)}. No release state was written.`); }
  if (!Array.isArray(listing?.result) || !listing.result.some(backend => backend.name === backendPath(t))) throw Error(`Firebase CLI cannot see backend ${t.backend} in ${t.project}; no release state was written.`);
}
/** Cloud Audit Log evidence of App Hosting create calls for this backend since a time. Unreadable logs are reported, never assumed empty. */
export function auditCreateEvents(t, sinceMs, run = command) {
  if (run === command) return readCreateAuditEvents(t, sinceMs);
  try {
    const filter = `protoPayload.serviceName="firebaseapphosting.googleapis.com" AND protoPayload.methodName=~"(CreateRollout|CreateBuild)" AND timestamp>="${new Date(sinceMs).toISOString()}"`;
    const rows = JSON.parse(run('gcloud', ['logging', 'read', filter, '--project', t.project, '--limit', '50', '--format', 'json']) || '[]');
    return { readable: Array.isArray(rows), events: (Array.isArray(rows) ? rows : []).filter(row => String(row.protoPayload?.resourceName || '').includes(`/backends/${t.backend}`)).map(row => ({ at: row.timestamp, method: row.protoPayload?.methodName })) };
  } catch { return { readable: false, events: [] }; }
}
function planRelease(t, options, pointer, before, access) {
  const rollback = options.rollback || Boolean(options.record);
  const selected = rollback ? rollbackSelection(t, pointer, options, before) : options;
  const sourceSha = exactSha(selected.sha || git('rev-parse', 'origin/main'));
  const source = mergedSource(sourceSha, access.github, { historicalRollback:rollback });
  const plan = { ...t, ...source, sourceSha, scopeHash: scopeHash(t.app, sourceSha), rollback };
  if (rollback) {
    const record = exactSha(selected.record);
    if (!ancestor(record, pointer.commit)) throw Error('Rollback record is not in the selected release history');
    const old = validateRecord(JSON.parse(git('show', `${record}:release.json`)), t);
    if (old.sourceSha !== sourceSha || old.scopeHash !== plan.scopeHash || old.smoke?.ok === false) throw Error('Rollback source does not match the verified historical record');
    plan.rollbackRecord = record;
  }
  if (before.sourceSha) {
    assertServingLineage(plan, before, ancestor(before.sourceSha, sourceSha), scopeHash(t.app, before.sourceSha) === plan.scopeHash);
    if (t.environment === 'prod') plan.productionDelta = productionDelta(before.sourceSha, sourceSha);
  }
  // Retain the historical field name so journals and ledgers remain readable across CLI versions.
  if (options.execute) plan.approval = executionEvidence(t, sourceSha, { ...options, action: rollback ? 'rollback' : 'deploy' }, access);
  return plan;
}

function matchesServing(record, before) {
  return record?.sourceSha === before.sourceSha && record?.rollout === before.rollout;
}

function archiveJournal(journal) {
  const archive = path.join(stateDir(), 'archives', `release-${digest(journal.releaseId)}.json`);
  if (existsSync(archive) && digest(jsonFile(archive)) !== digest(journal)) throw Error('Recovery journal archive differs; preserve both and investigate');
  if (!existsSync(archive)) save(archive, journal);
}

export async function deploy(app, environment, options, {
  read = cloud, github = ghApi, env = process.env, smoke = releaseHealthProbe,
  preflight = firebaseAuthPreflight, audit = auditCreateEvents,
  submit = plan => command('firebase', rolloutArguments(plan), { stdio: ['ignore', 'inherit', 'inherit'] }),
} = {}) {
  return asyncLock(`release-${app}-${environment}`, async () => {
    const t = target(app, environment);
    assertClean(git('status', '--porcelain')); git('fetch', 'origin');
    const journalFile = path.join(stateDir(), `release-${app}-${environment}.json`);
    let journal = existsSync(journalFile) ? jsonFile(journalFile) : undefined;
    let pointer = releaseRecord(t.branch), plan;
    if (pointer?.record.kind === 'intent') {
      if (!options.resume) throw Error('Pending distributed release intent: use --resume; never submit another rollout');
      if (!journal) throw Error('Missing original release journal; restore it before resuming');
      const pinned = journal.plan;
      const sourceSha = exactSha(options.sha || pinned.sourceSha);
      plan = { ...pinned, ...t, sourceSha, scopeHash: scopeHash(app, sourceSha) };
      if (pinned.rollbackRecord !== pointer.record.rollbackRecord || (options.record && options.record !== pinned.rollbackRecord) || (options.rollback && !pinned.rollback)) throw Error('Resume rollback differs from original intent');
      assertResume(pointer.record, journal, plan);
      if (journal.intentCommit && journal.intentCommit !== (pointer.record.retryClaim?.originalIntent || pointer.commit)) throw Error('Resume intent commit differs from the original journal');
      if (digest(plan.productionDelta || null) !== digest(pointer.record.productionDelta || null)) throw Error('Resume production delta differs from original intent');
      if (!options.execute) return { dryRun:true, plan, pendingReleaseId:pointer.record.releaseId, next:'Restore the matching journal and use --resume --execute to verify this attempt.' };
      plan.resumeOperator = authenticatedOperator(t, { github, env });
    } else if (options.resume) throw Error('No matching pending release to resume');

    const backend = await releaseBackend(t, read);
    if (!options.resume) {
      if (pointer) validateRecord(pointer.record, t);
      const prior = pointer?.record;
      const abandonedFirst = prior?.kind === 'abandoned' && prior.recovery.firstRelease === true;
      let before = await releasePrestate(t, read);
      if (abandonedFirst && (before.state === 'EMPTY' || matchesServing(prior, before))) {
        const baselineCommit = exactSha(prior.firstReleaseBaselineRecord);
        const baseline = validateRecord(JSON.parse(git('show', `${baselineCommit}:release.json`)), t);
        if (baseline.kind !== 'empty-baseline' || !ancestor(baselineCommit, pointer.commit)) throw Error('Abandoned first-release baseline lineage is invalid');
        before = await stableAdhocProductionState(t, read, { allowFailedHistory: prior });
      } else if (before.state === 'EMPTY') {
        before = await stableAdhocProductionState(t, read);
      }
      const firstRelease = before.state === 'EMPTY';
      if (firstRelease && (options.rollback || options.record)) throw Error('The first release has no earlier verified rollback target');
      if (before.sourceSha && !ref(before.sourceSha)) git('fetch', 'origin', before.sourceSha);
      plan = planRelease(t, options, pointer, before, { github, env });
      const staleLedger = firstRelease ? !abandonedFirst && prior?.kind !== 'empty-baseline' :
        !matchesServing(prior, before) && !(prior?.kind === 'abandoned' && matchesServing(prior.previousGood, before));
      if (!options.execute) return { dryRun:true, plan, before, url:backend.uri, ...(staleLedger ? { willRecordObservedBaseline:true } : {}),
        next:'An authenticated deployment operator can add --execute for this exact source and target.' };

      if (journal && !['completed', 'abandoned'].includes(journal.state)) {
        const remoteAdvanced = journal.intentCommit && pointer && ancestor(journal.intentCommit, pointer.commit);
        if (journal.submissionStartedAt && journal.releaseId !== prior?.releaseId && !remoteAdvanced) throw Error('Local journal has an unresolved submission; preserve it and inspect the original attempt');
        archiveJournal(journal);
      }
      const alreadyServing = !firstRelease && before.sourceSha === plan.sourceSha;
      let health;
      if (alreadyServing) {
        health = await smoke(app, backend.uri, before.sourceSha, fetch, environment);
        if (!health.ok || digest(before) !== digest(await releasePrestate(t, read))) throw Error('Cannot verify already-serving release while health or traffic is unstable');
        if (!staleLedger && prior?.kind !== 'abandoned') return { alreadyServing:true, before, smoke:health };
      } else {
        preflight(t);
      }

      // Adopt observed serving state prospectively, keeping the old ledger as first parent.
      // A missing or stale ledger is not an eligibility check, but the new intent still uses a non-force CAS.
      if (staleLedger) {
        if (!firstRelease && !alreadyServing && digest(before) !== digest(await verifiedReleaseServing(t, read))) throw Error('Firebase serving state changed before baseline recording');
        const baseline = firstRelease ? adhocEmptyBaselineRecord(t, before) :
          { schema:'fika.release.v1', ...t, ...before, kind:'baseline', scopeHash:scopeHash(app, before.sourceSha),
            observedAt:new Date().toISOString(), reconciliation:{type:'observed-serving-state', actor:plan.approval.actor, priorLedgerCommit:pointer?.commit || null},
            ...(health ? { smoke:health } : {}) };
        const commit = appendRecord(t, baseline, pointer?.commit || (firstRelease ? plan.sourceSha : undefined));
        pointer = { commit, record:baseline };
        if (alreadyServing) return { alreadyServing:true, commit, record:baseline, smoke:health };
      }
      const abandoned = pointer.record.kind === 'abandoned';
      const previousGoodRecord = firstRelease ? null : abandoned ? pointer.record.previousGoodRecord : pointer.commit;
      const previousGood = firstRelease ? null : abandoned ? pointer.record.previousGood : before;
      if (abandoned && !firstRelease) {
        const good = validateRecord(JSON.parse(git('show', `${exactSha(previousGoodRecord)}:release.json`)), t);
        if (!matchesServing(good, previousGood) || !ancestor(previousGoodRecord, pointer.commit)) throw Error('Abandoned release rollback evidence differs');
      }
      if (alreadyServing) {
        const record = { schema:'fika.release.v1', ...plan, ...before, kind:plan.rollback ? 'rollback' : 'deploy',
          previousGood, previousGoodRecord, releaseId:randomUUID(), reverifiedServing:true, completedAt:new Date().toISOString(), smoke:health };
        validateRecord(record, t);
        const commit = appendRecord(t, record, pointer.commit);
        return { alreadyServing:true, commit, record };
      }
      journal = { releaseId:randomUUID(), plan, before:previousGood, observedBefore:before, previousGoodRecord,
        firstRelease, firstReleaseBaselineRecord:firstRelease ? (abandonedFirst ? prior.firstReleaseBaselineRecord : pointer.commit) : undefined,
        state:'pending', createdAt:new Date().toISOString() };
      save(journalFile, journal);
      journal.intentCommit = appendRecord(t, { schema:'fika.release.v1', ...plan, kind:'intent', state:'PENDING', releaseId:journal.releaseId,
        previousGood, previousGoodRecord, firstRelease:journal.firstRelease || undefined,
        firstReleaseBaselineRecord:journal.firstReleaseBaselineRecord, createdAt:journal.createdAt }, pointer.commit);
      save(journalFile, journal);
      // Exactly one selected backend, reached only after the target's durable intent is recorded.
      journal.submissionStartedAt = new Date().toISOString(); save(journalFile, journal);
      let submissionFailure;
      try { submit(plan); }
      catch (error) { submissionFailure = { exitStatus: error?.status ?? null, message: String(error?.message || error).slice(0, 300) }; throw Error(`Rollout submission/completion uncertain. Journal ${journalFile}; use --resume, NEVER blindly resubmit.`); }
      finally {
        journal.submissionFinishedAt = new Date().toISOString();
        if (submissionFailure) journal.submissionFailure = submissionFailure;
        journal.submissionAttempts = [{ n: 1, startedAt: journal.submissionStartedAt, finishedAt: journal.submissionFinishedAt, ...(submissionFailure ? { failure: submissionFailure } : {}) }];
        save(journalFile, journal);
      }
    }
    let resubmissionNote = '';
    if (options.resume) {
      const t = target(plan.app, plan.environment);
      const io = {
        inspect: () => recoverySnapshot(t, read, verifiedReleaseServing),
        audit: sinceMs => audit(t, sinceMs),
        // Both local and hosted runners must win the same non-force ledger update before resubmitting.
        claim: (expectedAttempts, next) => {
          if (pointer.record.retryClaim || submissionAttempts(jsonFile(journalFile)).length !== expectedAttempts) throw Error('Another resume already claimed the resubmission');
          const attempt = next.submissionAttempts.at(-1);
          appendRecord(t, { ...pointer.record, retryClaim:{ originalIntent:pointer.commit, attempt:attempt.n, startedAt:attempt.startedAt } }, pointer.commit);
          save(journalFile, next);
          journal = next;
        },
        submit: () => submit(plan),
        finish: (n, patch) => { const stored = jsonFile(journalFile); save(journalFile, { ...stored, submissionAttempts: stored.submissionAttempts.map(attempt => attempt.n === n ? { ...attempt, ...patch } : attempt) }); },
      };
      try {
        if (!pointer.record.retryClaim && (journal.submissionFailure || !journal.submissionStartedAt)) {
          mergedSource(plan.sourceSha, github, { historicalRollback:plan.rollback });
          await resubmitNeverSubmitted({ intent: pointer.record, journal }, { ...io, preflight: () => preflight(t) });
          resubmissionNote = 'Original submission was proven never to have reached Firebase and was resubmitted once for the same intent.';
        }
      } catch (error) { if (error.failure) throw error; resubmissionNote = `Resubmission not attempted: ${error.message}.`; }
    }
    let verified; const deadline = Date.now() + Number(options['timeout-ms'] || 1200000);
    while (Date.now() < deadline) {
      try { const s = await verifiedReleaseServing(t, read); if (s.sourceSha === plan.sourceSha && s.rollout !== journal.observedBefore?.unhealthyFirstRelease?.rollout) { verified = s; break; } } catch { /* transient rollout state, no resubmission */ }
      await new Promise(resolve => setTimeout(resolve, 15000));
    }
    if (!verified) {
      let evidence = ''; try { evidence = describeSubmissionEvidence(await recoverySnapshot(t, read, verifiedReleaseServing), journal); } catch { evidence = 'Firebase state could not be read.'; }
      throw Error(`Serving verification incomplete; retain pending intent and ${journalFile}. ${evidence} ${resubmissionNote}`.trim());
    }
    const health = await smoke(app, backend.uri, verified.sourceSha, fetch, plan.environment);
    if (!health.ok) throw Error(`Non-destructive release health probe failed (${health.reason || health.status}); preserve journal for recovery`);
    if (digest(verified) !== digest(await verifiedReleaseServing(t, read))) throw Error('Serving revision changed during verification; preserve pending intent');
    git('fetch', 'origin'); const latest = releaseRecord(plan.branch);
    if (latest?.record.releaseId !== journal.releaseId || latest.record.kind !== 'intent') throw Error('Release intent changed unexpectedly; do not overwrite it');
    const record = { schema: 'fika.release.v1', ...plan, ...verified, kind: plan.rollback ? 'rollback' : 'deploy', previousGood: journal.firstRelease ? null : journal.before, previousGoodRecord:journal.previousGoodRecord,
      firstReleaseBaselineRecord:journal.firstReleaseBaselineRecord, releaseId: journal.releaseId, completedAt: new Date().toISOString(), smoke: health };
    validateRecord(record, plan); const commit = appendRecord(plan, record, latest.commit);
    save(journalFile, { ...journal, state: 'completed', record, commit }); return { commit, record };
  });
}

export async function reconcile(app, environment, options) {
  if (options.resolution === 'serving-baseline') return environment === 'prod'
    ? reconcileProductionServingBaseline(app, environment, options)
    : reconcileServingBaseline(app, environment, options);
  if (options.resolution === 'adopt-completed') return reconcileCompletedCpu(app, environment, options);
  return asyncLock(`release-${app}-${environment}`, async () => {
    const t = target(app, environment); assertClean(git('status', '--porcelain')); git('fetch', 'origin');
    const pointer = releaseRecord(t.branch);
    if (pointer?.record.kind !== 'intent' || (options['release-id'] && pointer.record.releaseId !== options['release-id'])) throw Error('No matching pending release intent');
    const journalFile = path.join(stateDir(), `release-${app}-${environment}.json`);
    const journal = jsonFile(journalFile);
    const backend = await releaseBackend(t, cloud);
    const snapshot = await recoverySnapshot(t, cloud, verifiedReleaseServing);
    // Dry-run returns only selected, non-secret evidence and never changes ledger/journal.
    if (!options.execute) return { dryRun: true, releaseId: pointer.record.releaseId, snapshot, next: 'Verify the terminal attempt, then use --resolution abandon|complete --rollout <ID> --execute.' };
    const operator = executionEvidence(t,pointer.record.sourceSha,{...options,action:`reconcile:${options.resolution}`,'release-id':pointer.record.releaseId});
    if (journal.firstRelease !== true) {
      const previousGoodRecord = exactSha(journal.previousGoodRecord);
      const good = validateRecord(JSON.parse(git('show', `${previousGoodRecord}:release.json`)), t);
      if (good.sourceSha !== journal.before?.sourceSha || good.rollout !== journal.before?.rollout || !ancestor(previousGoodRecord, pointer.commit)) throw Error('Original known-good rollback evidence is invalid');
    } else if (journal.previousGoodRecord != null || !journal.firstReleaseBaselineRecord || !ancestor(journal.firstReleaseBaselineRecord,pointer.commit)) throw Error('First-release recovery baseline lineage is invalid');
    const audit = journal.firstRelease === true && options.rollout === 'none' ?
      await auditCreateEvents(t, Date.parse(submissionAttempts(journal).at(-1).startedAt)) : undefined;
    return reconcileIntent({ pointer, journal, t, operator, rolloutId: options.rollout, resolution: options.resolution, reason: options.reason, audit }, {
      inspect: () => recoverySnapshot(t, cloud, verifiedReleaseServing),
      smoke: sourceSha => releaseHealthProbe(app, backend.uri, sourceSha, fetch, environment),
      scopeHash: sha => scopeHash(app, sha),
      latest: () => { git('fetch', 'origin'); return releaseRecord(t.branch); },
      archive: archiveJournal,
      append: (record, expected) => appendRecord(t, record, expected),
      finish: record => save(journalFile, record),
    });
  });
}

export async function reconcileCompletedCpu(app, environment, options) {
  const t = target(app,environment); assertCpuAdoptionTarget(t);
  const sha = exactSha(options.sha), rolloutId = options.rollout;
  return asyncLock(`release-${app}-${environment}`,async()=>{
    assertClean(git('status','--porcelain')); git('fetch','origin');
    const previous = releaseRecord(t.branch); validateRecord(previous?.record,t);
    const journalFile = path.join(stateDir(),`release-${app}-${environment}.json`);
    const journalHash = existsSync(journalFile) ? digest(jsonFile(journalFile)) : null;
    const assertJournal = () => {
      const journal = existsSync(journalFile) ? jsonFile(journalFile) : null;
      if ((journal && !['completed','abandoned'].includes(journal.state)) || (journal ? digest(journal) : null) !== journalHash) throw Error('Pending, unknown or changed CPU release journal; adoption is blocked');
    };
    assertJournal();
    const prs = ghApi(`repos/${REPO}/commits/${sha}/pulls?per_page=100`).filter(p=>p.merge_commit_sha===sha && p.merged_at && p.base?.ref==='main');
    if (prs.length !== 1) throw Error('Exactly one merged PR must identify the observed CPU source');
    const pr = ghApi(`repos/${REPO}/pulls/${prs[0].number}`);
    const provenance = {pr:{number:pr.number,merged:pr.merged,merged_at:pr.merged_at,merge_commit_sha:pr.merge_commit_sha,base:{ref:pr.base?.ref,repo:{full_name:pr.base?.repo?.full_name}}},
      validation:successfulValidation(sha),integrated:ancestor(sha,'origin/main'),preservesPrevious:ancestor(previous.record.sourceSha,sha)};
    // Executing recovery tooling must itself be integrated and exact-source validated.
    if (options.execute) {
      const toolSha = git('rev-parse','HEAD');
      if (!ancestor(toolSha,'origin/main')) throw Error('CPU adoption tooling must be integrated into main before execution');
      successfulValidation(toolSha);
    }
    const authorization = options.execute ? executionEvidence(t,sha,{...options,action:'reconcile:adopt-completed','release-id':previous.commit}) : undefined;
    return adoptCompletedCpu({t,sha,rolloutId,previous,provenance,execute:options.execute,authorization},{
      inspect:()=>observeCpuAdoption(t,rolloutId), smoke:(uri,source)=>releaseHealthProbe(app,uri,source,fetch,environment),
      latest:()=>{git('fetch','origin');return releaseRecord(t.branch);}, assertJournal,
      scopeHash:source=>scopeHash(app,source),
      archive:evidence=>{
        const file = path.join(stateDir(),'archives',`cpu-completed-adoption-${previous.commit}-${digest(evidence)}.json`);
        if (existsSync(file) && digest(jsonFile(file)) !== digest(evidence)) throw Error('CPU adoption evidence archive mismatch');
        if (!existsSync(file)) save(file,evidence);
      },
      append:(record,expected)=>appendRecord(t,record,expected),
    });
  });
}
