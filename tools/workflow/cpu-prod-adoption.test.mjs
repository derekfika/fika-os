import test from 'node:test';
import assert from 'node:assert/strict';
import {target,REPO} from './policy.mjs';
import {backendPath} from './runtime.mjs';
import {validateCpuAdoption,observeCpuAdoption,adoptCompletedCpu} from './cpu-prod-adoption.mjs';
import {reconcile,executionAuthorization} from './releases.mjs';

const t=target('cpu','prod'),base=backendPath(t),sha='f'.repeat(40),rolloutId='rollout-fixture',buildName=`${base}/builds/build-fixture`;
function fixture(){
  const build={name:buildName,state:'READY',reconciling:false,createTime:'2026-11-02T08:33:57Z',updateTime:'2026-11-02T08:37:01Z',source:{hash:sha,commit:sha,uri:`https://github.com/${REPO}/commit/${sha}`}};
  const rollout={name:`${base}/rollouts/${rolloutId}`,build:buildName,state:'SUCCEEDED',reconciling:false,createTime:'2026-11-02T08:33:59Z',updateTime:'2026-11-02T08:37:07Z'};
  const snapshot={backend:{name:base,environment:'production',uri:`${t.backend}--${t.project}.${t.region}.hosted.app`,appId:'1:397503564317:web:b6174aedc02ae65d3e54f4',reconciling:false,codebase:{repository:`projects/${t.project}/locations/${t.region}/connections/fixture/gitRepositoryLinks/derekfika-fika-os`,rootDirectory:'/apps/cpu-production'}},
    traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:buildName.replace('projects/fika-os/','projects/397503564317/'),percent:100}]}},build,rollout,builds:[structuredClone(build)],rollouts:[structuredClone(rollout)],operations:[]};
  const previous={commit:'a'.repeat(40),record:{schema:'fika.release.v1',...t,sourceSha:'b'.repeat(40),kind:'deploy',scopeHash:'prior',rollout:'build-prior',state:'SUCCEEDED',percent:100}};
  const provenance={integrated:true,preservesPrevious:true,validation:{sha,id:123,url:'https://github.com/fixture/check'},pr:{number:1,merged:true,merged_at:'2026-11-02T08:00:00Z',merge_commit_sha:sha,base:{ref:'main',repo:{full_name:REPO}}}};
  const authorization={action:'reconcile:adopt-completed',app:'cpu',environment:'prod',sourceSha:sha,releaseId:previous.commit,explicitExecute:true,method:'owner-instruction',actor:'fixture-owner',instruction:'Adopt verified existing CPU release',authorisedAt:'2026-11-02T12:00:00Z'};
  const input={t,sha,rolloutId,previous,provenance,authorization,execute:true},calls=[];
  let current=previous;
  const io={inspect:async()=>structuredClone(snapshot),smoke:async()=>({ok:true,status:200}),latest:async()=>current,assertJournal:async()=>{},scopeHash:async()=> 'scope-fixture',
    archive:async e=>calls.push(['archive',e]),append:async(record,expected)=>{calls.push(['append',record,expected]);current={commit:'c'.repeat(40),record};return current.commit;}};
  return {snapshot,input,io,calls};
}

test('adopts a completed missing-intent CPU rollout without submission, preserving rollback and audit evidence',async()=>{
  const f=fixture(),result=await adoptCompletedCpu(f.input,f.io);
  assert.equal(result.status,'reconciled');assert.equal(result.record.kind,'baseline');
  assert.equal(result.record.rollout,rolloutId);assert.equal(result.record.reconciliation.build,'build-fixture');
  assert.equal(result.record.previousGoodRecord,f.input.previous.commit);
  assert.equal(result.record.previousGood.sourceSha,f.input.previous.record.sourceSha);
  assert.equal(result.record.originalIntent,undefined);assert.equal(result.record.releaseId,undefined);
  assert.deepEqual(f.calls.map(c=>c[0]),['archive','append']);
  assert.equal(f.calls[1][2],f.input.previous.commit);
  assert.equal(f.calls[0][1].snapshot.build.config,undefined);
});

test('dry-run validates all observations but writes no ledger or archive',async()=>{
  const f=fixture();f.input.execute=false;delete f.input.authorization;
  assert.equal((await adoptCompletedCpu(f.input,f.io)).dryRun,true);assert.deepEqual(f.calls,[]);
});

