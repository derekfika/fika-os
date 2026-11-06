import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { protection } from './cli.mjs';
import { APPS, target, validateRecord } from './policy.mjs';
import { rolloutArguments, executionEvidence, releaseHealthProbe, reconcile, validateServingBaselineSnapshot, servingBaselineRecord, inspectAdhocProductionState, stableAdhocProductionState, adhocEmptyBaselineRecord } from './releases.mjs';
import { backendPath } from './runtime.mjs';

for (const environment of ['staging', 'prod']) {
  test(`Hospitality ${environment} health requires the exact local entry redirect and a healthy workspace`, async () => {
    const backend = 'https://hospitality.hosted.app';
    const calls = [];
    const probe = fetchImpl => releaseHealthProbe('hospitality', backend, 'a'.repeat(40), fetchImpl, environment);
    const response = (status, location = '/workspace') => ({ ok: status === 200, status, headers: new Headers({ location }) });
    const ok = await probe(async (url, options) => {
      calls.push({ url, options });
      return response(calls.length === 1 ? 307 : 200);
    });
    assert.equal(ok.ok, true);
    assert.deepEqual(calls.map(call => call.url), [`${backend}/`, `${backend}/workspace`]);
    assert.ok(calls.every(call => call.options.redirect === 'manual' && call.options.cache === 'no-store'));

    for (const invalid of [response(200), response(302), response(307, ''), ...[
      '/workspace?x=1', 'https://external.test/workspace', '//external.test/workspace', '/', '/workspace/',
    ].map(location => response(307, location))]) {
      let count = 0;
      const result = await probe(async () => {
        count++;
        return invalid;
      });
      assert.equal(result.reason, 'unexpected_hospitality_entry_redirect');
      assert.equal(count, 1);
    }
    for (const status of [307, 401, 403, 404, 500]) {
      const result = await probe(async url => response(url === `${backend}/` ? 307 : status));
      assert.equal(result.reason, 'hospitality_workspace_unavailable');
    }
    const failed = await probe(async () => { throw Error('transport'); });
    assert.equal(failed.reason, 'request_failed');
  });
}
test('Menu Planner health probe requires the exact uncached build identity endpoint',async()=>{
 const sha='a'.repeat(40);let request;
 const ok=await releaseHealthProbe('menu','https://menu-backend.hosted.app/',sha,async(url,options)=>{request={url,options};return {status:200,json:async()=>({appId:'menu-planning',buildSha:sha})};});
 assert.deepEqual(ok,{ok:true,status:200,url:'https://menu-backend.hosted.app/api/build-info',appId:'menu-planning',buildSha:sha});
 assert.equal(request.url,'https://menu-backend.hosted.app/api/build-info');assert.equal(request.options.redirect,'manual');assert.equal(request.options.cache,'no-store');
});
test('Menu Planner health probe fails closed for redirects, statuses and missing or mismatched provenance',async()=>{
 const sha='a'.repeat(40);const response=(status,body)=>({status,json:async()=>body});
 for(const [res,reason] of [[response(307,{appId:'menu-planning',buildSha:sha}),'unexpected_redirect'],[response(503,{}),'unexpected_status'],[response(200,{appId:'cpu-production',buildSha:sha}),'app_identity_mismatch'],[response(200,{appId:'menu-planning'}),'missing_or_invalid_build_sha'],[response(200,{appId:'menu-planning',buildSha:'short'}),'missing_or_invalid_build_sha'],[response(200,{appId:'menu-planning',buildSha:'b'.repeat(40)}),'source_sha_mismatch'],[{status:200,json:async()=>{throw Error('invalid JSON');}},'invalid_json']]) {
  const result=await releaseHealthProbe('menu','menu-backend.hosted.app',sha,async()=>res);assert.equal(result.ok,false);assert.equal(result.reason,reason);
 }
 const network=await releaseHealthProbe('menu','menu-backend.hosted.app',sha,async()=>{throw Error('network down');});assert.equal(network.ok,false);assert.equal(network.reason,'request_failed');
 const invalidExpected=await releaseHealthProbe('menu','menu-backend.hosted.app','abc',async()=>{throw Error('must not fetch');});assert.equal(invalidExpected.ok,false);assert.equal(invalidExpected.reason,'invalid_expected_source_sha');
});
test('other application health probes retain root endpoint smoke semantics',async()=>{
 let request;const result=await releaseHealthProbe('cpu','cpu-backend.hosted.app','a'.repeat(40),async(url,options)=>{request={url,options};return {ok:true,status:200};});
 assert.deepEqual(result,{ok:true,status:200,url:'https://cpu-backend.hosted.app/'});assert.equal(request.url,'https://cpu-backend.hosted.app/');assert.equal(request.options.redirect,'error');
});
test('Ad-Hoc health requires a live entry and fail-closed unauthenticated identity endpoint',async()=>{
 const calls=[];const response=(status,location=null)=>({status,headers:new Headers(location?{location}:{})});
 const ok=await releaseHealthProbe('adhoc','adhoc-backend.hosted.app','a'.repeat(40),async(url,options)=>{calls.push({url,options});return calls.length===1?response(200):response(401);},'prod');
 assert.equal(ok.ok,true);assert.equal(ok.authGate,'unauthenticated_request_denied');assert.equal(calls.length,2);assert.equal(calls[0].options.redirect,'manual');assert.match(calls[1].url,/\/api\/me$/);
 for(const outcome of [[307,null],[200,307],[200,302]]){let n=0;const result=await releaseHealthProbe('adhoc','adhoc-backend.hosted.app','a'.repeat(40),async()=>{n++;return response(n===1?outcome[0]:outcome[1]||401,n===1&&outcome[0]===307?'/login':n===2&&outcome[1]===302?'/login':null);},'prod');assert.equal(result.ok,false);}
});
test('Ad-Hoc first-production prestate accepts only the exact quiescent empty backend',async()=>{
 const t=target('adhoc','prod'),base=backendPath(t);
 const snapshot={backend:{name:base,environment:'production',reconciling:false,codebase:{rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[]},target:{splits:[]}},builds:[],rollouts:[],operations:[]};
 const read=async resource=>{if(resource===base)return snapshot.backend;if(resource===`${base}/traffic`)return snapshot.traffic;if(resource.includes('/builds?'))return {builds:snapshot.builds};if(resource.includes('/rollouts?'))return {rollouts:snapshot.rollouts};return {operations:snapshot.operations};};
 const state=await inspectAdhocProductionState(t,read);assert.equal(state.state,'EMPTY');assert.equal(state.sourceSha,null);assert.equal(state.rollout,null);assert.equal(state.percent,0);
 const mutations=[
  ['root',s=>s.backend.codebase.rootDirectory='/apps/elsewhere'],
  ['auto-rollouts',s=>s.traffic.rolloutPolicy.disabled=false],
  ['current-traffic',s=>s.traffic.current.splits=[{build:`${base}/builds/x`,percent:100}]],
  ['target-traffic',s=>s.traffic.target.splits=[{build:`${base}/builds/x`,percent:100}]],
  ['build-history',s=>s.builds.push({name:'build-x',state:'FAILED'})],
  ['rollout-history',s=>s.rollouts.push({name:'rollout-x',state:'FAILED'})],
  ['active-operation',s=>s.operations.push({name:'op-x',done:false,target:base})],
 ];
 for(const [label,mutate] of mutations){const bad=structuredClone(snapshot);mutate(bad);await assert.rejects(inspectAdhocProductionState(t,async resource=>{if(resource===base)return bad.backend;if(resource===`${base}/traffic`)return bad.traffic;if(resource.includes('/builds?'))return {builds:bad.builds};if(resource.includes('/rollouts?'))return {rollouts:bad.rollouts};return {operations:bad.operations};}),label);}
});
test('Logistics staging health accepts only its exact unauthenticated staging Hub gate redirect',async()=>{
 const backend='https://fika-logistics-staging--fika-os-dev.europe-west4.hosted.app',url=`${backend}/`;
 const response=(status,location)=>({status,headers:{get:name=>name==='location'?location:null}});
 const valid='https://staging-os.fikacatering.com/?returnTo='+encodeURIComponent(url)+'&launchError=FIKA_SESSION_MISSING&appId=logistics';
 let request;const ok=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async(target,options)=>{request={target,options};return response(307,valid);},'staging');
 assert.deepEqual(ok,{ok:true,status:307,url,authGate:'FIKA_SESSION_MISSING'});
 assert.equal(request.target,url);assert.equal(request.options.redirect,'manual');assert.equal(request.options.cache,'no-store');
 for(const location of [
  valid.replace('staging-os.fikacatering.com','evil.example'),
  valid.replace('appId=logistics','appId=cpu-production'),
  valid.replace('launchError=FIKA_SESSION_MISSING','launchError=OTHER'),
  valid.replace(encodeURIComponent(url),encodeURIComponent(`${backend}/different`)),
  `${valid}&extra=1`,
  'https://staging-os.fikacatering.com/',
 ]) {
  const result=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async()=>response(307,location),'staging');
  assert.equal(result.ok,false,location);
 }
 const notRedirect=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async()=>response(200,null),'staging');
 assert.equal(notRedirect.ok,false);assert.equal(notRedirect.reason,'unexpected_logistics_auth_response');
});
test('Logistics production health accepts only its exact unauthenticated production Hub gate redirect',async()=>{
 const backend='https://fika-os-prod-logistics--fika-os.europe-west4.hosted.app',url=`${backend}/`;
 const response=(status,location)=>({status,headers:{get:name=>name==='location'?location:null}});
 const valid='https://os.fikacatering.com/?returnTo='+encodeURIComponent(url)+'&launchError=FIKA_SESSION_MISSING&appId=logistics';
 let request;const ok=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async(target,options)=>{request={target,options};return response(307,valid);},'prod');
 assert.deepEqual(ok,{ok:true,status:307,url,authGate:'FIKA_SESSION_MISSING'});
 assert.equal(request.target,url);assert.equal(request.options.redirect,'manual');assert.equal(request.options.cache,'no-store');
 for(const location of [
  valid.replace('os.fikacatering.com','evil.example'),
  valid.replace('appId=logistics','appId=cpu-production'),
  valid.replace('launchError=FIKA_SESSION_MISSING','launchError=OTHER'),
  valid.replace(encodeURIComponent(url),encodeURIComponent(`${backend}/different`)),
  `${valid}&extra=1`,
  valid.replace('https://os.fikacatering.com','https://staging-os.fikacatering.com'),
  'https://os.fikacatering.com/',
 ]) {
  const result=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async()=>response(307,location),'prod');
  assert.equal(result.ok,false,location);
 }
 const notRedirect=await releaseHealthProbe('logistics',backend,'a'.repeat(40),async()=>response(200,null),'prod');
 assert.equal(notRedirect.ok,false);assert.equal(notRedirect.reason,'unexpected_logistics_auth_response');
});
test('staging executes with repository-write authority and no approval comment or WIF',()=>{
 const access={env:{},github:endpoint=>endpoint==='user'?{login:'writer',type:'User'}:{permissions:{push:true}}};
 const auth=executionEvidence(target('cpu','staging'),'a'.repeat(40),{},access);assert.equal(auth.actor,'writer');assert.equal(auth.explicitExecute,true);assert.equal(auth.method,'authenticated-repository-writer');
 assert.equal(executionEvidence(target('cpu','prod'),'a'.repeat(40),{},access).actor,'writer');
 assert.throws(()=>executionEvidence(target('cpu','staging'),'a'.repeat(40),{},{env:{},github:endpoint=>endpoint==='user'?{login:'reader',type:'User'}:{permissions:{push:false}}}));
});
test('Hub serving baseline reconciliation accepts only exact healthy, stable staging evidence and preserves prior rollback evidence',()=>{
 const t=target('hub','staging'),sha='c'.repeat(40),rolloutId='build-2026-10-24-003',buildName=`${backendPath(t)}/builds/${rolloutId}`,trafficBuild=`projects/594727519934/locations/${t.region}/backends/${t.backend}/builds/${rolloutId}`;
 const snapshot={backend:{name:backendPath(t),environment:'staging',uri:'fika-os-staging--fika-os-dev.europe-west4.hosted.app',reconciling:false,codebase:{repository:'projects/fika-os-dev/locations/europe-west4/connections/apphosting-github-conn-wz4o9sx/gitRepositoryLinks/derekfika-fika-os',rootDirectory:'/apps/integration-hub'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:trafficBuild,percent:100}]}},build:{name:buildName,state:'READY',reconciling:false,source:{codebase:{hash:sha,commit:sha,uri:`https://github.com/derekfika/fika-os/commit/${sha}`}}},rollout:{name:`${backendPath(t)}/rollouts/${rolloutId}`,state:'SUCCEEDED',reconciling:false,build:buildName}};
 assert.deepEqual(validateServingBaselineSnapshot(t,snapshot,sha,rolloutId),{sourceSha:sha,rollout:rolloutId,state:'SUCCEEDED',percent:100});
 const previous={commit:'a'.repeat(40),record:{schema:'fika.release.v1',...t,sourceSha:'b'.repeat(40),kind:'baseline',scopeHash:'prior',rollout:'build-001',state:'SUCCEEDED',percent:100}};
 const authorization={actor:'owner',method:'authenticated-repository-writer',explicitExecute:true,action:'reconcile:serving-baseline',sourceSha:sha,releaseId:previous.commit,instruction:'Owner-authorized forward-looking staging reconciliation',authorisedAt:'2026-10-25T14:00:00.000Z'};
 const record=servingBaselineRecord(t,{snapshot,expectedSha:sha,expectedRollout:rolloutId,previous,previousCommit:previous.commit,authorization,observedAt:'2026-10-25T14:01:00.000Z',health:{ok:true,status:200},scopeHashValue:'verified-source-tree-hash'});
 assert.equal(record.kind,'baseline');assert.equal(record.previousGoodRecord,previous.commit);assert.equal(record.reconciliation.priorLedgerCommit,previous.commit);assert.equal(record.reconciliation.historicalGovernance.includes('Not established'),true);assert.deepEqual(record.reconciliation.excludedRollbackCandidates,['build-2026-10-24-002']);
});
test('Hub serving baseline reconciliation fails closed on target, SHA, traffic, rollout, source or authorization contradictions',()=>{
 const t=target('hub','staging'),sha='c'.repeat(40),id='build-2026-10-24-003',bn=`${backendPath(t)}/builds/${id}`;
 const base={backend:{name:backendPath(t),environment:'staging',uri:'fika-os-staging--fika-os-dev.europe-west4.hosted.app',reconciling:false,codebase:{repository:'projects/fika-os-dev/locations/europe-west4/connections/apphosting-github-conn-wz4o9sx/gitRepositoryLinks/derekfika-fika-os',rootDirectory:'/apps/integration-hub'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:`projects/594727519934/locations/${t.region}/backends/${t.backend}/builds/${id}`,percent:100}]}},build:{name:bn,state:'READY',reconciling:false,source:{codebase:{hash:sha,commit:sha,uri:`https://github.com/derekfika/fika-os/commit/${sha}`}}},rollout:{name:`${backendPath(t)}/rollouts/${id}`,state:'SUCCEEDED',reconciling:false,build:bn}};
 const bad=[s=>s.backend.name='other',s=>s.backend.environment='prod',s=>s.backend.codebase.rootDirectory='/wrong',s=>s.traffic.rolloutPolicy.disabled=false,s=>s.traffic.current.splits[0].percent=90,s=>s.traffic.current.splits.push({build:bn,percent:10}),s=>s.build.state='FAILED',s=>s.build.source.codebase.hash='d'.repeat(40),s=>s.rollout.state='FAILED',s=>s.rollout.build='other'];
 for(const mutate of bad){const s=structuredClone(base);mutate(s);assert.throws(()=>validateServingBaselineSnapshot(t,s,sha,id));}
 assert.throws(()=>validateServingBaselineSnapshot(target('hub','prod'),base,sha,id));
 const prev={commit:'a'.repeat(40),record:{schema:'fika.release.v1',...t,sourceSha:'b'.repeat(40),kind:'baseline',scopeHash:'p',rollout:'old',state:'SUCCEEDED',percent:100}};
 assert.throws(()=>servingBaselineRecord(t,{snapshot:base,expectedSha:sha,expectedRollout:id,previous:prev,previousCommit:prev.commit,authorization:{},observedAt:'2026-10-25T14:00:00.000Z',health:{ok:true,status:200}}),/authorization/i);
 assert.throws(()=>servingBaselineRecord(t,{snapshot:base,expectedSha:sha,expectedRollout:id,previous:prev,previousCommit:prev.commit,authorization:{actor:'owner',explicitExecute:true,action:'reconcile:serving-baseline',sourceSha:sha,releaseId:prev.commit,instruction:'ok',authorisedAt:'now'},observedAt:'2026-10-25T14:00:00.000Z',health:{ok:false,status:503}}),/health/i);
});
test('Menu production serving baseline requires exact healthy evidence and owner-bound append-only authorization',()=>{
 const t=target('menu','prod'),sha='c'.repeat(40),rolloutId='build-2026-11-04-003',base=backendPath(t),buildName=`${base}/builds/${rolloutId}`;
 const snapshot={backend:{name:base,environment:'production',uri:`${t.backend}--${t.project}.${t.region}.hosted.app`,reconciling:false,codebase:{repository:'projects/fika-os/locations/europe-west4/connections/apphosting-github-conn-w1hpt65/gitRepositoryLinks/derekfika-fika-os',rootDirectory:'/apps/menu-planning'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:`projects/111111111111/locations/${t.region}/backends/${t.backend}/builds/${rolloutId}`,percent:100}]}},build:{name:buildName,state:'READY',reconciling:false,source:{codebase:{hash:sha,commit:sha,uri:`https://github.com/derekfika/fika-os/commit/${sha}`}}},rollout:{name:`${base}/rollouts/${rolloutId}`,state:'SUCCEEDED',reconciling:false,build:buildName}};
 assert.deepEqual(validateServingBaselineSnapshot(t,snapshot,sha,rolloutId),{sourceSha:sha,rollout:rolloutId,state:'SUCCEEDED',percent:100});
 const bad=[s=>s.backend.environment='staging',s=>s.backend.uri='fika-os-menu-staging--fika-os-dev.europe-west4.hosted.app',s=>s.backend.codebase.rootDirectory='/apps/integration-hub',s=>s.traffic.current.splits[0].percent=90,s=>s.traffic.rolloutPolicy.disabled=false,s=>s.build.source.codebase.hash='d'.repeat(40),s=>s.rollout.state='FAILED'];
 for(const mutate of bad){const altered=structuredClone(snapshot);mutate(altered);assert.throws(()=>validateServingBaselineSnapshot(t,altered,sha,rolloutId));}
 assert.throws(()=>validateServingBaselineSnapshot(target('menu','staging'),snapshot,sha,rolloutId));
 const previous={commit:'a'.repeat(40),record:{schema:'fika.release.v1',...t,sourceSha:'b'.repeat(40),kind:'baseline',scopeHash:'prior',rollout:'build-2026-11-02-002',state:'SUCCEEDED',percent:100}};
 const authorization={actor:'owner',method:'owner-instruction',explicitExecute:true,action:'reconcile:serving-baseline',sourceSha:sha,releaseId:previous.commit,instruction:'Owner instruction in #357 to reconcile the existing Menu production baseline',authorisedAt:'2026-11-04T22:00:00.000Z'};
 const validation={id:123,url:'https://github.com/derekfika/fika-os/actions/runs/123',sha};
 const record=servingBaselineRecord(t,{snapshot,expectedSha:sha,expectedRollout:rolloutId,previous,previousCommit:previous.commit,authorization,observedAt:'2026-11-04T22:01:00.000Z',health:{ok:true,status:200,appId:'menu-planning',buildSha:sha},scopeHashValue:'verified-production-source-tree',validation});
 assert.equal(record.kind,'baseline');assert.equal(record.environment,'prod');assert.equal(record.sourceSha,sha);assert.equal(record.rollout,rolloutId);assert.equal(record.state,'SUCCEEDED');
 assert.equal(record.previousGoodRecord,previous.commit);assert.equal(record.reconciliation.priorLedgerCommit,previous.commit);assert.deepEqual(record.reconciliation.exactSourceValidation,validation);
 assert.match(record.reconciliation.historicalGovernance,/not established/i);
 assert.throws(()=>servingBaselineRecord(t,{snapshot,expectedSha:sha,expectedRollout:rolloutId,previous,previousCommit:previous.commit,authorization:{...authorization,releaseId:'d'.repeat(40)},observedAt:'2026-11-04T22:01:00.000Z',health:{ok:true,status:200,appId:'menu-planning',buildSha:sha},validation}),/authorization/i);
 assert.throws(()=>servingBaselineRecord(t,{snapshot,expectedSha:sha,expectedRollout:rolloutId,previous,previousCommit:previous.commit,authorization,observedAt:'2026-11-04T22:01:00.000Z',health:{ok:true,status:200,appId:'menu-planning',buildSha:'d'.repeat(40)},validation}),/health/i);
});
test('serving-baseline reconciliation uses the governed reconcile entry point and rejects other apps',async()=>{
 await assert.rejects(reconcile('cpu','prod',{resolution:'serving-baseline'}),/restricted to the governed Hub or Menu staging\/production backend/);
});
test('production execution evidence binds the authenticated writer to target, action and source', () => {
 const access = { env:{}, github:endpoint=>endpoint==='user' ? {login:'writer',type:'User'} : {owner:{login:'owner'},permissions:{push:true}} };
 const t = target('cpu','prod'), sha = 'a'.repeat(40);
 const evidence = executionEvidence(t,sha,{},access);
 assert.equal(evidence.method,'authenticated-repository-writer');
 assert.equal(evidence.actor,'writer');
 assert.equal(evidence.sourceSha,sha);
 assert.notEqual(executionEvidence(t,sha,{action:'rollback'},access).id,evidence.id);
 assert.notEqual(executionEvidence(t,'b'.repeat(40),{},access).id,evidence.id);
 assert.equal(executionEvidence(t,sha,{reason:'Operator note'},access).instruction,'Operator note');
});
test('rollout command targets exactly one governed backend and pins the exact source',()=>{
 for(const app of Object.keys(APPS)) for(const env of ['staging','prod']) {
  const t=target(app,env);const sourceSha='a'.repeat(40);const args=rolloutArguments({...t,sourceSha});
  assert.deepEqual(args,['apphosting:rollouts:create',t.backend,'--project',t.project,'--git-commit',sourceSha,'--non-interactive','--force']);
  assert.throws(()=>rolloutArguments({...t,sourceSha,backend:'unrelated-backend'}));assert.throws(()=>rolloutArguments({...t,sourceSha:'main'}));
 }
});
test('solo-owner protection retains strict CI and prohibits force pushes/deletion, with zero mandatory human reviews',()=>{for(const release of [false,true]){const p=protection(release);assert.equal(p.allow_force_pushes,false);assert.equal(p.allow_deletions,false);assert.equal(p.enforce_admins,true);}const p=protection(false);assert.equal(p.required_pull_request_reviews.required_approving_review_count,0);assert.equal(p.required_pull_request_reviews.require_last_push_approval,false);assert.equal(p.required_status_checks.strict,true);assert.deepEqual(p.required_status_checks.contexts,['Workflow / merge-gate']);});
test('a pending release intent is never accepted as known-good rollback',()=>{assert.throws(()=>validateRecord({schema:'fika.release.v1',...target('cpu','prod'),sourceSha:'a'.repeat(40),kind:'intent',state:'PENDING'}));});
test('abandoned outcomes are never accepted as known-good rollback records',()=>{assert.throws(()=>validateRecord({schema:'fika.release.v1',...target('cpu','prod'),sourceSha:'a'.repeat(40),kind:'abandoned',state:'SUCCEEDED',percent:100,scopeHash:'scope',rollout:'build-new'}));});
test('the informational production delta includes backend changes and subsequent CSS',()=>{
 const base=mkdtempSync(path.join(os.tmpdir(),'fika-workflow-test-'));const git=(...a)=>execFileSync('git',a,{cwd:base,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const moduleUrl=new URL('./releases.mjs',import.meta.url).href;
 const delta=(from,to,ok=true)=>{const r=spawnSync(process.execPath,['--input-type=module','-e',`import {productionDelta} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(productionDelta(${JSON.stringify(from)},${JSON.stringify(to)})));`],{cwd:base,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);return r.status===0?JSON.parse(r.stdout):undefined;};
 try {
  git('init','-b','main');git('config','user.name','Workflow test');git('config','user.email','test@example.invalid');writeFileSync(path.join(base,'README.md'),'fixture');git('add','.');git('commit','-m','Production baseline');const production=git('rev-parse','HEAD');
  mkdirSync(path.join(base,'apps/cpu-production/app/api'),{recursive:true});writeFileSync(path.join(base,'apps/cpu-production/app/api/route.ts'),'operational backend');git('add','.');git('commit','-m','PR1 backend');const pr1=git('rev-parse','HEAD');
  mkdirSync(path.join(base,'apps/cpu-production/app/ui'));writeFileSync(path.join(base,'apps/cpu-production/app/ui/style.css'),'cosmetic change');git('add','.');git('commit','-m','PR2 cosmetic');const pr2=git('rev-parse','HEAD');
  const complete=delta(production,pr2);assert.ok(complete.paths.includes('apps/cpu-production/app/api/route.ts'));assert.ok(complete.paths.includes('apps/cpu-production/app/ui/style.css'));
  const cosmetic=delta(pr1,pr2);assert.deepEqual(cosmetic.paths,['apps/cpu-production/app/ui/style.css']);delta('f'.repeat(40),pr2,false);delta('main',pr2,false);
 } finally {assert.equal(path.dirname(path.resolve(base)),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('fika-workflow-test-'));rmSync(base,{recursive:true,force:true});}
});
test('real release ledger preserves source objects; a competing stale writer is rejected before rollout',()=>{
 const base=mkdtempSync(path.join(os.tmpdir(),'fika-workflow-test-'));const remote=path.join(base,'remote.git'),repo=path.join(base,'repo');mkdirSync(repo);
 const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const moduleUrl=new URL('./releases.mjs',import.meta.url).href;
 const append=(record,parent,ok=true)=>{const code=`import {appendRecord} from ${JSON.stringify(moduleUrl)}; console.log(appendRecord(${JSON.stringify(target('cpu','staging'))},${JSON.stringify(record)},${JSON.stringify(parent)}));`;const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:repo,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);return r.stdout.trim();};
 try {
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('init','-b','main');git('config','user.name','Workflow fixture');git('config','user.email','test@example.invalid');writeFileSync(path.join(repo,'file'),'source');git('add','.');git('commit','-m','Source');git('remote','add','origin',remote);git('push','-u','origin','main');const sourceSha=git('rev-parse','HEAD');
  const record={schema:'fika.release.v1',...target('cpu','staging'),sourceSha,kind:'baseline',scopeHash:'fixture',state:'SUCCEEDED',percent:100,rollout:'fixture'};const baseline=append(record);assert.equal(JSON.parse(git('show',`${baseline}:release.json`)).sourceSha,sourceSha);
  const deployedRecord={...record,kind:'deploy',previousGoodRecord:baseline,previousGood:{sourceSha,rollout:'fixture'}};
  const deployed=append(deployedRecord,baseline);
  const selectCode=`import {rollbackSelection} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(rollbackSelection(${JSON.stringify(target('cpu','staging'))},${JSON.stringify({commit:deployed,record:deployedRecord})})));`;
  const selected=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',selectCode],{cwd:repo,encoding:'utf8'}));assert.deepEqual(selected,{record:baseline,sha:sourceSha});
  const noTargetCode=`import {rollbackSelection} from ${JSON.stringify(moduleUrl)};rollbackSelection(${JSON.stringify(target('cpu','staging'))},${JSON.stringify({commit:baseline,record})});`;
  assert.notEqual(spawnSync(process.execPath,['--input-type=module','-e',noTargetCode],{cwd:repo,encoding:'utf8'}).status,0);
  const first=append({...record,kind:'intent',releaseId:'first',state:'PENDING'},deployed);append({...record,kind:'intent',releaseId:'competing',state:'PENDING'},deployed,false);
  assert.equal(git('ls-remote','origin','refs/heads/release/staging/cpu').split(/\s/)[0],first);assert.equal(git('merge-base','--is-ancestor',sourceSha,first),'');
 } finally {assert.equal(path.dirname(path.resolve(base)),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('fika-workflow-test-'));rmSync(base,{recursive:true,force:true});}
});

test('Ad-Hoc empty first-release record uses the governed backend ID even when inspection returns a resource path',()=>{
 const t=target('adhoc','prod');const inspected={backend:backendPath(t),sourceSha:null,rollout:null,state:'EMPTY',percent:0,builds:[],rollouts:[],operations:[],traffic:{current:[],target:[],reconciling:false,autoDisabled:true}};
 const record=adhocEmptyBaselineRecord(t,inspected,'2026-11-03T00:00:00.000Z');assert.equal(record.backend,t.backend);assert.equal(record.sourceSha,null);assert.equal(record.rollout,null);assert.equal(validateRecord(record,t),record);
});

test('Ad-Hoc first-release retry accepts only the exact recorded unhealthy serving attempt',async()=>{
 const t=target('adhoc','prod'),base=backendPath(t),source='b'.repeat(40),rolloutId='build-first-unhealthy';
 const record={kind:'abandoned',app:'adhoc',environment:'prod',sourceSha:source,rollout:rolloutId,state:'SUCCEEDED',percent:100,previousGood:null,previousGoodRecord:null,firstReleaseBaselineRecord:'c'.repeat(40),smoke:{ok:false,status:503,reason:'adhoc_auth_gate_not_fail_closed'},recovery:{firstRelease:true,noPreviousRelease:true,resolution:'abandon',rollout:rolloutId}};
 const snapshot={backend:{name:base,environment:'production',reconciling:false,codebase:{rootDirectory:'apps/ad-hoc-production',repository:'projects/fika-os/locations/europe-west4/gitRepositoryLinks/derekfika-fika-os'}},traffic:{rolloutPolicy:{disabled:true},reconciling:false,current:{splits:[{build:`${base}/builds/${rolloutId}`,percent:100}]},target:{splits:[]}},builds:[{name:`${base}/builds/${rolloutId}`,state:'READY',reconciling:false,source:{codebase:{hash:source}}}],rollouts:[{name:`${base}/rollouts/${rolloutId}`,build:`${base}/builds/${rolloutId}`,state:'SUCCEEDED',reconciling:false}],operations:[]};
 const read=async resource=>{if(resource===base)return snapshot.backend;if(resource===`${base}/traffic`)return snapshot.traffic;if(resource.includes('/builds?'))return {builds:snapshot.builds};if(resource.includes('/rollouts?'))return {rollouts:snapshot.rollouts};return {operations:snapshot.operations};};
 const state=await inspectAdhocProductionState(t,read,{allowFailedHistory:record});assert.equal(state.unhealthyFirstRelease.sourceSha,source);assert.equal(state.unhealthyFirstRelease.rollout,rolloutId);assert.equal(state.traffic.current[0].percent,100);
 const stable=await stableAdhocProductionState(t,read,{allowFailedHistory:record});assert.equal(stable.unhealthyFirstRelease.rollout,rolloutId);
 await assert.rejects(inspectAdhocProductionState(t,read),'unexpected serving traffic');
 for(const mutate of [s=>s.traffic.current.splits[0].build=`${base}/builds/other`,s=>s.builds[0].source.codebase.hash='d'.repeat(40),s=>s.rollouts[0].state='BUILDING',s=>s.traffic.current.splits[0].percent=50]){const bad=structuredClone(snapshot);mutate(bad);await assert.rejects(inspectAdhocProductionState(t,async resource=>{if(resource===base)return bad.backend;if(resource===`${base}/traffic`)return bad.traffic;if(resource.includes('/builds?'))return {builds:bad.builds};if(resource.includes('/rollouts?'))return {rollouts:bad.rollouts};return {operations:bad.operations};},{allowFailedHistory:record}));}
 await assert.rejects(inspectAdhocProductionState(t,read,{allowFailedHistory:{...record,smoke:{ok:true}}}));
 const wrongEnv={...snapshot,backend:{...snapshot.backend,environment:null}};await assert.rejects(inspectAdhocProductionState(t,async resource=>resource===base?wrongEnv.backend:read(resource)));
});
