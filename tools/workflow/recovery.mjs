import { digest, exactSha, assertResume, validateRecord } from './policy.mjs';
import { cloud, serving, backendPath } from './runtime.mjs';
import { discover } from './discovery.mjs';

const relative = name => String(name).split('/backends/')[1];
export async function recoverySnapshot(t, read = cloud, currentServing = serving) {
  const base = backendPath(t);
  const [builds, rollouts, operations, traffic] = await Promise.all([
    discover(`${base}/builds`, 'builds', b => ({ name: relative(b.name), state: b.state, sourceSha: b.source?.codebase?.hash || b.source?.codebase?.commit, createTime: b.createTime, updateTime: b.updateTime, reconciling: Boolean(b.reconciling) }), read),
    discover(`${base}/rollouts`, 'rollouts', r => ({ name: relative(r.name), build: relative(r.build), state: r.state, createTime: r.createTime, updateTime: r.updateTime, reconciling: Boolean(r.reconciling) }), read),
    discover(`projects/${t.project}/locations/${t.region}/operations`, 'operations', o => ({ name: o.name, done: o.done === true, target: relative(o.metadata?.target || o.response?.name || '') }), read),
    read(`${base}/traffic`),
  ]);
  const relevantOperations = operations.filter(o => !o.done && (!o.target || o.target === t.backend || o.target.startsWith(`${t.backend}/`)));
  const split = s => (s?.splits || []).map(x => ({ build: relative(x.build), percent: x.percent })).sort((a,b) => a.build.localeCompare(b.build));
  return { builds, rollouts, operations: relevantOperations, traffic: { current: split(traffic.current), target: split(traffic.target), reconciling: Boolean(traffic.reconciling), autoDisabled: traffic.rolloutPolicy?.disabled === true }, current: await currentServing(t) };
}
export function assertRecoveryEvidence(intent, journal, snapshot, rolloutId) {
  assertResume(intent, journal, journal?.plan || {});
  if (!Number.isFinite(Date.parse(journal.submissionStartedAt)) || !Number.isFinite(Date.parse(journal.submissionFinishedAt))) throw Error('Submission outcome is unknown: original submitter must have returned; do not abandon');
  if (!/^[a-z][a-z0-9-]{2,100}$/.test(rolloutId || '')) throw Error('Reconciliation requires the exact observed --rollout ID');
  // SKIPPED is accepted only for records predating this submission. A newer
  // skip could belong to a competing attempt and remains unresolved. The
  // selected rollout/build below still has to match the original submission,
  // and successful completion still requires exact-source serving evidence.
  const submissionStarted = Date.parse(journal.submissionStartedAt);
  const oldSkipped = item => item.state === 'SKIPPED' && Number.isFinite(Date.parse(item.createTime)) && Date.parse(item.createTime) < submissionStarted;
  if (snapshot.builds.some(b => (!['READY','FAILED','DELETED','CANCELLED'].includes(b.state) && !oldSkipped(b)) || b.reconciling) || snapshot.rollouts.some(r => (!['SUCCEEDED','FAILED','CANCELLED'].includes(r.state) && !oldSkipped(r)) || r.reconciling) || snapshot.operations.some(o => !o.done)) throw Error('Deployment may still be active or its outcome is unknown; do not abandon');
  const traffic = snapshot.traffic;
  if (!traffic.autoDisabled || traffic.reconciling || traffic.current.length !== 1 || traffic.current[0].percent !== 100 || (traffic.target.length && digest(traffic.target) !== digest(traffic.current))) throw Error('Traffic is not quiescent; do not abandon');
  const matches = snapshot.rollouts.filter(r => r.name === `${intent.backend}/rollouts/${rolloutId}`);
  if (matches.length !== 1) throw Error('Terminal rollout identity is missing or ambiguous');
  const rollout = matches[0]; const build = snapshot.builds.find(b => b.name === rollout.build);
  if (!build || build.sourceSha !== intent.sourceSha || !Number.isFinite(Date.parse(rollout.createTime)) || Date.parse(rollout.createTime) < Date.parse(journal.submissionStartedAt) || Date.parse(rollout.createTime) > Date.parse(journal.submissionFinishedAt)) throw Error('Rollout does not prove the original submission outcome');
  const current = snapshot.current;
  exactSha(current.sourceSha);
  if (current.state !== 'SUCCEEDED' || current.percent !== 100 || ![intent.sourceSha, (journal.observedBefore || journal.before).sourceSha].includes(current.sourceSha)) throw Error('Unexpected serving source; preserve intent and investigate');
  if (traffic.current[0].build !== `${intent.backend}/builds/${current.rollout}`) throw Error('Traffic/serving evidence differs');
  return { rollout, build };
}

