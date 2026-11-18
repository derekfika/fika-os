import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_CHECK, REPO, digest } from './policy.mjs';
import { assertHotfixFilesReconciled, assertMainReconciled, hotfixBranch, hotfixDiffHash, normalizeHotfixProtection, validateHotfixCandidate } from './hotfix.mjs';

const baseline = 'a'.repeat(40), source = 'b'.repeat(40), head = 'c'.repeat(40), rollout = 'build-serving-1';
function fixture(overrides = {}) {
  const paths = ['apps/integration-hub/lib/hospitality-booking-service.ts'];
  const blobs = { [paths[0]]: 'blob-sha256' };
  const releaseId = 'rcoa-2026-11';
  const manifest = { schema:'fika.hotfix.v1', app:'hub', releaseId, environment:'prod', branch:hotfixBranch('hub', releaseId),
    baselineSha:baseline, baselineRollout:rollout, reviewedHeadSha:head, paths, diffHash:hotfixDiffHash(paths, path => blobs[path]),
    configurationHash:'config-hash', tests:['application-tests','typecheck','build','security'] };
  return { app:'hub', releaseId, manifest, sourceSha:source, serving:{sourceSha:baseline,rollout}, firstParent:baseline, paths, blobs,
    pr:{number:601, merged_at:'2026-11-17T12:00:00Z', merge_commit_sha:source, user:{login:'candidate-author'}, base:{ref:manifest.branch,repo:{full_name:REPO}}, head:{sha:head,repo:{full_name:REPO}}},
    protection:{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},bypass_actors:[],
      required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true},
      required_status_checks:{strict:true,contexts:[MAIN_CHECK],checks:[{context:MAIN_CHECK,app_id:15368}]}},
    checks:[{name:MAIN_CHECK,head_sha:source,conclusion:'success',app:{slug:'github-actions'}}],
    reviews:[{state:'APPROVED',user:{login:'independent-reviewer'},commit_id:head}],
    config:{baselineHash:'config-hash',currentHash:'config-hash'},releaseState:{explicitApproval:true,approvalApp:'hub',approvalSourceSha:source,approvalReason:'Approved emergency release',approvalActor:'owner',approvalId:'approval-1',approvalHash:'d'.repeat(64),approvalAt:'2026-11-17T12:00:00Z'} ,...overrides };
}

