import test from 'node:test';
import assert from 'node:assert/strict';
import { MAIN_CHECK, REPO, digest } from './policy.mjs';
import { assertMainReconciled, hotfixBranch, hotfixDiffHash, validateHotfixCandidate } from './hotfix.mjs';

const baseline = 'a'.repeat(40), source = 'b'.repeat(40), head = 'c'.repeat(40), rollout = 'build-serving-1';
function fixture(overrides = {}) {
  const paths = ['apps/integration-hub/lib/hospitality-booking-service.ts'];
  const blobs = { [paths[0]]: 'blob-sha256' };
  const releaseId = 'rcoa-2026-11';
  const manifest = { schema:'fika.hotfix.v1', app:'hub', releaseId, environment:'prod', branch:hotfixBranch('hub', releaseId),
    baselineSha:baseline, baselineRollout:rollout, reviewedHeadSha:head, paths, diffHash:hotfixDiffHash(paths, path => blobs[path]),
    configurationHash:'config-hash', tests:['application-tests','typecheck','build','security'] };
  return { app:'hub', releaseId, manifest, sourceSha:source, serving:{sourceSha:baseline,rollout}, firstParent:baseline, paths, blobs,
    pr:{number:601, merged_at:'2026-11-17T12:00:00Z', merge_commit_sha:source, base:{ref:manifest.branch,repo:{full_name:REPO}}, head:{sha:head}},
    protection:{enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},bypass_actors:[],
      required_pull_request_reviews:{required_approving_review_count:1},required_status_checks:{contexts:[MAIN_CHECK]}},
    checks:[{name:MAIN_CHECK,head_sha:source,conclusion:'success',app:{slug:'github-actions'}}],
    config:{baselineHash:'config-hash',currentHash:'config-hash'},releaseState:{explicitApproval:true,approvalApp:'hub',approvalSourceSha:source,approvalReason:'Approved emergency release',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'} ,...overrides };
}

test('accepts only an exact reviewed production hotfix candidate with matching baseline and governance evidence', () => {
  const result = validateHotfixCandidate(fixture());
  assert.deepEqual({ready:result.ready,app:result.app,sourceSha:result.sourceSha,baselineSha:result.baselineSha},
    {ready:true,app:'hub',sourceSha:source,baselineSha:baseline});
});
test('rejects a branch without protected review evidence', () => {
  const input=fixture(); input.protection.required_pull_request_reviews.required_approving_review_count=0;
  assert.throws(()=>validateHotfixCandidate(input),/target branch lacks verified/);
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
    {explicitApproval:true,approvalApp:'hub',approvalSourceSha:source,approvalReason:'  ',approvalActor:'owner',approvalId:'approval-1',approvalAt:'2026-11-17T12:00:00Z'},
  ]) assert.throws(()=>validateHotfixCandidate(fixture({releaseState})),/Explicit .* production approval/);
});
test('rejects active deployment lock, unresolved journal or rollout', () => {
  for (const key of ['lockActive','pendingJournal','activeRollout']) assert.throws(()=>validateHotfixCandidate(fixture({releaseState:{...fixture().releaseState,[key]:true}})),/active release lock/);
});
test('rejects unrelated app, config and dependency paths', () => {
  for (const path of ['apps/cpu-production/app/page.tsx','apps/integration-hub/apphosting.production.yaml','package-lock.json']) {
    const input=fixture(); input.paths=[path]; input.blobs={[path]:'blob'}; input.manifest.paths=[path]; input.manifest.diffHash=hotfixDiffHash([path],name=>input.blobs[name]);
    assert.throws(()=>validateHotfixCandidate(input),/unrelated application/);
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
