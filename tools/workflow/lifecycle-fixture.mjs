import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { withRepository } from './runtime.mjs';
export function fixture() {
  const base=mkdtempSync(path.join(tmpdir(),'fika-lifecycle-'));const repo=path.join(base,'repo'),remote=path.join(base,'remote.git');mkdirSync(repo);
  const run=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],windowsHide:true}).trim();
  const git=(...args)=>run(repo,...args);
  execFileSync('git',['init','--bare',remote],{stdio:'ignore',windowsHide:true});
  git('init','-b','main');git('config','user.name','Lifecycle fixture');git('config','user.email','fixture@example.invalid');
  writeFileSync(path.join(repo,'.gitignore'),'node_modules/\n.env\n');writeFileSync(path.join(repo,'README.md'),'fixture');git('add','.');git('commit','-m','Baseline');git('remote','add','origin',remote);git('push','-u','origin','main');
  return {base,repo,remote,git,run,within:fn=>withRepository(repo,fn),dispose(){const target=path.resolve(base);if(path.dirname(target)!==path.resolve(tmpdir())||!path.basename(target).startsWith('fika-lifecycle-'))throw Error('Unsafe fixture cleanup');rmSync(target,{recursive:true,force:true});}};
}
