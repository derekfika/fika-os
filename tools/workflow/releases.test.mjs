import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { protection } from './cli.mjs';
import { APPS, target, validateRecord } from './policy.mjs';
import { rolloutArguments, assertFastTrack, executionAuthorization, releaseLane, assertStagingEvidence, releaseHealthProbe, authmodFailClosedRedirect } from './releases.mjs';
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
test('staging executes with repository-write authority and no approval comment or WIF',()=>{
 const access={env:{},github:endpoint=>endpoint==='user'?{login:'writer',type:'User'}:{permissions:{push:true}}};
 const auth=executionAuthorization(target('cpu','staging'),'a'.repeat(40),{},access);assert.equal(auth.actor,'writer');assert.equal(auth.explicitExecute,true);assert.equal(auth.method,'authenticated-repository-writer');
 assert.throws(()=>executionAuthorization(target('cpu','prod'),'a'.repeat(40),{},access));
 assert.throws(()=>executionAuthorization(target('cpu','staging'),'a'.repeat(40),{},{env:{},github:endpoint=>endpoint==='user'?{login:'reader',type:'User'}:{permissions:{push:false}}}));
});
test('production needs explicit owner release instruction bound to resolved scope/action, without review/comment API calls',()=>{
 const access={env:{},github:endpoint=>{assert.ok(endpoint==='user'||endpoint==='repos/derekfika/fika-os');return endpoint==='user'?{login:'owner',type:'User'}:{owner:{login:'owner'},permissions:{push:true}};}};
 const t=target('cpu','prod'),sha='a'.repeat(40),options={'owner-approved':true,reason:'Ship the CPU tablet change'};
 assert.throws(()=>executionAuthorization(t,sha,{execute:true,reason:'Implement this'},access));assert.throws(()=>executionAuthorization(t,sha,{'owner-approved':true,reason:''},access));
 const auth=executionAuthorization(t,sha,options,access);assert.equal(auth.method,'owner-instruction');assert.equal(auth.instruction,options.reason);assert.equal(auth.sourceSha,sha);assert.equal(auth.action,'deploy');
 for(const mutation of [{action:'rollback'},{action:'reconcile:abandon','release-id':'pending'}])assert.notEqual(executionAuthorization(t,sha,{...options,...mutation},access).id,auth.id);
 assert.notEqual(executionAuthorization(target('hub','prod'),sha,options,access).id,auth.id);assert.notEqual(executionAuthorization(t,'b'.repeat(40),options,access).id,auth.id);
 assert.throws(()=>executionAuthorization(t,sha,options,{env:{},github:endpoint=>endpoint==='user'?{login:'writer',type:'User'}:{owner:{login:'owner'},permissions:{push:true}}}));
});
test('cosmetics select Fast automatically; operational changes cannot skip matching integrated staging',()=>{
 const cosmetic={paths:['apps/cpu-production/app/ui/style.css'],risk:'fast'};assert.equal(releaseLane(cosmetic),'fast');assert.equal(releaseLane(cosmetic,false,true),'standard');
 const ui={paths:['apps/cpu-production/app/ui/Calendar.tsx'],risk:'standard'};assert.equal(releaseLane(ui),'standard');assert.equal(releaseLane(ui,true),'fast');
 const backend={paths:['apps/cpu-production/app/api/route.ts'],risk:'standard'};assert.equal(releaseLane(backend),'standard');assert.throws(()=>releaseLane(backend,true));assert.throws(()=>assertFastTrack({...backend,risk:'fast'},'fast','Risk: cosmetic-only'));
 const plan={app:'cpu',scopeHash:'scope'};const staged={commit:'e'.repeat(40),record:{schema:'fika.release.v1',...target('cpu','staging'),kind:'deploy',sourceSha:'a'.repeat(40),scopeHash:'scope',rollout:'build-staged',state:'SUCCEEDED',percent:100}};
 assert.equal(assertStagingEvidence(plan,staged,true),staged.commit);assert.throws(()=>assertStagingEvidence(plan,undefined,true));assert.throws(()=>assertStagingEvidence(plan,staged,false));assert.throws(()=>assertStagingEvidence({...plan,scopeHash:'changed'},staged,true));
});
test('rollout command targets exactly one governed backend and skips Firebase prompt only after approval',()=>{
 for(const app of Object.keys(APPS)) for(const env of ['staging','prod']) {
  const t=target(app,env);const sourceSha='a'.repeat(40);const args=rolloutArguments({...t,sourceSha});
  assert.deepEqual(args,['apphosting:rollouts:create',t.backend,'--project',t.project,'--git-commit',sourceSha,'--non-interactive','--force']);
  assert.throws(()=>rolloutArguments({...t,sourceSha,backend:'unrelated-backend'}));assert.throws(()=>rolloutArguments({...t,sourceSha:'main'}));
 }
});
test('solo-owner protection retains strict CI and prohibits force pushes/deletion, with zero mandatory human reviews',()=>{for(const release of [false,true]){const p=protection(release);assert.equal(p.allow_force_pushes,false);assert.equal(p.allow_deletions,false);assert.equal(p.enforce_admins,true);}const p=protection(false);assert.equal(p.required_pull_request_reviews.required_approving_review_count,0);assert.equal(p.required_pull_request_reviews.require_last_push_approval,false);assert.equal(p.required_status_checks.strict,true);assert.deepEqual(p.required_status_checks.contexts,['Workflow / merge-gate']);});
test('a pending release intent is never accepted as known-good rollback',()=>{assert.throws(()=>validateRecord({schema:'fika.release.v1',...target('cpu','prod'),sourceSha:'a'.repeat(40),kind:'intent',state:'PENDING'}));});
test('abandoned outcomes are never accepted as known-good rollback records',()=>{assert.throws(()=>validateRecord({schema:'fika.release.v1',...target('cpu','prod'),sourceSha:'a'.repeat(40),kind:'abandoned',state:'SUCCEEDED',percent:100,scopeHash:'scope',rollout:'build-new'}));});
test('Fast Track rejects PR1 backend changes hidden behind PR2 cosmetics, using the complete real Git production delta',()=>{
 const base=mkdtempSync(path.join(os.tmpdir(),'fika-workflow-test-'));const git=(...a)=>execFileSync('git',a,{cwd:base,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const moduleUrl=new URL('./releases.mjs',import.meta.url).href;
 const delta=(from,to,ok=true)=>{const r=spawnSync(process.execPath,['--input-type=module','-e',`import {productionDelta} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(productionDelta(${JSON.stringify(from)},${JSON.stringify(to)})));`],{cwd:base,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);return r.status===0?JSON.parse(r.stdout):undefined;};
 try {
  git('init','-b','main');git('config','user.name','Workflow test');git('config','user.email','test@example.invalid');writeFileSync(path.join(base,'README.md'),'fixture');git('add','.');git('commit','-m','Production baseline');const production=git('rev-parse','HEAD');
  mkdirSync(path.join(base,'apps/cpu-production/app/api'),{recursive:true});writeFileSync(path.join(base,'apps/cpu-production/app/api/route.ts'),'operational backend');git('add','.');git('commit','-m','PR1 backend');const pr1=git('rev-parse','HEAD');
  mkdirSync(path.join(base,'apps/cpu-production/app/ui'));writeFileSync(path.join(base,'apps/cpu-production/app/ui/style.css'),'cosmetic change');git('add','.');git('commit','-m','PR2 cosmetic');const pr2=git('rev-parse','HEAD');
  const complete=delta(production,pr2);assert.ok(complete.paths.includes('apps/cpu-production/app/api/route.ts'));assert.equal(complete.risk,'standard');assert.throws(()=>assertFastTrack(complete,'fast','Risk: cosmetic-only'),/Standard Track/);assertFastTrack(complete,'standard');
  const cosmetic=delta(pr1,pr2);assert.equal(cosmetic.risk,'fast');assertFastTrack(cosmetic,'fast');delta('f'.repeat(40),pr2,false);delta('main',pr2,false);assert.throws(()=>assertFastTrack(undefined,'fast'));
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

const backend = 'fika-logistics-staging--fika-os-dev.europe-west4.hosted.app';
const hubLocation = (extra = '', host = 'https://staging-os.fikacatering.com') => `${host}/?returnTo=${encodeURIComponent(`https://${backend}/`)}&launchError=FIKA_SESSION_MISSING&appId=logistics${extra}`;
const redirect = (location, status = 307) => async () => ({ ok: false, status, headers: new Headers(location === undefined ? {} : { location }) });
test('Logistics AUTHMOD fail-closed Hub redirect is a healthy release probe, fetched without following redirects', async () => {
  let request;
  const result = await releaseHealthProbe('logistics', backend, 'a'.repeat(40), async (url, options) => { request = { url, options }; return redirect(hubLocation())(); }, 'staging');
  assert.equal(result.ok, true); assert.equal(result.status, 307); assert.equal(result.authmodFailClosed, true);
  assert.equal(request.url, `https://${backend}/`); assert.equal(request.options.redirect, 'manual');
});
test('production Logistics accepts only the production Hub launch redirect', async () => {
  const prod = 'fika-os-prod-logistics--fika-os.europe-west4.hosted.app';
  const location = host => `${host}/?returnTo=${encodeURIComponent(`https://${prod}/`)}&launchError=FIKA_SESSION_MISSING&appId=logistics`;
  assert.equal((await releaseHealthProbe('logistics', prod, 'a'.repeat(40), redirect(location('https://os.fikacatering.com')), 'prod')).ok, true);
  assert.equal((await releaseHealthProbe('logistics', prod, 'a'.repeat(40), redirect(location('https://staging-os.fikacatering.com')), 'prod')).ok, false);
});
test('arbitrary, mismatched or widened redirects are never accepted as healthy', async () => {
  const cases = [
    ['other host', hubLocation('', 'https://evil.example.com')],
    ['lookalike host', hubLocation('', 'https://staging-os.fikacatering.com.evil.example')],
    ['http downgrade', hubLocation('', 'http://staging-os.fikacatering.com')],
    ['wrong app id', hubLocation('').replace('appId=logistics', 'appId=cpu')],
    ['different launch error', hubLocation('').replace('FIKA_SESSION_MISSING', 'FIKA_SESSION_EXPIRED')],
    ['returnTo another backend', hubLocation('').replace(encodeURIComponent(`https://${backend}/`), encodeURIComponent('https://other.hosted.app/'))],
    ['extra parameter', hubLocation('&next=https%3A%2F%2Fevil.example')],
    ['no location', undefined],
    ['not a URL', 'not a url'],
  ];
  for (const [name, location] of cases) assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), redirect(location), 'staging')).ok, false, name);
  assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), redirect(hubLocation(), 301), 'staging')).ok, false, 'permanent redirect');
  assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), async () => ({ ok: false, status: 401, headers: new Headers() }), 'staging')).ok, false, '401 alone');
  assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), async () => ({ ok: false, status: 503, headers: new Headers() }), 'staging')).ok, false, '5xx');
  assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), async () => { throw Error('timeout'); }, 'staging')).reason, 'request_failed');
  assert.equal((await releaseHealthProbe('logistics', backend, 'a'.repeat(40), async () => ({ ok: true, status: 200, headers: new Headers() }), 'staging')).ok, true, 'a plain 200 stays healthy');
});
test('other applications never get the redirect allowance and still reject redirects', async () => {
  const result = await releaseHealthProbe('cpu', backend, 'a'.repeat(40), async () => { throw Error('redirect: error semantics'); }, 'staging');
  assert.equal(result.ok, false);
  assert.equal(authmodFailClosedRedirect('cpu', 'staging', `https://${backend}`, { status: 307, headers: new Headers({ location: hubLocation().replace('appId=logistics', 'appId=cpu') }) }), false);
});
