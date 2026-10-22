import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, affected, risk, target, exactSha, assertClean, validateRecord, validateApproval, approvalText, partialPathOverlap, safeScope, assertResume, assertServingLineage } from './policy.mjs';
import { parse } from './cli.mjs';
const sha = 'a'.repeat(40);
test('six apps have distinct staging/prod backends and explicit projects', () => {
  const backends = [];
  for (const app of Object.keys(APPS)) for (const env of ['prod', 'staging']) { const t = target(app, env); assert.equal(t.project, env === 'prod' ? 'fika-os' : 'fika-os-dev'); backends.push(t.backend); }
  assert.equal(new Set(backends).size, 12); assert.equal(target('cpu', 'prod').backend, 'fika-os-prod-cpu');
});
test('unknown target and ambiguous environment fail closed', () => { assert.throws(() => target('cpu;firebase deploy', 'prod')); assert.throws(() => target('cpu', 'production')); assert.throws(() => parse(['deploy','cpu','--prod','--staging'])); });
test('exact SHA cannot be branch, abbreviation, option injection or uppercase', () => { for (const s of ['main','abc123','--all','A'.repeat(40),'']) assert.throws(() => exactSha(s)); assert.equal(exactSha(sha),sha); });
test('dirty workspaces cannot release', () => { assert.throws(() => assertClean('?? .env.local')); assertClean(''); });
test('app change affects only selected app', () => { assert.deepEqual(affected(['apps/cpu-production/app/styles.css']).apps,['cpu']); });
test('shared contract validates every direct core consumer conservatively', () => { assert.equal(affected(['packages/server-shared/src/foo.ts']).apps.length,6); assert.equal(affected(['apps/shared/orders.ts']).apps.length,6); });
test('root dependency changes affect all apps; docs/tooling alone do not force six builds', () => { assert.equal(affected(['package-lock.json']).apps.length,6); assert.deepEqual(affected(['docs/deployment/workflow.md','tools/workflow/cli.mjs']).apps,[]); });
test('operational source defaults Standard; CSS/docs qualify Fast', () => { assert.equal(risk(['apps/cpu-production/app/styles.css','CHANGELOG.md']),'fast'); for (const p of ['apps/cpu-production/app/page.tsx','packages/server-shared/x.ts','.github/workflows/release.yml']) assert.equal(risk([p]),'standard'); });
test('release cannot claim another target or an unverified serving state', () => {
  const record={schema:'fika.release.v1',...target('cpu','prod'),sourceSha:sha,kind:'baseline',rollout:'b1',state:'SUCCEEDED',percent:100,scopeHash:'hash'};
  validateRecord(record,{app:'cpu',environment:'prod'}); assert.throws(()=>validateRecord({...record,backend:target('hub','prod').backend})); assert.throws(()=>validateRecord({...record,percent:50})); assert.throws(()=>validateRecord({...record,kind:'intent',state:'PENDING'})); assert.throws(()=>validateRecord(record,{app:'logistics'}));
});
test('owner approval binds exact app, environment, SHA, lane and expiration', () => {
  const now=Date.parse('2026-10-22T12:00:00Z');const request={app:'cpu',environment:'prod',sha,lane:'standard',expires:'2026-10-23T12:00:00Z'};const c={user:{login:'owner',type:'User'},body:approvalText(request),created_at:'2026-10-22T11:00:00Z',id:1,html_url:'url'};const repo={owner:{login:'owner'}};
  validateApproval(c,repo,request,now);
  for (const mutation of [{app:'hub'},{environment:'staging'},{sha:'b'.repeat(40)},{lane:'fast'},{expires:'2026-10-21T00:00:00Z'}]) assert.throws(()=>validateApproval(c,repo,{...request,...mutation},now));
  assert.throws(()=>validateApproval({...c,user:{login:'agent',type:'User'}},repo,request,now)); assert.throws(()=>validateApproval({...c,user:{login:'owner',type:'Bot'}},repo,request,now));
});
test('expired, missing and unbounded approval do not unlock production', () => {
  const req={app:'cpu',environment:'prod',sha,lane:'fast',expires:'2027-01-01T00:00:00Z'}; assert.throws(()=>validateApproval({user:{login:'owner',type:'User'},body:approvalText(req),created_at:'2026-10-22T00:00:00Z'},{owner:{login:'owner'}},req,Date.parse('2026-10-22T12:00:00Z')));
});
test('scopes reject traversal; overlapping app/shared paths are detected',()=>{for(const s of ['../cpu','C:/repo','apps\\cpu','/root',''])assert.throws(()=>safeScope(s));assert.equal(partialPathOverlap('apps/cpu-production','apps/cpu-production/app'),true);assert.equal(partialPathOverlap('apps/cpu-production','apps/logistics'),false);});
test('CLI rejects unknown flags, duplicate flags and missing values',()=>{for(const args of [['--force'],['--prod','--prod'],['--sha']])assert.throws(()=>parse(args));assert.equal(parse(['deploy','cpu','--prod']).options.execute,undefined);});
test('script/bin-only root metadata does not rebuild six apps',()=>assert.deepEqual(affected(['package.json'],{rootRuntimeChanged:false}).apps,[]));
test('pending resume is bound to original source, scope, target, approval, lease and rollback baseline',()=>{
 const plan={...target('cpu','prod'),sourceSha:sha,scopeHash:'tree',approval:{id:123}};const before={sourceSha:'b'.repeat(40),rollout:'previous'};const intent={schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId:'lease',previousGood:before};const journal={releaseId:'lease',plan,before};assertResume(intent,journal,plan);
 assert.throws(()=>assertResume(intent,undefined,plan));assert.throws(()=>assertResume(intent,{...journal,releaseId:'other'},plan));assert.throws(()=>assertResume(intent,{...journal,before:{sourceSha:'c'.repeat(40)}},plan));
 for(const key of ['app','environment','project','backend','sourceSha','scopeHash'])assert.throws(()=>assertResume(intent,journal,{...plan,[key]:'different'}));assert.throws(()=>assertResume(intent,journal,{...plan,approval:{id:456}}));
});
test('production never silently drops a deployed emergency release not yet in main',()=>{
 assert.throws(()=>assertServingLineage({environment:'prod'}, {},false,false));assertServingLineage({environment:'prod'}, {},true,false);assertServingLineage({environment:'prod'}, {},false,true);assertServingLineage({environment:'prod',rollback:true}, {},false,false);assertServingLineage({environment:'staging'}, {},false,false);
});
