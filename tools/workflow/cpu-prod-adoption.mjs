import { target, exactSha, digest, validateRecord, REPO } from './policy.mjs';
import { backendPath, cloud } from './runtime.mjs';
import { discover } from './discovery.mjs';

export function assertCpuAdoptionTarget(t) {
  if (digest(t) !== digest(target('cpu', 'prod'))) throw Error('Completed-rollout adoption is restricted to CPU production');
}
const buildEvidence = b => ({ name:b.name, state:b.state, reconciling:b.reconciling, createTime:b.createTime, updateTime:b.updateTime, source:b.source?.codebase });
const rolloutEvidence = r => ({ name:r.name, build:r.build, state:r.state, reconciling:r.reconciling, createTime:r.createTime, updateTime:r.updateTime });

// Deliberate operator-only discovery. Never retain build environment/secret configuration.
export async function observeCpuAdoption(t, rolloutId, read = cloud) {
  assertCpuAdoptionTarget(t);
  if (!/^[\w-]+$/.test(rolloutId || '')) throw Error('Pin the exact completed --rollout');
  const base = backendPath(t);
  const list = (resource, key, select) => discover(resource, key, select, async url => {
    const page = await read(url);
    if (!Array.isArray(page?.[key])) throw Error(`Missing ${key} discovery evidence`);
    return page;
  });
  const [backend, traffic, rollout, builds, rollouts, operations] = await Promise.all([
    read(base), read(`${base}/traffic`), read(`${base}/rollouts/${rolloutId}`),
    list(`${base}/builds`, 'builds', buildEvidence), list(`${base}/rollouts`, 'rollouts', rolloutEvidence),
    list(`projects/${t.project}/locations/${t.region}/operations`, 'operations', o => ({name:o.name, done:o.done, target:o.metadata?.target || o.response?.name || null})),
  ]);
  if (!String(rollout?.build).startsWith(`${base}/builds/`) || !/^[\w-]+$/.test(rollout.build.slice(`${base}/builds/`.length))) throw Error('Rollout build is outside CPU production');
  const build = buildEvidence(await read(rollout.build));
  return { backend:{name:backend.name, environment:backend.environment, uri:backend.uri, appId:backend.appId, reconciling:backend.reconciling, codebase:backend.codebase},
    traffic, build, rollout:rolloutEvidence(rollout), builds, rollouts,
    operations:operations.filter(o => o.done !== true && (!o.target || new RegExp(`^projects/(?:${t.project}|[0-9]+)/locations/${t.region}/backends/${t.backend}(?:/|$)`).test(o.target) || !o.target.includes('/backends/'))) };
}

export function validateCpuAdoption(t, snapshot, sha, rolloutId, previous, provenance) {
  assertCpuAdoptionTarget(t); exactSha(sha); exactSha(previous?.commit);
  validateRecord(previous?.record, t);
  if (previous.record.sourceSha === sha) throw Error('CPU ledger already records this source; no adoption needed');
  const base = backendPath(t), {backend:b, traffic, build, rollout} = snapshot;
  if (b?.name !== base || b.environment !== 'production' || b.reconciling !== false || b.uri !== `${t.backend}--${t.project}.${t.region}.hosted.app` ||
      !new RegExp(`^projects/${t.project}/locations/${t.region}/connections/[^/]+/gitRepositoryLinks/derekfika-fika-os$`).test(b.codebase?.repository || '') ||
      !['apps/cpu-production','/apps/cpu-production'].includes(b.codebase?.rootDirectory)) throw Error('CPU production backend identity is not verified');
  if (!/^[\w-]+$/.test(rolloutId || '') || rollout?.name !== `${base}/rollouts/${rolloutId}` || rollout.state !== 'SUCCEEDED' || rollout.reconciling !== false ||
      rollout.build !== build?.name || !String(build?.name).startsWith(`${base}/builds/`) || !/^[\w-]+$/.test(build.name.slice(`${base}/builds/`.length))) throw Error('Completed CPU rollout identity is not verified');
  if (build.state !== 'READY' || build.reconciling !== false || build.source?.hash !== sha || build.source?.commit !== sha || build.source?.uri !== `https://github.com/${REPO}/commit/${sha}`) throw Error('CPU build does not prove the exact READY source');
  const projectNumber = /^1:([0-9]+):web:[a-f0-9]+$/.exec(b.appId || '')?.[1];
  if (!projectNumber) throw Error('CPU Firebase app/project number is not verified');
  const splits = traffic?.current?.splits, wanted = build.name.slice(`projects/${t.project}`.length);
  const matches = name => new RegExp(`^projects/(?:${t.project}|${projectNumber})${wanted}$`).test(name || '');
  if (traffic?.rolloutPolicy?.disabled !== true || traffic.reconciling !== false || splits?.length !== 1 || splits[0].percent !== 100 || !matches(splits[0].build) ||
      (traffic.target?.splits?.length && (traffic.target.splits.length !== 1 || traffic.target.splits[0].percent !== 100 || !matches(traffic.target.splits[0].build)))) throw Error('CPU traffic is not quiescent at the selected 100% build');
  for (const [rows, selected, states, cutoff] of [[snapshot.builds,build,['READY','FAILED','DELETED','CANCELLED'],build.createTime], [snapshot.rollouts,rollout,['SUCCEEDED','FAILED','CANCELLED'],rollout.createTime]]) {
    if (!Array.isArray(rows) || !rows.length || new Set(rows.map(r=>r.name)).size !== rows.length || !Number.isFinite(Date.parse(cutoff))) throw Error('Incomplete or ambiguous CPU discovery');
    if (rows.filter(r=>r.name===selected.name).length !== 1 || digest(rows.find(r=>r.name===selected.name)) !== digest(selected)) throw Error('Direct and discovered CPU release evidence differ');
    for (const row of rows) {
      const time = Date.parse(row.createTime);
      if (!Number.isFinite(time) || (row.name !== selected.name && time >= Date.parse(cutoff)) || row.reconciling !== false || (!states.includes(row.state) && !(row.state === 'SKIPPED' && time < Date.parse(cutoff)))) throw Error('A subsequent, active or unknown CPU build/rollout prevents adoption');
    }
  }
  if (!Array.isArray(snapshot.operations) || snapshot.operations.length) throw Error('CPU operations may still be in flight');
  const pr = provenance?.pr, gate = provenance?.validation;
  if (!provenance?.integrated || !provenance?.preservesPrevious || !Number.isInteger(pr?.number) || !pr.merged || !pr.merged_at || pr.merge_commit_sha !== sha || pr.base?.ref !== 'main' || pr.base?.repo?.full_name !== REPO ||
      gate?.sha !== sha || !gate.id || !gate.url) throw Error('Merged main/CI/previous-source provenance is not verified');
  return { sourceSha:sha, rollout:rolloutId, state:'SUCCEEDED', percent:100 };
}

