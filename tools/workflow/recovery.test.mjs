import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, target } from './policy.mjs';
import { recoverySnapshot, reconcileIntent, assertRecoveryEvidence } from './recovery.mjs';
import { backendPath } from './runtime.mjs';
// Isolated fixture supports the first-release recovery test on its own PR;
// production registration remains governed by policy.mjs in the dependent PR.
APPS.adhoc ||= {path:'apps/ad-hoc-production',staging:'fika-os-staging-adhoc',prod:'fika-os-prod-adhoc'};
test('recovery discovery paginates all histories and records no build environment or operation response payloads',async()=>{
 const t=target('cpu','staging');const prefix=`projects/123/locations/europe-west4/backends/${t.backend}`;const calls=[];
 const read=async resource=>{calls.push(resource);if(resource.endsWith('/traffic'))return {rolloutPolicy:{disabled:true},current:{splits:[{build:`${prefix}/builds/old`,percent:100}]}};
  if(resource.includes('/builds?'))return {builds:[{name:`${prefix}/builds/${resource.includes('pageToken=')?'second':'first'}`,state:'READY',config:{env:[{value:'DO_NOT_COPY'}]}}],...(resource.includes('pageToken=')?{}:{nextPageToken:'page2'})};
  if(resource.includes('/rollouts?'))return {rollouts:[],...(resource.includes('pageToken=')?{}:{nextPageToken:'page2'})};
  return {operations:[{name:'completed',done:true,response:{secret:'DO_NOT_COPY'}},{name:'other',metadata:{target:'projects/123/locations/europe-west4/backends/other-backend'}},{name:'unknown',done:false}]};};
 const s=await recoverySnapshot(t,read,async()=>({sourceSha:'a'.repeat(40),rollout:'old',state:'SUCCEEDED',percent:100}));
 assert.equal(s.builds.length,2);assert.equal(calls.filter(c=>c.includes('pageToken=')).length,2);assert.deepEqual(s.operations.map(o=>o.name),['unknown']);assert.equal(JSON.stringify(s).includes('DO_NOT_COPY'),false);
});

test('empty backend is represented only after backend identity, traffic and history are proven empty', async()=>{
 const t=target('adhoc','prod'), base=backendPath(t), calls=[];
 const read=async resource=>{calls.push(resource);if(resource===base)return {name:base,environment:'production',reconciling:false,codebase:{rootDirectory:'/apps/ad-hoc-production',repository:'projects/123/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os'}};if(resource.endsWith('/traffic'))return {rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[]},target:{splits:[]}};if(resource.includes('/builds?'))return {builds:[]};if(resource.includes('/rollouts?'))return {rollouts:[]};return {operations:[]};};
 const snapshot=await recoverySnapshot(t,read,async()=>{throw Error('serving should not be queried for empty backend');});
 assert.equal(snapshot.current.state,'EMPTY');assert.equal(snapshot.current.sourceSha,null);assert.deepEqual(snapshot.traffic.current,[]);assert.equal(calls.includes(base),true);
 await assert.rejects(recoverySnapshot(t,async resource=>resource.endsWith('/traffic')?{rolloutPolicy:{disabled:false},current:{splits:[]},target:{splits:[]}}:read(resource),async()=>{throw Error('serving')}),/not quiescent/);
});

