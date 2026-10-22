import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const cli=fileURLToPath(new URL('./cli.mjs',import.meta.url));
test('real Git workspace lifecycle, scoped concurrency, dirty preservation and retirement',()=>{
  const base=mkdtempSync(path.join(os.tmpdir(),'fika-workflow-test-'));const remote=path.join(base,'remote.git');const repo=path.join(base,'repo');mkdirSync(repo);
  const git=(...args)=>execFileSync('git',args,{cwd:repo,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  const run=(args,ok=true)=>{const r=spawnSync(process.execPath,[cli,...args],{cwd:repo,encoding:'utf8'});assert.equal(r.status===0,ok,r.stderr);return r.status===0?JSON.parse(r.stdout):r.stderr;};
  try {
    execFileSync('git',['init','--bare',remote],{stdio:'ignore'});git('init','-b','main');git('config','user.email','test@example.invalid');git('config','user.name','Workflow test');writeFileSync(path.join(repo,'README.md'),'fixture');writeFileSync(path.join(repo,'.gitignore'),'node_modules/\n.next/\n.env\n');git('add','.');git('commit','-m','Fixture baseline');git('remote','add','origin',remote);git('push','-u','origin','main');
    const one=run(['workspace','create','cpu-one','--owner','agent-one','--scope','apps/cpu-production']);assert.equal(one.state,'active');assert.equal(one.baseline,git('rev-parse','origin/main'));
    run(['workspace','create','cpu-two','--owner','agent-two','--scope','apps/cpu-production/app'],false);
    const two=run(['workspace','create','hub-one','--owner','agent-two','--scope','apps/integration-hub']);assert.ok(existsSync(two.directory));
    const runtimeUrl=new URL('./runtime.mjs',import.meta.url).href;
    for(const directory of [repo,one.directory]) {
      const sub=path.join(directory,'nested','inside');mkdirSync(sub,{recursive:true});
      const resolved=execFileSync(process.execPath,['--input-type=module','-e',`import {common} from ${JSON.stringify(runtimeUrl)};console.log(common());`],{cwd:sub,encoding:'utf8'}).trim();
      assert.equal(path.resolve(resolved),path.resolve(repo,'.git'));
    }
    run(['workspace','finish','cpu-one','--owner','wrong-owner'],false);
    assert.equal(run(['workspace','check','cpu-one','--owner','agent-one']).withinScope,true);
    writeFileSync(path.join(one.directory,'unfinished.txt'),'unique unfinished work');run(['workspace','check','cpu-one','--owner','agent-one'],false);run(['workspace','finish','cpu-one','--owner','agent-one'],false);run(['workspace','retire','cpu-one','--owner','agent-one'],false);assert.ok(existsSync(path.join(one.directory,'unfinished.txt')));
    // Remove only the fixture file this test created, not user files or a Git reset/clean.
    rmSync(path.join(one.directory,'unfinished.txt'));run(['workspace','finish','cpu-one','--owner','agent-one']);run(['workspace','retire','cpu-one','--owner','agent-one']);assert.equal(existsSync(one.directory),false);
    run(['workspace','finish','hub-one','--owner','agent-two']);run(['workspace','retire','hub-one','--owner','agent-two']);
    const generated=run(['workspace','create','cpu-generated','--owner','agent-one','--scope','apps/cpu-production']);
    mkdirSync(path.join(generated.directory,'node_modules'));writeFileSync(path.join(generated.directory,'node_modules','unique-note.txt'),'must survive even inside generated paths');writeFileSync(path.join(generated.directory,'.env'),'sensitive fixture');
    run(['workspace','finish','cpu-generated','--owner','agent-one']);run(['workspace','retire','cpu-generated','--owner','agent-one'],false);run(['workspace','retire','cpu-generated','--owner','agent-one','--preserve-generated'],false);
    assert.ok(existsSync(path.join(generated.directory,'node_modules','unique-note.txt')));rmSync(path.join(generated.directory,'.env'));
    const retired=run(['workspace','retire','cpu-generated','--owner','agent-one','--preserve-generated']);assert.equal(existsSync(generated.directory),false);assert.equal(readFileSync(path.join(retired.generatedArchive,'node_modules','unique-note.txt'),'utf8'),'must survive even inside generated paths');assert.ok(existsSync(path.join(retired.generatedArchive,'manifest.json')));
    const plan=run(['cleanup']);assert.equal(plan.stashes.length,0);assert.equal(plan.worktrees.length,1);
    const file=path.join(base,'plan.json');writeFileSync(file,JSON.stringify({...plan,baseline:'0'.repeat(40)}));run(['cleanup','--execute','--file',file,'--approve-hash',plan.planHash],false);
  } finally {
    const checked=path.resolve(base);assert.equal(path.dirname(checked),path.resolve(os.tmpdir()));assert.ok(path.basename(checked).startsWith('fika-workflow-test-'));rmSync(checked,{recursive:true,force:true});
  }
});