// Tests exercise this same orchestration with fault-injected inspection, ledger and archive IO.
// There is deliberately no rollout submission capability in this interface.
export async function adoptCompletedCpu(input, io) {
  const {t, sha, rolloutId, previous, provenance, execute, authorization} = input;
  const first = await io.inspect();
  const serving = validateCpuAdoption(t, first, sha, rolloutId, previous, provenance);
  const health = await io.smoke(first.backend.uri, sha);
  if (!health?.ok || health.status !== 200) throw Error('Healthy CPU serving probe required');
  const second = await io.inspect();
  if (digest(first) !== digest(second)) throw Error('CPU deployment evidence changed; no adoption permitted');
  if ((await io.latest())?.commit !== previous.commit) throw Error('CPU ledger changed; retry from current pointer');
  await io.assertJournal();
  if (!execute) return {dryRun:true, ...serving, build:first.build.name.split('/').at(-1), priorLedgerCommit:previous.commit, snapshotsStable:true, health, provenance};
  if (authorization?.action !== 'reconcile:adopt-completed' || authorization.app !== 'cpu' || authorization.environment !== 'prod' || authorization.sourceSha !== sha || authorization.releaseId !== previous.commit ||
      authorization.explicitExecute !== true || !['authenticated-repository-writer','authorised-workflow-dispatch'].includes(authorization.method) || !authorization.actor || !authorization.instruction || !Number.isFinite(Date.parse(authorization.authorisedAt))) throw Error('Exact authenticated execution evidence is required for CPU adoption');
  const record = {schema:'fika.release.v1', ...t, ...serving, kind:'baseline', scopeHash:await io.scopeHash(sha), observedAt:new Date().toISOString(),
    previousGood:{sourceSha:previous.record.sourceSha, rollout:previous.record.rollout, state:previous.record.state, percent:previous.record.percent}, previousGoodRecord:previous.commit,
    approval:authorization, provenance, smoke:health,
    reconciliation:{type:'completed-rollout-adoption', priorLedgerCommit:previous.commit, build:first.build.name.split('/').at(-1), rollout:rolloutId,
      evidenceHash:digest(first), historicalGovernance:'Historical deployment authorization not established by this adoption; no rollout was submitted and no intent was invented.'}};
  validateRecord(record,t);
  const evidence = {record, snapshot:first};
  await io.archive(evidence);
  const commit = await io.append(record,previous.commit);
  const written = await io.latest();
  if (written?.commit !== commit || digest(written.record) !== digest(record)) throw Error('CPU adoption readback mismatch; preserve archive and inspect before retrying');
  return {status:'reconciled', commit, record, snapshotsStable:true};
}
