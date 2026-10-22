import test from 'node:test';
import assert from 'node:assert/strict';
import { HOSTED, assertHostedContext, hostedTrust } from './hosted.mjs';
import { APPS, target } from './policy.mjs';
const context = { GITHUB_ACTIONS:'true', GITHUB_EVENT_NAME:'workflow_dispatch', GITHUB_REPOSITORY:'derekfika/fika-os', GITHUB_REPOSITORY_ID:HOSTED.repositoryId,
  GITHUB_REPOSITORY_OWNER_ID:HOSTED.ownerId, GITHUB_REF:HOSTED.ref, GITHUB_WORKFLOW_REF:HOSTED.workflowRef, FIKA_RELEASE_ENVIRONMENT:'staging-cpu', GITHUB_RUN_ID:'123', GITHUB_ACTOR:'operator' };
test('hosted credentials require the exact authorised workflow/ref/repository/environment combination',()=>{
 assert.equal(assertHostedContext(context,target('cpu','staging')).actor,'operator');
 for(const key of ['GITHUB_ACTIONS','GITHUB_EVENT_NAME','GITHUB_REPOSITORY','GITHUB_REPOSITORY_ID','GITHUB_REPOSITORY_OWNER_ID','GITHUB_REF','GITHUB_WORKFLOW_REF','FIKA_RELEASE_ENVIRONMENT','GITHUB_RUN_ID','GITHUB_ACTOR']) assert.throws(()=>assertHostedContext({...context,[key]:key === 'GITHUB_ACTOR' ? '' : 'untrusted'},target('cpu','staging')));
 assert.throws(()=>assertHostedContext(context,target('cpu','prod')));assert.throws(()=>assertHostedContext(context,target('hub','staging')));
});
test('future WIF trust requires numeric identity, dispatch, main, exact workflow and exact app/environment subject',()=>{
 for(const app of Object.keys(APPS)) for(const env of ['staging','prod']) {
  const spec=hostedTrust(app,env);for(const claim of ['repository_id','repository_owner_id','ref','workflow_ref','event_name','sub'])assert.ok(spec.attributeCondition.includes(`assertion.${claim} ==`));
  assert.ok(spec.attributeCondition.includes(`repo:derekfika/fika-os:environment:${env}-${app}`));assert.equal(spec.attributeMapping['google.subject'],'assertion.sub');
 }
});
