import { digest, exactSha, assertResume, validateRecord, APPS } from './policy.mjs';
import { cloud, serving, backendPath } from './runtime.mjs';
import { discover } from './discovery.mjs';

const relative = name => String(name).split('/backends/')[1];
export function isDomainOperationTarget(t, target) {
  const value = String(target || '');
  return value === `${t.backend}/domains` || value.startsWith(`${t.backend}/domains/`) ||
    value === `${backendPath(t)}/domains` || value.startsWith(`${backendPath(t)}/domains/`);
}
export function isReleaseRelevantOperation(t, operation) {
  if (operation.done || isDomainOperationTarget(t, operation.target)) return false;
  const value = String(operation.target || '');
  return !value || value === t.backend || value === backendPath(t) || value.startsWith(`${t.backend}/`) || value.startsWith(`${backendPath(t)}/`);
}
export async function recoverySnapshot(t, read = cloud, currentServing = serving) {
  const base = backendPath(t);
  const [backend, builds, rollouts, operations, traffic] = await Promise.all([
    read(base),
    discover(`${base}/builds`, 'builds', b => ({ name: relative(b.name), state: b.state, sourceSha: b.source?.codebase?.hash || b.source?.codebase?.commit, createTime: b.createTime, updateTime: b.updateTime, reconciling: Boolean(b.reconciling) }), read),
    discover(`${base}/rollouts`, 'rollouts', r => ({ name: relative(r.name), build: relative(r.build), state: r.state, createTime: r.createTime, updateTime: r.updateTime, reconciling: Boolean(r.reconciling) }), read),
    discover(`projects/${t.project}/locations/${t.region}/operations`, 'operations', o => ({ name: o.name, done: o.done === true, target: relative(o.metadata?.target || o.response?.name || '') }), read),
    read(`${base}/traffic`),
  ]);
  // Domain ownership/certificate work does not mutate backend builds, rollouts or traffic.
  // Keep it in the evidence digest while keeping the release gate specific to release operations.
  const domainOperations = operations.filter(o => !o.done && isDomainOperationTarget(t, o.target));
  const relevantOperations = operations.filter(o => isReleaseRelevantOperation(t, o));
  const split = s => (s?.splits || []).map(x => ({ build: relative(x.build), percent: x.percent })).sort((a,b) => a.build.localeCompare(b.build));
  const snapshot = { backend: { name: backend.name, environment: backend.environment, reconciling: Boolean(backend.reconciling), rootDirectory: backend.codebase?.rootDirectory, repository: backend.codebase?.repository }, builds, rollouts, operations: relevantOperations, domainOperations, traffic: { current: split(traffic.current), target: split(traffic.target), reconciling: Boolean(traffic.reconciling), autoDisabled: traffic.rolloutPolicy?.disabled === true } };
  // A first release has no serving revision. Represent that state only when the
  // backend is correctly mapped and Firebase proves there is no traffic,
  // target or in-flight operation. Any partial state remains an integrity error.
  if (snapshot.traffic.current.length === 0 && snapshot.traffic.target.length === 0 && relevantOperations.length === 0) {
    if (backend.reconciling !== false || traffic.reconciling || traffic.rolloutPolicy?.disabled !== true) throw Error('Backend without serving traffic is not quiescent or automatic rollouts are enabled');
    snapshot.current = { sourceSha: null, rollout: null, state: 'EMPTY', percent: 0 };
  } else snapshot.current = await currentServing(t, read);
  return snapshot;
}

