import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, affected, risk, target, exactSha, assertClean, validateRecord, partialPathOverlap, safeScope, assertResume, assertServingLineage } from './policy.mjs';
import { parse } from './cli.mjs';
const sha = 'a'.repeat(40);
test('registered apps have distinct staging/prod backends and explicit projects', () => {
  const backends = [];
  for (const app of Object.keys(APPS)) for (const env of ['prod', 'staging']) { const t = target(app, env); assert.equal(t.project, env === 'prod' ? 'fika-os' : 'fika-os-dev'); backends.push(t.backend); }
  assert.equal(new Set(backends).size, Object.keys(APPS).length * 2); assert.equal(target('cpu', 'prod').backend, 'fika-os-prod-cpu');
  assert.deepEqual(target('adhoc','staging'),{app:'adhoc',environment:'staging',project:'fika-os-dev',backend:'fika-os-staging-adhoc',region:'europe-west4',branch:'release/staging/adhoc'});
  assert.deepEqual(target('adhoc','prod'),{app:'adhoc',environment:'prod',project:'fika-os',backend:'fika-os-prod-adhoc',region:'europe-west4',branch:'release/prod/adhoc'});
});
test('unknown target and ambiguous environment fail closed', () => { assert.throws(() => target('cpu;firebase deploy', 'prod')); assert.throws(() => target('cpu', 'production')); assert.throws(() => parse(['deploy','cpu','--prod','--staging'])); });
test('exact SHA cannot be branch, abbreviation, option injection or uppercase', () => { for (const s of ['main','abc123','--all','A'.repeat(40),'']) assert.throws(() => exactSha(s)); assert.equal(exactSha(sha),sha); });
test('dirty workspaces cannot release', () => { assert.throws(() => assertClean('?? .env.local')); assertClean(''); });
test('app change affects only selected app', () => { assert.deepEqual(affected(['apps/cpu-production/app/styles.css']).apps,['cpu']); });
test('shared contract validates every registered consumer conservatively', () => { assert.equal(affected(['packages/server-shared/src/foo.ts']).apps.length,Object.keys(APPS).length); assert.equal(affected(['apps/shared/orders.ts']).apps.length,Object.keys(APPS).length); });
test('root dependency changes affect all registered apps; docs/tooling alone do not force app builds', () => { assert.equal(affected(['package-lock.json']).apps.length,Object.keys(APPS).length); assert.deepEqual(affected(['docs/deployment/workflow.md','tools/workflow/cli.mjs']).apps,[]); });
test('operational source defaults Standard; CSS/docs qualify Fast', () => { assert.equal(risk(['apps/cpu-production/app/styles.css','CHANGELOG.md']),'fast'); for (const p of ['apps/cpu-production/app/page.tsx','packages/server-shared/x.ts','.github/workflows/release.yml']) assert.equal(risk([p]),'standard'); });
test('release cannot claim another target or an unverified serving state', () => {
  const record={schema:'fika.release.v1',...target('cpu','prod'),sourceSha:sha,kind:'baseline',rollout:'b1',state:'SUCCEEDED',percent:100,scopeHash:'hash'};
  validateRecord(record,{app:'cpu',environment:'prod'}); assert.throws(()=>validateRecord({...record,backend:target('hub','prod').backend})); assert.throws(()=>validateRecord({...record,percent:50})); assert.throws(()=>validateRecord({...record,kind:'intent',state:'PENDING'})); assert.throws(()=>validateRecord(record,{app:'logistics'}));
});
test('only Ad-Hoc production accepts an explicit empty first-release baseline with no fabricated source or build',()=>{
 const record={schema:'fika.release.v1',...target('adhoc','prod'),kind:'empty-baseline',state:'EMPTY',percent:0,rollout:null,sourceSha:null,scopeHash:'backend-empty-proof',recovery:{firstRelease:true,noPreviousRelease:true}};
 validateRecord(record,{app:'adhoc',environment:'prod'});for(const change of [{app:'cpu'},{environment:'staging'},{sourceSha:sha},{rollout:'invented'},{percent:100},{recovery:{firstRelease:true}}])assert.throws(()=>validateRecord({...record,...change}));
});
test('solo-owner flags are explicit and obsolete approval-comment flags are rejected',()=>{
 const p=parse(['deploy','cpu','--prod','--execute','--owner-approved','--reason','Ship CPU']);assert.equal(p.options['owner-approved'],true);assert.equal(p.options.reason,'Ship CPU');assert.throws(()=>parse(['--approval-url','https://example.invalid/comment']));assert.equal(parse(['deploy','cpu','--prod','--execute']).options['owner-approved'],undefined);
});

test('scopes reject traversal; overlapping app/shared paths are detected',()=>{for(const s of ['../cpu','C:/repo','apps\\cpu','/root',''])assert.throws(()=>safeScope(s));assert.equal(partialPathOverlap('apps/cpu-production','apps/cpu-production/app'),true);assert.equal(partialPathOverlap('apps/cpu-production','apps/logistics'),false);});
test('CLI rejects unknown flags, duplicate flags and missing values',()=>{for(const args of [['--force'],['--prod','--prod'],['--sha']])assert.throws(()=>parse(args));assert.equal(parse(['deploy','cpu','--prod']).options.execute,undefined);});
test('script/bin-only root metadata does not rebuild registered apps',()=>assert.deepEqual(affected(['package.json'],{rootRuntimeChanged:false}).apps,[]));
test('pending resume is bound to original source, scope, target, approval, lease and rollback baseline',()=>{
 const plan={...target('cpu','prod'),sourceSha:sha,scopeHash:'tree',approval:{id:123}};const before={sourceSha:'b'.repeat(40),rollout:'previous'};const intent={schema:'fika.release.v1',...plan,kind:'intent',state:'PENDING',releaseId:'lease',previousGood:before};const journal={releaseId:'lease',plan,before};assertResume(intent,journal,plan);
 assert.throws(()=>assertResume(intent,undefined,plan));assert.throws(()=>assertResume(intent,{...journal,releaseId:'other'},plan));assert.throws(()=>assertResume(intent,{...journal,before:{sourceSha:'c'.repeat(40)}},plan));
 for(const key of ['app','environment','project','backend','sourceSha','scopeHash'])assert.throws(()=>assertResume(intent,journal,{...plan,[key]:'different'}));assert.throws(()=>assertResume(intent,journal,{...plan,approval:{id:456}}));assert.throws(()=>assertResume(intent,journal,{...plan,rollback:true}));
});
test('production never silently drops a deployed emergency release not yet in main',()=>{
 assert.throws(()=>assertServingLineage({environment:'prod'}, {},false,false));assertServingLineage({environment:'prod'}, {},true,false);assertServingLineage({environment:'prod'}, {},false,true);assertServingLineage({environment:'prod',rollback:true}, {},false,false);assertServingLineage({environment:'staging'}, {},false,false);
});