// The same orchestration is used by the CLI and fault-injection tests. No deployment is submitted here.
export async function reconcileIntent(input, io) {
  const { pointer, journal, t, rolloutId, resolution, reason, operator } = input;
  if (!['abandon','complete'].includes(resolution) || !reason?.trim() || reason.length > 500) throw Error('Reconciliation requires --resolution abandon|complete and a concise --reason');
  const snapshot = await io.inspect();
  const { rollout, build } = assertRecoveryEvidence(pointer.record, journal, snapshot, rolloutId);
  const current = snapshot.current;
  const smoke = await io.smoke(current.sourceSha);
  if (resolution === 'complete' && (rollout.state !== 'SUCCEEDED' || build.state !== 'READY' || current.sourceSha !== pointer.record.sourceSha || !smoke.ok)) throw Error('Cannot complete without healthy exact-source serving evidence');
  if (resolution === 'abandon' && current.sourceSha === pointer.record.sourceSha && smoke.ok) throw Error('Healthy successful rollout must be completed, not abandoned');
  const second = await io.inspect();
  if (digest(second) !== digest(snapshot)) throw Error('Deployment evidence changed during reconciliation; no ledger change permitted');
  const latest = await io.latest();
  if (latest.commit !== pointer.commit) throw Error('Release intent changed during reconciliation');
  const record = { schema: 'fika.release.v1', ...t, ...current, scopeHash: await io.scopeHash(current.sourceSha),
    kind: resolution === 'complete' ? (journal.plan.rollback ? 'rollback' : 'deploy') : 'abandoned',
    previousGood: journal.before, previousGoodRecord: journal.previousGoodRecord,
    releaseId: journal.releaseId, originalIntent: pointer.commit, smoke,
    recovery: { resolution, reason: reason.trim(), operator, rollout: rolloutId, evidenceHash: digest(snapshot), journalHash: digest(journal), at: new Date().toISOString() } };
  if (resolution === 'complete') validateRecord(record, t);
  // Persist an immutable original journal before appending the resolution; a failed CAS never discards evidence.
  await io.archive(journal);
  const commit = await io.append(record, pointer.commit);
  await io.finish({ ...journal, state: resolution === 'complete' ? 'completed' : 'abandoned', resolutionCommit: commit, resolution: record });
  return { commit, record };
}

// ── Guarded resubmission of a staging rollout that provably never reached Firebase ──────────────
// `deploy --resume` normally only verifies. It may resubmit the SAME intent (same release ID, pinned SHA and
// approval) once, and only when independently gathered evidence shows the original submission never reached
// Firebase. Any doubt leaves the intent pending for escalation. No new command and no ledger edit are involved.
export const RESUBMIT_QUIET_MS = 10 * 60 * 1000;
const CLOCK_SKEW_MS = 60 * 1000;
export const submissionAttempts = journal => journal.submissionAttempts?.length
  ? journal.submissionAttempts
  : [{ n: 1, startedAt: journal.submissionStartedAt, finishedAt: journal.submissionFinishedAt, ...(journal.submissionFailure ? { failure: journal.submissionFailure } : {}) }];