function assertFirstReleaseBackend(t, snapshot) {
  const allowed = (t.app === 'adhoc' && t.environment === 'prod') || (t.app === 'beverage' && t.environment === 'staging');
  const expectedEnvironment = t.environment === 'prod' ? 'production' : 'staging';
  const expectedRoot = `/${APPS[t.app]?.path || ''}`;
  if (!allowed || snapshot.backend?.name !== backendPath(t) || snapshot.backend.environment !== expectedEnvironment || snapshot.backend.reconciling !== false ||
      ![expectedRoot, expectedRoot.slice(1)].includes(snapshot.backend.rootDirectory) ||
      !String(snapshot.backend.repository || '').endsWith('/gitRepositoryLinks/derekfika-fika-os')) throw Error('First-release recovery target does not match an explicitly allowed backend');
}
export function assertRecoveryEvidence(intent, journal, snapshot, rolloutId, audit) {
  assertResume(intent, journal, journal?.plan || {});
  const { startedAt, finishedAt } = submissionAttempts(journal).at(-1);
  if (intent.retryClaim && (intent.retryClaim.startedAt !== startedAt || intent.retryClaim.attempt !== submissionAttempts(journal).length)) throw Error('Restore the journal for the claimed resubmission before reconciling');
  if (!Number.isFinite(Date.parse(startedAt)) || !Number.isFinite(Date.parse(finishedAt))) throw Error('Submission outcome is unknown: original submitter must have returned; do not abandon');
  const noRollout=journal.firstRelease===true&&rolloutId==='none';
  if (!noRollout&&!/^[a-z][a-z0-9-]{2,100}$/.test(rolloutId || '')) throw Error('Reconciliation requires the exact observed --rollout ID (or --rollout none for a proven first-release non-submission)');
  // SKIPPED is accepted only for records predating this submission. A newer
  // skip could belong to a competing attempt and remains unresolved. The
  // selected rollout/build below still has to match the original submission,
  // and successful completion still requires exact-source serving evidence.
  const submissionStarted = Date.parse(startedAt);
  const oldSkipped = item => item.state === 'SKIPPED' && Number.isFinite(Date.parse(item.createTime)) && Date.parse(item.createTime) < submissionStarted;
  if (snapshot.builds.some(b => (!['READY','FAILED','DELETED','CANCELLED'].includes(b.state) && !oldSkipped(b)) || b.reconciling) || snapshot.rollouts.some(r => (!['SUCCEEDED','FAILED','CANCELLED'].includes(r.state) && !oldSkipped(r)) || r.reconciling) || snapshot.operations.some(o => !o.done)) throw Error('Deployment may still be active or its outcome is unknown; do not abandon');
  const traffic = snapshot.traffic;
  if (!traffic.autoDisabled || traffic.reconciling || (traffic.target.length && digest(traffic.target) !== digest(traffic.current))) throw Error('Traffic is not quiescent; do not abandon');
  if(noRollout){
    assertFirstReleaseBackend(intent,snapshot);
    if(!audit?.readable||audit.events?.length)throw Error('Cloud Audit Logs do not prove that the first-release submission created no rollout');
    const possiblyNew=item=>{const created=Date.parse(item.createTime);return !Number.isFinite(created)||created>=submissionStarted;};
    if(snapshot.builds.some(possiblyNew)||snapshot.rollouts.some(possiblyNew)||traffic.current.length||traffic.target.length||snapshot.operations.length)throw Error('First-release submission may have reached Firebase; preserve intent and do not abandon');
    if(snapshot.builds.some(b=>!['FAILED','CANCELLED','DELETED'].includes(b.state))||snapshot.rollouts.some(r=>!['FAILED','CANCELLED'].includes(r.state)))throw Error('First-release backend history is not exclusively unsuccessful and terminal');
    return {rollout:null,build:null,firstReleaseEmpty:true,noRollout:true};
  }
  const matches = snapshot.rollouts.filter(r => r.name === `${intent.backend}/rollouts/${rolloutId}`);
  if (matches.length !== 1) throw Error('Terminal rollout identity is missing or ambiguous');
  const rollout = matches[0]; const build = snapshot.builds.find(b => b.name === rollout.build);
  if (!build || build.sourceSha !== intent.sourceSha || !Number.isFinite(Date.parse(rollout.createTime)) || Date.parse(rollout.createTime) < Date.parse(startedAt) || Date.parse(rollout.createTime) > Date.parse(finishedAt)) throw Error('Rollout does not prove the original submission outcome');
  const current = snapshot.current;
  const currentBuild = current.rollout === rolloutId && rollout.state === 'SUCCEEDED' ? rollout.build :
    snapshot.rollouts.find(r => r.name === `${intent.backend}/rollouts/${current.rollout}` && r.state === 'SUCCEEDED')?.build;
  if (journal.firstRelease === true) {
    assertFirstReleaseBackend(intent, snapshot);
    if (snapshot.traffic.current.length===1 && snapshot.traffic.current[0].percent===100 && current.state==='SUCCEEDED' && current.sourceSha===intent.sourceSha && rollout.state==='SUCCEEDED' && build.state==='READY' && current.rollout===rolloutId && snapshot.traffic.current[0].build===currentBuild) return {rollout,build,firstReleaseServing:true};
    if (snapshot.traffic.reconciling || !snapshot.traffic.autoDisabled || snapshot.traffic.current.length || snapshot.traffic.target.length || snapshot.operations.length) throw Error('First-release backend is not empty and quiescent; preserve intent and investigate');
    if (snapshot.builds.some(b => (!['READY','FAILED','DELETED','CANCELLED'].includes(b.state) && !oldSkipped(b)) || b.reconciling) || snapshot.rollouts.some(r => (!['SUCCEEDED','FAILED','CANCELLED'].includes(r.state) && !oldSkipped(r)) || r.reconciling)) throw Error('First-release deployment may still be active or its outcome is unknown; do not abandon');
    if (rollout.state === 'SUCCEEDED') throw Error('Successful first rollout is not serving; do not abandon or fabricate completion');
    if (!['FAILED','CANCELLED'].includes(rollout.state) || !['FAILED','CANCELLED','DELETED'].includes(build.state)) throw Error('First-release attempt is not positively terminal and unsuccessful');
    return { rollout, build, firstReleaseEmpty: true };
  }
  exactSha(current.sourceSha);
  if (current.state !== 'SUCCEEDED' || current.percent !== 100 || ![intent.sourceSha, (journal.observedBefore || journal.before).sourceSha].includes(current.sourceSha)) throw Error('Unexpected serving source; preserve intent and investigate');
  if (!currentBuild || traffic.current[0]?.build !== currentBuild) throw Error('Traffic/serving evidence differs');
  return { rollout, build };
}

