import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { APPS, MAIN_CHECK, REPO, target } from './policy.mjs';
import { appendRecord, deploy, releaseRecord, rolloutArguments } from './releases.mjs';
import { backendPath, git, jsonFile, save, scopeHash, stateDir, withRepository } from './runtime.mjs';

async function fixture(run) {
  const temporary = mkdtempSync(path.join(os.tmpdir(), 'fika-release-execution-'));
  const repository = path.join(temporary, 'work');
  const remote = path.join(temporary, 'remote.git');
  mkdirSync(repository);
  const git = (...args) => execFileSync('git', args, { cwd:repository, encoding:'utf8', stdio:['ignore','pipe','pipe'] }).trim();
  const commit = (name, content) => {
    const file = path.join(repository, name);
    mkdirSync(path.dirname(file), { recursive:true });
    writeFileSync(file, content);
    git('add', name); git('commit', '-m', content);
    return git('rev-parse', 'HEAD');
  };
  try {
    git('init','-b','main'); git('init','--bare',remote);
    git('config','user.name','Release fixture'); git('config','user.email','fixture@example.invalid');
    const baseline = commit('README.md','Serving baseline');
    const authmod = commit('apps/integration-hub/app/api/authmod/route.ts','Security fix');
    const shared = commit('packages/server-shared/src/contract.ts','Cross-app backend change');
    git('remote','add','origin',remote); git('push','-u','origin','main');
    git('switch','-c','unmerged');
    const unmerged = commit('README.md','Unmerged candidate');
    git('switch','main');
    return await withRepository(repository, () => run({ baseline, authmod, shared, unmerged }));
  } finally {
    assert.equal(path.dirname(path.resolve(temporary)), path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary), /^fika-release-execution-/);
    rmSync(temporary,{recursive:true,force:true});
  }
}

function releaseIO(t, sourceSha) {
  const base = backendPath(t);
  const builds = [], rollouts = [], calls = [], submitted = [];
  const projectNumber = t.environment === 'prod' ? '397503564317' : '594727519934';
  const backend = { name:base, environment:t.environment === 'prod' ? 'production' : 'staging', reconciling:false,
    uri:`${t.backend}--${t.project}.${t.region}.hosted.app`,
    codebase:{rootDirectory:APPS[t.app].path,repository:`projects/${t.project}/locations/${t.region}/connections/fixture/gitRepositoryLinks/derekfika-fika-os`} };
  const traffic = { rolloutPolicy:{disabled:true}, reconciling:false };
  const operations = [];
  const setServing = sha => {
    const build = { name:`${base.replace(t.project, projectNumber)}/builds/build-${builds.length+1}`, state:'READY', createTime:'2026-10-30T10:00:00Z',
      source:{codebase:{hash:sha,commit:sha,uri:`https://github.com/${REPO}/commit/${sha}`}} };
    const rollout = { name:`${base}/rollouts/rollout-${rollouts.length+1}`, state:'SUCCEEDED', build:build.name, createTime:build.createTime };
    builds.push(build); rollouts.push(rollout);
    traffic.current = { splits:[{build:build.name,percent:100}] };
    return { build, rollout };
  };
  setServing(sourceSha);
  const state = { githubWrite:true, conclusion:'success', provenance:true, smoke:true, interrupt:false, firebaseAuth:true };
  const io = {
    env:{},
    github(endpoint) {
      if (endpoint === 'user') return { login:'fixture-operator',type:'User' };
      if (endpoint === `repos/${REPO}`) return { permissions:{push:state.githubWrite},owner:{login:'different-owner'} };
      const match = endpoint.match(/\/commits\/([a-f0-9]{40})\/(pulls|check-runs)\?/);
      assert.ok(match, endpoint);
      const [,sha,type] = match;
      return type === 'pulls' ? (state.provenance ? [{ number:434, merge_commit_sha:sha === state.historicalHead ? 'c'.repeat(40) : sha, merged_at:'2026-11-06', base:{ref:'main',repo:{full_name:REPO}}, head:{sha} }] : []) :
        { check_runs:state.conclusion ? [{name:MAIN_CHECK,head_sha:sha,app:{slug:'github-actions'},conclusion:state.conclusion}] : [] };
    },
    async read(resource) {
      calls.push(resource);
      if (resource === base) return backend;
      if (resource === `${base}/traffic`) return traffic;
      if (resource.startsWith(`${base}/builds?`)) return { builds };
      if (resource.startsWith(`${base}/rollouts?`)) return { rollouts };
      if (resource.startsWith(`projects/${t.project}/locations/${t.region}/operations?`)) return { operations };
      const row = [...builds,...rollouts].find(item => item.name === resource);
      if (row) return row;
      throw Object.assign(Error(`Unexpected resource ${resource}`),{status:404});
    },
    smoke:async () => ({ok:state.smoke,status:state.smoke ? 200 : 503}),
    audit:() => ({readable:false,events:[]}),
    preflight(selected) {
      assert.deepEqual(selected,t);
      if (!state.firebaseAuth) throw Error('Firebase credentials unavailable');
    },
    submit(plan) {
      assert.equal(releaseRecord(t.branch).record.kind,'intent');
      submitted.push(rolloutArguments(plan));
      setServing(plan.sourceSha);
      if (state.interrupt) throw Error('Simulated CLI interruption after Firebase accepted the rollout');
    },
  };
  return { io, state, backend, traffic, operations, builds, rollouts, submitted, setServing, calls };
}