test('accepts only an exact reviewed production hotfix candidate with matching baseline and governance evidence', () => {
  const result = validateHotfixCandidate(fixture());
  assert.deepEqual({ready:result.ready,app:result.app,sourceSha:result.sourceSha,baselineSha:result.baselineSha},
    {ready:true,app:'hub',sourceSha:source,baselineSha:baseline});
});
test('rejects a branch without protected review evidence', () => {
  const input=fixture(); input.protection.required_pull_request_reviews.required_approving_review_count=0;
  assert.throws(()=>validateHotfixCandidate(input),/target branch lacks verified/);
  const stale=fixture(); stale.reviews[0].commit_id='d'.repeat(40);
  assert.throws(()=>validateHotfixCandidate(stale),/lacks a current non-author approval/);
  const dismissed=fixture(); dismissed.reviews.push({id:3,state:'DISMISSED',submitted_at:'2026-11-17T12:01:00Z',commit_id:head,user:{login:'independent-reviewer'}});
  assert.throws(()=>validateHotfixCandidate(dismissed),/lacks a current non-author approval/);
});
test('rejects unmerged or mismatched PR branches even when a check exists', () => {
  const input=fixture(); input.pr.merged_at=null;
  assert.throws(()=>validateHotfixCandidate(input),/exact merge commit/);
  const wrong=fixture(); wrong.pr.base.ref='hotfix/prod/hospitality/other-release';
  assert.throws(()=>validateHotfixCandidate(wrong),/exact merge commit/);
});
test('rejects a candidate for the wrong application', () => {
  const input=fixture(); input.app='hospitality';
  assert.throws(()=>validateHotfixCandidate(input),/manifest target/);
});
test('rejects serving source or rollout drift', () => {
  const input=fixture(); input.serving={sourceSha:'d'.repeat(40),rollout};
  assert.throws(()=>validateHotfixCandidate(input),/source drift/);
});
test('rejects missing or non-exact merge-gate check', () => {
  for (const checks of [[],[{name:MAIN_CHECK,head_sha:head,conclusion:'success',app:{slug:'github-actions'}}],
    [{name:MAIN_CHECK,head_sha:source,conclusion:'failure',app:{slug:'github-actions'}}]]) {
    assert.throws(()=>validateHotfixCandidate(fixture({checks})),/Exact-source hotfix merge-gate/);
  }
});
test('rejects runtime configuration drift', () => {
  assert.throws(()=>validateHotfixCandidate(fixture({config:{baselineHash:'config-hash',currentHash:'drift'}})),/configuration drift/);
});
test('requires an explicit approval bound to the exact app and source SHA', () => {
  for (const releaseState of [
    {explicitApproval:false,approvalApp:'hub',approvalSourceSha:source,approvalReason:'Approved',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'},
    {explicitApproval:true,approvalApp:'hospitality',approvalSourceSha:source,approvalReason:'Approved',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'},
    {explicitApproval:true,approvalApp:'hub',approvalSourceSha:head,approvalReason:'Approved',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'},
    {explicitApproval:true,approvalApp:'hub',approvalSourceSha:source,approvalReason:'  ',approvalActor:'owner',approvalId:'approval-1',approvalHash:'d'.repeat(64),approvalAt:'2026-11-17T12:00:00Z'},
    {explicitApproval:true,approvalApp:'hub',approvalSourceSha:source,approvalReason:'Approved',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'},
  ]) assert.throws(()=>validateHotfixCandidate(fixture({releaseState})),/Explicit .* production approval/);
});
test('normalizes only the exact protected hotfix branch pattern and complete active rulesets', () => {
  const releaseId='rcoa-2026-11', branch=hotfixBranch('hub',releaseId);
  const ruleset={id:42,target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/hotfix/prod/hub/*'],exclude:[]}},bypass_actors:[],rules:[
    {type:'pull_request',parameters:{required_approving_review_count:1,dismiss_stale_reviews_on_push:true}},
    {type:'required_status_checks',parameters:{strict_required_status_checks_policy:true,required_status_checks:[{context:MAIN_CHECK,integration_id:15368}]}},
    {type:'workflows',parameters:{do_not_enforce_on_create:true,workflows:[{path:'.github/workflows/validate.yml',repository_id:1297704019,ref:'refs/heads/main'}]}},
    {type:'deletion'}, {type:'non_fast_forward'}]};
  const effectiveRules=ruleset.rules.map(({type})=>({type}));
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,rulesets:[ruleset],effectiveRules}).required_pull_request_reviews.required_approving_review_count,1);
  const classic={enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},
    required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true},
    required_status_checks:{strict:true,contexts:[MAIN_CHECK],checks:[{context:MAIN_CHECK,app_id:15368}]}};
  const workflowEvidence={type:'workflows',parameters:{workflows:[{path:'.github/workflows/validate.yml',repository_id:1297704019,ref:'refs/heads/main'}]}};
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[],effectiveRules:[]}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[],effectiveRules:[{...workflowEvidence,parameters:{workflows:[{path:'.github/workflows/other.yml',repository_id:1297704019,ref:'refs/heads/main'}]}}]}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[],effectiveRules:[{...workflowEvidence,parameters:{workflows:[{path:'.github/workflows/validate.yml',repository_id:7,ref:'refs/heads/main'}]}}]}),null);
  assert.ok(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[],effectiveRules:[workflowEvidence]}));
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[{...ruleset,bypass_actors:[{actor_id:1}]}],effectiveRules}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,classic,rulesets:[{target:'branch',enforcement:'active',conditions:{ref_name:{include:['refs/heads/hotfix/prod/*/*'],exclude:[]}},bypass_actors:[{actor_id:1}]}],effectiveRules}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch:branch.replace('hub','cpu'),rulesets:[ruleset],effectiveRules}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,rulesets:[{...ruleset,bypass_actors:[{actor_id:1}]}],effectiveRules}),null);
  assert.equal(normalizeHotfixProtection({app:'hub',releaseId,branch,rulesets:[{...ruleset,rules:ruleset.rules.slice(0,2)}],effectiveRules}),null);
});
test('rejects active deployment lock, unresolved journal or rollout', () => {
  for (const key of ['lockActive','pendingJournal','activeRollout']) assert.throws(()=>validateHotfixCandidate(fixture({releaseState:{...fixture().releaseState,[key]:true}})),/active release lock/);
});
test('rejects unrelated app, config and dependency paths', () => {
  for (const path of ['apps/cpu-production/app/page.tsx','apps/integration-hub/apphosting.production.yaml','package-lock.json']) {
    const input=fixture(); input.paths=[path]; input.blobs={[path]:'blob'}; input.manifest.paths=[path]; input.manifest.diffHash=hotfixDiffHash([path],name=>input.blobs[name]);
    assert.throws(()=>validateHotfixCandidate(input),/non-application-specific/);
  }
});
test('rejects changed content after manifest approval and force-pushable branch', () => {
  const input=fixture(); input.blobs[input.paths[0]]='changed';
  assert.throws(()=>validateHotfixCandidate(input),/contents differ/);
  const unsafe=fixture(); unsafe.protection.allow_force_pushes.enabled=true;
  assert.throws(()=>validateHotfixCandidate(unsafe),/target branch lacks verified/);
});
test('blocks future promotion until a merged, green main reconciliation records the hotfix lineage', () => {
  const hotfixRecord={kind:'hotfix',sourceSha:source,diffHash:digest('patch')};
  assert.throws(()=>assertMainReconciled(hotfixRecord,{}),/not fully reconciled/);
  assert.equal(assertMainReconciled(hotfixRecord,{hotfixSourceSha:source,diffHash:digest('patch'),mainPrMerged:true,mainCheckGreen:true,recordCommit:'e'.repeat(40)}),true);
});
test('main reconciliation requires nonempty persisted manifest paths and exact blobs', () => {
  const hotfix={sourceSha:source,manifest:{paths:['apps/integration-hub/lib/hospitality-booking-service.ts']}};
  const blobs=new Map([[`${source}:${hotfix.manifest.paths[0]}`,'reviewed-blob'],[`e${'e'.repeat(39)}:${hotfix.manifest.paths[0]}`,'reviewed-blob']]);
  const blobAt=(sha,file)=>blobs.get(`${sha}:${file}`) || null;
  assert.equal(assertHotfixFilesReconciled(hotfix,'e'.repeat(40),blobAt),true);
  assert.throws(()=>assertHotfixFilesReconciled({sourceSha:source,paths:hotfix.manifest.paths},'e'.repeat(40),blobAt),/manifest paths are unavailable/);
  assert.throws(()=>assertHotfixFilesReconciled({...hotfix,manifest:{paths:[]}},'e'.repeat(40),blobAt),/manifest paths are unavailable/);
  assert.throws(()=>assertHotfixFilesReconciled(hotfix,'e'.repeat(40),(sha,file)=>sha===source?'reviewed-blob':'changed-blob'),/exact reviewed hotfix file contents/);
});