// The same orchestration is used by the CLI and fault-injection tests. No deployment is submitted here.
export async function reconcileIntent(input, io) {
  const { pointer, journal, t, rolloutId, resolution, reason, operator, audit } = input;
  if (!['abandon','complete'].includes(resolution)) throw Error('Reconciliation requires --resolution abandon|complete');
  const note = reason?.trim().slice(0, 500) || (resolution === 'complete' ? 'Verified exact-source serving rollout' : 'Verified terminal unsuccessful rollout');
  const snapshot = await io.inspect();
  const { rollout, build, firstReleaseEmpty = false, noRollout = false } = assertRecoveryEvidence(pointer.record, journal, snapshot, rolloutId,input.audit);
  const current = snapshot.current;
  const smoke = firstReleaseEmpty ? { ok: false, status: null, reason: 'first_release_failed_without_serving_traffic' } : await io.smoke(current.sourceSha);
  if (resolution === 'complete' && (rollout.state !== 'SUCCEEDED' || build.state !== 'READY' || current.rollout !== rolloutId || current.sourceSha !== pointer.record.sourceSha || !smoke.ok)) throw Error('Cannot complete without healthy exact-source serving evidence');
  if (resolution === 'abandon' && current.sourceSha === pointer.record.sourceSha && smoke.ok) throw Error('Healthy successful rollout must be completed, not abandoned');
  const second = await io.inspect();
  if (digest(second) !== digest(snapshot)) throw Error('Deployment evidence changed during reconciliation; no ledger change permitted');
  const latest = await io.latest();
  if (latest.commit !== pointer.commit) throw Error('Release intent changed during reconciliation');
  const record = { schema: 'fika.release.v1', ...t, ...(firstReleaseEmpty ? { sourceSha: pointer.record.sourceSha, rollout: noRollout ? null : rolloutId, state: 'FAILED', percent: 0 } : current), scopeHash: await io.scopeHash(firstReleaseEmpty ? pointer.record.sourceSha : current.sourceSha),
    kind: resolution === 'complete' ? (journal.plan.rollback ? 'rollback' : 'deploy') : 'abandoned',
    previousGood: journal.firstRelease ? null : journal.before, previousGoodRecord: journal.firstRelease ? null : journal.previousGoodRecord, firstReleaseBaselineRecord:journal.firstReleaseBaselineRecord,
    releaseId: journal.releaseId, originalIntent: pointer.commit, smoke,
    recovery: { resolution, reason: note, operator, rollout: noRollout ? null : rolloutId, ...(journal.firstRelease ? { firstRelease: true, noPreviousRelease: true } : {}), ...(noRollout ? { noRolloutSubmitted:true, auditHash:digest(audit) } : {}), evidenceHash: digest(snapshot), journalHash: digest(journal), at: new Date().toISOString() } };
  if (resolution === 'complete') validateRecord(record, t);
  // Persist an immutable original journal before appending the resolution; a failed CAS never discards evidence.
  await io.archive(journal);
  const commit = await io.append(record, pointer.commit);
  await io.finish({ ...journal, state: resolution === 'complete' ? 'completed' : 'abandoned', resolutionCommit: commit, resolution: record });
  return { commit, record };
}