test('backend, traffic, source, discovery and merged provenance contradictions fail closed',()=>{
  const mutations=[
    f=>f.input.t=target('cpu','staging'),f=>f.input.t=target('menu','prod'),
    f=>f.snapshot.backend.environment='staging',f=>f.snapshot.backend.reconciling=true,
    f=>f.snapshot.backend.codebase.repository='other',f=>f.snapshot.backend.codebase.rootDirectory='/apps/menu-planning',
    f=>f.snapshot.backend.uri='other.invalid',f=>f.snapshot.backend.name='other',
    f=>delete f.snapshot.backend.appId,
    f=>f.snapshot.traffic.current.splits[0].build=buildName.replace('projects/fika-os/','projects/999/'),
    f=>f.snapshot.traffic.current.splits[0].percent=99,f=>f.snapshot.traffic.rolloutPolicy.disabled=false,
    f=>f.snapshot.traffic.reconciling=true,f=>f.snapshot.traffic.current.splits.push(f.snapshot.traffic.current.splits[0]),
    f=>f.snapshot.traffic.current.splits[0].build='projects/1/locations/europe-west4/backends/other/builds/build-fixture',
    f=>f.snapshot.traffic.target={splits:[{build:buildName,percent:50}]},
    f=>f.snapshot.build.source.hash='d'.repeat(40),f=>f.snapshot.build.source.commit='d'.repeat(40),f=>f.snapshot.build.source.uri='other',
    f=>f.snapshot.build.state='FAILED',f=>f.snapshot.build.reconciling=true,
    f=>f.snapshot.rollout.build='other',f=>f.snapshot.rollout.name='other',f=>f.snapshot.rollout.state='FAILED',
    f=>f.snapshot.builds=[],f=>f.snapshot.rollouts=[],f=>f.snapshot.builds.push(structuredClone(f.snapshot.build)),
    f=>f.snapshot.rollouts[0].state='FAILED',f=>delete f.snapshot.builds[0].createTime,
    f=>f.snapshot.builds.push({...f.snapshot.build,name:`${base}/builds/newer`,createTime:'2026-11-02T10:00:00Z'}),
    f=>f.snapshot.builds.push({...f.snapshot.build,name:`${base}/builds/same-time`}),
    f=>f.snapshot.rollouts.push({...f.snapshot.rollout,name:`${base}/rollouts/active`,state:'QUEUED',createTime:'2026-11-02T08:00:00Z'}),
    f=>f.snapshot.operations.push({done:false}),f=>f.input.previous.record.kind='intent',
    f=>f.input.previous.record.sourceSha=sha,f=>f.input.provenance.integrated=false,f=>f.input.provenance.preservesPrevious=false,
    f=>f.input.provenance.pr.merged=false,f=>f.input.provenance.pr.base.repo.full_name='other/repo',
    f=>f.input.provenance.pr.merge_commit_sha='d'.repeat(40),f=>f.input.provenance.validation.sha='d'.repeat(40),
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);assert.throws(()=>validateCpuAdoption(f.input.t,f.snapshot,sha,rolloutId,f.input.previous,f.input.provenance),mutate.toString());}
});

test('changed observations, ledger, journal, health, archive failure and authorization permit no append',async()=>{
  const mutations=[
    f=>{let n=0;f.io.inspect=async()=>{const s=structuredClone(f.snapshot);if(n++)s.backend.reconciling=true;return s;};},
    f=>f.io.latest=async()=>({commit:'d'.repeat(40)}),
    f=>f.io.assertJournal=async()=>{throw Error('Pending journal');},
    f=>f.io.smoke=async()=>({ok:false,status:500}),
    f=>f.io.archive=async()=>{throw Error('archive unavailable');},
    f=>delete f.input.authorization,f=>f.input.authorization.releaseId='d'.repeat(40),
    f=>f.input.authorization.sourceSha='d'.repeat(40),f=>f.input.authorization.method='login',
  ];
  for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(adoptCompletedCpu(f.input,f.io));assert.equal(f.calls.some(c=>c[0]==='append'),false);}
});

test('lost compare-and-swap and bad readback surface failure and preserve archive',async()=>{
  const f=fixture();f.io.append=async()=>{throw Error('CAS rejected');};
  await assert.rejects(adoptCompletedCpu(f.input,f.io),/CAS/);assert.equal(f.calls[0][0],'archive');
  const g=fixture();g.io.append=async()=> 'c'.repeat(40);
  await assert.rejects(adoptCompletedCpu(g.input,g.io),/readback/);assert.equal(g.calls[0][0],'archive');
});

test('observer follows distinct build ID, paginates and never retains build configuration',async()=>{
  const f=fixture(),calls=[];
  const read=async url=>{
    calls.push(url);
    if(url===base)return f.snapshot.backend;if(url===`${base}/traffic`)return f.snapshot.traffic;
    if(url===f.snapshot.rollout.name)return f.snapshot.rollout;
    if(url===buildName)return {...f.snapshot.build,source:{codebase:f.snapshot.build.source},config:{env:['must-not-be-retained']}};
    if(url.startsWith(`${base}/builds?`))return {builds:[{...f.snapshot.build,source:{codebase:f.snapshot.build.source}}]};
    if(url===`${base}/rollouts?pageSize=100`)return {rollouts:[],nextPageToken:'next'};
    if(url===`${base}/rollouts?pageSize=100&pageToken=next`)return {rollouts:[f.snapshot.rollout]};
    if(url.includes('/operations?'))return {operations:[]};throw Error(`Unexpected ${url}`);
  };
  const observed=await observeCpuAdoption(t,rolloutId,read);
  assert.equal(observed.build.name,buildName);assert.equal(observed.build.config,undefined);
  validateCpuAdoption(t,observed,sha,rolloutId,f.input.previous,f.input.provenance);
  assert.ok(calls.some(c=>c.includes('pageToken=next')));
  await assert.rejects(observeCpuAdoption(t,rolloutId,async url=>url.includes('/operations?')?{}:read(url)),/Missing operations/);
});

test('existing CLI reconcile dispatch restricts adoption target and production authority remains explicit',async()=>{
  await assert.rejects(reconcile('menu','prod',{resolution:'adopt-completed'}),/restricted/);
  await assert.rejects(reconcile('cpu','staging',{resolution:'adopt-completed'}),/restricted/);
  const access={env:{},github:url=>url==='user'?{login:'fixture-owner',type:'User'}:{permissions:{push:true},owner:{login:'fixture-owner'}}};
  assert.throws(()=>executionAuthorization(t,sha,{action:'reconcile:adopt-completed'},access),/Explicit owner/);
  assert.equal(executionAuthorization(t,sha,{action:'reconcile:adopt-completed','owner-approved':true,reason:'Fixture approved adoption'},access).action,'reconcile:adopt-completed');
});