export function assertNeverSubmitted({ intent, journal, first, second, audit, now = Date.now(), quietMs = RESUBMIT_QUIET_MS }) {
  assertResume(intent, journal, journal?.plan || {});
  if (journal.plan.environment !== 'staging') throw Error('Automatic resubmission is limited to staging; production submission uncertainty is escalated');
  const attempts = submissionAttempts(journal);
  if (attempts.length !== 1) throw Error('A resubmission was already recorded for this intent; submission state is uncertain, do not resubmit');
  const started = Date.parse(attempts[0].startedAt); const finished = Date.parse(attempts[0].finishedAt); const created = Date.parse(journal.createdAt);
  // appendRecord can push an intent, then fail on its readback fetch before returning.
  // Submission is write-ahead marked only after that call returns. Recover this narrow
  // pre-submission gap without inventing a completed CLI attempt or its timestamps.
  const beforeSubmission = journal.state === 'pending' && !journal.intentCommit &&
    !journal.submissionStartedAt && !journal.submissionFinishedAt && !journal.submissionFailure &&
    !journal.submissionAttempts && intent.createdAt === journal.createdAt;
  if (!Number.isFinite(created) || (!beforeSubmission && ![started, finished].every(Number.isFinite))) throw Error('Submission outcome is unknown: original submitter must have returned');
  const waitMs = (beforeSubmission ? created : finished) + quietMs - now;
  if (waitMs > 0) throw Error(`Quiet period not elapsed; evidence is not yet conclusive (retry in ${Math.ceil(waitMs / 60000)} minute(s))`);
  if (digest(first) !== digest(second)) throw Error('Deployment evidence changed between snapshots; not resubmitting');
  const since = created - CLOCK_SKEW_MS;
  // A missing or unparsable createTime counts as "possibly new": doubt never permits resubmission.
  const possiblyNew = item => !(Date.parse(item.createTime) < since);
  const present = [...first.builds.filter(possiblyNew), ...first.rollouts.filter(possiblyNew)].map(item => item.name);
  if (present.length) throw Error(`Firebase already holds ${present.join(', ')} created after the intent; the submission may have reached Firebase`);
  if (first.operations.length) throw Error('Firebase operations are still in flight; submission state is uncertain');
  const traffic = first.traffic;
  if (!traffic.autoDisabled || traffic.reconciling || traffic.current.length !== 1 || traffic.current[0].percent !== 100 || (traffic.target.length && digest(traffic.target) !== digest(traffic.current))) throw Error('Traffic is not quiescent; not resubmitting');
  const before = journal.observedBefore || journal.before; const current = first.current;
  if (current.state !== 'SUCCEEDED' || current.percent !== 100 || current.sourceSha !== before.sourceSha || current.rollout !== before.rollout || traffic.current[0].build !== `${intent.backend}/builds/${current.rollout}`) throw Error('Serving state differs from the state recorded before the submission; not resubmitting');
  if (!audit?.readable) throw Error('Cloud Audit Logs could not be read; non-submission cannot be proven');
  if (audit.events.length) throw Error(`Cloud Audit Logs show ${audit.events.length} App Hosting create call(s) after the intent; the submission may have reached Firebase`);
  return beforeSubmission ? [{ n: 1, phase: 'not-started-before-intent-readback' }] : attempts;
}

/** io: inspect, audit(sinceMs), claim(expectedAttempts, nextJournal), submit, finish(n, patch), now. Exactly one invocation can claim. */
export async function resubmitNeverSubmitted({ intent, journal }, io) {
  const now = () => io.now?.() ?? Date.now();
  const first = await io.inspect(); const audit = await io.audit(Date.parse(journal.createdAt) - CLOCK_SKEW_MS); const second = await io.inspect();
  const attempts = assertNeverSubmitted({ intent, journal, first, second, audit, now: now() });
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
    : `Firebase holds no build or rollout created after the intent (serving ${snapshot.current.sourceSha.slice(0, 8)} at ${snapshot.current.percent}%): the submission has not reached Firebase.`;
}