test('Beverage empty recovery is restricted to the exact staging backend identity',async()=>{
 const t=target('beverage','staging'),base=backendPath(t),backend={name:base,environment:'staging',reconciling:false,codebase:{rootDirectory:'/apps/beverage-innovation',repository:'projects/fika-os-dev/locations/europe-west4/connections/apphosting-github-conn/gitRepositoryLinks/derekfika-fika-os'}};
 const read=async resource=>resource===base?backend:resource.endsWith('/traffic')?{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[]},target:{splits:[]}}:resource.includes('/builds?')?{builds:[]}:resource.includes('/rollouts?')?{rollouts:[]}:{operations:[]};
 const snapshot=await recoverySnapshot(t,read,async()=>{throw Error('serving should not be queried for empty backend');});
 assert.equal(snapshot.current.state,'EMPTY');assert.equal(snapshot.backend.environment,'staging');
 const sourceSha='a'.repeat(40),releaseId='beverage-preview-first-release',plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'owner-authorized'}};
 const journal={releaseId,plan,before:null,previousGoodRecord:null,firstRelease:true,submissionStartedAt:'2026-11-07T10:00:00Z',submissionFinishedAt:'2026-11-07T10:01:00Z'};
 const intent={schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null};
 const wrongEnvironment=structuredClone(snapshot);wrongEnvironment.backend.environment='production';
 assert.throws(()=>assertRecoveryEvidence(intent,journal,wrongEnvironment,'none',{readable:true,events:[]}),/target does not match/);
 assert.throws(()=>target('beverage','prod'),/Unknown application\/environment/);
});

test('failed initial Ad-Hoc release can be abandoned only with exact terminal evidence and empty production traffic', async()=>{
 const t=target('adhoc','prod'), sourceSha='a'.repeat(40), releaseId='initial-123', started='2026-11-03T06:00:00Z', finished='2026-11-03T06:01:00Z';
 const plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'owner-authorized'}};
 const journal={releaseId,plan,before:null,observedBefore:{sourceSha:null,rollout:null,state:'EMPTY',percent:0},previousGoodRecord:null,firstRelease:true,submissionStartedAt:started,submissionFinishedAt:finished};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null}};
 const build={name:`${t.backend}/builds/build-failed`,state:'FAILED',sourceSha,createTime:'2026-11-03T06:00:10Z',reconciling:false};
 const rollout={name:`${t.backend}/rollouts/build-failed`,build:build.name,state:'FAILED',createTime:build.createTime,reconciling:false};
 const snapshot={backend:{name:backendPath(t),environment:'production',rootDirectory:'/apps/ad-hoc-production',repository:'projects/123/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os',reconciling:false},builds:[build],rollouts:[rollout],operations:[],traffic:{current:[],target:[],reconciling:false,autoDisabled:true},current:{sourceSha:null,rollout:null,state:'EMPTY',percent:0}};
 assert.deepEqual(assertRecoveryEvidence(pointer.record,journal,snapshot,'build-failed').firstReleaseEmpty,true);
 const calls=[];const io={inspect:async()=>structuredClone(snapshot),smoke:async()=>{throw Error('no serving smoke for empty backend')},scopeHash:async()=> 'candidate',latest:async()=>pointer,archive:async()=>calls.push('archive'),append:async record=>{calls.push(record);return 'e'.repeat(40)},finish:async()=>calls.push('finish')};
 const out=await reconcileIntent({t,pointer,journal,rolloutId:'build-failed',resolution:'abandon',reason:'Firebase confirmed failed initial rollout',operator:{actor:'owner'}},io);
 assert.equal(out.record.kind,'abandoned');assert.equal(out.record.previousGoodRecord,null);assert.equal(out.record.recovery.noPreviousRelease,true);assert.equal(out.record.state,'FAILED');assert.deepEqual(calls.map(x=>typeof x==='string'?x:x.kind),['archive','abandoned','finish']);
 snapshot.traffic.current=[{build:`${t.backend}/builds/build-failed`,percent:100}];
 assert.throws(()=>assertRecoveryEvidence(pointer.record,journal,snapshot,'build-failed'),/not empty and quiescent/);
});

