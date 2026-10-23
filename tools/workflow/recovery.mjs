import { digest, exactSha, assertResume, validateRecord } from './policy.mjs';
import { cloud, serving, backendPath } from './runtime.mjs';

const relative = name => String(name).split('/backends/')[1];
async function discover(resource, key, select, read) {
  const rows = []; const seen = new Set(); let token;
  do {
    const page = await read(`${resource}?pageSize=100${token ? `&pageToken=${encodeURIComponent(token)}` : ''}`);
    rows.push(...(page[key] || []).map(select)); token = page.nextPageToken;
    if (token && seen.has(token)) throw Error('Repeated recovery discovery page token');
    if (token) seen.add(token);
  } while (token);
  return rows.sort((a,b) => a.name.localeCompare(b.name));
}
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
