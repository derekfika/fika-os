import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MAIN_CHECK, REPO } from './policy.mjs';
import { hotfixBranch, hotfixDiffHash } from './hotfix.mjs';
import { configurationDigest, hotfixManifestDigest, prepareHotfixRelease } from './hotfix-release.mjs';
import { withRepository } from './runtime.mjs';

const sourcePath='apps/integration-hub/lib/hospitality-booking-service.ts';
const releaseId='rcoa-2026-11';

async function fixture(run) {
  const temporary=mkdtempSync(path.join(os.tmpdir(),'fika-hotfix-release-'));
  const repository=path.join(temporary,'work'); mkdirSync(repository);
  const git=(...args)=>execFileSync('git',args,{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const commit=message=>{git('add','-A');git('commit','-m',message);return git('rev-parse','HEAD');};
  try{
    git('init','-b','main');git('config','user.name','Hotfix fixture');git('config','user.email','hotfix-fixture@example.invalid');
    const baselineFile=path.join(repository,sourcePath);mkdirSync(path.dirname(baselineFile),{recursive:true});writeFileSync(baselineFile,'served implementation\n');
    const baseline=commit('Serving baseline');git('switch','-c',hotfixBranch('hub',releaseId));git('switch','-c','candidate');
    writeFileSync(baselineFile,'reviewed hotfix implementation\n');
    const blob=git('hash-object',sourcePath);
    const backend={overrideEnv:[{variable:'FIKA_TEST_FLAG',value:'off'}]};
    const servingBuild={config:{effectiveEnv:[{variable:'FIKA_TEST_FLAG',value:'off',origin:'BACKEND_OVERRIDES'}]}};
    const configurationHash=configurationDigest(backend,servingBuild);
    const manifest={schema:'fika.hotfix.v1',app:'hub',releaseId,environment:'prod',branch:hotfixBranch('hub',releaseId),
      baselineSha:baseline,baselineRollout:'rollout-1',reviewedHeadSha:'',paths:[sourcePath],
      diffHash:hotfixDiffHash([sourcePath],()=>blob),configurationHash};
    manifest.manifestHash=hotfixManifestDigest(manifest);
    const changelogFile='.changes/integration-hub/2026-11-17-hotfix-fixture.md';
    mkdirSync(path.dirname(path.join(repository,changelogFile)),{recursive:true});
    writeFileSync(path.join(repository,changelogFile),`# 2026-11-17 Hotfix fixture\n\nValidation: isolated fixture.\nDeployment: none.\n\n<!-- fika-hotfix-manifest-sha256: ${manifest.manifestHash} -->\n`);
    const headSha=commit('Hotfix code and changelog');manifest.reviewedHeadSha=headSha;
    git('switch',hotfixBranch('hub',releaseId));git('merge','--no-ff','candidate','-m','Merge reviewed hotfix PR');
    const finalSource=git('rev-parse','HEAD');
    const firstParent=git('rev-parse',`${finalSource}^1`);
    const serving={sourceSha:baseline,rollout:'rollout-1'};
    const backendRecord={name:'projects/fika-os/locations/europe-west4/backends/fika-os-prod-hub',environment:'production',
      uri:'fika-os-prod-hub--fika-os.europe-west4.hosted.app',reconciling:false,etag:'test-etag',overrideEnv:backend.overrideEnv,
      codebase:{rootDirectory:'apps/integration-hub',repository:'projects/fika-os/locations/europe-west4/connections/fixture/gitRepositoryLinks/derekfika-fika-os'}};
    const build={name:'projects/fika-os/locations/europe-west4/backends/fika-os-prod-hub/builds/build-1',state:'READY',reconciling:false,
      source:{codebase:{hash:baseline}},config:servingBuild.config};
    const base='projects/fika-os/locations/europe-west4/backends/fika-os-prod-hub';
    const body=`<!-- fika-hotfix-manifest:start -->\n\`\`\`json\n${JSON.stringify(manifest)}\n\`\`\`\n<!-- fika-hotfix-manifest:end -->`;
    const pr={number:601,merged_at:'2026-11-17T12:00:00Z',merge_commit_sha:finalSource,body,
      base:{ref:hotfixBranch('hub',releaseId),repo:{full_name:REPO}},
      head:{sha:headSha,repo:{full_name:REPO}},user:{login:'candidate-author'}};
    const protection={enforce_admins:{enabled:true},allow_force_pushes:{enabled:false},allow_deletions:{enabled:false},
      required_pull_request_reviews:{required_approving_review_count:1,dismiss_stale_reviews:true},
      required_status_checks:{strict:true,contexts:[MAIN_CHECK],checks:[{context:MAIN_CHECK,app_id:15368}]}};
    const github=endpoint=>{
      if(endpoint.includes('/branches/')&&endpoint.endsWith('/protection'))return protection;
      if(endpoint.includes('/rules/branches/'))return [];
      if(endpoint.includes('/rulesets?'))return [];
      if(endpoint.endsWith(`/commits/${finalSource}/pulls?per_page=100`))return [pr];
      if(endpoint.includes('/commits/')&&endpoint.endsWith('/pulls?per_page=100'))return [];
      if(endpoint.endsWith('/pulls/601'))return pr;
      if(endpoint.endsWith('/pulls/601/reviews?per_page=100'))return [{id:2,state:'APPROVED',commit_id:headSha,user:{login:'reviewer'}}];
      if(endpoint.endsWith(`/commits/${finalSource}/check-runs?per_page=100`))return {check_runs:[{id:11,name:MAIN_CHECK,head_sha:finalSource,conclusion:'success',app:{slug:'github-actions'}}]};
      throw Error(`Unexpected GitHub request: ${endpoint}`);
    };
    const read=async resource=>{
      if(resource===`${base}/rollouts/rollout-1`)return {name:`${base}/rollouts/rollout-1`,build:build.name};
      if(resource===build.name)return build;
      throw Error(`Unexpected App Hosting request: ${resource}`);
    };
    return await withRepository(repository,()=>run({repository,git,baseline,sourceSha:finalSource,headSha,firstParent,serving,backend:backendRecord,github,read,pr,protection}));
  }finally{
    assert.equal(path.dirname(path.resolve(temporary)),path.resolve(os.tmpdir()));
    assert.match(path.basename(temporary),/^fika-hotfix-release-/);
    rmSync(temporary,{recursive:true,force:true});
  }
}

test('prepares a hotfix release only from its exact protected PR, source baseline and production configuration',()=>fixture(async f=>{
  const result=await prepareHotfixRelease({app:'hub',releaseId,sourceSha:f.sourceSha,serving:f.serving,backend:f.backend,github:f.github,read:f.read});
  assert.equal(result.observed.validated.ready,true);
  assert.equal(result.observed.sourceSha,f.sourceSha);
  assert.equal(result.observed.validated.baselineSha,f.baseline);
  assert.match(result.approvalHash,/^[a-f0-9]{64}$/);
}));

test('rejects effective protection gaps, stale approval, configuration drift and source mismatch',()=>fixture(async f=>{
  const original=f.github;
  f.github=endpoint=>endpoint.includes('/branches/')&&endpoint.endsWith('/protection')
    ? {...f.protection,required_pull_request_reviews:{required_approving_review_count:0}} : original(endpoint);
  await assert.rejects(prepareHotfixRelease({app:'hub',releaseId,sourceSha:f.sourceSha,serving:f.serving,backend:f.backend,github:f.github,read:f.read}),/no verifiable protected-PR/);
  f.github=endpoint=>endpoint.endsWith('/pulls/601/reviews?per_page=100')
    ? [{state:'APPROVED',commit_id:'f'.repeat(40),user:{login:'reviewer'}}] : original(endpoint);
  await assert.rejects(prepareHotfixRelease({app:'hub',releaseId,sourceSha:f.sourceSha,serving:f.serving,backend:f.backend,github:f.github,read:f.read}),/lacks a current non-author approval/);
  f.github=original;
  const drifted={...f.backend,overrideEnv:[{variable:'FIKA_TEST_FLAG',value:'changed'}]};
  await assert.rejects(prepareHotfixRelease({app:'hub',releaseId,sourceSha:f.sourceSha,serving:f.serving,backend:drifted,github:f.github,read:f.read}),/configuration drift/);
  await assert.rejects(prepareHotfixRelease({app:'hub',releaseId,sourceSha:'f'.repeat(40),serving:f.serving,backend:f.backend,github:f.github,read:f.read}),/Exactly one merged same-repository PR/);
}));

test('rejects a changed pull-request manifest that is not bound to the approved source commit',()=>fixture(async f=>{
  const original=f.github;
  f.github=endpoint=>endpoint.endsWith('/pulls/601')
    ? {...f.pr,body:f.pr.body.replace(f.pr.body.match(/"configurationHash":"([^"]+)"/)[1],'different-config-hash')}
    : original(endpoint);
  await assert.rejects(prepareHotfixRelease({app:'hub',releaseId,sourceSha:f.sourceSha,serving:f.serving,backend:f.backend,github:f.github,read:f.read}),/manifest is not bound/);
}));