test('interrupted first-release submission with no rollout is reconciled only with stable empty traffic and readable clean audit logs',async()=>{
 const t=target('adhoc','prod'),sourceSha='f'.repeat(40),releaseId='interrupted-123',started='2026-11-03T06:00:00Z',finished='2026-11-03T06:01:00Z';
 const plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'owner-authorized'}};
 const journal={releaseId,plan,before:null,observedBefore:{sourceSha:null,rollout:null,state:'EMPTY',percent:0},previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:'d'.repeat(40),submissionStartedAt:started,submissionFinishedAt:finished};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null,firstRelease:true}};
 const snapshot={backend:{name:backendPath(t),environment:'production',rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os',reconciling:false},builds:[],rollouts:[],operations:[],traffic:{current:[],target:[],reconciling:false,autoDisabled:true},current:{sourceSha:null,rollout:null,state:'EMPTY',percent:0}};
 const audit={readable:true,events:[]};assert.equal(assertRecoveryEvidence(pointer.record,journal,snapshot,'none',audit).noRollout,true);
 for(const badAudit of [{readable:false,events:[]},{readable:true,events:[{method:'CreateRollout'}]}])assert.throws(()=>assertRecoveryEvidence(pointer.record,journal,snapshot,'none',badAudit),/Audit Logs/);
 const withUnknownBuild=structuredClone(snapshot);withUnknownBuild.builds.push({name:'fika-os-prod-adhoc/builds/unknown',state:'FAILED',createTime:'not-a-time'});assert.throws(()=>assertRecoveryEvidence(pointer.record,journal,withUnknownBuild,'none',audit),/may have reached Firebase/);
 const calls=[],io={inspect:async()=>structuredClone(snapshot),smoke:async()=>{throw Error('no serving smoke')},scopeHash:async()=> 'candidate',latest:async()=>pointer,archive:async()=>calls.push('archive'),append:async record=>{calls.push(record);return 'e'.repeat(40)},finish:async()=>calls.push('finish')};
 const out=await reconcileIntent({t,pointer,journal,rolloutId:'none',resolution:'abandon',reason:'Returned submitter and audit confirm no Firebase rollout',operator:{actor:'owner'},audit},io);
 assert.equal(out.record.kind,'abandoned');assert.equal(out.record.rollout,null);assert.equal(out.record.recovery.noRolloutSubmitted,true);assert.equal(out.record.recovery.auditHash.length,64);
});

test('successful initial Ad-Hoc rollout reconciles as first known-good record with no invented rollback target',async()=>{
 const t=target('adhoc','prod'),sourceSha='9'.repeat(40),releaseId='initial-success-123',started='2026-11-03T06:00:00Z',finished='2026-11-03T06:01:00Z';
 const plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'owner-authorized'}};
 const journal={releaseId,plan,before:null,observedBefore:{sourceSha:null,rollout:null,state:'EMPTY',percent:0},previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:'d'.repeat(40),submissionStartedAt:started,submissionFinishedAt:finished};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null,firstRelease:true}};
 const build={name:`${t.backend}/builds/build-success`,state:'READY',sourceSha,createTime:'2026-11-03T06:00:10Z',reconciling:false};
 const rollout={name:`${t.backend}/rollouts/build-success`,build:build.name,state:'SUCCEEDED',createTime:build.createTime,reconciling:false};
 const snapshot={backend:{name:backendPath(t),environment:'production',rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os',reconciling:false},builds:[build],rollouts:[rollout],operations:[],traffic:{current:[{build:build.name,percent:100}],target:[],reconciling:false,autoDisabled:true},current:{sourceSha,rollout:'build-success',state:'SUCCEEDED',percent:100}};
 assert.equal(assertRecoveryEvidence(pointer.record,journal,snapshot,'build-success').firstReleaseServing,true);
 const calls=[],io={inspect:async()=>structuredClone(snapshot),smoke:async sha=>({ok:sha===sourceSha,status:401}),scopeHash:async()=> 'candidate',latest:async()=>pointer,archive:async()=>calls.push('archive'),append:async record=>{calls.push(record);return 'e'.repeat(40)},finish:async()=>calls.push('finish')};
 const out=await reconcileIntent({t,pointer,journal,rolloutId:'build-success',resolution:'complete',reason:'Serving exact source with protected unauthenticated entry',operator:{actor:'owner'}},io);
 assert.equal(out.record.kind,'deploy');assert.equal(out.record.sourceSha,sourceSha);assert.equal(out.record.previousGood,null);assert.equal(out.record.previousGoodRecord,null);assert.equal(out.record.firstReleaseBaselineRecord,journal.firstReleaseBaselineRecord);assert.equal(out.record.recovery.noPreviousRelease,true);
});

