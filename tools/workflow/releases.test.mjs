import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { protection } from './cli.mjs';
import { APPS, target, validateRecord } from './policy.mjs';
import { rolloutArguments } from './releases.mjs';
test('rollout command targets exactly one governed backend and skips Firebase prompt only after approval',()=>{
 for(const app of Object.keys(APPS)) for(const env of ['staging','prod']) {
  const t=target(app,env);const sourceSha='a'.repeat(40);const args=rolloutArguments({...t,sourceSha});
  assert.deepEqual(args,['apphosting:rollouts:create',t.backend,'--project',t.project,'--git-commit',sourceSha,'--non-interactive','--force']);
  assert.throws(()=>rolloutArguments({...t,sourceSha,backend:'unrelated-backend'}));assert.throws(()=>rolloutArguments({...t,sourceSha:'main'}));
 }
});
test('main/release protection prohibits force pushes and deletion',()=>{for(const release of [false,true]){const p=protection(release);assert.equal(p.allow_force_pushes,false);assert.equal(p.allow_deletions,false);assert.equal(p.enforce_admins,true);}assert.equal(protection(false).required_pull_request_reviews.required_approving_review_count,1);});
test('a pending release intent is never accepted as known-good rollback',()=>{assert.throws(()=>validateRecord({schema:'fika.release.v1',...target('cpu','prod'),sourceSha:'a'.repeat(40),kind:'intent',state:'PENDING'}));});
test('real release ledger preserves source objects; a competing stale writer is rejected before rollout',()=>{
 const base=mkdtempSync(path.join(os.tmpdir(),'fika-workflow-test-'));const remote=path.join(base,'remote.git'),repo=path.join(base,'repo');mkdirSync(repo);
 const git=(...a)=>execFileSync('git',a,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const moduleUrl=new URL('./releases.mjs',import.meta.url).href;
 const append=(record,parent,ok=true)=>{const code=`import {appendRecord} from ${JSON.stringify(moduleUrl)}; console.log(appendRecord(${JSON.stringify(target('cpu','staging'))},${JSON.stringify(record)},${JSON.stringify(parent)}));`;const r=spawnSync(process.execPath,['--input-type=module','-e',code],{cwd:repo,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);return r.stdout.trim();};
 try {
  execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('init','-b','main');git('config','user.name','Workflow fixture');git('config','user.email','test@example.invalid');writeFileSync(path.join(repo,'file'),'source');git('add','.');git('commit','-m','Source');git('remote','add','origin',remote);git('push','-u','origin','main');const sourceSha=git('rev-parse','HEAD');
  const record={schema:'fika.release.v1',...target('cpu','staging'),sourceSha,kind:'baseline',scopeHash:'fixture',state:'SUCCEEDED',percent:100,rollout:'fixture'};const baseline=append(record);assert.equal(JSON.parse(git('show',`${baseline}:release.json`)).sourceSha,sourceSha);
  const first=append({...record,kind:'intent',releaseId:'first',state:'PENDING'},baseline);append({...record,kind:'intent',releaseId:'competing',state:'PENDING'},baseline,false);
  assert.equal(git('ls-remote','origin','refs/heads/release/staging/cpu').split(/\s/)[0],first);assert.equal(git('merge-base','--is-ancestor',sourceSha,first),'');
 } finally {assert.equal(path.dirname(path.resolve(base)),path.resolve(os.tmpdir()));assert.ok(path.basename(base).startsWith('fika-workflow-test-'));rmSync(base,{recursive:true,force:true});}
});
