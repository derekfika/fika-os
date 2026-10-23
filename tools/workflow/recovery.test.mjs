import test from 'node:test';
import assert from 'node:assert/strict';
import { target } from './policy.mjs';
import { recoverySnapshot, reconcileIntent } from './recovery.mjs';
test('recovery discovery paginates all histories and records no build environment or operation response payloads',async()=>{
 const t=target('cpu','staging');const prefix=`projects/123/locations/europe-west4/backends/${t.backend}`;const calls=[];
 const read=async resource=>{calls.push(resource);if(resource.endsWith('/traffic'))return {rolloutPolicy:{disabled:true},current:{splits:[{build:`${prefix}/builds/old`,percent:100}]}};
  if(resource.includes('/builds?'))return {builds:[{name:`${prefix}/builds/${resource.includes('pageToken=')?'second':'first'}`,state:'READY',config:{env:[{value:'DO_NOT_COPY'}]}}],...(resource.includes('pageToken=')?{}:{nextPageToken:'page2'})};
  if(resource.includes('/rollouts?'))return {rollouts:[],...(resource.includes('pageToken=')?{}:{nextPageToken:'page2'})};
  return {operations:[{name:'completed',done:true,response:{secret:'DO_NOT_COPY'}},{name:'other',metadata:{target:'projects/123/locations/europe-west4/backends/other-backend'}},{name:'unknown',done:false}]};};
 const s=await recoverySnapshot(t,read,async()=>({sourceSha:'a'.repeat(40),rollout:'old',state:'SUCCEEDED',percent:100}));
 assert.equal(s.builds.length,2);assert.equal(calls.filter(c=>c.includes('pageToken=')).length,2);assert.deepEqual(s.operations.map(o=>o.name),['unknown']);assert.equal(JSON.stringify(s).includes('DO_NOT_COPY'),false);
});

function fixture() {
 const t=target('cpu','staging');const sourceSha='a'.repeat(40);const old='b'.repeat(40);
 const plan={...t,sourceSha,scopeHash:'candidate',approval:{id:'staging:cpu:candidate'}};
 const before={sourceSha:old,rollout:'build-old',state:'SUCCEEDED',percent:100};
 const journal={releaseId:'123',plan,before,previousGoodRecord:'d'.repeat(40),submissionStartedAt:'2026-10-22T12:00:00Z',submissionFinishedAt:'2026-10-22T12:01:00Z'};
 const pointer={commit:'c'.repeat(40),record:{schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId:journal.releaseId,previousGood:before,previousGoodRecord:journal.previousGoodRecord}};
 const build={name:`${t.backend}/builds/build-new`,state:'FAILED',sourceSha,createTime:'2026-10-22T12:00:10Z'};
 const rollout={name:`${t.backend}/rollouts/build-new`,build:build.name,state:'FAILED',createTime:build.createTime,reconciling:false};
 const snapshot={builds:[build],rollouts:[rollout],operations:[],traffic:{current:[{build:`${t.backend}/builds/build-old`,percent:100}],target:[],reconciling:false,autoDisabled:true},current:structuredClone(before)};
 const calls=[];const io={inspect:async()=>structuredClone(snapshot),smoke:async()=>({ok:true,status:200}),latest:async()=>pointer,scopeHash:async()=> 'scope',archive:async j=>calls.push(['archive',structuredClone(j)]),append:async(r,p)=>{calls.push(['append',r,p]);return 'e'.repeat(40);},finish:async j=>calls.push(['finish',j])};
 return {input:{t,pointer,journal,rolloutId:'build-new',resolution:'abandon',reason:'Confirmed failed build; previous release still serves',operator:{actor:'writer'}},snapshot,io,calls};
}
test('failed terminal intent is abandoned with original journal and rollback evidence preserved before resolution',async()=>{
 const f=fixture();const original=structuredClone(f.input.journal);const result=await reconcileIntent(f.input,f.io);
 assert.equal(result.record.kind,'abandoned');assert.equal(result.record.previousGoodRecord,original.previousGoodRecord);
 assert.deepEqual(f.calls.map(x=>x[0]),['archive','append','finish']);assert.deepEqual(f.calls[0][1],original);assert.deepEqual(f.input.journal,original);assert.equal(f.calls[1][2],f.input.pointer.commit);assert.equal(result.record.sourceSha,original.before.sourceSha);
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
 f.input.resolution='complete';const r=await reconcileIntent(f.input,f.io);assert.equal(r.record.kind,'deploy');assert.equal(r.record.state,'SUCCEEDED');
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
