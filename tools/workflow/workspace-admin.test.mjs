import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './lifecycle-fixture.mjs';
import { withRepository, stateDir, save } from './runtime.mjs';
import { createWorkspace, workspaceRecords, checkWorkspace, finishWorkspace } from './workspaces.mjs';
import { beginWorkspaceOperation, authorityForCurrentWorkspace, governedOperation } from './workspace-state.mjs';
import { previewReleaseAll, releaseAllWorkspaces, RELEASE_CONFIRMATION, completeWorkspace, previewSweep, sweepWorkspaces, publicWorkspaceReport, recoverValidationOperation } from './workspace-admin.mjs';
import { installWorkspaceFences } from './workspace-fencing.mjs';

const authorize=()=>({login:'fixture-admin',administrator:true});
const deps={authorize};
const apply=(plan,extra={})=>releaseAllWorkspaces({'approve-hash':plan.planHash,confirm:RELEASE_CONFIRMATION,reason:'Owner approved fixture recovery',...extra},deps);
const make=(name='task-one',scope='src')=>createWorkspace(name,{owner:'fixture-owner',scope});

test('administrator revocation is previewed, concurrent-safe, idempotent, durable and deletes no work',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make(),two=make('task-two','other-two');const file=path.join(one.directory,'untracked.txt');writeFileSync(file,'unique');writeFileSync(path.join(one.directory,'.env'),'secret fixture');
    writeFileSync(path.join(one.directory,'README.md'),'stashed content');f.run(one.directory,'stash','push','-m','preserve fixture stash');const stash=f.git('stash','list','--format=%H');
    const before=f.git('for-each-ref','--format=%(refname) %(objectname)');const plan=previewReleaseAll(deps);
    assert.throws(()=>apply(plan,{confirm:'yes'}),/Type RELEASE/);assert.throws(()=>apply(plan,{reason:''}),/reason/);
    make('concurrent-task','other-three');assert.throws(()=>apply(plan),/fresh preview/);assert.equal(workspaceRecords().filter(r=>r.state==='active').length,3);
    const fresh=previewReleaseAll(deps);const event=apply(fresh);assert.equal(event.released.length,3);assert.equal(event.protected.length,0);
    assert.equal(readFileSync(file,'utf8'),'unique');assert.equal(readFileSync(path.join(one.directory,'.env'),'utf8'),'secret fixture');
    const after=f.git('for-each-ref','--format=%(refname) %(objectname)');for(const line of before.split('\n'))assert.ok(after.includes(line));
    assert.ok(existsSync(two.directory));assert.equal(apply(fresh).alreadyApplied,true);
    assert.equal(f.git('stash','list','--format=%H'),stash);
    assert.equal(workspaceRecords().filter(r=>r.state==='revoked').length,3);
    assert.throws(()=>checkWorkspace(one.name,{owner:one.owner}),/active task owner/);
    assert.throws(()=>withRepository(one.directory,authorityForCurrentWorkspace),/revoked/);
    assert.throws(()=>withRepository(one.directory,()=>beginWorkspaceOperation('validate')),/revoked/);
    assert.throws(()=>beginWorkspaceOperation('integrate',{workspace:one.name,owner:one.owner}),/revoked/);
    const journal=path.join(stateDir(),'workspace-revocations',`${fresh.planHash}.json`);assert.equal(JSON.parse(readFileSync(journal)).actor.login,'fixture-admin');
    const report=publicWorkspaceReport(workspaceRecords(),'2026-10-28T07:00:00Z');assert.match(report,/revoked/);assert.ok(!report.includes(f.base)&&!report.includes('secret fixture')&&!report.includes('.env'));
  });}finally{f.dispose();}
});
test('critical operations and release locks are protected, including interrupted operations',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make(),two=make('task-two','other-two');const operation=withRepository(one.directory,()=>beginWorkspaceOperation('validate'));
    let p=previewReleaseAll(deps);assert.equal(p.protectedCount,1);assert.equal(p.eligibleCount,1);
    let e=apply(p);assert.equal(e.released[0].name,two.name);assert.match(e.protected[0].reasons.join(),/In-flight or interrupted/);
    assert.equal(workspaceRecords().find(r=>r.name===one.name).state,'active');
    // A process disappearing does not release the durable marker or its lease.
    p=previewReleaseAll(deps);assert.equal(p.protectedCount,1);operation.end();
    writeFileSync(path.join(stateDir(),'release-cpu-staging.lock'),'fixture');
    p=previewReleaseAll(deps);assert.equal(p.eligibleCount,0);assert.match(p.entries[0].reasons.join(),/Never break/);
  });}finally{f.dispose();}
});
test('journal interruption before commit is a no-op; corrupt committed journals fail closed',()=>{
  const f=fixture();try{f.within(()=>{
    make();const p=previewReleaseAll(deps);mkdirSync(path.join(stateDir(),'workspace-revocations'),{recursive:true});
    writeFileSync(path.join(stateDir(),'workspace-revocations','interrupted.tmp'),'unfinished');assert.equal(workspaceRecords()[0].state,'active');
    apply(p);assert.equal(workspaceRecords()[0].state,'revoked');
    const file=path.join(stateDir(),'workspace-revocations',`${p.planHash}.json`);const e=JSON.parse(readFileSync(file));e.reason='tampered';writeFileSync(file,JSON.stringify(e));
    assert.throws(()=>workspaceRecords(),/integrity failure/);const invalid=previewReleaseAll(deps);assert.ok(invalid.integrityError);assert.equal(invalid.eligibleCount,0);
  });}finally{f.dispose();}
});
test('normal completion releases and retires; pushed open-PR branch and unique commits remain',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make();const out=completeWorkspace(one.name,{owner:one.owner});assert.equal(out.leaseReleased,true);assert.equal(out.retirement,'retired');assert.ok(!existsSync(one.directory));assert.ok(f.git('show-ref',`refs/heads/${one.branch}`));
    const two=make('task-pr');mkdirSync(path.join(two.directory,'src'));writeFileSync(path.join(two.directory,'src','x.txt'),'PR content');f.run(two.directory,'add','.');f.run(two.directory,'commit','-m','PR change');f.run(two.directory,'push','-u','origin',two.branch);
    const head=f.run(two.directory,'rev-parse','HEAD');const result=completeWorkspace(two.name,{owner:two.owner},{evidenceFor:()=>({pushed:true,inMain:false,pr:{number:123,url:'https://github.com/derekfika/fika-os/pull/123',state:'open',merged:false}})});assert.equal(result.pr.state,'open');assert.equal(result.retirement,'retired');assert.ok(existsSync(result.record.bundle));assert.equal(f.git('rev-parse',two.branch),head);assert.equal(f.git('rev-parse',`origin/${two.branch}`),head);
    assert.equal(completeWorkspace(two.name,{owner:two.owner}).retirement,'already-retired');
  });}finally{f.dispose();}
});
test('dirty, unique ignored and unpushed work require explicit preservation; interruption stays active',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make();mkdirSync(path.join(one.directory,'src'));writeFileSync(path.join(one.directory,'src','draft.txt'),'draft');writeFileSync(path.join(one.directory,'.env'),'must remain');
    assert.throws(()=>completeWorkspace(one.name,{owner:one.owner}),/Dirty/);assert.equal(workspaceRecords()[0].state,'active');
    const result=completeWorkspace(one.name,{owner:one.owner,preserve:true,reason:'Interrupted implementation explicitly preserved'});
    assert.equal(result.leaseReleased,true);assert.equal(result.retirement,'protected');assert.equal(readFileSync(path.join(one.directory,'.env'),'utf8'),'must remain');
    const payload=JSON.parse(readFileSync(result.record.preservedWork.recoveryFile));assert.equal(Buffer.from(payload.files[0].bytes,'base64').toString(),'draft');
    const two=make('task-unpushed');mkdirSync(path.join(two.directory,'src'));writeFileSync(path.join(two.directory,'src','a'),'unique');f.run(two.directory,'add','.');f.run(two.directory,'commit','-m','Unpushed');assert.throws(()=>completeWorkspace(two.name,{owner:two.owner}),/not pushed/);
    const p=previewSweep();assert.equal(p.eligibleCount,0);assert.ok(p.protectedCount>=2);
  });}finally{f.dispose();}
});
test('sweep retires only unchanged finished workspaces and retains dirty/ignored/active work',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make();finishWorkspace(one.name,{owner:one.owner});const two=make('task-ignored');writeFileSync(path.join(two.directory,'.env'),'keep');finishWorkspace(two.name,{owner:two.owner});make('task-active');
    const p=previewSweep();assert.equal(p.eligibleCount,1);assert.equal(p.protectedCount,2);assert.ok(p.candidateBytes>0);
    const out=sweepWorkspaces({'approve-hash':p.planHash},deps);assert.deepEqual(out.retired,[one.name]);assert.equal(readFileSync(path.join(two.directory,'.env'),'utf8'),'keep');assert.ok(f.git('show-ref',`refs/heads/${one.branch}`));
  });}finally{f.dispose();}
});
test('Git hook fences reject old-agent pushes after revocation and preserve prior hooks',()=>{
  const f=fixture();try{f.within(()=>{
    const hooks=path.join(f.repo,'.git','original-hooks');mkdirSync(hooks);writeFileSync(path.join(hooks,'pre-push'),'#!/bin/sh\nexit 0\n',{mode:0o755});f.git('config','core.hooksPath',hooks);
    const sourceRoot=fileURLToPath(new URL('../../',import.meta.url));const installed=installWorkspaceFences({sourceRoot});assert.equal(installed.original,hooks);assert.equal(installWorkspaceFences({sourceRoot}).alreadyInstalled,true);
    const one=make();const p=previewReleaseAll(deps);apply(p);
    assert.throws(()=>f.run(one.directory,'push','origin',one.branch),/FIKA HOLD|revoked|failed to push/);assert.ok(existsSync(path.join(hooks,'pre-push')));
  });}finally{f.dispose();}
});
test('scope check accepts only byte-identical inherited main content after concurrent integration',()=>{
  const f=fixture();try{f.within(()=>{
    const one=make();mkdirSync(path.join(f.repo,'other'));writeFileSync(path.join(f.repo,'other','provider.txt'),'validated main');f.git('add','.');f.git('commit','-m','Concurrent provider');f.git('push','origin','main');f.run(one.directory,'merge','origin/main');
    assert.deepEqual(checkWorkspace(one.name,{owner:one.owner}).inheritedFromMain,['other/provider.txt']);
    writeFileSync(path.join(one.directory,'other','provider.txt'),'unowned change');assert.throws(()=>checkWorkspace(one.name,{owner:one.owner}),/exceed owned scope/);
  });}finally{f.dispose();}
});
test('validation exit waits for concurrent registry access; exited validation recovery is audited',async()=>{
  const f=fixture();try{await f.within(async()=>{
    const one=make();await withRepository(one.directory,()=>governedOperation('validate',async()=>{
      const file=path.join(stateDir(),'workspaces.lock');writeFileSync(file,'fixture concurrent reader');setTimeout(()=>unlinkSync(file),50);return 'passed';
    }));
    assert.equal(readdirSync(path.join(stateDir(),'workspace-operations')).length,0);
    withRepository(one.directory,()=>beginWorkspaceOperation('validate'));
    assert.throws(()=>finishWorkspace(one.name,{owner:one.owner}),/in-flight or interrupted/);
    const file=readdirSync(path.join(stateDir(),'workspace-operations'))[0];const id=file.slice(0,-5);
    assert.throws(()=>recoverValidationOperation(id,{reason:'Fixture verified returned'},{authorize,processAlive:()=>true}),/confirmed exited/);
    const event=recoverValidationOperation(id,{reason:'Fixture verified returned'},{authorize,processAlive:()=>false});assert.equal(event.operation.kind,'validate');assert.ok(existsSync(path.join(stateDir(),'workspace-audit',`validation-recovery-${id}.json`)));assert.equal(readdirSync(path.join(stateDir(),'workspace-operations')).length,0);
  });}finally{f.dispose();}
});