test('AUTHMOD and shared/backend merged sources deploy directly to production without a staging ledger or approval, then roll back', () => fixture(async ({baseline,authmod,shared}) => {
  const t = target('hub','prod');
  const f = releaseIO(t,baseline);
  const plan = await deploy(t.app,t.environment,{sha:authmod},f.io);
  assert.equal(plan.plan.sourceSha,authmod);
  assert.deepEqual(plan.plan.productionDelta.paths,['apps/integration-hub/app/api/authmod/route.ts']);
  assert.equal(plan.willRecordObservedBaseline,true);
  assert.equal(releaseRecord(t.branch),undefined);
  const first = await deploy(t.app,t.environment,{execute:true,sha:authmod},f.io);
  assert.equal(first.record.previousGood.sourceSha,baseline);
  assert.equal(releaseRecord(t.branch).record.sourceSha,authmod);
  assert.equal(first.record.approval.actor,'fixture-operator');
  assert.equal(first.record.stagingEvidence,undefined);
  assert.equal(first.record.lane,undefined);
  const second = await deploy(t.app,t.environment,{execute:true},f.io);
  assert.equal(second.record.sourceSha,shared);
  assert.deepEqual(second.record.productionDelta.paths,['packages/server-shared/src/contract.ts']);
  // A previous deployment recorded the exact PR head before it was merged.
  f.state.historicalHead = authmod;
  await assert.rejects(deploy(t.app,t.environment,{execute:true,sha:authmod},f.io),/result of a merged PR/);
  const restored = await deploy(t.app,t.environment,{execute:true,rollback:true},f.io);
  assert.equal(restored.record.kind,'rollback');
  assert.equal(restored.record.sourceSha,authmod);
  assert.deepEqual(f.submitted.map(args=>args[args.indexOf('--git-commit')+1]),[authmod,shared,authmod]);
  assert.equal(releaseRecord(target('hub','staging').branch),undefined);
  assert.ok(f.calls.every(resource=>!resource.includes('fika-os-dev')));
}));

test('stale ledger is appended to without erasing history, and interrupted rollout resumes without another submission', () => fixture(async ({baseline,authmod,shared}) => {
  const t = target('hub','prod');
  const f = releaseIO(t,authmod);
  const old = appendRecord(t,{schema:'fika.release.v1',...t,kind:'baseline',sourceSha:baseline,rollout:'old-rollout',
    state:'SUCCEEDED',percent:100,scopeHash:scopeHash(t.app,baseline),lane:'standard',stagingEvidence:'historical'},undefined);
  f.state.interrupt = true;
  await assert.rejects(deploy(t.app,t.environment,{execute:true},f.io),/use --resume/);
  const intent = releaseRecord(t.branch);
  assert.equal(intent.record.previousGood.sourceSha,authmod);
  assert.equal(intent.record.kind,'intent');
  await assert.rejects(deploy(t.app,t.environment,{execute:true},f.io),/Pending distributed release intent/);
  await assert.rejects(deploy(t.app,t.environment,{execute:true,resume:true,sha:authmod},f.io),/differs from original/);
  f.state.smoke = false;
  await assert.rejects(deploy(t.app,t.environment,{execute:true,resume:true},f.io),/health probe failed/);
  assert.equal(releaseRecord(t.branch).commit,intent.commit);
  f.state.smoke = true;
  const resumed = await deploy(t.app,t.environment,{execute:true,resume:true},f.io);
  assert.equal(resumed.record.releaseId,intent.record.releaseId);
  assert.equal(resumed.record.sourceSha,shared);
  assert.equal(f.submitted.length,1);
  const adopted = intent.record.previousGoodRecord;
  assert.equal(resumed.record.previousGoodRecord,adopted);
  assert.equal(git('rev-parse', `${adopted}^1`),old);
  assert.equal(JSON.parse(git('show', `${old}:release.json`)).stagingEvidence,'historical');
}));