// ── Guarded resubmission of a rollout that provably never reached Firebase ──────────────
// `deploy --resume` normally only verifies. It may resubmit the SAME intent (same release ID, pinned SHA and
// operator evidence) once, and only when independently gathered evidence shows the original submission never reached
// Firebase. Any doubt leaves the intent pending. The retry is claimed in the existing ledger before submission.
export const RESUBMIT_QUIET_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
export const submissionAttempts = journal => journal.submissionAttempts?.length
  ? journal.submissionAttempts
  : [{ n: 1, startedAt: journal.submissionStartedAt, finishedAt: journal.submissionFinishedAt, ...(journal.submissionFailure ? { failure: journal.submissionFailure } : {}) }];

export function assertNeverSubmitted({ intent, journal, first, second, audit, now = Date.now(), quietMs = RESUBMIT_QUIET_MS }) {
  assertResume(intent, journal, journal?.plan || {});
  const attempts = submissionAttempts(journal);
  if (attempts.length !== 1) throw Error('A resubmission was already recorded for this intent; submission state is uncertain, do not resubmit');
  const started = Date.parse(attempts[0].startedAt); const finished = Date.parse(attempts[0].finishedAt); const created = Date.parse(journal.createdAt);
  // The intent can be durable before the local journal is marked ready to submit.
  // Recover that gap without inventing a completed CLI attempt or its timestamps.
  const beforeSubmission = journal.state === 'pending' &&
    !journal.submissionStartedAt && !journal.submissionFinishedAt && !journal.submissionFailure &&
    !journal.submissionAttempts && intent.createdAt === journal.createdAt;
  if (!Number.isFinite(created) || (!beforeSubmission && ![started, finished].every(Number.isFinite))) throw Error('Submission outcome is unknown: original submitter must have returned');
  const waitMs = (beforeSubmission ? created : finished) + quietMs - now;
  if (waitMs > 0) throw Error(`Quiet period not elapsed; evidence is not yet conclusive (retry in ${Math.ceil(waitMs / 60000)} minute(s))`);
  if (digest(first) !== digest(second)) throw Error('Deployment evidence changed between snapshots; not resubmitting');
  const since = created - CLOCK_SKEW_MS;
  // A missing or unparsable createTime counts as "possibly new": doubt never permits resubmission.
  const possiblyNew = item => item.reconciling || !(Date.parse(item.createTime) < since);
  const present = [...first.builds.filter(possiblyNew), ...first.rollouts.filter(possiblyNew)].map(item => item.name);
  if (present.length) throw Error(`Firebase already holds ${present.join(', ')} created after the intent; the submission may have reached Firebase`);
  if (first.operations.length || first.builds.some(b => !['READY','FAILED','DELETED','CANCELLED','SKIPPED'].includes(b.state)) ||
      first.rollouts.some(r => !['SUCCEEDED','FAILED','CANCELLED','SKIPPED'].includes(r.state))) throw Error('Firebase operations are still in flight or unknown; submission state is uncertain');
  const traffic = first.traffic;
  if (!traffic.autoDisabled || traffic.reconciling || (traffic.target.length && digest(traffic.target) !== digest(traffic.current))) throw Error('Traffic is not quiescent; not resubmitting');
  const before = journal.observedBefore || journal.before;
  const current = first.current;
  if (current.state === 'EMPTY' && journal.firstRelease === true) {
    assertFirstReleaseBackend(intent, first);
    if (before?.state !== 'EMPTY' || traffic.current.length || traffic.target.length) throw Error('Serving state differs from the recorded empty backend; not resubmitting');
  } else {
    const servingRollout = first.rollouts.find(r => r.name === `${intent.backend}/rollouts/${current.rollout}` && r.state === 'SUCCEEDED' && !r.reconciling);
    if (current.state !== 'SUCCEEDED' || current.percent !== 100 || current.sourceSha !== before?.sourceSha || current.rollout !== before?.rollout ||
        traffic.current.length !== 1 || traffic.current[0].percent !== 100 || traffic.current[0].build !== servingRollout?.build) throw Error('Serving state differs from the state recorded before the submission; not resubmitting');
  }
  if (!audit?.readable) throw Error('Cloud Audit Logs could not be read; non-submission cannot be proven');
  if (audit.events.length) throw Error(`Cloud Audit Logs show ${audit.events.length} App Hosting create call(s) after the intent; the submission may have reached Firebase`);
  return beforeSubmission ? [{ n: 1, phase: 'not-started-after-intent' }] : attempts;
}

