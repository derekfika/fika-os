import test from 'node:test';
import assert from 'node:assert/strict';
import { APPS, affected, risk, target, exactSha, assertClean, validateRecord, partialPathOverlap, safeScope, assertResume, assertServingLineage, supportedEnvironments, supportedTargets } from './policy.mjs';
import { parse } from './cli.mjs';
const sha = 'a'.repeat(40);
test('registered apps have distinct staging/prod backends and explicit projects', () => {
  const backends = [];
  for (const t of supportedTargets()) { assert.equal(t.project, t.environment === 'prod' ? 'fika-os' : 'fika-os-dev'); backends.push(t.backend); }
  assert.equal(new Set(backends).size, supportedTargets().length); assert.equal(target('cpu', 'prod').backend, 'fika-os-prod-cpu');
  assert.deepEqual(supportedEnvironments('beverage'), ['staging']); assert.equal(target('beverage', 'staging').backend, 'fika-beverage-staging'); assert.throws(() => target('beverage', 'prod'), /Unknown application\/environment/);
  assert.deepEqual(target('adhoc','staging'),{app:'adhoc',environment:'staging',project:'fika-os-dev',backend:'fika-os-staging-adhoc',region:'europe-west4',branch:'release/staging/adhoc'});
  assert.deepEqual(target('adhoc','prod'),{app:'adhoc',environment:'prod',project:'fika-os',backend:'fika-os-prod-adhoc',region:'europe-west4',branch:'release/prod/adhoc'});
});
test('unknown target and ambiguous environment fail closed', () => { assert.throws(() => target('cpu;firebase deploy', 'prod')); assert.throws(() => target('cpu', 'production')); assert.throws(() => parse(['deploy','cpu','--prod','--staging'])); });
test('exact SHA cannot be branch, abbreviation, option injection or uppercase', () => { for (const s of ['main','abc123','--all','A'.repeat(40),'']) assert.throws(() => exactSha(s)); assert.equal(exactSha(sha),sha); });
test('dirty workspaces cannot release', () => { assert.throws(() => assertClean('?? .env.local')); assertClean(''); });
test('app change affects only selected app', () => { assert.deepEqual(affected(['apps/cpu-production/app/styles.css']).apps,['cpu']); });
test('Ad-Hoc app paths select exactly one canonical matrix entry', () => { assert.deepEqual(affected(['apps/ad-hoc-production/app/page.tsx']).apps,['adhoc']); });
test('shared contract validates every registered consumer conservatively', () => { assert.equal(affected(['packages/server-shared/src/foo.ts']).apps.length,Object.keys(APPS).length); assert.equal(affected(['apps/shared/orders.ts']).apps.length,Object.keys(APPS).length); });
test('root dependency changes affect all registered apps; docs/tooling alone do not force app builds', () => { assert.equal(affected(['package-lock.json']).apps.length,Object.keys(APPS).length); assert.deepEqual(affected(['docs/deployment/workflow.md','tools/workflow/cli.mjs']).apps,[]); });
test('operational source defaults Standard; CSS/docs qualify Fast', () => { assert.equal(risk(['apps/cpu-production/app/styles.css','CHANGELOG.md']),'fast'); for (const p of ['apps/cpu-production/app/page.tsx','packages/server-shared/x.ts','.github/workflows/release.yml']) assert.equal(risk([p]),'standard'); });
test('release cannot claim another target or an unverified serving state', () => {
  const record={schema:'fika.release.v1',...target('cpu','prod'),sourceSha:sha,kind:'baseline',rollout:'b1',state:'SUCCEEDED',percent:100,scopeHash:'hash'};
  validateRecord(record,{app:'cpu',environment:'prod'}); assert.throws(()=>validateRecord({...record,backend:target('hub','prod').backend})); assert.throws(()=>validateRecord({...record,percent:50})); assert.throws(()=>validateRecord({...record,kind:'intent',state:'PENDING'})); assert.throws(()=>validateRecord(record,{app:'logistics'}));
});
test('abandoned releases require complete recovery evidence and preserve first-release or previous-good lineage',()=>{
 const abandoned={schema:'fika.release.v1',...target('adhoc','prod'),sourceSha:sha,kind:'abandoned',rollout:'build-first',state:'SUCCEEDED',percent:100,scopeHash:'scope',originalIntent:'b'.repeat(40),previousGood:null,previousGoodRecord:null,firstReleaseBaselineRecord:'c'.repeat(40),smoke:{ok:false,status:503},recovery:{resolution:'abandon',reason:'Unhealthy first deployment',rollout:'build-first',firstRelease:true,noPreviousRelease:true,evidenceHash:'d'.repeat(64),journalHash:'e'.repeat(64),at:'2026-11-03T12:00:00.000Z',operator:{sourceSha:sha}}};
 validateRecord(abandoned,{app:'adhoc',environment:'prod'});
 for(const change of [{recovery:{...abandoned.recovery,resolution:'complete'}},{recovery:{...abandoned.recovery,rollout:'different-build'}},{recovery:{...abandoned.recovery,firstRelease:false}},{recovery:{...abandoned.recovery,operator:{sourceSha:'f'.repeat(40)}}},{smoke:{ok:true,status:200}},{firstReleaseBaselineRecord:null},{environment:'staging'}]) assert.throws(()=>validateRecord({...abandoned,...change}));
 const failedWithoutRollout={...abandoned,state:'FAILED',percent:0,rollout:null,smoke:{ok:false,status:null},recovery:{...abandoned.recovery,rollout:null}};validateRecord(failedWithoutRollout,{app:'adhoc',environment:'prod'});
 const previous={sourceSha:'a'.repeat(40),rollout:'build-previous',state:'SUCCEEDED',percent:100};
 const nonFirst={...abandoned,...target('cpu','prod'),sourceSha:previous.sourceSha,rollout:previous.rollout,previousGood:previous,previousGoodRecord:'f'.repeat(40),firstReleaseBaselineRecord:undefined,smoke:{ok:true,status:200},recovery:{...abandoned.recovery,firstRelease:undefined,noPreviousRelease:undefined,rollout:previous.rollout,operator:{sourceSha:'b'.repeat(40)}}};
 validateRecord(nonFirst,{app:'cpu',environment:'prod'});
 const retainedServing={...nonFirst,recovery:{...nonFirst.recovery,rollout:'build-abandoned'}};
 validateRecord(retainedServing,{app:'cpu',environment:'prod'});
 assert.throws(()=>validateRecord({...retainedServing,previousGood:{...previous,rollout:'different-serving-build'}},{app:'cpu',environment:'prod'}));
 assert.throws(()=>validateRecord({...retainedServing,recovery:{...retainedServing.recovery,rollout:'bad ID'}},{app:'cpu',environment:'prod'}));
 const unhealthyCandidate={...nonFirst,sourceSha:'b'.repeat(40),rollout:'build-candidate',smoke:{ok:false,status:503},recovery:{...nonFirst.recovery,rollout:'build-candidate'}};validateRecord(unhealthyCandidate,{app:'cpu',environment:'prod'});
 assert.throws(()=>validateRecord({...nonFirst,previousGoodRecord:null},{app:'cpu',environment:'prod'}));
});
test('only Ad-Hoc production accepts an explicit empty first-release baseline with no fabricated source or build',()=>{
 const record={schema:'fika.release.v1',...target('adhoc','prod'),kind:'empty-baseline',state:'EMPTY',percent:0,rollout:null,sourceSha:null,scopeHash:'backend-empty-proof',recovery:{firstRelease:true,noPreviousRelease:true}};
 validateRecord(record,{app:'adhoc',environment:'prod'});const legacy={...record,backend:'projects/fika-os/locations/europe-west4/backends/fika-os-prod-adhoc'};assert.equal(validateRecord(legacy,{app:'adhoc',environment:'prod'}),legacy);assert.throws(()=>validateRecord({...record,backend:'fika-os-prod-cpu'}));for(const change of [{app:'cpu'},{environment:'staging'},{sourceSha:sha},{rollout:'invented'},{percent:100},{recovery:{firstRelease:true}}])assert.throws(()=>validateRecord({...record,...change}));
});
test('release execution needs only the target and execute flag, and rejects obsolete policy flags', () => {
 const args = ['deploy','cpu','--prod','--execute'];
 assert.deepEqual({...parse(args).options},{prod:true,execute:true});
 assert.equal(parse([...args,'--reason','Operator note']).options.reason,'Operator note');
 for(const flag of ['--owner-approved','--cosmetic-only','--standard','--approval-url']) assert.throws(()=>parse([...args,flag]),/Unknown/);
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