function fixture() {
 const t=target('cpu','staging');const sourceSha='a'.repeat(40);const old='b'.repeat(40);
 const plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'staging:cpu:candidate'}};
 const before={sourceSha:old,rollout:'build-old',state:'SUCCEEDED',percent:100};
 const journal={releaseId:'123',plan,before,previousGoodRecord:'d'.repeat(40),submissionStartedAt:'2026-10-22T12:00:00Z',submissionFinishedAt:'2026-10-22T12:01:00Z'};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId:journal.releaseId,previousGood:before,previousGoodRecord:journal.previousGoodRecord}};
 const build={name:`${t.backend}/builds/build-new`,state:'FAILED',sourceSha,createTime:'2026-10-22T12:00:10Z'};
 const rollout={name:`${t.backend}/rollouts/build-new`,build:build.name,state:'FAILED',createTime:build.createTime,reconciling:false};
 const snapshot={builds:[build],rollouts:[rollout,{name:`${t.backend}/rollouts/build-old`,build:`${t.backend}/builds/build-old`,state:'SUCCEEDED'}],operations:[],traffic:{current:[{build:`${t.backend}/builds/build-old`,percent:100}],target:[],reconciling:false,autoDisabled:true},current:structuredClone(before)};
 const calls=[],smokeSources=[];const io={inspect:async()=>structuredClone(snapshot),smoke:async sourceSha=>{smokeSources.push(sourceSha);return {ok:true,status:200};},latest:async()=>pointer,scopeHash:async()=> 'scope',archive:async j=>calls.push(['archive',structuredClone(j)]),append:async(r,p)=>{calls.push(['append',r,p]);return 'e'.repeat(40);},finish:async j=>calls.push(['finish',j])};
 return {input:{t,pointer,journal,rolloutId:'build-new',resolution:'abandon',reason:'Confirmed failed build; previous release still serves',operator:{actor:'writer'}},snapshot,io,calls,smokeSources};
}
test('failed terminal intent is abandoned with original journal and rollback evidence preserved before resolution',async()=>{
 const f=fixture();const original=structuredClone(f.input.journal);const result=await reconcileIntent(f.input,f.io);
 assert.equal(result.record.kind,'abandoned');assert.equal(result.record.previousGoodRecord,original.previousGoodRecord);
 assert.deepEqual(f.calls.map(x=>x[0]),['archive','append','finish']);assert.deepEqual(f.smokeSources,[original.before.sourceSha]);assert.deepEqual(f.calls[0][1],original);assert.deepEqual(f.input.journal,original);assert.equal(f.calls[1][2],f.input.pointer.commit);assert.equal(result.record.sourceSha,original.before.sourceSha);
});
test('failed ledger CAS keeps archived journal and never reports the intent resolved',async()=>{
 const f=fixture();f.io.append=async()=>{throw Error('competing writer');};await assert.rejects(reconcileIntent(f.input,f.io),/competing writer/);assert.deepEqual(f.calls.map(c=>c[0]),['archive']);assert.equal(f.input.journal.state,undefined);
});
test('active/unknown build, rollout, operation, traffic, submission and identity evidence reject before any write',async()=>{
 const mutations=[f=>{f.snapshot.builds[0].state='BUILDING';},f=>{f.snapshot.builds[0].state='NEW_UNKNOWN_STATE';},f=>{f.snapshot.rollouts[0].state='PENDING_ROLLOUT';},f=>{f.snapshot.rollouts[0].reconciling=true;},f=>{f.snapshot.operations.push({done:false});},f=>{f.snapshot.traffic.reconciling=true;},f=>{f.snapshot.traffic.target=[{build:'other',percent:100}];},f=>{f.snapshot.traffic.autoDisabled=false;},f=>{delete f.input.journal.submissionFinishedAt;},f=>{f.snapshot.rollouts=[];},f=>{f.snapshot.builds[0].sourceSha='f'.repeat(40);},f=>{f.snapshot.rollouts[0].createTime='2026-10-21T12:00:00Z';},f=>{f.input.journal.releaseId='wrong';},f=>{f.snapshot.current.sourceSha='f'.repeat(40);},f=>{f.snapshot.traffic.current[0].build='different';}];
 for(const mutate of mutations){const f=fixture();mutate(f);await assert.rejects(reconcileIntent(f.input,f.io));assert.equal(f.calls.length,0);}
});
test('recovery evidence or remote intent changing during verification cannot be abandoned',async()=>{
 for(const remote of [false,true]){const f=fixture();let n=0;if(remote)f.io.latest=async()=>({commit:'changed'});else f.io.inspect=async()=>{const v=structuredClone(f.snapshot);if(n++)v.rollouts.push({...v.rollouts[0],name:'new-rollout',state:'PENDING_BUILD'});return v;};await assert.rejects(reconcileIntent(f.input,f.io));assert.equal(f.calls.length,0);}
});
test('healthy successful exact-source outcome completes; it cannot be concealed by abandonment',async()=>{
 const f=fixture();f.snapshot.builds[0].state='READY';f.snapshot.rollouts[0].state='SUCCEEDED';f.snapshot.current={...f.snapshot.current,sourceSha:f.input.pointer.record.sourceSha,rollout:'build-new'};f.snapshot.traffic.current[0].build=`${f.input.t.backend}/builds/build-new`;
 await assert.rejects(reconcileIntent(f.input,f.io),/must be completed/);assert.equal(f.calls.length,0);
 f.input.resolution='complete';const r=await reconcileIntent(f.input,f.io);assert.equal(r.record.kind,'deploy');assert.equal(r.record.state,'SUCCEEDED');assert.deepEqual(f.smokeSources,[f.input.pointer.record.sourceSha,f.input.pointer.record.sourceSha]);
});
test('unrelated historical SKIPPED build and rollout do not block completion of the exact successful intent',async()=>{
 const f=fixture();f.snapshot.builds[0].state='READY';f.snapshot.rollouts[0].state='SUCCEEDED';f.snapshot.current={...f.snapshot.current,sourceSha:f.input.pointer.record.sourceSha,rollout:'build-new'};f.snapshot.traffic.current[0].build=`${f.input.t.backend}/builds/build-new`;
 const oldBuild={name:`${f.input.t.backend}/builds/old-skipped`,state:'SKIPPED',sourceSha:'f'.repeat(40),createTime:'2026-08-31T09:18:01Z',reconciling:false};
 const oldRollout={name:`${f.input.t.backend}/rollouts/old-skipped`,build:oldBuild.name,state:'SKIPPED',createTime:oldBuild.createTime,reconciling:false};
 f.snapshot.builds.push(oldBuild);f.snapshot.rollouts.push(oldRollout);f.input.resolution='complete';
 const r=await reconcileIntent(f.input,f.io);assert.equal(r.record.kind,'deploy');assert.equal(r.record.state,'SUCCEEDED');assert.equal(r.record.recovery.rollout,'build-new');
});
test('a SKIPPED build/rollout at or after submission remains unresolved',async()=>{
 const f=fixture();f.snapshot.builds[0].state='SKIPPED';f.snapshot.rollouts[0].state='SKIPPED';f.snapshot.current={...f.snapshot.current,sourceSha:f.input.pointer.record.sourceSha,rollout:'build-new'};f.snapshot.traffic.current[0].build=`${f.input.t.backend}/builds/build-new`;f.input.resolution='complete';
 f.snapshot.builds[0].createTime='2026-10-22T12:00:10Z';f.snapshot.rollouts[0].createTime='2026-10-22T12:00:10Z';
 await assert.rejects(reconcileIntent(f.input,f.io),/may still be active or its outcome is unknown/);assert.equal(f.calls.length,0);
});
test('an unhealthy terminal serving release is never known-good: completion fails, abandonment retains rollback-only evidence',async()=>{
 const f=fixture();f.snapshot.builds[0].state='READY';f.snapshot.rollouts[0].state='SUCCEEDED';f.snapshot.current={...f.snapshot.current,sourceSha:f.input.pointer.record.sourceSha,rollout:'build-new'};f.snapshot.traffic.current[0].build=`${f.input.t.backend}/builds/build-new`;f.io.smoke=async()=>({ok:false,status:503});
 f.input.resolution='complete';await assert.rejects(reconcileIntent(f.input,f.io));assert.equal(f.calls.length,0);f.input.resolution='abandon';const r=await reconcileIntent(f.input,f.io);assert.equal(r.record.kind,'abandoned');assert.equal(r.record.smoke.ok,false);assert.equal(r.record.previousGoodRecord,f.input.journal.previousGoodRecord);
});