/** io: inspect, audit(sinceMs), claim(expectedAttempts, nextJournal), submit, finish(n, patch), optional preflight and now. Exactly one invocation can claim. */
export async function resubmitNeverSubmitted({ intent, journal }, io) {
  const now = () => io.now?.() ?? Date.now();
  const first = await io.inspect(); const audit = await io.audit(Date.parse(journal.createdAt) - CLOCK_SKEW_MS); const second = await io.inspect();
  const attempts = assertNeverSubmitted({ intent, journal, first, second, audit, now: now() });
  await io.preflight?.();
  const attempt = { n: attempts.length + 1, startedAt: new Date(now()).toISOString(), reason: 'verified-never-submitted', evidenceHash: digest({ first, events: audit.events }), ...(attempts[0].failure ? { previousFailure: attempts[0].failure } : {}) };
  // Write-ahead compare-and-swap: the claim is durable BEFORE the submission, so a second or crashed invocation can never resubmit.
  await io.claim(attempts.length, { ...journal, submissionAttempts: [...attempts, attempt] });
  let failure;
  try { await io.submit(); } catch (error) { failure = { exitStatus: error?.status ?? null, message: String(error?.message || error).slice(0, 300) }; }
  await io.finish(attempt.n, { finishedAt: new Date(now()).toISOString(), ...(failure ? { failure } : {}) });
  if (failure) throw Object.assign(Error(`Resubmission failed (${failure.message}); the intent is retained, do not resubmit`), { failure });
  return { attempt };
}

/** Human-readable state of Firebase relative to an intent, for resume diagnostics. */
export function describeSubmissionEvidence(snapshot, journal) {
  const since = Date.parse(journal.createdAt) - CLOCK_SKEW_MS;
  const newer = [...snapshot.builds, ...snapshot.rollouts].filter(item => !(Date.parse(item.createTime) < since));
  return newer.length
    ? `Firebase holds ${newer.map(item => `${item.name} (${item.state})`).join(', ')} created after the intent; resume is verifying it.`
    : `Firebase holds no build or rollout created after the intent (serving ${(snapshot.current.sourceSha?.slice(0, 8) || 'empty')} at ${snapshot.current.percent}%): there is no Firebase build or rollout evidence of submission.`;
}