test('optional staging accepts the same merged source contract and rejects absent/red CI and unmerged or unproven commits', () => fixture(async ({baseline,unmerged,shared}) => {
  const t = target('hub','staging');
  const f = releaseIO(t,baseline);
  for (const conclusion of ['failure',null]) {
    f.state.conclusion = conclusion;
    await assert.rejects(deploy(t.app,t.environment,{execute:true},f.io),/has not passed/);
  }
  f.state.conclusion = 'success';
  await assert.rejects(deploy(t.app,t.environment,{execute:true,sha:unmerged},f.io),/integrated into origin\/main/);
  f.state.provenance = false;
  await assert.rejects(deploy(t.app,t.environment,{execute:true},f.io),/merged PR/);
  assert.equal(f.submitted.length,0);
  assert.equal(releaseRecord(t.branch),undefined);
  f.state.provenance = true;
  const result = await deploy(t.app,t.environment,{execute:true},f.io);
  assert.equal(result.record.sourceSha,shared);
  assert.equal(f.submitted[0][3],'fika-os-dev');
}));

test('production fails before writing intent for missing credentials or uncertain Firebase state', () => fixture(async ({baseline}) => {
  const t = target('hub','prod');
  const f = releaseIO(t,baseline);
  const run = () => deploy(t.app,t.environment,{execute:true},f.io);
  f.state.githubWrite = false;
  await assert.rejects(run(),/authenticated repository writer/);
  f.state.githubWrite = true;
  f.state.firebaseAuth = false;
  await assert.rejects(run(),/Firebase credentials unavailable/);
  f.state.firebaseAuth = true;
  f.backend.name = f.backend.name.replace('projects/fika-os/','projects/wrong/');
  await assert.rejects(run(),/backend, project/);
  f.backend.name = backendPath(t);
  f.operations.push({name:'operations/pending',metadata:{target:backendPath(t)}});
  await assert.rejects(run(),/active or unknown/);
  f.operations.pop();
  f.rollouts[0].state = 'UNKNOWN_STATE';
  await assert.rejects(run(),/does not verify/);
  f.rollouts[0].state = 'SUCCEEDED';
  f.builds[0].source.codebase.commit = 'a'.repeat(40);
  await assert.rejects(run(),/exact FIKA repository commit/);
  f.builds[0].source.codebase.commit = baseline;
  f.traffic.current.splits[0].build = f.builds[0].name.replace('397503564317','594727519934');
  await assert.rejects(run(),/outside the selected backend/);
  f.traffic.current.splits[0].build = f.builds[0].name;
  f.traffic.current.splits[0].percent = 90;
  await assert.rejects(run(),/not quiescent/);
  assert.equal(f.submitted.length,0);
  assert.equal(releaseRecord(t.branch),undefined);
}));

test('proven pre-submission failure claims one production retry in the remote ledger before submission', () => fixture(async ({baseline,shared}) => {
  const t = target('hub','prod');
  const f = releaseIO(t,baseline);
  const submit = f.io.submit;
  f.io.submit = () => { throw Error('Simulated pre-submission failure'); };
  await assert.rejects(deploy(t.app,t.environment,{execute:true},f.io),/use --resume/);
  const initial = releaseRecord(t.branch);
  const file = path.join(stateDir(),'release-hub-prod.json');
  const journal = jsonFile(file);
  const earlier = '2026-10-31T12:00:00Z';
  save(file,{...journal,createdAt:earlier,submissionStartedAt:earlier,submissionFinishedAt:earlier,
    submissionAttempts:[{...journal.submissionAttempts[0],startedAt:earlier,finishedAt:earlier}]});
  f.io.audit = () => ({readable:true,events:[]});
  f.io.submit = plan => {
    const claimed = releaseRecord(t.branch);
    assert.equal(claimed.record.retryClaim.originalIntent,initial.commit);
    assert.equal(claimed.record.retryClaim.attempt,2);
    assert.equal(git('rev-parse',`${claimed.commit}^1`),initial.commit);
    submit(plan);
  };
  const result = await deploy(t.app,t.environment,{execute:true,resume:true},f.io);
  assert.equal(result.record.sourceSha,shared);
  assert.equal(result.record.releaseId,initial.record.releaseId);
  assert.equal(f.submitted.length,1);
  await assert.rejects(deploy(t.app,t.environment,{execute:true,resume:true},f.io),/No matching pending release/);
}));