test('unhealthy exact-source first production rollout cannot complete but can be explicitly abandoned with full evidence',async()=>{
 const t=target('adhoc','prod'),sourceSha='f'.repeat(40),releaseId='first-release-health-failure',started='2026-11-03T13:32:42Z',finished='2026-11-03T13:35:28Z';
 const plan={...t,sourceSha,scopeHash:'first-release-scope',approval:{id:'owner-approved-first-release'}};
 const journal={releaseId,plan,before:null,observedBefore:{sourceSha:null,rollout:null,state:'EMPTY',percent:0},previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:'d'.repeat(40),submissionStartedAt:started,submissionFinishedAt:finished};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:journal.firstReleaseBaselineRecord}};
 const build={name:`${t.backend}/builds/build-first`,state:'READY',sourceSha,createTime:'2026-11-03T13:32:54Z',reconciling:false};
 const rollout={name:`${t.backend}/rollouts/build-first`,build:build.name,state:'SUCCEEDED',createTime:build.createTime,reconciling:false};
 const snapshot={backend:{name:backendPath(t),environment:'production',rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/connections/apphosting-github-conn/gitRepositoryLinks/derekfika-fika-os',reconciling:false},builds:[build],rollouts:[rollout],operations:[],traffic:{current:[{build:build.name,percent:100}],target:[],reconciling:false,autoDisabled:true},current:{sourceSha,rollout:'build-first',state:'SUCCEEDED',percent:100}};
 assert.equal(assertRecoveryEvidence(pointer.record,journal,snapshot,'build-first').firstReleaseServing,true);
 const writes=[],io={inspect:async()=>structuredClone(snapshot),smoke:async sha=>({ok:false,status:503,reason:sha===sourceSha?'adhoc_auth_gate_not_fail_closed':'wrong_source'}),scopeHash:async()=>plan.scopeHash,latest:async()=>pointer,archive:async original=>writes.push(['archive',original]),append:async record=>{writes.push(['append',record]);return 'e'.repeat(40)},finish:async record=>writes.push(['finish',record])};
 await assert.rejects(reconcileIntent({t,pointer,journal,rolloutId:'build-first',resolution:'complete',reason:'Health probe is failing',operator:{actor:'owner'}},io),/Cannot complete without healthy exact-source serving evidence/);
 assert.equal(writes.length,0,'unhealthy production evidence cannot be marked complete');
 const out=await reconcileIntent({t,pointer,journal,rolloutId:'build-first',resolution:'abandon',reason:'First rollout serves but auth health probe fails',operator:{actor:'owner'}},io);
 assert.equal(out.record.kind,'abandoned');assert.equal(out.record.sourceSha,sourceSha);assert.equal(out.record.rollout,'build-first');assert.equal(out.record.state,'SUCCEEDED');assert.equal(out.record.percent,100);assert.equal(out.record.previousGood,null);assert.equal(out.record.previousGoodRecord,null);assert.equal(out.record.firstReleaseBaselineRecord,journal.firstReleaseBaselineRecord);assert.equal(out.record.smoke.ok,false);assert.equal(out.record.recovery.firstRelease,true);assert.equal(out.record.recovery.noPreviousRelease,true);assert.equal(out.record.recovery.evidenceHash.length,64);assert.equal(out.record.recovery.journalHash.length,64);
 assert.deepEqual(writes.map(x=>x[0]),['archive','append','finish']);assert.deepEqual(writes[0][1],journal);assert.equal(writes[1][1].rollout,'build-first');assert.equal(writes[2][1].state,'abandoned');
});

