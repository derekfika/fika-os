import test from 'node:test';
import assert from 'node:assert/strict';
import { target } from './policy.mjs';
import { backendPath } from './runtime.mjs';
import { validateServingBaselineSnapshot, observeServingBaseline, servingBaselineRecord, reconcileServingBaseline } from './releases.mjs';

const t=target('menu','staging'),sha='f'.repeat(40),rolloutId='rollout-2026-10-28-000',buildId='build-2026-10-28-003',base=backendPath(t);
function fixture(){
  const buildName=`${base}/builds/${buildId}`;
  const snapshot={backend:{name:base,environment:'staging',uri:`${t.backend}--${t.project}.${t.region}.hosted.app`,reconciling:false,codebase:{repository:'projects/fika-os-dev/locations/europe-west4/connections/fixture/gitRepositoryLinks/derekfika-fika-os',rootDirectory:'apps/menu-planning'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:`projects/594727519934/locations/${t.region}/backends/${t.backend}/builds/${buildId}`,percent:100}]}},build:{name:buildName,state:'READY',reconciling:false,source:{codebase:{hash:sha,commit:sha,uri:`https://github.com/derekfika/fika-os/commit/${sha}`}}},rollout:{name:`${base}/rollouts/${rolloutId}`,build:buildName,state:'SUCCEEDED',reconciling:false}};
  const previous={commit:'a'.repeat(40),record:{schema:'fika.release.v1',...t,sourceSha:'b'.repeat(40),kind:'baseline',scopeHash:'prior',rollout:'build-previous',state:'SUCCEEDED',percent:100}};
  const authorization={actor:'fixture-owner',method:'authenticated-repository-writer',explicitExecute:true,action:'reconcile:serving-baseline',sourceSha:sha,releaseId:previous.commit,instruction:'Owner approved this exact Menu staging baseline repair',authorisedAt:'2026-10-29T10:00:00.000Z'};
  const health={ok:true,status:200,appId:'menu-planning',buildSha:sha};
  return {snapshot,previous,authorization,health,record:overrides=>servingBaselineRecord(t,{snapshot,expectedSha:sha,expectedRollout:rolloutId,previous,previousCommit:previous.commit,authorization,observedAt:'2026-10-29T10:01:00.000Z',health,scopeHashValue:'fixture-scope',...overrides})};
}

test('Menu staging adoption binds distinct build/rollout IDs and preserves the prior ledger as rollback evidence',()=>{
  const f=fixture();
  assert.deepEqual(validateServingBaselineSnapshot(t,f.snapshot,sha,rolloutId),{sourceSha:sha,rollout:rolloutId,state:'SUCCEEDED',percent:100});
  const record=f.record();
  assert.equal(record.previousGoodRecord,f.previous.commit);
  assert.equal(record.previousGood.sourceSha,f.previous.record.sourceSha);
  assert.equal(record.reconciliation.build,buildId);
  assert.equal(record.reconciliation.rollout,rolloutId);
  assert.equal(record.reconciliation.historicalGovernance.includes('Not established'),true);
  assert.deepEqual(record.reconciliation.excludedRollbackCandidates,[]);
});

test('Menu baseline evidence and health fail closed on target, source, repository, traffic and binding contradictions',()=>{
  for(const mutate of [s=>s.backend.codebase.rootDirectory='/apps/integration-hub',s=>s.backend.codebase.repository='other',s=>s.backend.environment='prod',s=>s.traffic.rolloutPolicy.disabled=false,s=>s.traffic.current.splits[0].percent=99,s=>s.build.source.codebase.commit='c'.repeat(40),s=>s.build.source.codebase.hash='c'.repeat(40),s=>s.build.source.codebase.uri='https://other.invalid',s=>s.rollout.build=`${base}/builds/another`,s=>s.rollout.name=`${base}/rollouts/another`,s=>s.rollout.reconciling=true]){
    const f=fixture();mutate(f.snapshot);assert.throws(()=>f.record());
  }
  const f=fixture();
  for(const other of [target('menu','prod'),target('hub','prod'),target('cpu','staging'),{...t,backend:'fika-os-staging'}])assert.throws(()=>validateServingBaselineSnapshot(other,f.snapshot,sha,rolloutId));
  assert.throws(()=>f.record({health:{...f.health,appId:'hub'}}),/exact expected build identity/);
  assert.throws(()=>f.record({health:{...f.health,buildSha:'d'.repeat(40)}}),/exact expected build identity/);
  assert.throws(()=>f.record({authorization:{...f.authorization,releaseId:'d'.repeat(40)}}),/authorization/);
  assert.throws(()=>f.record({previous:{...f.previous,record:{...f.previous.record,kind:'intent'}}}),/pending intent/);
});

test('baseline observation follows the actual rollout build link and never reads a foreign backend',async()=>{
  const f=fixture(),calls=[];
  const read=async resource=>{calls.push(resource);if(resource===base)return f.snapshot.backend;if(resource===`${base}/traffic`)return f.snapshot.traffic;if(resource===`${base}/rollouts/${rolloutId}`)return f.snapshot.rollout;if(resource===f.snapshot.build.name)return f.snapshot.build;throw Error('Unexpected read');};
  assert.equal((await observeServingBaseline(t,sha,rolloutId,read)).serving.rollout,rolloutId);
  assert.ok(calls.includes(`${base}/builds/${buildId}`));
  assert.equal(calls.includes(`${base}/builds/${rolloutId}`),false);
  f.snapshot.rollout.build='projects/other/locations/europe-west4/backends/other/builds/wrong';
  await assert.rejects(observeServingBaseline(t,sha,rolloutId,read),/outside the selected backend/);
  assert.equal(calls.includes(f.snapshot.rollout.build),false);
});

test('the executable adoption command rejects production and missing owner instructions before any release work',async()=>{
  await assert.rejects(reconcileServingBaseline('menu','staging',{execute:true}),/Explicit owner/);
  await assert.rejects(reconcileServingBaseline('menu','prod',{execute:true,'owner-approved':true,reason:'Fixture'}),/restricted/);
  await assert.rejects(reconcileServingBaseline('cpu','staging',{execute:true,reason:'Fixture'}),/restricted/);
});