test('unhealthy first-release abandonment rejects unknown outcomes and changed readbacks before ledger writes',async()=>{
 const make=()=>{
  const t=target('adhoc','prod'),sourceSha='f'.repeat(40),releaseId='first-release-uncertain',started='2026-11-03T13:32:42Z',finished='2026-11-03T13:35:28Z';
  const plan={...t,sourceSha,scopeHash:'scope',approval:{id:'owner'}};const journal={releaseId,plan,before:null,observedBefore:{sourceSha:null,rollout:null,state:'EMPTY',percent:0},previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:'d'.repeat(40),submissionStartedAt:started,submissionFinishedAt:finished};
  const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId,previousGood:null,previousGoodRecord:null,firstRelease:true,firstReleaseBaselineRecord:journal.firstReleaseBaselineRecord}};
  const build={name:`${t.backend}/builds/build-first`,state:'READY',sourceSha,createTime:'2026-11-03T13:32:54Z',reconciling:false};const rollout={name:`${t.backend}/rollouts/build-first`,build:build.name,state:'SUCCEEDED',createTime:build.createTime,reconciling:false};
  const snapshot={backend:{name:backendPath(t),environment:'production',rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/connections/apphosting-github-conn/gitRepositoryLinks/derekfika-fika-os',reconciling:false},builds:[build],rollouts:[rollout],operations:[],traffic:{current:[{build:build.name,percent:100}],target:[],reconciling:false,autoDisabled:true},current:{sourceSha,rollout:'build-first',state:'SUCCEEDED',percent:100}};
  const writes=[];const io={inspect:async()=>structuredClone(snapshot),smoke:async()=>({ok:false,status:503}),scopeHash:async()=>plan.scopeHash,latest:async()=>pointer,archive:async()=>writes.push('archive'),append:async()=>{writes.push('append');return 'e'.repeat(40)},finish:async()=>writes.push('finish')};
  return {t,pointer,journal,snapshot,io,writes};
 };
 const unknown=make();unknown.snapshot.rollouts[0].state='RECONCILING';await assert.rejects(reconcileIntent({t:unknown.t,pointer:unknown.pointer,journal:unknown.journal,rolloutId:'build-first',resolution:'abandon',reason:'unknown',operator:{actor:'owner'}},unknown.io),/may still be active or its outcome is unknown/);assert.deepEqual(unknown.writes,[]);
 const changed=make();let reads=0;changed.io.inspect=async()=>{const result=structuredClone(changed.snapshot);if(reads++)result.traffic.current[0].percent=90;return result;};await assert.rejects(reconcileIntent({t:changed.t,pointer:changed.pointer,journal:changed.journal,rolloutId:'build-first',resolution:'abandon',reason:'changed readback',operator:{actor:'owner'}},changed.io),/changed during reconciliation/);assert.deepEqual(changed.writes,[]);
});
